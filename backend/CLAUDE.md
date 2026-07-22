# CLAUDE.md — Smart-OM Backend

## Commands

```bash
npm run dev     # tsx watch src/index.ts, port from .env (default 4000)
npm run build   # tsc -> dist/
npm run start   # node dist/index.js (requires build first)
npm run scratch # tsx src/scratch.ts — throwaway script runner, not a test suite
```

No lint or test script exists yet.

## Setup

Requires `.env` in `backend/` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`, `PORT`. Missing vars throw at boot (`src/env.ts`) — that's
intentional, don't add silent defaults.

## Architecture

Express + TypeScript, Postgres via `pg.Pool` (`src/db.ts`) using `DATABASE_URL`
directly — the `@supabase/supabase-js` client is a dependency but not the DB
access path; only reach for it if you're specifically using Supabase Storage
or Auth, not for row data.

### Directory layout

- `src/index.ts` — app entry, route mounting, error handler last.
- `src/routes/` — one file per resource: `sites`, `models`, `pois`,
  `measurements`, `tickets`, `documents`, `contacts`, `photos`, `subcategories`.
- `src/services/indexing.ts` — indexing/search-adjacent business logic.
- `src/lib/geometry.ts` — shared geometry math (points, distances).
- `src/middleware/error.ts` — central error handler, mounted last in `index.ts`.
- `src/utils/sogConverter.ts` — Gaussian Splat (.sog) conversion utility.
- `src/types.ts` — shared TS types (`Site`, `Model`, `Poi`, `Measurement`, ...).
- `supabase/schema.sql` — full current schema (reference, not applied directly).
- `supabase/migrations/NNNN_<name>.sql` — incremental, idempotent migrations.

### API surface

Mounted at `/api/<resource>` matching the route filenames above, plus
`GET /health`. Frontend's expected endpoint list lives in
`frontend/CLAUDE.md` — keep both in sync when routes change shape.

## Conventions

- Comments and error messages are Italian; identifiers/code are English.
- New migrations: numbered (`NNNN_description.sql`), idempotent
  (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guard `ADD
  CONSTRAINT` with `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$`).
  See `supabase/migrations/0002_subcategories.sql` for the pattern.
- File uploads go through `multer`; large payloads (models, PDFs) are the
  norm — check existing routes (`documents.ts`, `photos.ts`, `models.ts`)
  for size-limit conventions before adding new upload endpoints.

## Never

- Point code at `DATABASE_URL` credentials from anywhere but `env.ts`.
- Edit a merged file under `supabase/migrations/` — add a new one.
- Add a background job or cron inside the API process — nothing here runs
  a scheduler today; flag it in the PR if you think one is needed.
