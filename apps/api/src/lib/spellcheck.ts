// Automated spelling check for short/long answers - dictionary-based, no
// AI cost, per the "spelling is the priority, not full free-text
// semantic grading" split in
// Question-Types-and-Content-Authoring-Plan.md's grading-decision
// section (build order step 5). This only flags likely misspellings; it
// never grades content or meaning - that stays excluded from scoring
// (see lib/scoring.ts's short_answer/long_answer branch).
import dictionaryEn from "dictionary-en";
import NSpell from "nspell";

export type SpellingIssue = {
  word: string;
  suggestions: string[];
};

// Loaded once per process - the dictionary is a couple of MB of Hunspell
// data, not worth re-parsing on every submitted answer. Lazy so a server
// that never sees a short/long answer submission never pays this cost.
let spellerPromise: Promise<ReturnType<typeof NSpell>> | null = null;

function getSpeller() {
  if (!spellerPromise) {
    spellerPromise = (async () => {
      const dict = await dictionaryEn;
      return NSpell({ aff: Buffer.from(dict.aff), dic: Buffer.from(dict.dic) });
    })();
  }
  return spellerPromise;
}

// Tokenizes on word characters (letters, plus an internal apostrophe -
// "don't", "it's") - punctuation and numbers are stripped rather than
// flagged, since this is a spelling check, not a grammar/content one.
const WORD_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

// Checks the words in a piece of free text and returns one entry per
// likely-misspelled word (case-insensitively deduped - a repeated typo
// is only flagged once), each with up to 3 suggested corrections
// (nspell's own ranking). Returns [] for empty/whitespace-only text.
export async function checkSpelling(text: string): Promise<SpellingIssue[]> {
  const words = text.match(WORD_PATTERN) ?? [];
  if (words.length === 0) return [];

  const speller = await getSpeller();
  const seen = new Set<string>();
  const issues: SpellingIssue[] = [];

  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (speller.correct(word)) continue;
    issues.push({ word, suggestions: speller.suggest(word).slice(0, 3) });
  }

  return issues;
}
