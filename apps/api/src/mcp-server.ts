import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { questions, subjects, conceptGuides } from "./db/schema.js";

// MCP server exposing the question bank to Claude Code directly - reuses
// the same Drizzle client/schema as the Fastify API (./db/client.js) rather
// than opening a second connection or duplicating the DB URL handling.
//
// Three tools (see AI-Study-Mentor-Agent-Plan.md, Section 5), each
// covering a different lookup shape so a caller never has to guess which
// one applies:
//   - get_question(id)               - fetch exactly ONE question by its id (this file)
//   - search_content(topic, subject) - filter many questions by exact topic tag
//                                       + subject (this file - NOT ranked full-text
//                                       search; see the tool's own description)
//   - get_concept_guide(topic)       - the "how do you solve this kind of problem"
//                                       reference for a topic, not a specific question
//                                       (this file). Backed by the concept_guides
//                                       table (migration 0007) - starts empty until
//                                       content-author authors real rows (Section 10,
//                                       step 2), so an honest "not found yet" is the
//                                       expected response until then, not a bug.

const server = new McpServer({ name: "puzzle-kingdom", version: "0.1.0" });

server.registerTool(
  "get_question",
  {
    description:
      'Fetch exactly ONE quiz question by its exact id (uuid) - its question text, ' +
      "options, correct answer, explanation, tip, and topic tags. Use this only " +
      "when you already have a specific question id. It does not search or filter " +
      "by topic/subject/keyword (use search_content for that) and it does not " +
      "return topic-level method/concept reference material - get_concept_guide " +
      "covers that - if you don't have an exact question id already, this is the " +
      "wrong tool.",
    inputSchema: {
      questionId: z.string().uuid().describe("The question's id (uuid), e.g. from a prior search or an admin lookup"),
    },
  },
  async ({ questionId }) => {
    try {
      const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
      if (!question) {
        return {
          isError: true,
          content: [{ type: "text", text: `No question found with id "${questionId}".` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(question, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `get_question failed for id "${questionId}": ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  "search_content",
  {
    description:
      "Find questions tagged with an exact topic within a subject. This is " +
      "SIMPLE FILTERING, not ranked full-text search: `topic` must match one of " +
      "the exact tag strings already on a question (the same tags GET /topics " +
      "returns for a class+subject) - a made-up or partial phrase like 'fractions' " +
      "won't match a tag like 'Fractions, Decimals & Percentages' unless it's the " +
      "exact string. `subject` must match a subject's exact name (e.g. 'Maths'). " +
      "Returns a lightweight list (id, questionText, explanation, topics) for " +
      "each match, not the full record - call get_question with a result's id to " +
      "get its options/correct answer/tip. Use get_question instead if you " +
      "already have a specific question id, and get_concept_guide if you want " +
      "method/reference material rather than actual questions.",
    inputSchema: {
      subject: z.string().min(1).describe("Exact subject name, e.g. 'Maths' or 'English'"),
      topic: z.string().min(1).describe("Exact topic tag to match, e.g. 'Fractions, Decimals & Percentages'"),
      limit: z.number().int().min(1).max(50).optional().default(20).describe("Max results to return (default 20, max 50)"),
    },
  },
  async ({ subject, topic, limit }) => {
    try {
      const [subjectRow] = await db.select().from(subjects).where(eq(subjects.name, subject)).limit(1);
      if (!subjectRow) {
        return {
          isError: true,
          content: [{ type: "text", text: `No subject named "${subject}".` }],
        };
      }

      // Same exact-tag-match convention as POST /quizzes' own topic filter
      // (see routes/quizzes.ts) - topics is a text[] tag array, and a
      // question matches if the requested topic is one of its (possibly
      // several) tags.
      const rows = await db
        .select({
          id: questions.id,
          questionText: questions.questionText,
          explanation: questions.explanation,
          topics: questions.topics,
        })
        .from(questions)
        .where(
          sql`${questions.subjectId} = ${subjectRow.id} AND ${questions.topics} @> ARRAY[${topic}]::text[]`
        )
        .limit(limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ subject, topic, count: rows.length, results: rows }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `search_content failed for subject "${subject}", topic "${topic}": ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  "get_concept_guide",
  {
    description:
      "Fetch the concept/method reference guide(s) for a topic - the \"how do you " +
      "actually solve this kind of problem\" explanation (method, formula if any), " +
      "distinct from any one specific question (use get_question for that) and " +
      "distinct from finding matching questions themselves (use search_content for " +
      "that). `topic` must be an exact tag match, same convention as " +
      "search_content's `topic` param - a partial phrase won't match. Content is " +
      "authored gradually by the content-author subagent, so a topic with no guide " +
      "yet returns an honest 'not found' rather than a fabricated answer - that's " +
      "an expected, normal response for any topic not yet covered, not a bug. Can " +
      "return more than one guide if the same topic has separate guides for " +
      "different classes (e.g. Year 4 vs Year 5 versions of the same topic).",
    inputSchema: {
      topic: z.string().min(1).describe("Exact topic tag to fetch a concept/method guide for, e.g. 'Fractions, Decimals & Percentages'"),
    },
  },
  async ({ topic }) => {
    try {
      const rows = await db
        .select({
          id: conceptGuides.id,
          classId: conceptGuides.classId,
          subjectId: conceptGuides.subjectId,
          topic: conceptGuides.topic,
          title: conceptGuides.title,
          methodText: conceptGuides.methodText,
          formula: conceptGuides.formula,
        })
        .from(conceptGuides)
        .where(eq(conceptGuides.topic, topic));

      if (rows.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `No concept guide found for topic "${topic}" yet - this topic hasn't been ` +
                `authored yet (see AI-Study-Mentor-Agent-Plan.md Section 10, step 2), not an error ` +
                `with the request. Try search_content to find actual questions on this topic instead.`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ topic, count: rows.length, results: rows }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `get_concept_guide failed for topic "${topic}": ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
