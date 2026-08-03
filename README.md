# Cardfolio

Cardfolio is a private household credit-card portfolio tracker. It tracks card
applications, open and closed accounts, 5/24 status, annual fees, reusable card
definitions, recurring benefits, and benefit usage.

The app is independently hosted on Cloudflare Workers and uses Supabase for:

- passwordless email authentication;
- PostgreSQL data storage;
- household membership and invitations; and
- row-level security as a second authorization layer.

It has no runtime dependency on OpenAI or ChatGPT.

## Local setup

Requirements: Node.js `>=22.13.0`, a Supabase project, and a Cloudflare account.

1. Copy `.env.example` to `.env.local`.
2. Fill in the Supabase project URL, anon key, and service-role key.
3. Set `CARDFOLIO_OWNER_EMAIL` to the first portfolio owner's email address.
4. Run the SQL migration in `supabase/migrations` through the Supabase SQL editor.
5. Start the app with `npm run dev`.

The service-role key is server-only. Never expose it in client code or commit an
environment file.

## Authentication model

Visitors request a Supabase magic link from the sign-in screen. Authentication
alone does not grant portfolio access. Every API request also requires a matching
household membership or invitation.

The email configured in `CARDFOLIO_OWNER_EMAIL` automatically becomes the owner
on first sign-in. The owner can authorize Sophia or another household member from
the profile menu. An authorized email becomes an active membership on its first
successful sign-in.

All reads and writes pass through the server API. The browser never receives the
Supabase service-role key, and every business-data query is scoped to the signed-in
user's household.

## Migrating the existing Sites database

The one-time importer reads the current live Cardfolio API and preserves numeric
IDs so benefit-usage relationships remain intact.

Set the migration-only values from `.env.example`, then run:

```bash
npm run db:migrate-data
```

Keep the existing Site unchanged until the imported record counts and the new app
have been verified. The importer is idempotent and can be rerun immediately before
cutover to capture final edits.

## Deployment

Authenticate Wrangler with the Cloudflare account that should own the app, add the
four runtime environment variables as Worker secrets, and run:

```bash
npm run deploy
```

For magic links, add the final `workers.dev` URL or custom domain to Supabase's
Authentication URL Configuration as the Site URL and an allowed redirect URL.

## Commands

- `npm run dev` — local development
- `npm run build` — production build
- `npm test` — build and regression checks
- `npm run lint` — lint the source
- `npm run db:migrate-data` — one-time live data import
- `npm run deploy` — deploy to the connected Cloudflare account
