---
name: content-author-style-guide
description: Style guide for writing quiz question explanations and tips (Year 3-6 tone, UK curriculum conventions, formula/method restrictions by year group, and 11+/CSSE exam-prep conventions). Load before authoring or reviewing question content — explanation/tip fields, seed scripts, or any AI-generation prompt that produces them.
---

# Content-author style guide

Applies to the `explanation` and `tip` fields on every question (see
`apps/api/src/lib/question-schema.ts`), across all subjects and classes —
Year 3 through Year 6, and the 11+/CSSE classes. Load this before writing
or reviewing worked solutions, before editing a seed script's prompt, or
before hand-authoring/editing a question in the admin dashboard.

## The two fields are not interchangeable

- **`explanation`** answers *this specific question*. One sentence, rarely
  two. Show the actual numbers or fact that gets to the correct answer.
  Never generic teaching, never "remember that...", never restates the
  question, never says "the answer is X" outright — the correct option
  already says that; the explanation shows *why*.
  - Good: `"4m = 400cm, which is much longer than 45cm."`
  - Good: `"The prefix \"mis-\" means \"wrongly\" or \"badly\", so \"mis-\" + \"understand\" = \"misunderstand\"."`
  - Bad: `"You need to convert units before comparing lengths. The answer is 4m."` (teaches the method here instead of in the tip; states the answer directly)

- **`tip`** teaches the transferable strategy — the thing a child can
  reuse on the *next* question of this type, not just this one. Phrase it
  as an instruction ("Convert...", "Look at...", "Remember...", "Think
  of..."), one to two sentences, and generalise the pattern rather than
  repeating the specific numbers from the explanation.
  - Good: `"Convert both measurements into the same unit first (100cm = 1m, so 4m = 400cm) before comparing which is longer."`
  - Good: `"Think of the tool scientists use in experiments and in everyday life to check how hot or cold something is — it has a scale marked on the side."`
  - Bad: `"400 is bigger than 45."` (just repeats the explanation's arithmetic, teaches nothing transferable)

  (11+/CSSE English has one deliberate exception to the brevity/no-restating
  rule — see the 11+/CSSE section below.)

## Tone

- Plain, warm, direct. No baby talk, no stacked exclamation marks, no
  filler ("Great question!", "Let's find out!").
- Second person, imperative mood for tips: "Look at...", "Convert...",
  "Remember...", not "One should look at..." or "We can convert...".
- Tone stays simple and encouraging across Year 3–6, but assumes
  progressively more prior knowledge as the year increases — a Year 6 tip
  can lean on facts/methods from Year 3–5 without re-explaining them; a
  Year 3 tip must never assume anything from Year 4 or later.
- UK spelling and units throughout: "colour" not "color", "maths" not
  "math", metric units (cm, m, g, kg, ml, l) — never imperial, never
  mixed.
- UK National Curriculum vocabulary: "ones/tens/hundreds" (not "units"),
  "column method" (not "regrouping" jargon from other curricula). Note
  the 11+/CSSE exception below — "borrowing"/"carrying" is correct there.
- Plain prose only — no markdown, no bullet points, no bold/italics
  inside `explanation` or `tip` strings. These render as plain text in
  the quiz UI; markdown syntax would show up literally.

## Formula/method conventions — don't teach ahead of the curriculum

A worked solution must only use methods and facts the target class has
actually been taught. Reaching for a shortcut from a later year makes the
tip actively unhelpful — the child hasn't learned it yet. Each topic
below is a Year 3 → 4 → 5 → 6 progression: a tip/explanation for a given
year may use anything from that year or earlier, never anything later.

- **Algebra**: not introduced at all until Year 6 — no `x`, no
  letter-variable formulas anywhere in Year 3–5 content (describe
  perimeter etc. in words: "add up the length of every side"). Year 6
  introduces simple formulae expressed in words *then* symbols/letters,
  expressing missing-number problems algebraically, and simple linear
  sequences — algebraic notation is fair game only once a question is
  tagged Year 6, and even then prefer the words-first framing the
  curriculum itself uses before jumping to letters.

- **Place value**:
  - Y3: numbers to 1,000, three digits — "ones/tens/hundreds" column
    language only (matches existing content, e.g.
    `year3-maths-number-calculation-questions.json`).
  - Y4: numbers to at least 10,000, four digits — "thousands" column
    valid; rounding to nearest 10/100/1,000 introduced.
  - Y5: numbers to 1,000,000; rounding to any degree of accuracy;
    negative numbers (counting through zero); Roman numerals to 1,000 (M).
  - Y6: numbers to 10,000,000; negative numbers used in context
    (calculating intervals across zero).

- **Calculation methods (× and ÷)**:
  - Y3: times tables 2, 3, 4, 5, 8, 10 only. Never assume recall of a
    table outside that set (e.g. don't lean on "just remember 7 × 8" for
    a Year 3 question).
  - Y4: all times tables to 12 × 12 known.
  - Y5: formal long multiplication (up to 4-digit × 2-digit); formal
    short division (up to 4-digit ÷ 1-digit) with remainders; square (²)
    and cube (³) notation.
  - Y6: long division (up to 4-digit ÷ 2-digit) with remainders expressed
    as whole numbers, fractions, or rounded as appropriate; order of
    operations with all four operations in one calculation (BIDMAS) —
    don't assume this convention below Year 6.

- **Fractions, decimals & percentages** (verified against the DfE primary
  source directly - PRIMARY_national_curriculum.pdf, Mathematics Number –
  fractions sections - after an earlier version of this guide incorrectly
  placed equivalent fractions at Y5 only; it's actually a three-stage
  progression starting at Y3):
  - Y3: unit/simple non-unit fractions, small denominators; recognise and
    show, using diagrams, equivalent fractions **with small denominators**
    (e.g. 1/2 = 4/8) - this genuinely is Y3, not Y4/Y5, so don't flag a
    Y3 question that does this as too advanced; same-denominator
    addition/subtraction within one whole (e.g. 5/7 + 1/7 = 6/7); compare
    and order unit fractions and fractions with the same denominator; no
    decimals mixed in.
  - Y4: recognise and show, using diagrams, **families of** common
    equivalent fractions - the deeper version of Y3's single-pair skill,
    not a first introduction to the concept; counting in hundredths;
    decimal equivalents for tenths/hundredths and for 1/4, 1/2, 3/4;
    comparing decimals to 2dp.
  - Y5: identify, name and write equivalent fractions **of a given
    fraction**, including tenths and hundredths (deeper again - working
    from one fraction to its equivalents, not just recognising a
    matching pair); adding/subtracting fractions with denominators that
    are multiples of the same number; multiplying fractions by whole
    numbers; the % symbol and "percent = per 100"; numbers with up to 3
    decimal places.
  - Y6: simplifying fractions via common factors; adding/subtracting
    fractions with *different* denominators and mixed numbers;
    multiplying/dividing fractions; converting between fraction/decimal/
    percentage forms fluently.

- **Ratio & proportion**: not introduced until Year 6 — relative sizes of
  quantities, scale factors between similar shapes, unequal sharing —
  never appears in Year 3–5 content.

- **Measurement & conversions**:
  - Y3: 100cm = 1m, 1000g = 1kg, 1000ml = 1l, 60min = 1hr, stated inline
    in the tip ("Remember 1m = 100cm, so multiply..."). Perimeter is
    counting/adding side lengths, not a formula.
  - Y4: converting between more units in the same family (km ↔ m ↔ cm ↔
    mm); area of rectilinear shapes by counting squares only — still no
    formula.
  - Y5: converting between metric AND approximate metric/imperial
    equivalences; perimeter of composite rectilinear shapes; area of
    rectangles using standard units (cm², m²) — arithmetic
    (length × width), not yet named as a letter-formula; estimating
    volume/capacity.
  - Y6: named area/perimeter formulae for rectangles; area of
    parallelograms and triangles; volume of cubes/cuboids; converting
    miles ↔ km.

- **Shape (geometry — properties of shapes)**:
  - Y3: right angles only (not acute/obtuse) — identify them, and know
    that 2 right angles make a half-turn, 3 make three-quarters of a
    turn, 4 make a complete turn; horizontal/vertical lines and
    perpendicular/parallel pairs; recognising 2-D/3-D shapes by
    properties.
  - Y4: adds acute and obtuse angles, comparing/ordering angles up to
    two right angles by size — don't use "acute"/"obtuse" in a
    Year 3-tagged tip; classifying quadrilaterals/triangles by property;
    lines of symmetry, completing a symmetric figure.
  - Y5: angles measured in degrees; reflex angles; using a protractor;
    angles at a point / on a straight line / vertically opposite;
    regular vs irregular polygons; identifying 3-D shapes from 2-D
    representations.
  - Y6: drawing shapes to given dimensions/angles; nets of 3-D shapes;
    finding unknown/missing angles in triangles, quadrilaterals, regular
    polygons; parts of a circle (radius, diameter, circumference;
    diameter = 2 × radius).

- **Position & direction**:
  - Not introduced until Year 4: first-quadrant coordinates, describing
    translations ("3 right and 2 up"), plotting points to complete a
    polygon. Never appears in Year 3 content — don't invent a Year 3
    version of it.
  - Y5: still first-quadrant only — reflections and translations using a
    2-D grid and coordinates in the first quadrant. Four-quadrant work is
    Year 6-exclusive; don't write a Y5 tip that assumes it.
  - Y6: full coordinate grid (all four quadrants) — translating and
    reflecting shapes in the axes.

- **Statistics**:
  - Y3: bar charts, pictograms, and tables — including *scaled* versions
    (one square/symbol represents more than one unit, e.g. each square =
    2). One-step and two-step comparison questions ("How many
    more/fewer?").
  - Y4: adds time graphs and continuous (not just discrete) data, plus
    comparison/sum/difference problems across bar charts, pictograms,
    tables and other graph types — a continuous-data line graph question
    isn't valid for Year 3.
  - Y5: line graphs; reading/interpreting tables including timetables.
  - Y6: pie charts (new); line graphs extend from Y5's read-only to also
    constructing them; calculating/interpreting the mean as an average.

## 11+/CSSE conventions ("11+ Grammar Prep" class)

This class is a different audience from Year 3–6, not one more rung on
that ladder — same age as Year 6 (~10–11), but preparing for a
competitive grammar-school entrance exam, so tone and technique diverge
from the National Curriculum progression above. Grounded in the real
past-paper content in `docs/official-papers/generated/`. Only Maths and
English are covered below — no 11+ Science, Verbal/Non-Verbal Reasoning,
or Broad Knowledge sample content exists in this repo yet, so don't
invent conventions for those; flag it if you need to author for them.

- **Tone**: terse and technique-focused, not encouraging/scaffolded like
  Year 3–6. State the method, not "well done for trying" framing. Assume
  a competent, methodical student who just needs the exam technique named.

- **Maths — column-method language is exam terminology here, not
  jargon to avoid**: "borrowing"/"carrying" are the correct, expected
  words at this level (contrast with the Year 3–6 rule against them).
  Formal written methods for all four operations are assumed fluent.
  Covers indices/powers (e.g. "3 to the power of"), mixed-number
  fractions, and multi-step arithmetic beyond the Year 6 ceiling.

- **Maths — still no formal letter-algebra**: even at this level, the
  real papers phrase unknowns as "fill in the box" rather than using `x`
  or other variable notation — match that convention rather than
  introducing formal algebra that isn't how the source papers ask the
  question.

- **English — quote the source text as evidence**: unlike the general
  rule that `explanation` should be a single sentence and never restate
  the question, 11+ English comprehension explanations should directly
  quote the relevant phrase from the passage in single quotes (e.g. "The
  passage states 'Every door was shut, every dog in his kennel', showing
  both humans and dogs sheltered inside") — the quote *is* the evidence,
  so this is the one place a slightly longer, quote-bearing explanation
  is correct rather than a style violation.

- **English — topic taxonomy differs from Year 3–6**: use categories
  like "Inference & Interpretation" rather than the simpler Year 3–6 tags
  ("Vocabulary & Word Reading" etc.) — check
  `docs/official-papers/generated/csse-*-english-questions.json` for the
  existing tag set before inventing a new one.

- **Passages can use archaic/complex literary language** (the sample
  content includes 19th-century prose) — don't simplify the passage
  itself; the comprehension skill being tested is understanding it as
  written.

- **Continuous writing papers are out of scope for this skill** — the
  mark schemes under `docs/official-papers/` for continuous
  writing/composition aren't MCQ content and don't populate the
  `explanation`/`tip` fields this skill governs.

## Quoting convention

Existing content is inconsistent about quote style inside `tip` vs
`explanation` (some use escaped `\"...\"`, some use `'...'`). Pick one and
apply it consistently within any batch you author or edit — prefer plain
`'...'` inside `tip`/`explanation` strings to avoid escaping noise in the
JSON, matching the newer files. (Exception: 11+/CSSE English explanations
quoting the passage — see above.)

## Before saving a batch

1. Re-read each `explanation`/`tip` pair against the Good/Bad examples
   above.
2. Check no method/fact used is above the target class's curriculum
   stage (or, for 11+/CSSE, against the conventions in that section).
3. Run `npm run validate:tips -w apps/api` to structurally check the
   file against `generatedQuestionSetSchema` before it's seeded.
