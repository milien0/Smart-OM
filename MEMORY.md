# Smart-OM — session memory

Cross-session facts and decisions for this repo. Prune stale entries every
session — this file rots the same way CLAUDE.md does.

## Preferences

- No padding in commit messages or PR descriptions; direct and brief.
- Push to remote after every commit unless told otherwise.
- No dead code, no duplicate files — refactor messy structure encountered
  along the way rather than working around it.

## Decisions

- 2026-07-22: Backend talks to Postgres via `pg.Pool` directly, not the
  Supabase JS client, even though the client is a listed dependency. Don't
  "fix" this by migrating routes to `supabase-js` without being asked.
- 2026-07-22: `plyViewer.tsx` stays a single large component — Three.js
  ref/scene/raycaster coupling makes extraction fragile. See
  `frontend/CLAUDE.md`.

## Open questions

- No test suite exists in either app. Flag if a task assumes one.
- `frontend/.claude/launch.json` and root `.claude/launch.json` are debug
  launcher configs, unrelated to the Claude Code harness — don't confuse
  them with `settings.json`.
