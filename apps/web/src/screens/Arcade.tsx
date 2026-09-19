import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Blocks,
  Boxes,
  Brain,
  Building2,
  CheckCircle2,
  Ear,
  Flame,
  Lightbulb,
  Link2,
  ListChecks,
  Map as MapIcon,
  PenLine,
  Shapes,
  Shuffle,
  ShieldCheck,
  SpellCheck,
  Star,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import { getAvailableGames, getGameRound, recordGameAttempt } from "../api";
import { useActivityHeartbeat } from "../hooks/useActivityHeartbeat";
import type { GameKey, GameQuestion, PkClass, Profile } from "../types";
import { Button } from "../components/ui/button";

// The Arcade: informal, repeatable practice games built on the same
// question-type data model as the graded quiz - see "Practice games (the
// Arcade)" in plan/Question-Types-and-Content-Authoring-Plan.md and
// GAME_DEFINITIONS in apps/api/src/routes/games.ts, which this mirrors.
// Reached from SubjectPicker as a third mode alongside Quest Journey and
// Topic Practice, so it's always scoped to an already-picked class+
// subject.
//
// Exported (11 September 2026) so FamilyDashboard.tsx/AdminDashboard.tsx
// can show a real game title instead of the raw gameKey on the new
// activity-time metrics sections - same lookup, not a duplicated copy.
// Per-game "how to think about this" content, shown on a one-time tips
// screen before a round starts (see GameTips below) - added 19 September
// 2026 after Decompose the Workflow's Claude/Existing System/Human split
// turned out genuinely confusing without a memorable rule of thumb.
// Deliberately generic (title/detail pairs + an optional worked example)
// so every game gets a tips screen from the same component, not just the
// one that prompted this.
type GameTipsContent = {
  intro: string;
  tips: { title: string; detail: string }[];
  example?: { label: string; walkthrough: string };
};

export const GAME_META: Record<
  GameKey,
  { title: string; blurb: string; icon: typeof PenLine; accent: string; domain?: string; tips: GameTipsContent }
> = {
  spelling_sprint: {
    title: "Spelling Sprint",
    blurb: "Type the missing letters before you lose your streak.",
    icon: SpellCheck,
    accent: "emerald",
    tips: {
      intro: "Fill in the missing letters before the clock runs out.",
      tips: [
        { title: "Sound it out", detail: "Say the word slowly, sound by sound - most gaps follow exactly how the word sounds." },
        { title: "Watch for patterns", detail: "Tricky spellings repeat the same patterns, like \"ight\", \"tion\", or \"ough\" - learn the pattern, not just the word." },
        { title: "A wrong guess isn't the end", detail: "It only breaks your streak. Take your best shot and keep moving - there's no penalty for trying." },
      ],
    },
  },
  missing_letters: {
    title: "Missing Letters",
    blurb: "Same idea, tricky words - fill in what's missing.",
    icon: PenLine,
    accent: "sapphire",
    tips: {
      intro: "Same idea as Spelling Sprint, but with trickier words.",
      tips: [
        { title: "Use what's already there", detail: "The letters you're given usually tell you what part of the word is missing - read them before guessing." },
        { title: "Break it into syllables", detail: "Sound out the word piece by piece rather than trying to picture the whole thing at once." },
        { title: "Watch for silent letters", detail: "Words like \"know\" or \"comb\" hide a silent letter - if a word sounds too short, check for one." },
      ],
    },
  },
  word_meaning_match: {
    title: "Word Meaning Match",
    blurb: "Match each word to what it means.",
    icon: Link2,
    accent: "amethyst",
    tips: {
      intro: "Match each word to what it means.",
      tips: [
        { title: "Read the meaning first", detail: "Picture a sentence that uses the meaning before you look at the word choices - it's easier to spot the right match." },
        { title: "Don't be fooled by similar sounds", detail: "Some wrong choices sound like the right word but mean something different - read carefully, not quickly." },
        { title: "Pick the exact fit", detail: "When two choices seem close, pick the one that matches the meaning precisely, not just loosely." },
      ],
    },
  },
  homophone_hunter: {
    title: "Homophone Hunter",
    blurb: "Pick the right sound-alike word for the sentence.",
    icon: Ear,
    accent: "ruby",
    tips: {
      intro: "Pick the right sound-alike word for the sentence.",
      tips: [
        { title: "Read the whole sentence first", detail: "The right word only makes sense once you know what the whole sentence is saying - don't stop at the gap." },
        { title: "Test each option in your head", detail: "Swap each choice into the sentence and check which one actually makes sense, not just which one sounds right." },
        { title: "Learn the common ones first", detail: "their/there/they're, to/too/two, your/you're - most questions test these, so know them cold." },
      ],
    },
  },
  prefix_suffix_builder: {
    title: "Prefix/Suffix Builder",
    blurb: "Build a new word by adding a word part.",
    icon: Blocks,
    accent: "gold",
    tips: {
      intro: "Build a new word by adding a word part.",
      tips: [
        { title: "Front changes meaning, back changes usage", detail: "A prefix (like \"un-\" = not) usually flips or adjusts meaning; a suffix (like \"-ful\" = full of) usually changes how the word is used." },
        { title: "Say the root word alone first", detail: "Know the base word on its own, then add the part - it's easier to hear whether the result sounds right." },
        { title: "Trust your ear", detail: "If the new word doesn't sound like a real word, you've probably added the part to the wrong end." },
      ],
    },
  },
  decompose_the_workflow: {
    title: "Decompose the Workflow",
    blurb: "Who owns this step - Claude, an existing system, or a human?",
    icon: Boxes,
    accent: "sapphire",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Before you sort a step, ask what KIND of work it actually is - not just what it sounds like.",
      tips: [
        {
          title: "Claude: language + judgment, against something already written down",
          detail:
            'Reading, interpreting, classifying, drafting, summarizing, or scoring - anything where Claude applies a documented rule or policy. Trigger words: read, interpret, classify, draft, summarize, score, match.',
        },
        {
          title: "Existing System: mechanical, zero judgment",
          detail:
            "Looking something up, calculating, logging, updating a record, scheduling, or processing a payment - a plain read or write with no interpretation involved. Trigger words: look up, check, calculate, log, update, schedule, process, route.",
        },
        {
          title: "Human: real stakes, or no rule exists yet",
          detail:
            "Approving an exception, waiving a fee, overriding policy, judging intent like fraud or risk, or authorizing something above a limit. Trigger words: approve (exception), waive, override, escalate, investigate, authorize, resolve a dispute.",
        },
        {
          title: 'The trap word: "Decide"',
          detail:
            '"Decide" shows up on BOTH Claude\'s side and Human\'s side - that\'s what makes this confusing. Ask: is there already a written rule to apply? If yes, Claude is deciding within the rule. If it\'s an exception, a judgment about someone\'s intent, or a situation nobody\'s written a rule for yet, it\'s a Human\'s decision.',
        },
      ],
      example: {
        label: "Worked example - IT helpdesk ticket",
        walkthrough:
          '"Draft a reply explaining the fix" -> Claude (drafting from a known fix). "Log the ticket\'s resolution time" -> Existing System (pure record-keeping, no judgment). "Decide if this is a genuine security incident" -> Human (real stakes, and no simple rule covers it).',
      },
    },
  },
  platform_map_primitives: {
    title: "Platform Map & Primitives",
    blurb: "What does each building block of the Claude platform actually do?",
    icon: MapIcon,
    accent: "gold",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Match each primitive to what it actually does - these are the pieces you call from code to build with Claude.",
      tips: [
        {
          title: "Group by job, not by name",
          detail:
            "Messages API sends and receives conversations. Tool use lets Claude call functions. Files and code execution handle data and running code. MCP connects external systems. Sort by what job something does, not by memorizing names in isolation.",
        },
        {
          title: '"Give information" vs "let Claude act"',
          detail:
            "Some primitives feed Claude information (Files, web search, MCP resources); others let Claude DO something (tool use, code execution, computer use). Ask which side a primitive is on first.",
        },
        {
          title: "Efficiency primitives are their own group",
          detail:
            "Prompt caching (reuse repeated context cheaply) and extended thinking (let Claude reason longer before answering) don't add a new capability - they change the cost or quality of a request you could already make.",
        },
      ],
    },
  },
  pattern_selection: {
    title: "Pattern Selection",
    blurb: "Given a scenario, which architecture pattern actually fits?",
    icon: Shapes,
    accent: "ruby",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Sort each scenario into the pattern that fits - not the one that sounds most advanced.",
      tips: [
        {
          title: "Start simple, add only what the scenario needs",
          detail:
            "A single agent with tools handles most tasks. Only reach for multi-agent orchestration when the work genuinely splits into independent sub-tasks that benefit from separate context.",
        },
        {
          title: 'Look for "approve" or "review"',
          detail: "Any scenario where a person must sign off before an action goes through needs a human-in-the-loop pattern, no matter how simple the rest of the task is.",
        },
        {
          title: 'Look for "improve" or "check its own work"',
          detail: "A scenario where one pass checks or refines another pass's output is an evaluator-optimizer loop - two roles, one improving the other's work.",
        },
        {
          title: 'Look for "our own documents" or "information Claude wasn\'t trained on"',
          detail: "If Claude needs facts it doesn't already know - your company's docs, live data - that's RAG-augmented, not a bigger model or a longer prompt.",
        },
      ],
    },
  },
  reference_architectures: {
    title: "Reference Architectures",
    blurb: "Match each reference architecture to what actually defines it.",
    icon: Building2,
    accent: "amethyst",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Match each reference architecture to the trait that actually defines it.",
      tips: [
        { title: "Ask what problem it was built to solve", detail: "A reference architecture is defined by the problem it solves, not its diagram - match on purpose first." },
        {
          title: "Find its one distinguishing piece",
          detail: "Most reference architectures differ by a single key component - a retrieval step, an approval gate, an orchestrator. Find that piece and the match follows.",
        },
        { title: "Don't match on scale or industry", detail: "The same reference architecture can serve a small team or a large enterprise - industry and size are distractors, not defining traits." },
      ],
    },
  },
  rag_pipeline_design: {
    title: "RAG Pipeline Design",
    blurb: "Sort each step into the RAG pipeline stage it belongs to.",
    icon: Workflow,
    accent: "emerald",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Sort each step into the stage it belongs to: Ingestion & Chunking, Embedding & Indexing, Retrieval, or Generation & Grounding.",
      tips: [
        {
          title: "Follow the data, in order",
          detail:
            "Documents get split and cleaned first (ingestion), turned into vectors and stored (embedding/indexing), fetched by relevance for a query (retrieval), then handed to Claude to answer from (generation).",
        },
        { title: '"Chunk", "split", "clean" -> Ingestion', detail: "Anything that prepares raw documents before they're searchable belongs here." },
        { title: '"Embed", "index", "store" -> Embedding & Indexing', detail: "Turning text into vectors and saving them for fast lookup - this happens once per document, not once per query." },
        {
          title: '"Rerank" vs "cite" is the retrieval/generation split',
          detail: "Reranking and filtering results happens at Retrieval; citing sources and grounding the final answer happens at Generation - the difference is whether Claude has already started answering.",
        },
      ],
    },
  },
  model_context_strategy: {
    title: "Model & Context Strategy",
    blurb: "True or false: model choice, context windows, and prompt caching tradeoffs.",
    icon: Brain,
    accent: "sapphire",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Quick true/false checks on model choice, context windows, and prompt caching - the tradeoffs, not just the terms.",
      tips: [
        { title: "Bigger model isn't always the right call", detail: "A more capable model costs more and can be slower - reach for it when the task needs deeper reasoning, not by default." },
        {
          title: "Context window and knowledge aren't the same thing",
          detail: "A long context window means Claude can read a lot in one request - it doesn't mean Claude already knows your data. That's what RAG is for.",
        },
        {
          title: "Prompt caching pays off on repetition, not size alone",
          detail: "Caching helps when the same large context (a system prompt, a document) is reused across many requests - a single one-off huge prompt gets no benefit from it.",
        },
      ],
    },
  },
  prompting_as_architecture: {
    title: "Prompting as Architecture",
    blurb: "Sort each prompting technique by the concern it actually solves.",
    icon: Wand2,
    accent: "gold",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Sort each technique into the architectural concern it solves - structure, framing, reasoning, or output control.",
      tips: [
        { title: "Structuring/Formatting", detail: "XML tags and clear sections organize a prompt so Claude can tell its parts apart - this is about layout, not content." },
        { title: "Role & Task Framing", detail: "A system prompt or persona sets who Claude is being and what it's meant to accomplish, before any instructions arrive." },
        {
          title: "Reasoning Elicitation",
          detail: "Chain-of-thought and extended thinking ask Claude to reason step by step before answering - useful when the task needs multi-step logic, not simple recall.",
        },
        { title: "Output Control", detail: "Few-shot examples and output prefilling shape the exact form of the answer - what it should look like, not how Claude should think to get there." },
      ],
    },
  },
  entry_points_governance: {
    title: "Entry Points & Governance",
    blurb: "Match each entry point or governance control to what it does.",
    icon: ShieldCheck,
    accent: "ruby",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Match each entry point or governance control to what it actually does.",
      tips: [
        {
          title: "Three ways in, one thing they share",
          detail:
            "The Claude Developer Platform (direct API), cloud platforms (Amazon Bedrock, Google Vertex AI, Microsoft Foundry), and Claude's own apps (web/desktop/mobile) all reach the same models - they differ in billing, infrastructure, and enterprise controls, not capability.",
        },
        {
          title: "Governance controls are about WHERE and WHO, not WHAT",
          detail: "Data residency and inference-region settings control where a request runs; admin and workspace controls decide who can use what - neither changes what Claude can do.",
        },
        {
          title: "Admin API manages the account, not the conversation",
          detail: "Workspace creation, usage limits, and access controls are Admin API territory - separate from the Messages API that actually talks to Claude.",
        },
      ],
    },
  },
  assembly_recap: {
    title: "Assembly & Recap",
    blurb: "Pull it together - which phase of the build does this step belong to?",
    icon: ListChecks,
    accent: "amethyst",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Pull it all together - which phase of designing a Claude-based solution does this step belong to?",
      tips: [
        {
          title: "Four phases, roughly in order",
          detail:
            "Discover & Scope (what's the problem, what does success look like) -> Design & Prototype (pick the pattern, primitives, and prompting approach) -> Evaluate & Harden (test against real cases, add guardrails) -> Deploy & Operate (choose the entry point, set governance, monitor).",
        },
        { title: '"Which pattern fits" is Design, not Discover', detail: "Understanding the problem comes first; choosing HOW to solve it (a pattern, a pipeline) is a separate, later step." },
        { title: "Guardrails belong to Evaluate & Harden", detail: "Handling edge cases, adding human review, and testing against real scenarios happens after a design exists, not before." },
      ],
    },
  },
  all_sections_mix: {
    title: "All Sections Mix",
    blurb: "Every section in this course, shuffled into one round.",
    icon: Shuffle,
    accent: "emerald",
    domain: "Claude Platform & Solution Design",
    tips: {
      intro: "Every section in Claude Platform & Solution Design, shuffled into one round - a real test of whether it's all stuck.",
      tips: [
        { title: "No new rules here", detail: "Every question is pulled straight from the sections you've already practiced - if a question type looks unfamiliar, revisit that section's own tips first." },
        {
          title: "Watch for the switch",
          detail: 'Because sections mix, the SAME word (like "decide") can mean something different depending on which section\'s question you\'re on - read the whole prompt, not just the trigger word.',
        },
        { title: "This is the one that counts", detail: "If you can move between sections without missing a beat here, you've actually learned the material, not just memorized one section's pattern." },
      ],
    },
  },
};

const ACCENT_TEXT: Record<string, string> = {
  emerald: "text-emerald",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  amethyst: "text-amethyst",
  gold: "text-primary",
};
const ACCENT_BG: Record<string, string> = {
  emerald: "bg-emerald",
  sapphire: "bg-sapphire",
  ruby: "bg-ruby",
  amethyst: "bg-amethyst",
  gold: "bg-primary",
};

// One quick-fire question, normalized to a single tap-or-type decision -
// this is what lets one shared round engine (below) drive all 5 games
// instead of five bespoke ones. A match_column question (several pairs)
// expands into several prompts, one per pair, since "match every pair at
// once" doesn't fit the rapid-fire single-decision mechanic the other
// games use - it's presented as "which one matches?" one pair at a time
// instead.
type Prompt =
  | { kind: "choice"; promptText: string; choices: { id: string; text: string }[]; correctId: string }
  | { kind: "text"; promptText: string; accepted: string[]; caseSensitive: boolean };

function normalizeText(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function flattenToPrompts(questions: GameQuestion[]): Prompt[] {
  const prompts: Prompt[] = [];
  for (const q of questions) {
    if (q.questionType === "mcq" || q.questionType === "true_false") {
      if (!q.correctOptionId) continue;
      prompts.push({
        kind: "choice",
        promptText: q.questionText,
        choices: q.options.map((o) => ({ id: o.id, text: o.text })),
        correctId: q.correctOptionId,
      });
    } else if (q.questionType === "fill_blank" || q.questionType === "missing_number" || q.questionType === "missing_spelling") {
      const accepted = q.answerPayload?.acceptedAnswers ?? [];
      if (accepted.length === 0) continue;
      prompts.push({
        kind: "text",
        promptText: q.questionText,
        accepted,
        caseSensitive: q.questionType === "missing_spelling",
      });
    } else if (q.questionType === "match_column") {
      const left = q.answerPayload?.left ?? [];
      const right = q.answerPayload?.right ?? [];
      const correctPairs = q.answerPayload?.correctPairs ?? [];
      left.forEach((leftText, i) => {
        const pair = correctPairs.find((p) => p[0] === i);
        if (!pair || right.length === 0) return;
        prompts.push({
          kind: "choice",
          promptText: `Match: "${leftText}"`,
          choices: right.map((r, idx) => ({ id: String(idx), text: r })),
          correctId: String(pair[1]),
        });
      });
    } else if (q.questionType === "categorize") {
      // Arcade's rapid-fire round engine only understands one prompt at a
      // time, so a categorize question (several items, one shared bucket
      // set) flattens into one "which bucket?" choice prompt per item -
      // same treatment match_column gets just above. The real quiz shows
      // the whole scenario as one board instead (Quiz.tsx) - see
      // migration 0029 for why the two contexts differ.
      const items = q.answerPayload?.items ?? [];
      const buckets = q.answerPayload?.buckets ?? [];
      const correctBucketIndex = q.answerPayload?.correctBucketIndex ?? [];
      items.forEach((itemText, i) => {
        const correct = correctBucketIndex[i];
        if (typeof correct !== "number" || buckets.length === 0) return;
        prompts.push({
          kind: "choice",
          promptText: itemText,
          choices: buckets.map((b, idx) => ({ id: String(idx), text: b })),
          correctId: String(correct),
        });
      });
    }
    // short_answer/long_answer never appear in a game's questionTypes
    // (see GAME_DEFINITIONS) - nothing to flatten for them.
  }
  return prompts;
}

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function Arcade({
  pkClass,
  subjectId,
  subjectName,
  profile,
  onExit,
}: {
  pkClass: PkClass;
  subjectId: string;
  subjectName: string;
  profile: Profile;
  onExit: () => void;
}) {
  const [gameKey, setGameKey] = useState<GameKey | null>(null);
  // Which games actually have content for this class+subject - fetched
  // fresh whenever the subject changes, same "derive from what's real"
  // pattern SubjectPicker already uses for topics. Null while loading, []
  // once loaded but nothing's available yet - both are handled by
  // GameMenu below rather than showing every game unconditionally
  // (previously Spelling Sprint/Missing Letters showed up even for
  // subjects with zero missing_spelling content).
  const [availableGames, setAvailableGames] = useState<GameKey[] | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);

  useEffect(() => {
    setAvailableGames(null);
    setAvailableError(null);
    getAvailableGames({ classId: pkClass.id, subjectName })
      .then(setAvailableGames)
      .catch((err) => setAvailableError(err instanceof Error ? err.message : "Failed to check which games are ready"));
  }, [pkClass.id, subjectName]);

  if (gameKey === null) {
    return <GameMenu availableGames={availableGames} error={availableError} onPick={setGameKey} onExit={onExit} />;
  }

  return (
    <ArcadeRound
      key={gameKey}
      game={gameKey}
      pkClass={pkClass}
      subjectId={subjectId}
      subjectName={subjectName}
      profile={profile}
      onExit={() => setGameKey(null)}
    />
  );
}

// Games with no `domain` (the 5 literacy games) fall in here - shown as
// a flat grid exactly like before, with no topic step in front of it.
const NO_DOMAIN = "__no_domain__";

// GameMenu picks a game in one or two steps depending on the subject's
// content. Most subjects (the literacy games) have no `domain` tag on
// any of their games, so this behaves exactly as it always has: one flat
// grid, no topic step. A subject like Claude Certified Architect -
// Professional, where every available game carries a `domain` (see
// GAME_META), gets a Topic step first (added 19 September 2026) - so
// "Claude Platform & Solution Design" is chosen once, then its 10
// sections show as the familiar flat grid. A subject that somehow mixes
// domain-tagged and undomained games groups the undomained ones under a
// synthetic "General Practice" topic card rather than silently hiding
// them.
function GameMenu({
  availableGames,
  error,
  onPick,
  onExit,
}: {
  availableGames: GameKey[] | null;
  error: string | null;
  onPick: (key: GameKey) => void;
  onExit: () => void;
}) {
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  if (error) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">{error}</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      </section>
    );
  }

  if (availableGames === null) {
    return <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center text-muted-foreground">Loading the Arcade...</section>;
  }

  if (availableGames.length === 0) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">No Arcade games are ready for this subject yet - ask an adult to add some content in the admin dashboard.</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      </section>
    );
  }

  const domains = Array.from(new Set(availableGames.map((k) => GAME_META[k].domain ?? NO_DOMAIN)));
  const hasTopics = domains.some((d) => d !== NO_DOMAIN);

  if (hasTopics && selectedDomain === null) {
    return <TopicPicker domains={domains} availableGames={availableGames} onPick={setSelectedDomain} onExit={onExit} />;
  }

  const gamesToShow = hasTopics
    ? availableGames.filter((k) => (GAME_META[k].domain ?? NO_DOMAIN) === selectedDomain)
    : availableGames;
  const goBack = hasTopics ? () => setSelectedDomain(null) : onExit;
  const backLabel = hasTopics ? "Back to topics" : "Back";

  return (
    <section className="mx-auto mt-10 w-full max-w-2xl flex-1">
      {hasTopics && (
        <p className="mb-5 text-center text-sm font-display font-bold text-muted-foreground">
          {selectedDomain === NO_DOMAIN ? "General Practice" : selectedDomain}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {gamesToShow.map((key, i) => {
          const meta = GAME_META[key];
          const Icon = meta.icon;
          return (
            <button
              key={key}
              onClick={() => onPick(key)}
              style={{ animationDelay: `${i * 60}ms` }}
              className="animate-pop-in shadow-quest flex flex-col items-center rounded-3xl border border-border/70 bg-card/85 p-6 text-center backdrop-blur transition-transform hover:-translate-y-1.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className={`animate-float grid size-16 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[meta.accent]}`}>
                <Icon className="size-8" />
              </span>
              <span className="mt-4 text-xl font-display font-bold">{meta.title}</span>
              <span className="mt-1 text-sm text-muted-foreground">{meta.blurb}</span>
              <span className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-display font-bold text-primary-foreground">
                Play
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Stars from games count toward your kingdom total, same as quests.
      </p>
      <div className="mt-4 flex justify-center">
        <Button variant="ghost" onClick={goBack}>
          {backLabel}
        </Button>
      </div>
    </section>
  );
}

// The topic step shown only when a subject's games span at least one
// `domain` - one card per domain (plus a "General Practice" card for any
// undomained games sharing the subject, if there are any). A domain has
// no metadata of its own (it's just a label on each game), so its card
// borrows the first game's icon/accent in that group and counts its
// sections rather than needing a separate lookup table to keep in sync.
function TopicPicker({
  domains,
  availableGames,
  onPick,
  onExit,
}: {
  domains: string[];
  availableGames: GameKey[];
  onPick: (domain: string) => void;
  onExit: () => void;
}) {
  return (
    <section className="mx-auto mt-10 w-full max-w-2xl flex-1">
      <p className="mb-5 text-center text-sm text-muted-foreground">Choose a topic to practice.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {domains.map((domain, i) => {
          const gamesInDomain = availableGames.filter((k) => (GAME_META[k].domain ?? NO_DOMAIN) === domain);
          const first = GAME_META[gamesInDomain[0]];
          const Icon = first.icon;
          const label = domain === NO_DOMAIN ? "General Practice" : domain;
          return (
            <button
              key={domain}
              onClick={() => onPick(domain)}
              style={{ animationDelay: `${i * 60}ms` }}
              className="animate-pop-in shadow-quest flex flex-col items-center rounded-3xl border border-border/70 bg-card/85 p-6 text-center backdrop-blur transition-transform hover:-translate-y-1.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className={`animate-float grid size-16 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[first.accent]}`}>
                <Icon className="size-8" />
              </span>
              <span className="mt-4 text-xl font-display font-bold">{label}</span>
              <span className="mt-1 text-sm text-muted-foreground">
                {gamesInDomain.length} section{gamesInDomain.length === 1 ? "" : "s"} to practice
              </span>
              <span className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-display font-bold text-primary-foreground">
                Choose
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-8 flex justify-center">
        <Button variant="ghost" onClick={onExit}>
          Back
        </Button>
      </div>
    </section>
  );
}

const ROUND_SIZE = 10;
const PROMPT_SECONDS = 20;

// Shown once before a round starts: what this game is testing, a handful
// of memorable rules of thumb, and (for games where it helps) one worked
// example. Content lives per-game in GAME_META[key].tips above - this
// component just renders whatever it's handed, so every game gets a tips
// screen for free rather than needing its own bespoke one.
function GameTips({
  meta,
  onStart,
  onExit,
}: {
  meta: (typeof GAME_META)[GameKey];
  onStart: () => void;
  onExit: () => void;
}) {
  const Icon = meta.icon;
  return (
    <section className="animate-pop-in mx-auto mt-8 w-full max-w-xl flex-1">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <span className={`grid size-11 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[meta.accent]}`}>
          <Icon className="size-6" />
        </span>
        <div>
          <h2 className="text-xl font-display font-bold">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.tips.intro}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {meta.tips.tips.map((tip, i) => (
          <div key={i} className="flex gap-3 rounded-2xl border border-border/70 bg-card/85 p-4">
            <Lightbulb className={`mt-0.5 size-5 shrink-0 ${ACCENT_TEXT[meta.accent]}`} />
            <div>
              <p className="font-semibold">{tip.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{tip.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {meta.tips.example && (
        <div className={`mt-4 rounded-2xl border-2 border-dashed p-4 ${ACCENT_TEXT[meta.accent]} border-current/40`}>
          <p className={`text-sm font-display font-bold ${ACCENT_TEXT[meta.accent]}`}>{meta.tips.example.label}</p>
          <p className="mt-1 text-sm text-foreground/90">{meta.tips.example.walkthrough}</p>
        </div>
      )}

      <div className="mt-7 flex justify-center">
        <Button onClick={onStart}>Start game</Button>
      </div>
    </section>
  );
}

function ArcadeRound({
  game,
  pkClass,
  subjectId,
  subjectName,
  profile,
  onExit,
}: {
  game: GameKey;
  pkClass: PkClass;
  subjectId: string;
  subjectName: string;
  profile: Profile;
  onExit: () => void;
}) {
  const meta = GAME_META[game];
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [textAnswer, setTextAnswer] = useState("");
  const [flash, setFlash] = useState<"right" | "wrong" | null>(null);
  const [pickedChoiceId, setPickedChoiceId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PROMPT_SECONDS);
  const [finished, setFinished] = useState(false);
  const [starsEarned, setStarsEarned] = useState<number | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  // Tips-before-you-play gate (19 September 2026) - true only after the
  // player taps "Start game" on the GameTips screen below. Stays true
  // across a same-session "Play again" (this component doesn't remount
  // for that), so tips are only forced once per visit to a game, not once
  // per round.
  const [ready, setReady] = useState(false);

  // Activity time tracking (11 September 2026) - see
  // useActivityHeartbeat.ts. Stops the moment the round finishes rather
  // than running until this component unmounts, so the results screen
  // doesn't keep quietly logging "game" time.
  useActivityHeartbeat({
    activityType: "game",
    classId: pkClass.id,
    subjectId,
    gameKey: game,
    enabled: !finished,
  });

  useEffect(() => {
    getGameRound({ game, classId: pkClass.id, subjectName, count: ROUND_SIZE })
      .then((res) => {
        const built = shuffled(flattenToPrompts(res.questions));
        if (built.length === 0) {
          setError(`No ${meta.title} questions are ready for ${subjectName} yet - ask an adult to add some in the admin dashboard.`);
          return;
        }
        setPrompts(built);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this game"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, pkClass.id, subjectName]);

  const current = prompts?.[index] ?? null;

  // A gentle per-prompt countdown, purely for arcade pressure/feel - it
  // never fails the whole round, just auto-marks the current prompt wrong
  // and moves on, so a child who needs longer isn't punished beyond that
  // one prompt.
  useEffect(() => {
    if (!current || flash !== null || finished) return;
    setSecondsLeft(PROMPT_SECONDS);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          answer(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current, finished]);

  function answer(isCorrect: boolean) {
    setFlash(isCorrect ? "right" : "wrong");
    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }
    setTimeout(() => {
      setFlash(null);
      setPickedChoiceId(null);
      setTextAnswer("");
      setIndex((i) => i + 1);
    }, 700);
  }

  function pickChoice(choiceId: string) {
    if (flash !== null || current?.kind !== "choice") return;
    setPickedChoiceId(choiceId);
    answer(choiceId === current.correctId);
  }

  function submitText() {
    if (flash !== null || current?.kind !== "text") return;
    const normalized = normalizeText(textAnswer, current.caseSensitive);
    const isCorrect = normalized.length > 0 && current.accepted.some((a) => normalizeText(a, current.caseSensitive) === normalized);
    answer(isCorrect);
  }

  // Round over - record it once, the moment the last prompt is answered.
  useEffect(() => {
    if (!prompts || finished) return;
    if (index < prompts.length) return;
    setFinished(true);
    setSavingResult(true);
    recordGameAttempt({
      profileId: profile.id,
      classId: pkClass.id,
      subjectId,
      gameKey: game,
      correctCount,
      totalCount: prompts.length,
    })
      .then((res) => setStarsEarned(res.starsEarned))
      .catch(() => setStarsEarned(0))
      .finally(() => setSavingResult(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, prompts, finished]);

  if (error) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">{error}</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back to the Arcade
          </Button>
        </div>
      </section>
    );
  }

  if (!ready) {
    return <GameTips meta={meta} onStart={() => setReady(true)} onExit={onExit} />;
  }

  if (!prompts) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center text-muted-foreground">
        Loading {meta.title}...
      </section>
    );
  }

  if (finished) {
    const total = prompts.length;
    const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <section className="animate-pop-in mx-auto mt-10 w-full max-w-md flex-1 text-center">
        <span className={`mx-auto grid size-20 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[meta.accent]}`}>
          <meta.icon className="size-10" />
        </span>
        <h2 className="mt-4 text-2xl font-display font-bold">{meta.title} complete!</h2>
        <p className="mt-2 text-muted-foreground">
          {correctCount} of {total} correct ({percent}%) - best streak {bestStreak}
        </p>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-lg font-display font-bold text-primary">
          {savingResult ? (
            "Saving..."
          ) : (
            <>
              <Star className="size-5 fill-current" /> +{starsEarned ?? 0} stars
            </>
          )}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              setPrompts(null);
              setIndex(0);
              setCorrectCount(0);
              setStreak(0);
              setBestStreak(0);
              setFinished(false);
              setStarsEarned(null);
              getGameRound({ game, classId: pkClass.id, subjectName, count: ROUND_SIZE })
                .then((res) => {
                  const built = shuffled(flattenToPrompts(res.questions));
                  if (built.length === 0) {
                    setError(`No ${meta.title} questions are ready for ${subjectName} yet.`);
                    return;
                  }
                  setPrompts(built);
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this game"));
            }}
          >
            Play again
          </Button>
          <Button variant="secondary" onClick={onExit}>
            Back to the Arcade
          </Button>
        </div>
      </section>
    );
  }

  if (!current) return null;

  return (
    <section className="mx-auto mt-6 w-full max-w-xl flex-1">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-4 text-sm font-display font-bold">
          <span className="flex items-center gap-1 text-muted-foreground">
            {index + 1} / {prompts.length}
          </span>
          <span className={`flex items-center gap-1 ${streak > 0 ? "text-primary" : "text-muted-foreground"}`}>
            <Flame className={`size-4 ${streak > 0 ? "fill-current" : ""}`} /> {streak}
          </span>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
        <div
          className={`h-full ${ACCENT_BG[meta.accent]} transition-[width] duration-1000 ease-linear`}
          style={{ width: `${(secondsLeft / PROMPT_SECONDS) * 100}%` }}
        />
      </div>

      <div
        className={`animate-pop-in shadow-quest mt-6 rounded-3xl border-2 bg-card/85 p-7 text-center backdrop-blur transition-colors ${
          flash === "right" ? "border-emerald" : flash === "wrong" ? "border-ruby" : "border-border/70"
        }`}
      >
        <h2 className="text-xl leading-snug font-semibold">{current.promptText}</h2>

        {current.kind === "choice" && (
          <div className="mt-6 grid gap-3">
            {current.choices.map((choice) => {
              const isPicked = pickedChoiceId === choice.id;
              const showRight = flash !== null && choice.id === current.correctId;
              const showWrong = flash !== null && isPicked && choice.id !== current.correctId;
              return (
                <button
                  key={choice.id}
                  onClick={() => pickChoice(choice.id)}
                  disabled={flash !== null}
                  className={`flex items-center justify-between rounded-2xl border-2 px-5 py-3.5 text-left font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:translate-y-0 ${
                    showRight
                      ? "border-emerald bg-emerald/15 text-emerald"
                      : showWrong
                        ? "border-ruby bg-ruby/15 text-ruby"
                        : "border-border bg-secondary/60"
                  }`}
                >
                  {choice.text}
                  {showRight && <CheckCircle2 className="size-5 shrink-0" />}
                  {showWrong && <X className="size-5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {current.kind === "text" && (
          <div className="mt-6">
            <input
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitText()}
              autoFocus
              disabled={flash !== null}
              placeholder="Type your answer"
              autoCapitalize={current.caseSensitive ? "none" : undefined}
              className="w-full rounded-2xl border-2 border-border bg-secondary/60 px-5 py-3.5 text-center text-lg font-semibold outline-none focus-visible:border-primary"
            />
            <Button className="mt-4" onClick={submitText} disabled={flash !== null || textAnswer.trim().length === 0}>
              Check
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
