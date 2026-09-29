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

## Testing on production

A test member, `devtest068@gmail.com`, can sign in to https://cardfolio.harrisonku.com. It sees
and can edit the household's real data: only read unless the owner asks for a change, and undo
anything you change.

1. The Claude Code environment must allow `cardfolio.harrisonku.com` and
   `ylrkwnqrmuxlzouziabz.supabase.co` (already added to the "Default" environment).
2. Playwright's Chromium must trust the egress proxy CA: install `libnss3-tools`, split
   `/root/.ccr/ca-bundle.crt` and add the Anthropic proxy CAs to `sql:$HOME/.pki/nssdb`
   with `certutil -A -t "C,,"`. Launch Chromium with `proxy: { server: process.env.HTTPS_PROXY }`.
3. Enter the email, press "Email me a sign-in code" once, keep that page open, then read the
   newest "Your Cardfolio sign-in code" email from `cardfolio@harrisonku.com` with the Gmail
   connector and type the code. Pressing send again invalidates the earlier code.
4. Live updates (Supabase realtime websockets) fail through the container proxy; that's
   expected there and not an app bug.

## Always commit and push

After every change, commit it and push to `main` right away, without waiting to be asked.
Run `npm run check` first; if it fails, fix the problem rather than pushing a broken build.
