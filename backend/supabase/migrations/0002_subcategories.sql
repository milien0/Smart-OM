-- =====================================================================
-- Smart O&M — Migrazione 0002: Sottocategorie dei POI
-- Aggiunge la tabella `subcategories` e la colonna `pois.subcategory_id`,
-- richieste dal codice backend (routes/subcategories.ts, routes/pois.ts)
-- ma assenti nello schema iniziale 0001_init.sql.
-- Idempotente: può essere rieseguita senza errori.
-- =====================================================================

-- ---------- Tabella sottocategorie ----------
CREATE TABLE IF NOT EXISTS public.subcategories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id    uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    category   text NOT NULL,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Evita duplicati della stessa sottocategoria nello stesso sito/categoria
    CONSTRAINT subcategories_unique UNIQUE (site_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_subcategories_site
    ON public.subcategories (site_id);

-- ---------- Collega i POI alle sottocategorie ----------
ALTER TABLE public.pois
    ADD COLUMN IF NOT EXISTS subcategory_id uuid;

-- FK aggiunta a parte per poter usare IF NOT EXISTS sulla colonna.
-- ON DELETE SET NULL: eliminando una sottocategoria i pin restano
-- (tornano "non ordinati"), coerentemente con la UI del viewer.
DO $$ BEGIN
    ALTER TABLE public.pois
        ADD CONSTRAINT pois_subcategory_id_fkey
        FOREIGN KEY (subcategory_id)
        REFERENCES public.subcategories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pois_subcategory
    ON public.pois (subcategory_id);
