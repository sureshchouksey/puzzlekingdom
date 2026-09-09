#!/usr/bin/env tsx
// Seeds the fun_content table (drizzle/0013_add_fun_content.sql) - the
// curated bank of tongue twisters, riddles, jokes, multi-step brain-teaser
// puzzles, and subject trivia that the Study Buddy chat (routes/tutor.ts)
// serves when a child's message is classified as a "fun_request" by
// tutorIntent.ts, instead of going through the retrieval+generation
// pipeline. See plan/AI-Study-Mentor-Agent-Plan.md's "friendly chat / play
// a game" extension.
//
// Usage: npm run seed:fun-content -w apps/api
//
// Idempotent: each row is looked up by (content_type, prompt_text) before
// inserting, so re-running after editing an item's answer/prompt below
// updates it in place instead of creating a duplicate. Safe to run as many
// times as you like.
//
// Content sources: the riddles, tongue twisters, and the full "Class 3 to
// 5" logic/wordplay/challenge set were supplied directly by the user for
// this feature. The jokes and subject trivia were drafted to round out the
// bank across all five content types and the three trivia subjects
// tutorIntent.ts can classify a request into (science/english/maths).

import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { funContent } from "../src/db/schema.js";

type FunContentSeed = {
  contentType: "tongue_twister" | "riddle" | "joke" | "puzzle" | "trivia";
  subject?: "science" | "english" | "maths";
  promptText: string;
  answerText?: string;
  // A gentle nudge toward the answer, shown when a child asks for a hint
  // instead of the full answer (see tutorIntent.ts's hint_request intent) -
  // undefined for tongue twisters, which have no answer to hint at.
  hintText?: string;
};

const ITEMS: FunContentSeed[] = [
  // --- Riddles (user-supplied) ---------------------------------------
  {
    contentType: "riddle",
    promptText: "I have a head and a tail, but no body. What am I?",
    answerText: "A coin.",
    hintText: "Think about something small and round that jingles in your pocket.",
  },
  {
    contentType: "riddle",
    promptText: "What gets wetter and wetter the more it dries?",
    answerText: "A towel.",
    hintText: "Think about what you use right after a bath or a swim.",
  },
  {
    contentType: "riddle",
    promptText: "David's parents have three sons: Snap, Crackle, and what is the name of the third son?",
    answerText: "David! Read it again - the riddle already told you his name.",
    hintText: "Read the riddle again very carefully - the answer is hiding in the very first word.",
  },
  {
    contentType: "riddle",
    promptText: "I am full of holes, but I can still hold water. What am I?",
    answerText: "A sponge.",
    hintText: "You'll find this sitting by the kitchen sink or in the bathtub.",
  },
  {
    contentType: "riddle",
    promptText: "What has to be broken before you can use it?",
    answerText: "An egg.",
    hintText: "Think about breakfast - you might crack one of these into a pan.",
  },
  {
    contentType: "riddle",
    promptText: "What goes up when rain comes down?",
    answerText: "An umbrella.",
    hintText: "You carry this outside to stay dry.",
  },

  // --- Tongue twisters (user-supplied) --------------------------------
  {
    contentType: "tongue_twister",
    promptText: "Five frantic frogs fled from fifty fierce fish.",
  },
  {
    contentType: "tongue_twister",
    promptText: "How much wood would a woodchuck chuck if a woodchuck could chuck wood?",
  },
  {
    contentType: "tongue_twister",
    promptText: "She sells seashells by the seashore.",
  },
  {
    contentType: "tongue_twister",
    promptText: "A big black bug bit a big black bear on his big black nose!",
  },
  {
    contentType: "tongue_twister",
    promptText: "If two witches were watching two watches, which witch would watch which watch?",
  },
  {
    contentType: "tongue_twister",
    promptText: "A skunk sat on a stump and thunk the stump stunk, but the stump thunk the skunk stunk.",
  },

  // --- Class 3-5 (ages 8-11): Tricky Logic & Math Riddles (user-supplied) ---
  {
    contentType: "riddle",
    promptText: "A farmer has 17 sheep, and all but 9 die. How many sheep does he have left?",
    answerText: "9 sheep are left - \"all BUT 9\" means 9 of them survived.",
    hintText: "Read the word 'but' very carefully - it's changing the meaning of the sentence.",
  },
  {
    contentType: "riddle",
    promptText: "How many times can you subtract 5 from 25?",
    answerText: "Just once! After that, you're subtracting from 20, not 25 anymore.",
    hintText: "Try it step by step: after you subtract once, what number are you subtracting from next?",
  },
  {
    contentType: "riddle",
    promptText: "What is half of two, plus two?",
    answerText: "3! Half of two is one, and one plus two is three.",
    hintText: "Do the two parts in order: find half of two first, then add two to that.",
  },
  {
    contentType: "riddle",
    promptText: "How many months of the year have 28 days?",
    answerText: "All 12 of them! Every month has at least 28 days.",
    hintText: "Think carefully: does every month have AT LEAST 28 days, even February?",
  },
  {
    contentType: "riddle",
    promptText: "What number can you cut exactly in half to get two zeros, and turn on its side to get infinity?",
    answerText: "The number 8! Cut it in half and you get two 0s; turn it on its side and it looks like the infinity symbol.",
    hintText: "Picture the digits 0 through 9 - which one looks like two circles stacked on top of each other?",
  },

  // --- Class 3-5: Lateral Thinking & Wordplay (user-supplied) ---------
  {
    contentType: "riddle",
    promptText: "What appears once in a minute, twice in a moment, but never in a thousand years?",
    answerText: "The letter M.",
    hintText: "Try spelling out the words 'minute', 'moment', and 'thousand years' and look for a letter that repeats in a pattern.",
  },
  {
    contentType: "riddle",
    promptText: "What 5-letter word becomes shorter when you add two letters to it?",
    answerText: "SHORT - add \"ER\" to the end and it becomes SHORTER!",
    hintText: "Think of a word that describes something small in length - adding letters to it makes a funny joke.",
  },
  {
    contentType: "riddle",
    promptText:
      "You're the driver of a bus. At the first stop, 3 people get on. At the second stop, 5 people get on and 2 people get off. What color are the bus driver's eyes?",
    answerText: "Whatever color your own eyes are - YOU are the bus driver!",
    hintText: "Read the very first sentence of the riddle again - who did it say was doing the driving?",
  },
  {
    contentType: "riddle",
    promptText: "What begins with P, ends with E, and has thousands of letters?",
    answerText: "The Post Office!",
    hintText: "Think about a place where letters - the mail kind - get sorted and delivered.",
  },
  {
    contentType: "riddle",
    promptText: "What goes up and down but never actually moves?",
    answerText: "A flight of stairs (a staircase)!",
    hintText: "Think about something in a two-storey house that you walk on to get from one floor to another.",
  },

  // --- Class 3-5: Step-by-Step Challenge Puzzles (user-supplied) ------
  {
    contentType: "puzzle",
    promptText:
      "The Climbing Snail: A snail is at the bottom of a 10-metre pit. Each day it climbs up 3 metres, but each night it slides back down 2 metres. How many days does it take the snail to climb all the way out?",
    answerText:
      "8 days. Each full day-and-night, the snail only gains 1 metre overall (up 3, down 2), so after 7 days it's at 7 metres. On day 8, it climbs the 3 metres it needs to reach 10 metres and escapes the pit BEFORE that night's slide-back happens - so it takes 8 days, not 10.",
    hintText: "Work out how many metres the snail actually gains after each full day and night (up 3, down 2) - then think carefully about what happens on the very last day.",
  },
  {
    contentType: "puzzle",
    promptText:
      "The 3-Bucket Water Puzzle: You have a 3-litre bucket and a 5-litre bucket, and an unlimited supply of water from a tap. Neither bucket has any markings on it. How can you measure out exactly 4 litres of water?",
    answerText:
      "1) Fill the 5-litre bucket completely. 2) Pour from it into the 3-litre bucket until that one is full - this leaves exactly 2 litres in the 5-litre bucket. 3) Empty the 3-litre bucket completely. 4) Pour the 2 litres from the 5-litre bucket into the empty 3-litre bucket. 5) Fill the 5-litre bucket completely again. 6) Pour from the 5-litre bucket into the 3-litre bucket (which already has 2 litres) until it's full - that only takes 1 more litre, leaving exactly 4 litres behind in the 5-litre bucket!",
    hintText: "Start by filling the 5-litre bucket completely, then pour it into the 3-litre bucket until that one is full - think about what's left over in the big one.",
  },

  // --- Jokes ------------------------------------------------------------
  { contentType: "joke", promptText: "Why did the math book look so sad?", answerText: "Because it had too many problems!", hintText: "Think about what fills the pages of a math book - and what that same word can mean in real life." },
  { contentType: "joke", promptText: "What do you call a bear with no teeth?", answerText: "A gummy bear!", hintText: "Think of a chewy candy shaped like a little bear." },
  { contentType: "joke", promptText: "Why can't you give Elsa a balloon?", answerText: "Because she'll let it go!", hintText: "Think about Elsa's famous song from Frozen - what does she tell you to do?" },
  { contentType: "joke", promptText: "What do you call a fish with no eyes?", answerText: "A fsh!", hintText: "Say the word 'fish' out loud, then imagine spelling it without the letter that looks like a little eye." },
  { contentType: "joke", promptText: "Why did the bicycle fall over?", answerText: "Because it was two tired!", hintText: "Think about how many wheels a bicycle has, and a word that sounds like a number but means sleepy." },
  { contentType: "joke", promptText: "What did one wall say to the other wall?", answerText: "I'll meet you at the corner!", hintText: "Think about where two walls in a room actually touch each other." },
  { contentType: "joke", promptText: "Why did the scarecrow win an award?", answerText: "Because he was outstanding in his field!", hintText: "Think about where a scarecrow stands all day, and a word that also means 'excellent'." },
  { contentType: "joke", promptText: "What do you call a dinosaur that crashes his car?", answerText: "A Tyrannosaurus wrecks!", hintText: "Think of a famous dinosaur's name, and a word for a car accident that sounds a bit like part of it." },

  // --- Trivia: science ----------------------------------------------
  { contentType: "trivia", subject: "science", promptText: "How many legs does a spider have?", answerText: "8 legs - that's what makes spiders arachnids, not insects (insects have 6 legs).", hintText: "Count on your fingers - spiders have more legs than insects do." },
  { contentType: "trivia", subject: "science", promptText: "What is the closest planet to the Sun?", answerText: "Mercury.", hintText: "Think of the smallest, speediest planet, orbiting closest to the Sun's heat." },
  { contentType: "trivia", subject: "science", promptText: "What gas do plants take in that humans and animals breathe out?", answerText: "Carbon dioxide.", hintText: "Think about what you breathe out, and what plants need to make their own food." },
  { contentType: "trivia", subject: "science", promptText: "What is the largest organ in the human body?", answerText: "The skin!", hintText: "Think about the one organ that covers your whole body from head to toe." },
  { contentType: "trivia", subject: "science", promptText: "About how many bones are in an adult human body?", answerText: "206 bones.", hintText: "It's a number a bit more than 200 - somewhere in the low 200s." },
  { contentType: "trivia", subject: "science", promptText: "What do we call animals that only eat plants?", answerText: "Herbivores.", hintText: "Think of the word 'herb', like the plants you might find in a garden." },

  // --- Trivia: english ------------------------------------------------
  { contentType: "trivia", subject: "english", promptText: "What do you call a word that means the same as another word, like \"happy\" and \"joyful\"?", answerText: "A synonym.", hintText: "Think of a word that means basically the same thing as another word." },
  { contentType: "trivia", subject: "english", promptText: "What do you call a word that means the opposite of another word, like \"hot\" and \"cold\"?", answerText: "An antonym.", hintText: "Think of a word that's the total opposite of another word." },
  { contentType: "trivia", subject: "english", promptText: "What punctuation mark goes at the end of a question?", answerText: "A question mark (?).", hintText: "Look at the little curved symbol with a dot underneath it - you'll see it at the end of this hint if it were a question." },
  { contentType: "trivia", subject: "english", promptText: "What do we call the main character in a story?", answerText: "The protagonist.", hintText: "Think about the hero of the story - the character whose journey you're following." },
  { contentType: "trivia", subject: "english", promptText: "What's the plural of the animal \"mouse\"?", answerText: "Mice!", hintText: "Think about more than one mouse - the word doesn't just add an 's' at the end." },
  { contentType: "trivia", subject: "english", promptText: "What part of speech describes an action, like \"run\" or \"jump\"?", answerText: "A verb.", hintText: "Think about the word in a sentence that tells you what someone is DOING." },

  // --- Trivia: maths ---------------------------------------------------
  { contentType: "trivia", subject: "maths", promptText: "What do we call a number that can only be divided evenly by 1 and itself?", answerText: "A prime number.", hintText: "Think of numbers like 2, 3, 5, or 7 - what do they all have in common?" },
  { contentType: "trivia", subject: "maths", promptText: "How many sides does a hexagon have?", answerText: "6 sides.", hintText: "Think of a honeycomb - count the sides on one of the little cells the bees build." },
  { contentType: "trivia", subject: "maths", promptText: "What do you get when you multiply any number by zero?", answerText: "Zero!", hintText: "Think about having zero groups of something - how many do you actually have?" },
  { contentType: "trivia", subject: "maths", promptText: "What do we call the answer to a subtraction problem?", answerText: "The difference.", hintText: "Think of the math word for how far apart two numbers are after you subtract." },
];

async function main() {
  let inserted = 0;
  let updated = 0;

  for (const item of ITEMS) {
    const [existing] = await db
      .select({ id: funContent.id })
      .from(funContent)
      .where(and(eq(funContent.contentType, item.contentType), eq(funContent.promptText, item.promptText)))
      .limit(1);

    if (existing) {
      await db
        .update(funContent)
        .set({ subject: item.subject ?? null, answerText: item.answerText ?? null, hintText: item.hintText ?? null })
        .where(eq(funContent.id, existing.id));
      updated++;
    } else {
      await db.insert(funContent).values({
        contentType: item.contentType,
        subject: item.subject ?? null,
        promptText: item.promptText,
        answerText: item.answerText ?? null,
        hintText: item.hintText ?? null,
      });
      inserted++;
    }
  }

  console.log(`Done. ${inserted} row(s) inserted, ${updated} updated (${ITEMS.length} in total).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to seed fun content:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
