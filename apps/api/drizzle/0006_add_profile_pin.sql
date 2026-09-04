-- Gives each profile a real PIN, so "who's playing" is an actual login
-- rather than just typing a name. pin_hash is nullable so existing
-- profiles (created before this feature) simply get prompted to choose a
-- PIN the next time that name is entered - see POST /profiles/:id/set-pin,
-- which only ever sets a PIN once (pin_hash must currently be null),
-- everything after that goes through /verify-pin or an admin reset. Run
-- this once in the Supabase SQL Editor, same as 0000-0005.

alter table profiles add column if not exists pin_hash text;
