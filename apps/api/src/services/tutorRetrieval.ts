import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Retrieval + grounding for the AI Study Mentor ("Study Buddy") tutor -
// see plan/AI-Study-Mentor-Agent-Plan.md, Section 7 ("How a reply actually
// gets built") and Section 10, step 3. This module answers exactly one
// question: "given what the child is asking about, what real content in
// our own database - if any - is relevant enough to ground an answer in?"
// It never calls an AI model itself; it hands back either real retrieved
// text or an honest "nothing matched", and the caller (the not-yet-built
// POST /tutor/conversations/:id/messages route, Section 9) decides what to
// do with that - call Gemini with the retrieved text, or serve the
// template-only "I don't have that yet" fallback. Keeping retrieval and
// generation as two separate steps is what makes the refuse-rather-than-
// guess design in Section 2 enforceable in code rather than left to the
// model's judgement.
//
// Two entry points, matching Section 2's two entry points into the tutor:
//   - retrieveForQuestion  - "Explain this to me" on a specific wrong
//                            answer. We already know exactly which
//                            question; no fuzzy search needed, so this
//                            always "matches" (the question is real by
//                            definition) and just gathers its own
//                            explanation/tip plus any concept guide for
//                            its topic(s), scoped to the child's own class.
//   - retrieveForQuery     - the general "Ask your Study Buddy" chat. The
//                            child's free-text message is matched against
//                            the content bank via Postgres full-text
//                            search (see the module note below on why FTS
//                            and not a vector DB), and a genuine "nothing
//                            matched" is possible and expected.
//
// Class-scoping note (this is the one subtle correctness issue worth
// reading before changing this file): mcp-server.ts's get_concept_guide
// deliberately matches by topic tag ALONE and can return guides from
// multiple classes under the same tag (e.g. Year 3's "Fractions" vs 11+'s
// "Fractions, Decimals & Percentages" happen to be different tags today,
// but nothing stops two classes sharing one tag in the future the way the
// tool's own docstring anticipates - "Year 4 vs Year 5 versions of the
// same topic"). This module is NOT that tool - it always filters
// concept_guides and questions down to the calling profile's own
// class_id/subject_id before ranking anything, which is what actually
// prevents a Year 3 child ever being handed 11+-level material (or the
// reverse) through the tutor. Never remove the class_id filter from either
// query below to "widen" results.

export type RetrievedSource =
  | {
      type: "concept_guide";
      id: string;
      rank: number;
      topic: string;
      title: string;
      methodText: string;
      formula: string | null;
    }
  | {
      type: "question";
      id: string;
      rank: number;
      questionText: string;
      explanation: string;
      tip: string | null;
      topics: string[] | null;
    };

export interface RetrievalResult {
  matched: boolean;
  sources: RetrievedSource[];
}

// How relevant the single best result has to be before we trust it enough
// to ground an AI reply, on Postgres's ts_rank scale (roughly 0-1 for a
// single matched term with default weights, though it has no hard upper
// bound). This number is a starting guess, not a calibrated constant -
// deliberately set low (favouring "found something, maybe too loosely
// related" over "wrongly claimed nothing exists"), because the real cost
// of getting this wrong is asymmetric: a false "not found" denies a child
// a real answer that existed, while a borderline true match still only
// ever gets used to ground an explanation of REAL retrieved text, never to
// fabricate anything - the retrieved text is what Gemini is told to
// explain, not a free-form prompt. That said, this genuinely needs
// re-tuning once real transcripts exist: Section 8's match_score column on
// tutor_messages exists specifically so a future pass can look at actual
// matched/unmatched queries and their scores and pick a real threshold
// from data rather than a guess. Treat 0.05 as a placeholder to revisit,
// not a finished decision.
const MATCH_THRESHOLD = 0.05;

// How many candidate sources to hand to the generation step. Capped
// deliberately small - Gemini's free tier (Section 6) means every extra
// token in the prompt is a token against a shared daily budget (Section
// 9), and a Year 3-level explanation only ever needs one or two genuinely
// relevant sources, not a wall of loosely-related ones.
const MAX_RESULTS = 5;

function rankSources(sources: RetrievedSource[]): RetrievalResult {
  const sorted = [...sources].sort((a, b) => b.rank - a.rank).slice(0, MAX_RESULTS);
  const topRank = sorted[0]?.rank ?? 0;
  return { matched: topRank >= MATCH_THRESHOLD, sources: sorted };
}

// plainto_tsquery() ANDs every remaining lexeme together after stopword
// removal - which sounds right, but breaks real queries in practice. "How
// many grams are in a kilogram?" strips down to "many & gram & kilogram"
// (the english dictionary stems "many" to "mani", and it is NOT a
// stopword), and since no Year 3 concept guide happens to use the word
// "many", the strict AND fails the whole query even though "gram" and
// "kilogram" both appear right there in the Measurement & Units guide -
// confirmed as a real false negative via test-tutor-retrieval.ts, not a
// hypothetical. This helper builds an OR query instead - "many | gram |
// kilogram" - so a document needs only ONE of the query's real content
// words to be a candidate at all, and lets ts_rank (which rewards matching
// MORE of the terms, not just one) do the actual quality sorting that
// MATCH_THRESHOLD then filters on. Trade-off worth knowing: this trades
// away some precision for recall - a query sharing just one incidental
// word with an unrelated guide can now produce a very low-ranked match
// instead of no match at all, which makes MATCH_THRESHOLD more load-
// bearing than it was, not less. Returns null when the query has no real
// content words at all (all stopwords, or empty) - there is nothing
// honest to search for in that case.
async function buildOrTsQuery(queryText: string): Promise<string | null> {
  const [row] = await db.execute(sql`
    select tsvector_to_array(to_tsvector('english', ${queryText})) as lexemes
  `);
  const lexemes = ((row as any)?.lexemes ?? []) as string[];
  if (lexemes.length === 0) return null;
  return lexemes.join(" | ");
}

/**
 * "Explain this to me" on one specific wrong answer. The question is
 * already known and real, so this always matches - there is no fuzzy
 * search step and no "nothing found" case here (a missing questionId is a
 * caller bug, not a retrieval outcome, and should 404 upstream in the
 * route rather than flow through this function).
 *
 * Gathers the question's own explanation/tip plus any concept guide for
 * ANY of its topic tags, scoped to the profile's own class - a question
 * can carry more than one topic tag (schema.ts's own comment on
 * `questions.topics`), so this deliberately checks all of them rather than
 * just the first.
 */
export async function retrieveForQuestion(params: {
  questionId: string;
  classId: string;
  subjectId: string;
}): Promise<RetrievalResult> {
  const { questionId, classId, subjectId } = params;

  const questionRows = await db.execute(sql`
    select id, question_text as "questionText", explanation, tip, topics
    from questions
    where id = ${questionId}
    limit 1
  `);

  const question = questionRows[0] as
    | { id: string; questionText: string; explanation: string; tip: string | null; topics: string[] | null }
    | undefined;

  if (!question) {
    // Caller error, not a retrieval outcome - see doc comment above.
    return { matched: false, sources: [] };
  }

  const topics = question.topics ?? [];
  const guideRows =
    topics.length === 0
      ? []
      : await db.execute(sql`
          select id, topic, title, method_text as "methodText", formula
          from concept_guides
          where class_id = ${classId}
            and subject_id = ${subjectId}
            and topic = any(${sql.raw(`ARRAY[${topics.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]`)}::text[])
        `);

  const sources: RetrievedSource[] = [
    // Rank 1 for the question itself - it's the exact thing being asked
    // about, always the most relevant possible source.
    {
      type: "question",
      id: question.id,
      rank: 1,
      questionText: question.questionText,
      explanation: question.explanation,
      tip: question.tip,
      topics: question.topics,
    },
    ...guideRows.map((r: any) => ({
      type: "concept_guide" as const,
      id: r.id,
      rank: 0.9, // just under the question itself, but still always included
      topic: r.topic,
      title: r.title,
      methodText: r.methodText,
      formula: r.formula,
    })),
  ];

  return { matched: true, sources };
}

/**
 * The general "Ask your Study Buddy" chat. Full-text search over both
 * concept_guides (title + methodText) and questions (questionText +
 * explanation + tip), scoped to the child's own class + subject, ranked by
 * Postgres's ts_rank and thresholded via MATCH_THRESHOLD.
 *
 * Why Postgres full-text search and not a vector database: Section 5's
 * MCP-server work already established this project's content bank is
 * small enough (hundreds, not millions, of rows) that FTS is the right
 * tool - see mcp-server.ts's own description of search_content as "simple
 * filtering, not ranked full-text search" for the exact-tag-match tool;
 * this function is the ranked, fuzzy counterpart Section 7 describes,
 * built as a real query rather than deferred to a vector store this
 * project doesn't need yet.
 *
 * Uses to_tsvector() computed at query time rather than a stored/generated
 * tsvector column with a GIN index - correct and fast enough at this
 * content size (confirmed: under 300 concept-guide + question rows across
 * all of Year 3 Maths as of this writing), but worth revisiting with a
 * migration (a generated tsvector column + GIN index on both tables) if
 * the content bank grows enough that this becomes a measurable cost - not
 * a premature optimization to do now.
 */
export async function retrieveForQuery(params: {
  queryText: string;
  classId: string;
  subjectId: string;
}): Promise<RetrievalResult> {
  const { queryText, classId, subjectId } = params;

  const orQuery = await buildOrTsQuery(queryText);
  if (!orQuery) {
    // Nothing but stopwords, or an empty message - no real content word
    // to search on, so there is nothing honest to match against.
    return { matched: false, sources: [] };
  }

  const guideRows = await db.execute(sql`
    select
      id, topic, title, method_text as "methodText", formula,
      ts_rank(
        to_tsvector('english', title || ' ' || method_text),
        to_tsquery('english', ${orQuery})
      ) as rank
    from concept_guides
    where class_id = ${classId}
      and subject_id = ${subjectId}
      and to_tsvector('english', title || ' ' || method_text)
          @@ to_tsquery('english', ${orQuery})
    order by rank desc
    limit ${MAX_RESULTS}
  `);

  const questionRows = await db.execute(sql`
    select
      q.id, q.question_text as "questionText", q.explanation, q.tip, q.topics,
      ts_rank(
        to_tsvector('english', q.question_text || ' ' || q.explanation || ' ' || coalesce(q.tip, '')),
        to_tsquery('english', ${orQuery})
      ) as rank
    from questions q
    join documents d on d.id = q.document_id
    where d.class_id = ${classId}
      and q.subject_id = ${subjectId}
      and to_tsvector('english', q.question_text || ' ' || q.explanation || ' ' || coalesce(q.tip, ''))
          @@ to_tsquery('english', ${orQuery})
    order by rank desc
    limit ${MAX_RESULTS}
  `);

  const sources: RetrievedSource[] = [
    ...guideRows.map((r: any) => ({
      type: "concept_guide" as const,
      id: r.id,
      rank: Number(r.rank),
      topic: r.topic,
      title: r.title,
      methodText: r.methodText,
      formula: r.formula,
    })),
    ...questionRows.map((r: any) => ({
      type: "question" as const,
      id: r.id,
      rank: Number(r.rank),
      questionText: r.questionText,
      explanation: r.explanation,
      tip: r.tip,
      topics: r.topics,
    })),
  ];

  return rankSources(sources);
}