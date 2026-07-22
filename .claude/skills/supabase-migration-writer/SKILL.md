---
name: supabase-migration-writer
description: Writes Postgres migration files for the Smart-OM schema. Use when the user asks to add/alter a table, column, index, or constraint in backend/supabase.
when_to_use: schema change requested, new feature needs a new column, index
  missing on a hot query path, a route references a table/column that
  doesn't exist yet in supabase/schema.sql
---

# Steps

1. Read `backend/supabase/schema.sql` to confirm the current state — it is
   the reference, migrations are the incremental history.
2. Find the highest existing number in `backend/supabase/migrations/` and
   write the next one: `NNNN_<verb>_<noun>.sql` (zero-padded to 4 digits,
   matching `0001_init.sql`, `0002_subcategories.sql`, `0003_documents_poi.sql`).
3. Write it idempotent, matching `0002_subcategories.sql`'s pattern:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - New constraints wrapped in `DO $$ BEGIN ... EXCEPTION WHEN
     duplicate_object THEN null; END $$;`
   - Indexes with `CREATE INDEX IF NOT EXISTS`
4. Header comment block: migration number, one-line purpose, why (what
   route/feature needs it), and confirmation it's idempotent — see existing
   migrations for the exact shape.
5. Update `backend/supabase/schema.sql` to reflect the new state (it's the
   living reference, not just history).
6. If the frontend or backend routes now depend on the new column/table,
   note that in the migration's header comment so the reviewer can trace it.

# Never

- Edit a migration file that's already merged — always add a new one.
- Drop a column or table without an explicit user request — additive by
  default.
