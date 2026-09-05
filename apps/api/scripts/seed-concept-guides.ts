#!/usr/bin/env tsx
// Seeds the concept_guides table (drizzle/0007_add_concept_guides.sql) - the
// topic-level "how do you actually solve this kind of problem" method
// reference that the get_concept_guide MCP tool reads
// (src/mcp-server.ts). This is deliberately NOT question content: each row
// is the general walkthrough for a whole topic at one year group's level,
// distinct from any single question's explanation/tip.
//
// Usage: npm run seed:concept-guides -w apps/api
//
// Idempotent: every row upserts on the (class_id, subject_id, topic) unique
// index, so re-running after editing the text below updates the existing
// guide in place rather than erroring or creating a duplicate. Safe to run
// as many times as you like.
//
// Adding more guides: append another object to the GUIDES array. Class and
// subject are given by NAME and resolved to their uuids at runtime - the
// real ids only exist in the remote database, so nothing here hardcodes
// one. A name that doesn't exist is a hard failure (non-zero exit) rather
// than a silently skipped row, since a typo'd class name would otherwise
// look like a successful no-op.
//
// One guide per (class, subject, topic): a topic taught at more than one
// year group (e.g. "Fractions, Decimals & Percentages" appears on 11+ and
// Year 3 questions) gets a SEPARATE row per class, each written to that
// year's curriculum stage. Don't try to cover several years in one row -
// get_concept_guide returns all guides for a topic and the class_id is what
// distinguishes them, so each title should also name its year group.
//
// Why there is no "Year 4" guide here: the database currently has only two
// classes, "11+ Grammar Prep" and "Year 3". A guide naming a class that
// doesn't exist makes this script exit non-zero on the resolveId lookup (by
// design - see above), so don't re-add a Year 4 row until a Year 4 class is
// actually created.
//
// A note on the topic tag below: the Year 3 maths questions generated so far
// tag fractions work as "Fractions", while "Fractions, Decimals &
// Percentages" is the tag used on the 11+ maths questions. get_concept_guide
// matches the topic string exactly, so if Year 3 questions keep the shorter
// tag in the live database this guide will need a second row (or a retag)
// to be reachable from them. Check GET /topics before assuming.

import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { classes, conceptGuides, subjects } from "../src/db/schema.js";

type ConceptGuideSeed = {
  /** Exact `classes.name`, e.g. "Year 3" - resolved to a uuid at runtime. */
  className: string;
  /** Exact `subjects.name`, e.g. "Maths" - resolved to a uuid at runtime. */
  subjectName: string;
  /**
   * Exact topic tag string, matching the tags already on `questions.topics`
   * (the same strings GET /topics returns). get_concept_guide does an exact
   * equality match, so a near-miss here means the guide is unreachable.
   */
  topic: string;
  title: string;
  methodText: string;
  /**
   * Only set this when the topic really has a formula the target year group
   * has been taught. Leave it null otherwise - an invented or too-advanced
   * formula is worse than none.
   */
  formula: string | null;
};

const GUIDES: ConceptGuideSeed[] = [
  {
    className: "Year 3",
    subjectName: "Maths",
    topic: "Fractions",
    // Names the year group (get_concept_guide returns every guide sharing
    // this topic tag) and lists the fraction skills covered - decimals
    // start in Year 4 and percentages in Year 5, so this guide sticks to
    // fractions only, matching the "Fractions" topic tag it's filed under.
    title:
      "Fractions (Year 3): Naming Fractions, Equivalent Fractions, Tenths, Comparing, Same-Denominator Adding and Fractions of Amounts",
    methodText: [
      "A fraction is a way of writing some equal parts of one whole. The bottom number (the denominator) tells you how many equal parts the whole was split into, and the top number (the numerator) tells you how many of those parts you have. So if a cake is cut into 8 equal parts and you take 3 of them, you have 3/8. The parts must be equal, so always count the total number of equal pieces for the bottom number, not just the pieces you can see shaded. A fraction with 1 on top, like 1/4, is called a unit fraction: one single part. A fraction with more than 1 on top, like 3/4, is a non-unit fraction: several of those parts. When the top and the bottom numbers are the same, you have every part, which is one whole, so 8/8 = 1.",

      "Equivalent fractions. Two fractions are equivalent when they name the same amount of the whole, even though the top and bottom numbers are different, like 1/2 and 4/8: half of a chocolate bar is exactly the same amount as 4 out of 8 equal pieces cut from that same bar. To find an equivalent fraction, multiply the top number and the bottom number by the same number. Multiplying both by 4 turns 1/2 into 4/8, because you have simply cut each half into 4 smaller, equal pieces without changing how much of the bar you have. In the same way, multiplying both by 3 turns 1/3 into 3/9. Drawing two identical bars, splitting them into the two different numbers of equal parts, and shading the matching amount on each is the easiest way to check: the shaded parts should cover exactly the same length on both bars.",

      "Tenths. Tenths come from splitting one whole into 10 equal parts, so each part is 1/10. Dividing a number by 10 gives you tenths in the same way: 1 ÷ 10 is 1/10, and 3 ÷ 10 is 3/10. You can count up and down in tenths just like counting in ones: 1/10, 2/10, 3/10 and on up to 10/10, which is one whole, then back down again. Counting in tenths is useful for reading scales and number lines that are split into ten equal steps between two whole numbers.",

      "Comparing and ordering fractions. When two fractions have the same bottom number, the parts are the same size, so you only need to compare the top numbers: 5/8 is bigger than 3/8 because 5 of those parts is more than 3 of them. To order a list of fractions that all share a bottom number, put the top numbers in order and keep the bottom number as it is, so 1/6, 3/6, 5/6 goes from smallest to largest. Unit fractions work the opposite way round, and this is the part that catches people out. The more parts you cut the whole into, the smaller each part must be, so 1/3 is bigger than 1/5 even though 5 is the bigger number. Picture cutting one cake into 3 pieces or into 5 pieces: the 5 pieces are the smaller ones.",

      "Adding and subtracting fractions with the same bottom number. When the bottom numbers already match, add or subtract the top numbers and leave the bottom number exactly as it is, because the size of each part has not changed. So 2/8 + 3/8 = 5/8, and 7/8 - 3/8 = 4/8. It helps to say it out loud: 2 eighths plus 3 eighths is 5 eighths. Never add the bottom numbers together. In a word problem about what is left, work out how many parts are left first, then write that over the total, or take the fraction away from the whole: if 3/10 of a jug has been poured out, then 10/10 - 3/10 = 7/10 is still in there.",

      "Finding a fraction of a set of objects. For a unit fraction, share the amount into that many equal groups, which means dividing by the bottom number: 1/5 of 20 counters is 20 ÷ 5 = 4 counters. When the top number is more than 1, do it in two steps. Divide by the bottom number first to find what one part is worth, then multiply by the top number to find how many of those parts the question wants. So 3/4 of 20 is 20 ÷ 4 = 5, then 5 × 3 = 15. Your 2, 3, 4, 5, 8 and 10 times tables are what make the dividing step quick. Finish by checking your answer looks sensible: a fraction of an amount is always smaller than the amount you started with, and half of it should be about half.",

      "These same fractions can also be written as decimals and as percentages, but that comes later. In Year 3 you only need the fraction form.",
    ].join("\n\n"),
    // Left null on purpose. There is no formula a Year 3 child has been
    // taught here: finding a fraction of an amount is a two-step
    // divide-then-multiply procedure, already written out in words in
    // methodText, and writing it with letters would mean introducing
    // algebraic notation, which the curriculum doesn't do until Year 6.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Place Value" (32 live questions),
    // NOT "Number & Place Value" - that's the differently-named tag the
    // 11+ Grammar Prep class uses for its own (more advanced) place value
    // questions. get_concept_guide matches the topic string exactly, so
    // this guide is only reachable from questions tagged with this exact
    // string.
    topic: "Place Value",
    title:
      "Place Value (Year 3): The Value of Each Digit in a 3-Digit Number, Writing Numbers in Words and Figures, Comparing, Ordering, +/-10 and +/-100, and Rounding to the Nearest 10",
    methodText: [
      "Every whole number up to 1,000 is made of three columns: hundreds, tens and ones. The column a digit sits in decides what it is worth, not just what the digit itself looks like. In 483, the 4 is in the hundreds column, so it is worth 400, not 4 - the 8 is in the tens column and is worth 80, and the 3 is in the ones column and is worth 3 on its own. Always ask which column a digit is sitting in before saying what it is worth. A quick way to build a number from its parts is to add the columns together: 5 hundreds, 0 tens and 9 ones is 500 + 0 + 9 = 509 - the 0 tens still needs a zero written in the tens column, otherwise the number would read as 59, which is wrong.",

      "Writing numbers in words and figures works the same column by column. To turn digits into words, read the hundreds column first ('four hundred'), then read the last two digits together as one two-digit word ('and eighteen' for 18, not 'one-eight'), so 218 is 'two hundred and eighteen'. Going the other way, from words to digits, fill in the hundreds column from the words first, then the tens and ones - 'nine hundred and four' is 900 + 4, and since there is no tens word mentioned, the tens column gets a 0, giving 904. Watch out for tricky-sounding word pairs like 'eighteen' and 'eighty', which are easy to muddle when reading quickly.",

      "Comparing two numbers means comparing column by column, starting with the biggest column (hundreds) and only moving on to the next column if the digits there are tied. To compare 456 and 465, the hundreds digits match (both 4), so look at the tens: 6 tens is more than 5 tens, so 465 is the bigger number - you never need to look at the ones column once an earlier column has already decided it. Ordering a list of numbers uses the exact same idea, just repeated for every number in the list: compare the hundreds digits first to group the numbers roughly, then use the tens digits to break any ties within a group, and finally the ones digits if needed.",

      "Adding or subtracting 10 or 100 only ever changes one column, unless a column rolls over past 9 or below 0. Adding 100 to 802 only changes the hundreds digit (802 to 902) - hundreds go from 8 to 9, and the '02' stays exactly the same. Subtracting 100 works the same way in reverse. Adding 10 usually only changes the tens digit, but watch for a column already at 9 rolling over into the next column: 695 + 10 makes the tens digit go from 9 up to 10, which cannot fit in one column, so it carries an extra hundred across, giving 705, not '6(10)5'.",

      "Rounding to the nearest 10 means deciding which multiple of 10 a number is closer to, and the ones digit alone tells you the answer. If the ones digit is 5 or more, round up to the next multiple of 10; if it is 4 or less, round down to the one below. 456 has a 6 in the ones column, so it rounds up to 460. 384 has a 4 in the ones column, so it rounds down to 380. The hundreds and tens digits of the original number do not change unless rounding up causes the tens column to roll over (for example, 195 rounds up to 200, not 190).",

      "Number sequences that count up or down in equal steps of 10 or 100 follow the same column logic: only the column matching the step size changes each time. Counting 400, 500, 600 is adding 100 each time, so only the hundreds digit increases and the next number is 700. Spotting the step size first (is it going up in 10s or 100s?) tells you exactly which column to adjust for the next or missing number in the sequence.",
    ].join("\n\n"),
    // Left null. Every place-value skill here (digit value, comparing,
    // rounding to the nearest 10) is a column-by-column procedure that's
    // already written out in words in methodText - there is nothing here
    // that a Year 3 child has been taught as a letter-formula, and rounding
    // to any degree of accuracy or using thousands columns doesn't start
    // until Year 4/5.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Addition & Subtraction" (32 live
    // questions), all within 3-digit numbers (numbers to 1,000, matching
    // the Y3 place value ceiling) - no 4-digit numbers or thousands column
    // anywhere in the sample pulled.
    topic: "Addition & Subtraction",
    title:
      "Addition and Subtraction (Year 3): Adding and Subtracting Multiples of 10 or 100 Mentally, the Column Method for 3-Digit Numbers, Missing-Number Problems and Estimating by Rounding",
    methodText: [
      "The quickest way to add or subtract a multiple of 10 or 100 is to spot that only one column changes. Adding 100 to 456 only changes the hundreds digit (4 becomes 5), so 456 + 100 = 556 straight away - the tens and ones digits, '56', stay exactly as they were. The same idea works for subtracting: 815 - 200 only changes the hundreds digit, giving 615. Adding or subtracting a multiple of 10, like 640 - 50, only changes the tens digit (and sometimes the hundreds digit too, if the tens column runs out - 530 - 40 = 490, where the tens column running below zero pulls one hundred across). Always check which column the number you're adding or subtracting actually lives in before working it out.",

      "When the numbers don't line up so neatly - like 215 + 63 or 342 + 289 - use the column method. Write one number under the other so the ones line up under ones, the tens under tens, and the hundreds under hundreds. Add each column starting from the ones column on the right. If a column adds up to 10 or more, write down only the ones digit of that column's total and move the extra ten across into the next column to be added there too: 342 + 289 gives 2 + 9 = 11 in the ones column, so write down 1 and move 1 ten across into the tens column before adding that column.",

      "Column subtraction works the same way, right to left, but sometimes a column doesn't have enough to subtract from. For 674 - 8, the ones column has 4 but needs to take away 8, so you exchange one ten from the tens column for 10 extra ones, making it 14 - 8 = 6 in the ones column, and one fewer ten in the tens column. The same exchanging idea applies to 472 - 39: the ones column (2) can't take away 9, so exchange a ten from the tens column first. Always check the exchange lands in the very next column along, never further away.",

      "Missing-number problems like 320 + ___ = 450 or 600 − ___ = 275 are solved by working backwards with the opposite operation. If a number was added to 320 to reach 450, then subtracting tells you what that missing number was: 450 - 320 = 130. If a number was subtracted from 600 to leave 275, then the missing number is 600 - 275 = 325 - you can always check by adding it back on (600 - 325 = 275) or subtracting it (as in 700 − ___ = 325, where subtracting gives 700 - 325 = 375, the missing number).",

      "Word problems tell you whether to add or subtract through the story, not through any special trick - look for words like 'more', 'altogether' or 'now has' for addition, and 'left', 'sold' or 'gave away' for subtraction. 'A shop had 456 apples. They sold 178. How many apples are left?' is a subtraction, because apples are being taken away: 456 - 178 = 278. 'Tom has 235 stickers. He gets 148 more' is an addition, because stickers are being added on: 235 + 148 = 383. Read the whole sentence before choosing which operation to use.",

      "Estimating an answer by rounding first is a useful check before or after doing the exact column method. Round each number to the nearest hundred, then add or subtract the rounded numbers to get a rough answer: for 213 + 396, round 213 to 200 and 396 to 400, giving an estimate of 600. The exact answer (609) should be close to that estimate - if a column-method answer comes out far away from the rounded estimate, it's a sign a mistake was made somewhere and it's worth checking the working again.",
    ].join("\n\n"),
    // Left null. Column addition/subtraction is a step-by-step procedure,
    // already written out in words above - there's no letter-formula a
    // Year 3 child has been taught for it, and formal algebraic notation
    // for missing-number problems doesn't start until Year 6.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Multiplication & Division" (30
    // live questions). Two of those live questions ("Find the missing
    // number: 6 × ___ = 24" and "Find the missing number: 7 × ___ = 28")
    // test recall of the 6 and 7 times tables specifically, which sit
    // outside the Y3-taught set of {2, 3, 4, 5, 8, 10} per the style
    // guide - this guide deliberately does NOT lean on those two tables
    // anywhere below, and every worked example here keeps the table being
    // recalled (the first factor) inside the taught set. Flagged rather
    // than quietly worked around - see conversation for detail.
    topic: "Multiplication & Division",
    title:
      "Multiplication and Division (Year 3): The 2, 3, 4, 5, 8 and 10 Times Tables, Related Division Facts, Missing-Number Problems and Multiplying a Two-Digit Number by a One-Digit Number",
    methodText: [
      "Year 3 focuses on six times tables: the 2, 3, 4, 5, 8 and 10 times tables. Knowing a times table means being able to recall facts like 3 × 6 = 18 or 8 × 5 = 40 quickly, without having to count up from the start every time. Skip counting is a good way to build up to recall: counting in 3s (3, 6, 9, 12...) or in 8s (8, 16, 24, 32...) and keeping track of how many steps have been taken tells you the answer to any fact in that table. Some tables have handy shortcuts too - the 5 times table always ends in 0 or 5, and the 4 times table can be found by doubling the 2 times table (since 4 × 6 is the same as 2 × 6 doubled), and the 8 times table by doubling the 4 times table again.",

      "For a fact that is just short of a multiple of 10, like 3 × 9, it can help to multiply by 10 first and then subtract one group: 3 × 10 = 30, then take away one group of 3 to get 3 × 9 = 27. This works because 9 groups of something is the same as 10 groups with one group taken back off. The same trick works for any of the six tables above when multiplying by 9.",

      "Multiplication and division are inverse operations - opposite ways of using the same fact. If you know 4 × 8 = 32, you also know 32 ÷ 4 = 8 and 32 ÷ 8 = 4, without needing to work it out separately. When faced with a division like 56 ÷ 8, think 'how many groups of 8 fit into 56?' and use the related multiplication fact (8 × 7 = 56) to answer it: 7 groups. Sharing problems work the same way - '36 sweets shared equally between 4 children' is asking 36 ÷ 4, which is answered by recalling that 4 × 9 = 36, so each child gets 9 sweets.",

      "Missing-number problems like 'Find the missing number: 4 × ___ = 32' are solved with the same inverse-operation idea: turn the multiplication around into a division, 32 ÷ 4 = 8, so the missing number is 8. Always check the answer by multiplying it back: 4 × 8 = 32.",

      "Multiplying a two-digit number by a one-digit number, such as 23 × 4, is done by splitting the two-digit number into its tens and ones and multiplying each part separately, then adding the results together. For 23 × 4: split 23 into 20 and 3, work out 20 × 4 = 80 and 3 × 4 = 12, then add 80 + 12 = 92. The same method works for 26 × 4 (20 × 4 = 80, 6 × 4 = 24, giving 80 + 24 = 104) and 18 × 3 (10 × 3 = 30, 8 × 3 = 24, giving 30 + 24 = 54). Splitting the bigger number into tens and ones first turns one hard fact into two easier ones from a known times table.",

      "Once an answer is worked out, a quick sanity check is worthwhile: a multiplication answer should be bigger than both numbers being multiplied (when both are more than 1), and a division answer (the number of groups or the size of each group) should be smaller than the number being divided.",
    ].join("\n\n"),
    // Left null. Times tables and the related division facts are recall
    // and grouping facts, already written out in words above - there is
    // no letter-formula a Year 3 child has been taught for multiplication
    // or division; formal written methods (long multiplication, short
    // division) don't start until Year 5.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Geometry & Shape" (33 live
    // questions on Year 3; the same exact tag string is separately used
    // by 3 questions on the 11+ Grammar Prep class - by design, per
    // get_concept_guide's classId-based distinction). A meaningful chunk
    // of the live Year-3-tagged sample pulled from the DB actually
    // exceeds the Y3 ceiling: several questions use "acute"/"obtuse"
    // (Y4, per the style guide), several use degree notation like 90°/
    // 180°/360° (Y5), and two use the rectangle perimeter formula
    // 2 × (length + width) (Y3 should be counting/adding sides only -
    // a named formula doesn't arrive until Y6). None of that is repeated
    // here - this guide sticks to what the Y3 curriculum stage actually
    // covers (right angles only, turns described in right angles not
    // degrees, and perimeter as adding side lengths). Flagged rather than
    // quietly worked around - see conversation for detail.
    topic: "Geometry & Shape",
    title:
      "Geometry and Shape (Year 3): Naming 2-D and 3-D Shapes by Their Properties, Right Angles and Turns, Horizontal/Vertical/Perpendicular/Parallel Lines, and Perimeter by Adding Side Lengths",
    methodText: [
      "2-D shapes are named by counting their straight sides (which is always the same as counting their corners, also called vertices). A shape with 3 sides is a triangle, 4 sides is a quadrilateral, 5 sides is a pentagon, and 6 sides is a hexagon - the prefixes tri-, penta- and hexa- are a useful memory hook for the number of sides. To tell two similar-looking shapes apart, use their exact properties together, not just one property alone: a square has 4 equal sides AND 4 right angles, while a rectangle has 4 right angles but only its opposite sides are equal to each other, not all four.",

      "3-D shapes are named by their faces - the flat or curved surfaces on the outside. A cube has 6 flat square faces, all the same size. A sphere has no flat faces at all - it is completely curved all over, like a ball. A cone has one flat circular face at the base, one curved surface, and comes to a point at the top. A triangular prism has 5 faces in total: 2 triangular faces at each end and 3 rectangular faces joining them. When naming a 3-D shape from a description, count how many faces are flat versus curved, and note the shape of each flat face, before deciding which shape matches.",

      "A right angle is a square corner, exactly the same shape as the corner of a piece of paper or a book. Right angles are used to measure turns: a quarter turn is 1 right angle, a half-turn is 2 right angles, three-quarters of a turn is 3 right angles, and a complete turn all the way round back to the start is 4 right angles. To answer a question about turns, count how many square corners fit into the turn being described, rather than trying to picture the angle by eye.",

      "A horizontal line goes straight across, side to side, like the horizon. A vertical line goes straight up and down, like a flagpole. When two lines cross each other and make a right angle where they meet, they are called perpendicular lines - picture the corner of a square window frame. When two lines never meet, however far they are drawn, and always stay the same distance apart, they are called parallel lines - picture the two long edges of a ruler or the two rails of a railway track.",

      "Perimeter is the total distance all the way around the outside of a shape, found by adding up the length of every one of its sides. For a rectangle with sides 5cm and 3cm, add all four sides together: 5cm + 3cm + 5cm + 3cm = 16cm. For a square, all four sides are the same length, so a square with a side of 7cm has a perimeter of 7cm + 7cm + 7cm + 7cm = 28cm. Whichever shape it is, the method is the same: write down the length of every side, then add them all together - there's no need for anything more than careful addition.",
    ].join("\n\n"),
    // Left null on purpose. Perimeter in Year 3 is counting/adding side
    // lengths (already written out in words above), not a named formula -
    // the rectangle perimeter formula (2 × (length + width)) isn't
    // introduced until Year 6, and turns are described here in right
    // angles rather than degrees, so there's nothing here to express as a
    // formula at this stage.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Measurement & Units" (26 live
    // questions). This exact tag string is also used by the 11+ Grammar
    // Prep class (11 questions there) - by design, same reasoning as the
    // Geometry & Shape guide above (get_concept_guide distinguishes rows
    // by classId, not by tag string alone), so a Year 3 row and a
    // separate 11+ row sharing this identical topic tag is expected, not
    // a collision to fix.
    //
    // A chunk of the live-tagged sample repeats the same too-advanced
    // perimeter shortcut already flagged on the Geometry & Shape guide
    // above: several rectangle-perimeter questions here (they're
    // cross-tagged with both "Measurement & Units" and "Geometry &
    // Shape") give their tip as the named formula "2 × (length + width)",
    // which is Y6 content - Y3 perimeter should stay at adding/counting
    // side lengths. This guide does not repeat that formula anywhere
    // below; it sticks to side-by-side addition (and, for a square, the
    // repeated-addition shortcut of multiplying one side by 4, which is
    // arithmetic, not a named letter-formula). Flagged rather than
    // quietly worked around - see conversation for detail.
    topic: "Measurement & Units",
    title:
      "Measurement and Units (Year 3): Converting Between Centimetres and Metres, Grams and Kilograms, and Millilitres and Litres, Adding and Subtracting Money in Pence and Pounds, and Finding Perimeter by Adding Side Lengths",
    methodText: [
      "Length is measured in centimetres (cm) for shorter distances and metres (m) for longer ones, and 100cm makes exactly 1m. To convert metres to centimetres, multiply the number of metres by 100: 3m = 3 × 100 = 300cm. To go the other way, divide by 100, and whatever is left over after the whole metres stays as centimetres: 250cm is 2 whole lots of 100 (2m), with 50cm left over, so 250cm = 2m 50cm. Before comparing two lengths given in different units, always convert them into the same unit first - 45cm and 4m cannot be compared directly, but once 4m is converted to 400cm, it's clear 400cm is much longer than 45cm.",

      "Mass (how heavy something is) is measured in grams (g) and kilograms (kg), and 1000g makes exactly 1kg. Converting kilograms to grams works the same way as length: multiply the number of kilograms by 1000, so 2kg = 2 × 1000 = 2000g. As with length, always convert to the same unit before comparing two masses - to compare 750g and 1kg, convert 1kg to 1000g first, and then it's clear 1000g is heavier than 750g.",

      "Capacity (how much liquid something holds) is measured in millilitres (ml) and litres (l), and 1000ml makes exactly 1 litre. Converting litres to millilitres again means multiplying by 1000: 3 litres = 3 × 1000 = 3000ml. A common question style asks how much more is needed to fill a container up to a full litre - this is a subtraction once everything is in the same unit: a jug holding 750ml needs 1000ml - 750ml = 250ml more to reach a full litre.",

      "Money is measured in pounds (£) and pence (p), and 100p makes exactly £1. Adding or subtracting amounts given entirely in pence works exactly like adding or subtracting any other whole numbers: 45p + 30p = 75p. Finding change from £1 means first turning the pound into its pence value (100p), then subtracting the cost: if a pencil costs 35p, the change from £1 is 100p - 35p = 65p. Word problems about spending ('buys', 'spends') mean subtract, and problems about totals ('altogether', 'combined') mean add - read the sentence carefully to decide which one the story is asking for.",

      "Perimeter is the total distance all the way around the outside of a shape, found by adding together the length of every one of its sides. For a rectangle with sides 6cm and 4cm, there are two sides of 6cm and two sides of 4cm, so add all four: 6cm + 4cm + 6cm + 4cm = 20cm. For a square, all four sides are the same length, so instead of adding the same number four times, it's quicker to multiply that one side length by 4: a square with a 9cm side has a perimeter of 9 × 4 = 36cm - this is just a shortcut for the repeated addition, not a separate rule to learn. Whatever the shape, the method stays the same: write down every side length, then add them all up.",

      "Whichever of these a question is about, the same two checks are worth doing at the end: make sure every measurement used was converted into the same unit before adding, subtracting or comparing, and give the final answer in the unit the question actually asked for (don't answer in pence if the question asked for pounds, or in centimetres if it asked for metres and centimetres).",
    ].join("\n\n"),
    // Left null. Every skill here (unit conversion, money arithmetic, and
    // perimeter as adding side lengths) is a described procedure, already
    // written out in words in methodText - there's no letter-formula a
    // Year 3 child has been taught for any of it, and the named rectangle
    // perimeter formula doesn't arrive until Year 6 (see the flagged note
    // above this entry).
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Statistics & Data Handling" (30
    // live questions) - NOT "Averages & Data Handling", which is the
    // differently-named tag the 11+ Grammar Prep class uses for a
    // similar-sounding but more advanced topic (mean/averages, a Year 6+
    // skill per the style guide). get_concept_guide matches the topic
    // string exactly, so this guide is only reachable from questions
    // tagged with this exact string, and the two tags stay entirely
    // separate audiences.
    //
    // The live sample is entirely bar charts, pictograms (including
    // scaled/half-symbol pictograms, e.g. "1 symbol = 10 books, 2.5
    // symbols shown") and tables, with one-step ("how many more/fewer",
    // "which is the smallest") and two-step (find a total, then compare)
    // comparison questions - squarely within the Y3 statistics ceiling.
    // Nothing in the sample reached for line graphs, time graphs,
    // continuous data or averages (all Y4+), so nothing here does either.
    topic: "Statistics & Data Handling",
    title:
      "Statistics and Data Handling (Year 3): Reading Bar Charts, Pictograms With Scaled Symbols, and Tables, and Answering One-Step and Two-Step Comparison Questions",
    methodText: [
      "A bar chart shows a separate bar for each category, and the height (or length) of the bar shows the amount for that category, read against the scale marked along the edge of the chart. If 'Apples' reaches 12 on the scale and 'Bananas' reaches 7, those are the two amounts to work with for any question about that chart. Before answering anything, check what each bar actually represents and what number it reaches - misreading the scale is the most common mistake.",

      "A pictogram uses a repeated picture or symbol instead of a bar, and each symbol stands for a stated amount - not always 1. The key at the side or bottom of the pictogram always tells you this, for example '1 symbol = 5 sweets'. To find the total for a row of symbols, multiply the number of symbols by the value each symbol represents: 3 symbols at 5 sweets each is 3 × 5 = 15 sweets. Sometimes a row ends with half a symbol to show half that amount - a half symbol counts as half the value shown in the key, so 2.5 symbols at 10 books each is 2.5 × 10 = 25 books. Always read the key first, since the value of one symbol changes from one pictogram to the next.",

      "A table lays out amounts in rows and columns instead of pictures or bars, usually with a label down one side (like the days of the week) and the matching amount next to each label. Reading a table means finding the row for whichever label the question asks about and reading off the number next to it - for 'How many books were read on Tuesday?', find the Tuesday row and read its number directly.",

      "The most common question after any chart, pictogram or table is a one-step comparison: 'how many more/fewer' is found by subtracting the smaller amount from the larger one (12 - 7 = 5 more apples than bananas), and 'which is the biggest/smallest/most/least common' is found by comparing every value shown and picking out the largest or smallest one.",

      "A second common question style asks for a total or asks you to compare after first working something out - a two-step question. Finding the total shown across a whole chart or table means adding up every single value shown, not just two of them: for a bar chart showing cats 6, dogs 9 and fish 3, the total is 6 + 9 + 3 = 18. A question might also ask you to work out one bar's value from a pictogram first, and then compare it with another value - always do the working-out step first, then use the answer for the comparison the question actually asked.",

      "Whatever kind of question it is, three checks are worth doing before answering: read the scale or key correctly before doing any arithmetic, make sure every value being added, subtracted or compared has actually been read from the right row, bar or symbol group, and check whether the question wants a total, a difference, or simply the largest/smallest value, since these need different operations.",
    ].join("\n\n"),
    // Left null. Reading charts, multiplying by a pictogram's symbol
    // value, and comparing/adding values are all described procedures,
    // already written out in words in methodText - there's no
    // letter-formula a Year 3 child has been taught for statistics, and
    // calculating the mean as an average doesn't arrive until Year 6.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Time" (14 live questions). No 11+
    // equivalent tag exists in the live data, so there's no collision
    // risk to check here. Not broken out as its own strand in this
    // skill's formula/method table, so grounded directly against the DfE
    // Year 3 statutory requirements for measurement (Mathematics -
    // measurement, PRIMARY_national_curriculum.pdf): tell and write the
    // time to the nearest minute on 12-hour analogue and digital clocks,
    // using Roman numerals from I to XII; know the number of seconds in
    // a minute and the number of days in each month, year and leap year;
    // compare durations of events; estimate/read time with increasing
    // accuracy. The live sample matches this exactly - digital 12-hour
    // times, "quarter/twenty to/past" wording, seconds/minutes/hours/
    // days/weeks/months/years conversions, leap years, and finding a
    // later time by counting on - with nothing reaching for the 24-hour
    // clock or timetables (both Y4+), so nothing here does either.
    topic: "Time",
    title:
      "Time (Year 3): Telling and Writing the Time to the Nearest Minute, Roman Numerals on a Clock Face, Converting Between Seconds, Minutes, Hours, Days and Years, and Finding a Later Time",
    methodText: [
      "An analogue clock has two hands: the short hand shows the hour, and the long hand shows the minutes. Some clocks show the numbers 1 to 12 as Roman numerals instead of ordinary digits - I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII - but they mark exactly the same positions as a normal clock face, so I is where 1 would be, VI is where 6 would be, and XII is where 12 would be. Reading the time to the nearest minute means counting round from the 12 (or XII) in steps of 5 minutes for each numbered mark the long hand has passed, then counting on in single minutes for any marks between them.",

      "Times are also said in words: 'o'clock' means the long hand is exactly on the 12, with no extra minutes. 'Quarter past' an hour means 15 minutes have gone past it, and 'half past' means 30 minutes have gone past. 'Quarter to' the next hour means 15 minutes are still to go before it, so 'quarter to 8' is 15 minutes before 8, and in digital form that's 7:45, not 8:15 - the hour written is the one still coming up, one before the stated hour, with the minutes counted as 60 minus 15. In the same way, 'twenty to 5' is 20 minutes before 5, which is 4:40.",

      "A digital clock shows the time as hours and minutes separated by a colon, with 'am' for times before midday and 'pm' for times after it, for example 7:15am. To turn a spoken time into digital form, work out the hour first, then the minutes: 'ten past 2' is the hour 2, plus 10 minutes, giving 2:10.",

      "Units of time fit together in fixed amounts, the same way length or mass units do: 60 seconds make 1 minute, and 60 minutes make 1 hour, so to convert minutes to seconds, multiply by 60 (3 minutes = 3 × 60 = 180 seconds), and to convert hours to minutes, also multiply by 60 (half an hour = 60 ÷ 2 = 30 minutes, three-quarters of an hour = 3 lots of a quarter, or 3 × 15 = 45 minutes). A day has 24 hours, and a week has 7 days. A normal year has 365 days, and a leap year has one extra day, making 366 - a year is roughly 52 weeks, since 365 ÷ 7 is close to 52. Most months have 31 days, except April, June, September and November, which have 30, and February, which usually has 28 (29 in a leap year) - the rhyme 'thirty days has September, April, June and November' is a handy way to remember which months are shorter.",

      "Finding what time it will be after a number of minutes have passed means counting on from the starting time, in stages if the minutes cross over an hour. For 9:50am plus 20 minutes, count on 10 minutes first to reach the next hour exactly (9:50 + 10 = 10:00), then count on the remaining 10 minutes (10:00 + 10 = 10:10) - splitting the minutes at the hour boundary like this avoids the mistake of writing something like '9:70am', which isn't a real time because minutes only go up to 59 before rolling over into the next hour.",
    ].join("\n\n"),
    // Left null. Reading a clock face and converting between units of
    // time are both described procedures, already written out in words
    // in methodText - there's no letter-formula a Year 3 child has been
    // taught for telling the time or converting time units.
    formula: null,
  },
  {
    className: "Year 3",
    subjectName: "Maths",
    // Confirmed against live DB data: "Word Problems" (35 live
    // questions). This exact tag string is also used by the 11+ Grammar
    // Prep class (14 questions there) - by design, same reasoning as the
    // Measurement & Units guide above (get_concept_guide distinguishes
    // rows by classId, not by tag string alone).
    //
    // "Word Problems" isn't a standalone content strand in the National
    // Curriculum or in this skill's formula/method table - in the live
    // data it's a second tag layered on top of a question that's really
    // testing another topic (addition/subtraction, multiplication/
    // division, fractions, measurement, or statistics) but phrased as a
    // short real-world story rather than a bare calculation. So unlike
    // the other guides above, this one is deliberately NOT a re-teach of
    // any single arithmetic method (those already have their own guides
    // above) - it's the transferable comprehension skill of turning a
    // sentence into the right calculation, which is what a child actually
    // needs when this tag is the one surfaced. Every worked example below
    // stays within what a Y3 child has already been taught elsewhere in
    // these guides (times tables 2/3/4/5/8/10, 3-digit column addition/
    // subtraction, unit fractions of amounts, metric/money conversions),
    // consistent with the live sample.
    topic: "Word Problems",
    title:
      "Word Problems (Year 3): Turning a Sentence Into the Right Calculation - Spotting Addition, Subtraction, Multiplication, Division and Fraction-of Language, Solving Two-Step Problems, and Checking the Answer Makes Sense",
    methodText: [
      "A word problem tells a short story with numbers hidden inside it, and the first job is always to read the whole sentence before doing any working out, to be clear what is actually being asked for. Underlining or noting down the numbers given, and circling the question being asked, helps separate the useful information from the story dressing around it.",

      "Certain words are strong clues to which operation a story wants. Addition is usually signalled by words like 'altogether', 'in total', 'combined', 'now has' or 'gets more' - 'Tom has 235 stickers. He gets 148 more' is addition, because stickers are being added on: 235 + 148 = 383. Subtraction is signalled by words like 'left', 'spent', 'sold', 'gave away' or 'fewer' - 'A shop had 456 apples. They sold 178. How many apples are left?' is subtraction, because apples are being taken away: 456 - 178 = 278.",

      "Multiplication is usually signalled by equal groups being repeated - phrases like 'packs of', 'boxes of', or 'X in each of Y groups' - 'A box holds 8 eggs. How many eggs are in 5 boxes?' is multiplication, because the same amount (8) is repeated 5 times: 8 × 5 = 40. Division shows up in two different-sounding but related ways: 'shared equally between' or 'split between' means dividing the total by the number of groups to find how much each group gets - '36 sweets shared equally between 4 children' is 36 ÷ 4 = 9 sweets each - while a question that instead gives the size of each group and asks how many groups there are also uses division, just answering a different question about the same fact.",

      "Fraction-of-amount word problems ask for a fraction of a number of objects, such as 'There are 20 sweets. What is 1/4 of 20?' - divide the total by the denominator (the bottom number): 20 ÷ 4 = 5. A 'how much is left' fraction problem, like 'A pizza is cut into 10 equal slices. James eats 4. What fraction is left?', is answered by first working out how many equal parts remain (10 - 4 = 6), then writing that over the total number of parts (6/10).",

      "Some word problems need two steps rather than one - the answer to the first part becomes an input for the second part. 'A jug holds 750ml. How many more ml are needed to fill it to 1 litre?' first needs 1 litre converting to the same unit (1000ml), and only then can the subtraction happen: 1000ml - 750ml = 250ml. Comparison questions using a chart or table work the same way - first read off the two values being compared, and only then subtract them to answer 'how many more'. Always find every value the second step needs before trying to do that step.",

      "Once a calculation is done, it's worth checking two things before settling on the final answer: that it's given in the same unit the question used (pence, not pounds, if the question was about pence; the right item name, like 'apples' or 'sweets'), and that the size of the answer makes sense for the story - an amount 'left' or 'spent' should always be smaller than the amount there was to start with, and a multiplication answer covering several equal groups should be bigger than any one group on its own.",
    ].join("\n\n"),
    // Left null. This guide teaches a comprehension/strategy skill
    // (matching story language to an operation), not a calculation
    // method - the calculation methods it points to are already written
    // out, with no formula, in the other Year 3 guides above (Addition &
    // Subtraction, Multiplication & Division, Fractions, Measurement &
    // Units). There is nothing here that would be expressed as a
    // letter-formula even once algebra is introduced in Year 6.
    formula: null,
  },
];

async function resolveId(
  table: typeof classes | typeof subjects,
  label: "class" | "subject",
  name: string
): Promise<string> {
  const [row] = await db.select({ id: table.id, name: table.name }).from(table).where(eq(table.name, name)).limit(1);
  if (row) return row.id;

  const all = await db.select({ name: table.name }).from(table);
  throw new Error(
    `No ${label} named "${name}" exists in the database. ` +
      `Existing ${label} names: ${all.length > 0 ? all.map((r) => `"${r.name}"`).join(", ") : "(none)"}. ` +
      `Fix the ${label === "class" ? "className" : "subjectName"} in GUIDES (it must match exactly, including case) ` +
      `or create the ${label} first - this script never creates classes or subjects itself.`
  );
}

async function main() {
  // Cache lookups so a long GUIDES array doesn't re-query the same
  // class/subject once per row.
  const classIds = new Map<string, string>();
  const subjectIds = new Map<string, string>();

  let inserted = 0;
  let updated = 0;

  for (const guide of GUIDES) {
    if (!classIds.has(guide.className)) {
      classIds.set(guide.className, await resolveId(classes, "class", guide.className));
    }
    if (!subjectIds.has(guide.subjectName)) {
      subjectIds.set(guide.subjectName, await resolveId(subjects, "subject", guide.subjectName));
    }

    const classId = classIds.get(guide.className)!;
    const subjectId = subjectIds.get(guide.subjectName)!;

    // Checked only so the log can say "updated" vs "inserted" - the upsert
    // below is what actually makes a re-run safe.
    const [existing] = await db
      .select({ id: conceptGuides.id })
      .from(conceptGuides)
      .where(
        and(
          eq(conceptGuides.classId, classId),
          eq(conceptGuides.subjectId, subjectId),
          eq(conceptGuides.topic, guide.topic)
        )
      )
      .limit(1);

    await db
      .insert(conceptGuides)
      .values({
        classId,
        subjectId,
        topic: guide.topic,
        title: guide.title,
        methodText: guide.methodText,
        formula: guide.formula,
      })
      // Targets the concept_guides_class_subject_topic_idx unique index from
      // migration 0007, so re-running updates the existing guide's text in
      // place instead of raising a duplicate-key error.
      .onConflictDoUpdate({
        target: [conceptGuides.classId, conceptGuides.subjectId, conceptGuides.topic],
        set: {
          title: guide.title,
          methodText: guide.methodText,
          formula: guide.formula,
        },
      });

    if (existing) {
      updated++;
      console.log(`Updated: [${guide.className} / ${guide.subjectName}] ${guide.topic}`);
    } else {
      inserted++;
      console.log(`Inserted: [${guide.className} / ${guide.subjectName}] ${guide.topic}`);
    }
  }

  console.log(`\nDone. ${inserted} guide(s) inserted, ${updated} updated (${GUIDES.length} in total).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to seed concept guides:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
