-- =====================================================================
-- Smart O&M — Schema Database Nativo (PostgreSQL Locale / Docker)
-- Autonomo, senza dipendenze cloud o Supabase Auth.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. ENUM ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'technician', 'viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE poi_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE measurement_type AS ENUM ('distance', 'height', 'area', 'coordinate');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ---------- 2. FUNZIONI UTILI (Definite subito per evitare errori nei trigger) ----------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';


-- ---------- 3. TABELLA UTENTI LOCALE (Sostituisce Supabase Auth) ----------
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,       -- Gestito dal backend Express (es. con bcrypt)
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'technician',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 4. SITES (Le sedi/impianti gestiti dall'azienda) ----------
CREATE TABLE IF NOT EXISTS public.sites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 5. MODELS (I digital twin di ciascuna sede) ----------
CREATE TABLE IF NOT EXISTS public.models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  file_path      TEXT,          -- percorso relativo es: 'models/file.glb'
  format         TEXT,          -- 'ply' | 'splat' | 'ksplat' | 'glb' | 'gltf'
  default_camera JSONB,         -- { position:{x,y,z}, target:{x,y,z} }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 6. POIS (Marker / Catasto anomalie e guasti) ----------
CREATE TABLE IF NOT EXISTS public.pois (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  model_id              UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  position              JSONB NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  severity              poi_severity NOT NULL DEFAULT 'info'::poi_severity,
  created_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  category              TEXT,
  maintenance_due_date  DATE,
  maintenance_done_date DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pois_pkey PRIMARY KEY (id)
);


-- ---------- 7. POI_PHOTOS (Allegati fotografici) ----------
CREATE TABLE IF NOT EXISTS public.poi_photos (
  id         UUID NOT NULL DEFAULT gen_random_uuid(),
  poi_id     UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  caption    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poi_photos_pkey PRIMARY KEY (id)
);


-- ---------- 8. DOCUMENTS (Gestione documentale e PDF) ----------
CREATE TABLE IF NOT EXISTS public.documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  size       INTEGER,
  mime_type  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. Crea la tabella da zero con la dimensione corretta per Nomic Embed
CREATE TABLE public.document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding   public.vector(768) NULL, 
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Crea l'indice HNSW per la ricerca semantica velocizzata
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. Crea l'indice per velocizzare le query sui documenti del sito
CREATE INDEX IF NOT EXISTS idx_document_chunks_site_id 
ON public.document_chunks (site_id);


-- ---------- 9. MEASUREMENTS ----------
CREATE TABLE IF NOT EXISTS public.measurements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id   UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  type       measurement_type NOT NULL,
  points     JSONB NOT NULL,
  result     NUMERIC,
  unit       TEXT,
  label      TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 10. CONTACTS (Fornitori e manutentori) ----------
CREATE TABLE IF NOT EXISTS public.contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id      UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    company      VARCHAR(255),
    service_type VARCHAR(255) NOT NULL,
    phone        VARCHAR(50),
    email        VARCHAR(255),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 11. TICKETS ----------
CREATE TABLE IF NOT EXISTS public.tickets (
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  poi_id      UUID REFERENCES public.pois(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      ticket_status NOT NULL DEFAULT 'open'::ticket_status,
  priority    ticket_priority NOT NULL DEFAULT 'medium'::ticket_priority,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tickets_pkey PRIMARY KEY (id)
);

-- Associazione trigger aggiornamento tempo su tabella tickets
DROP TRIGGER IF EXISTS trg_update_tickets_updated_at ON public.tickets;
CREATE TRIGGER trg_update_tickets_updated_at
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();


-- ---------- 12. TICKET_COMMENTS ----------
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id        UUID NOT NULL DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  comment   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_comments_pkey PRIMARY KEY (id)
);


-- ---------- 13. INDICI (Ottimizzazione Performance Query) ----------
CREATE INDEX IF NOT EXISTS idx_models_site         ON public.models(site_id);
CREATE INDEX IF NOT EXISTS idx_pois_model           ON public.pois(model_id);
CREATE INDEX IF NOT EXISTS idx_poi_photos_poi       ON public.poi_photos(poi_id);
CREATE INDEX IF NOT EXISTS idx_documents_site       ON public.documents(site_id);
CREATE INDEX IF NOT EXISTS idx_measurements_model   ON public.measurements(model_id);
CREATE INDEX IF NOT EXISTS idx_contacts_site        ON public.contacts(site_id);
CREATE INDEX IF NOT EXISTS idx_tickets_poi          ON public.tickets(poi_id);
CREATE INDEX IF NOT EXISTS idx_tickets_site         ON public.tickets(site_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_tk   ON public.ticket_comments(ticket_id);


-- ---------- 14. UTENTE AMMINISTRATORE DI TEST ----------
-- Password in chiaro di esempio: "AdminPassword2026!" crittografata in locale tramite pgcrypto (Blowfish/bcrypt)
INSERT INTO public.users (email, password_hash, full_name, role)
VALUES (
  'admin@smartom.local', 
  crypt('AdminPassword2026!', gen_salt('bf', 10)), 
  'Amministratore Locale', 
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- =====================================================================
-- MIGRAZIONE: piano di manutenzione dei POI
-- =====================================================================

-- 1) Nuove colonne richieste dal nuovo modello di manutenzione
ALTER TABLE pois
  ADD COLUMN IF NOT EXISTS maintenance_periodicity TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_last_done DATE;

-- maintenance_due_date dovrebbe già esistere; in caso contrario:
ALTER TABLE pois
  ADD COLUMN IF NOT EXISTS maintenance_due_date DATE;

-- (facoltativo) vincolo sui valori ammessi per la periodicità
ALTER TABLE pois
  DROP CONSTRAINT IF EXISTS pois_maintenance_periodicity_check;
ALTER TABLE pois
  ADD CONSTRAINT pois_maintenance_periodicity_check
  CHECK (
    maintenance_periodicity IS NULL
    OR maintenance_periodicity IN ('monthly', 'quarterly', 'biannual', 'annual')
  );

-- (facoltativo) la data di completamento non serve più.
-- Scommenta SOLO se sei sicuro di non usarla altrove:
-- ALTER TABLE pois DROP COLUMN IF EXISTS maintenance_done_date;


-- =====================================================================
-- 2) VERIFICA/FIX della colonna severity (deve accettare 'maintenance')
-- =====================================================================

-- 2a) Scopri com'è definita la colonna severity:
--     SELECT column_name, data_type, udt_name
--     FROM information_schema.columns
--     WHERE table_name = 'pois' AND column_name = 'severity';

-- 2b) CASO A — severity è un ENUM (udt_name tipo 'poi_severity'):
--     ALTER TYPE poi_severity ADD VALUE IF NOT EXISTS 'maintenance';

-- 2c) CASO B — severity è TEXT con un vincolo CHECK:
--     Trova il nome del constraint:
--       SELECT conname FROM pg_constraint
--       WHERE conrelid = 'pois'::regclass AND contype = 'c';
--     Poi ricrealo includendo 'maintenance', es.:
--       ALTER TABLE pois DROP CONSTRAINT pois_severity_check;
--       ALTER TABLE pois ADD CONSTRAINT pois_severity_check
--         CHECK (severity IN ('info','warning','critical','maintenance'));

-- 2d) CASO C — severity è TEXT senza vincoli: nessuna azione necessaria.

ALTER TYPE poi_severity ADD VALUE IF NOT EXISTS 'maintenance';

ALTER TABLE public.tickets
ADD COLUMN contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;