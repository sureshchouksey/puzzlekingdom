-- fun_content (migration 0013) only ever stored the full answer, with
-- nothing in between the question and giving it away outright. tutor.ts's
-- INCORRECT_GUESS_REPLIES already offers "want a hint, or should I tell
-- you the answer?" after a wrong guess, but until now there was no actual
-- hint to give - this column is that missing piece. Nullable: tongue
-- twisters have no answer to hint at, and it's fine for older/future rows
-- to go without one (funContent.ts's formatFunContentHint degrades
-- gracefully when it's null).
alter table fun_content add column if not exists hint_text text;
