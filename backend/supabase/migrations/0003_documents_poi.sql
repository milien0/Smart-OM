-- ---------- Documents ↔ POI ----------
-- La route POST /api/documents/upload inserisce poi_id (documenti allegati a
-- un pin) e GET /api/documents/poi/:poi_id filtra su questa colonna, ma la
-- 0001_init non l'aveva mai creata: senza questa migrazione ogni upload di
-- documenti fallisce con errore 500.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS poi_id UUID REFERENCES public.pois(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_documents_poi ON public.documents(poi_id);
