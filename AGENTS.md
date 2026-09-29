# Notes for agents working on Cardfolio

## Keep the to-do list current

`TODO.md` is the project's to-do list. Whenever you finish, start, or discover work:

- add new follow-ups (things the owner must do, setup steps, known data guesses, ideas);
- check off finished items and move them to **Done** with the date;
- keep steps concrete enough that someone can follow them later without the chat history.

Update it in the same commit as the related change.

## Project basics

- Next.js app on Vercel (project `cardfolio`, team `hku-projects`), Supabase for auth and
  Postgres (project `ylrkwnqrmuxlzouziabz`). Production: https://cardfolio.harrisonku.com.
- Business logic lives in framework-free TypeScript under `app/lib/core/` and is tested in
  `tests/core.test.ts` against `data/sheet-snapshot.json`.
- The browser reads and writes Supabase directly under row-level security; server routes
  in `app/api/` handle membership, invites, push reminders and exports.
- Schema changes go in a new file in `supabase/migrations/` (never edit applied ones).
- Card names: use the short name (`shortName()` / `holdingName()`, the sheet abbreviation
  like "biz plat #7") wherever space is tight: tables, tags, lists, toasts, notifications.
  Keep full names (`holdingName(..., true)`) for headings, dropdowns and detail views.
- Before pushing, run `npm run check` (lint, type-check, tests, build).
- Commit to `main`; Vercel deploys every push.

## Always commit and push

After every change, commit it and push to `main` right away, without waiting to be asked.
Run `npm run check` first; if it fails, fix the problem rather than pushing a broken build.
