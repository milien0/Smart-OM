-- =====================================================================
-- Smart O&M — Schema Database completo (PostgreSQL locale / Docker)
-- Crea da zero l'intero database, senza dipendenze cloud o Supabase Auth.
-- Consolida in un unico file lo stato finale delle migrazioni in
-- supabase/migrations/ (0001_init, 0002_subcategories, 0003_documents_poi).
--
-- Uso:
--   createdb smart_om
--   psql "postgresql://<user>@localhost:5432/smart_om" -f supabase/schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. ENUM ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'technician', 'viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE poi_severity AS ENUM ('info', 'warning', 'critical', 'maintenance');
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


-- ---------- 2. FUNZIONI UTILI ----------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';


-- ---------- 3. UTENTI LOCALI (sostituisce Supabase Auth) ----------
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'technician',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 4. SITES ----------
CREATE TABLE IF NOT EXISTS public.sites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 5. MODELS (digital twin per sede) ----------
CREATE TABLE IF NOT EXISTS public.models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  file_path      TEXT,
  format         TEXT,          -- 'ply' | 'splat' | 'ksplat' | 'glb' | 'gltf'
  default_camera JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- 6. SUBCATEGORIES ----------
CREATE TABLE IF NOT EXISTS public.subcategories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id    UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subcategories_unique UNIQUE (site_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_subcategories_site ON public.subcategories (site_id);


-- ---------- 7. POIS (marker / catasto anomalie e guasti) ----------
CREATE TABLE IF NOT EXISTS public.pois (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id                 UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  position                 JSONB NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT,
  severity                 poi_severity NOT NULL DEFAULT 'info',
  created_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  category                 TEXT,
  subcategory_id           UUID REFERENCES public.subcategories(id) ON DELETE SET NULL,
  maintenance_due_date     DATE,
  maintenance_done_date    DATE,
  maintenance_periodicity  TEXT CHECK (
    maintenance_periodicity IS NULL
    OR maintenance_periodicity IN ('monthly', 'quarterly', 'biannual', 'annual')
  ),
  maintenance_last_done    DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pois_model         ON public.pois(model_id);
CREATE INDEX IF NOT EXISTS idx_pois_subcategory    ON public.pois(subcategory_id);


-- ---------- 8. POI_PHOTOS ----------
CREATE TABLE IF NOT EXISTS public.poi_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id     UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  caption    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poi_photos_poi ON public.poi_photos(poi_id);


-- ---------- 9. DOCUMENTS (gestione documentale e PDF) ----------
CREATE TABLE IF NOT EXISTS public.documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  poi_id     UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  size       INTEGER,
  mime_type  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_site ON public.documents(site_id);
CREATE INDEX IF NOT EXISTS idx_documents_poi  ON public.documents(poi_id);


-- ---------- 10. DOCUMENT_CHUNKS (embeddings per RAG, Nomic Embed 768d) ----------
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding   public.vector(768) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
ON public.document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_document_chunks_site_id
ON public.document_chunks (site_id);


-- ---------- 11. MEASUREMENTS ----------
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

CREATE INDEX IF NOT EXISTS idx_measurements_model ON public.measurements(model_id);


-- ---------- 12. CONTACTS (fornitori e manutentori) ----------
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

CREATE INDEX IF NOT EXISTS idx_contacts_site ON public.contacts(site_id);


-- ---------- 13. TICKETS ----------
CREATE TABLE IF NOT EXISTS public.tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  poi_id      UUID REFERENCES public.pois(id) ON DELETE SET NULL,
  contact_id  UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      ticket_status NOT NULL DEFAULT 'open',
  priority    ticket_priority NOT NULL DEFAULT 'medium',
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_poi  ON public.tickets(poi_id);
CREATE INDEX IF NOT EXISTS idx_tickets_site ON public.tickets(site_id);

DROP TRIGGER IF EXISTS trg_update_tickets_updated_at ON public.tickets;
CREATE TRIGGER trg_update_tickets_updated_at
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();


-- ---------- 14. TICKET_COMMENTS ----------
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  comment    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_tk ON public.ticket_comments(ticket_id);


-- ---------- 15. UTENTE AMMINISTRATORE DI TEST ----------
-- Password in chiaro di esempio: "AdminPassword2026!" (bcrypt via pgcrypto)
INSERT INTO public.users (email, password_hash, full_name, role)
VALUES (
  'admin@smartom.local',
  crypt('AdminPassword2026!', gen_salt('bf', 10)),
  'Amministratore Locale',
  'admin'
) ON CONFLICT (email) DO NOTHING;
