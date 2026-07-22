# Goal

<!-- Fill this in per loop run. One goal per run.sh session — don't queue
multiple unrelated goals in one PROMPT.md; the loop re-reads this file every
iteration and drifts if the target keeps changing under it. -->

Example shape (replace before running `./run.sh`):

# Goal
Add a `severity: 'critical'` filter toggle to the POI list in
`frontend/features/models/components/plyViewer.tsx`.

# Done when
- Toggle exists in the category filter row.
- Filtering hides non-critical POIs on the 3D model and in the ticket list.
- `npm run lint` passes in `frontend/`.

# Never touch
- `backend/supabase/migrations/*` already merged.
- Anything under `frontend/node_modules/`.
- The route mounting order in `backend/src/index.ts`.

# Stop if
- More than 3 files outside `frontend/features/models/` need edits.
- A route that currently works starts returning errors.
