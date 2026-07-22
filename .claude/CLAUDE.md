# Project: Smart-OM

Infrastructure operations platform: drone-captured 3D site models (PLY / Gaussian
Splat) with POIs, measurements, tickets, documents, photos, contacts. UI and
code comments are Italian; identifiers/code are English.

Monorepo, two independent apps, no shared package:

```
Smart-OM/
├── backend/   Express + TypeScript API, PostgreSQL via `pg` (Supabase-hosted)
├── frontend/  Next.js 16 (App Router) + React 19 + Three.js
└── assets/    Shared 3D model sample data (not code)
```

`backend/CLAUDE.md` and `frontend/CLAUDE.md` hold app-specific detail. Read the
one for whichever app you're touching — this file is the shared floor only.

## Commands

```bash
cd backend  && npm run dev    # tsx watch, port 4000
cd backend  && npm run build  # tsc -> dist/
cd frontend && npm run dev    # next dev (Turbopack), port 3000/3001
cd frontend && npm run build  # production build
cd frontend && npm run lint   # ESLint (frontend only — backend has no lint script)
```

No test suite exists in either app yet. Don't invent `npm test` calls.

## Conventions

- Backend connects to Postgres directly via `pg.Pool` (`backend/src/db.ts`),
  not the `@supabase/supabase-js` client, despite it being a dependency.
- Backend env is validated at boot in `backend/src/env.ts` — required vars
  throw immediately rather than defaulting silently. Keep that pattern for
  new env vars.
- Frontend has no auth layer client-side; backend owns auth. Don't add
  client-stored tokens/cookies without discussing it first.
- SQL migrations in `backend/supabase/migrations/` are numbered and written
  idempotent (`IF NOT EXISTS`, `EXCEPTION WHEN duplicate_object`). Match that
  style for new ones.

## Never

- Edit or renumber a migration file in `backend/supabase/migrations/` once
  it's merged — add a new numbered migration instead.
- Commit a `.env` file (backend needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `PORT` — see `backend/readme.md`).
- Split `frontend/features/models/components/plyViewer.tsx` into
  sub-components — the Three.js refs/scene/raycaster coupling is intentional
  (documented in `frontend/CLAUDE.md`).
- Add a dependency without a one-line justification in the PR/commit body.

## Housekeeping

Keep this file under 300 lines — it's standing context on every session.
Prune stale entries instead of layering new ones on top.
