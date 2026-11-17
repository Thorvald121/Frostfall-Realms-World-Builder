-- Frostfall P3. Staging-only additive migration after P2.
-- No existing world/article/manuscript records are changed or removed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ff_manuscript_worlds (
  world_id uuid PRIMARY KEY REFERENCES public.worlds(id) ON DELETE CASCADE,
  manuscripts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(manuscripts)='array'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.ff_manuscript_revisions (
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision>0),
  manuscripts jsonb NOT NULL CHECK (jsonb_typeof(manuscripts)='array'),
  saved_at timestamptz NOT NULL DEFAULT now(),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (world_id,revision)
);
CREATE INDEX IF NOT EXISTS ff_manuscript_revisions_lookup
  ON public.ff_manuscript_revisions(world_id,revision DESC);

ALTER TABLE public.ff_manuscript_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_manuscript_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ff_ms_read ON public.ff_manuscript_worlds;
DROP POLICY IF EXISTS ff_ms_history_read ON public.ff_manuscript_revisions;
CREATE POLICY ff_ms_read ON public.ff_manuscript_worlds FOR SELECT TO authenticated
  USING (public.ff_canon_can_read(world_id));
CREATE POLICY ff_ms_history_read ON public.ff_manuscript_revisions FOR SELECT TO authenticated
  USING (public.ff_canon_can_read(world_id));

-- The single RPC owns writes and history. Neither clients nor anon may directly
-- mutate manuscript rows. In SECURITY DEFINER functions, verify auth.uid()
-- explicitly and use an empty search path to avoid caller-controlled objects.
CREATE OR REPLACE FUNCTION public.ff_save_manuscript_world(
  p_world_id uuid, p_expected_revision bigint, p_manuscripts jsonb
) RETURNS TABLE(revision bigint, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_revision bigint; v_updated timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ff_canon_can_write(p_world_id) THEN
    RAISE EXCEPTION 'FF_MANUSCRIPT_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_manuscripts IS NULL OR jsonb_typeof(p_manuscripts) <> 'array'
     OR pg_column_size(p_manuscripts) > 10485760 THEN
    RAISE EXCEPTION 'FF_MANUSCRIPT_INVALID_OR_TOO_LARGE' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'FF_MANUSCRIPT_BAD_REVISION' USING ERRCODE='22023';
  END IF;

  IF p_expected_revision = 0 THEN
    INSERT INTO public.ff_manuscript_worlds(world_id,manuscripts,revision,updated_by)
      VALUES (p_world_id,p_manuscripts,1,auth.uid())
      ON CONFLICT (world_id) DO NOTHING
      RETURNING ff_manuscript_worlds.revision,ff_manuscript_worlds.updated_at INTO v_revision,v_updated;
  ELSE
    UPDATE public.ff_manuscript_worlds AS ms
      SET manuscripts=p_manuscripts,revision=ms.revision+1,updated_at=now(),updated_by=auth.uid()
      WHERE ms.world_id=p_world_id AND ms.revision=p_expected_revision
      RETURNING ms.revision,ms.updated_at INTO v_revision,v_updated;
  END IF;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'FF_MANUSCRIPT_REVISION_CONFLICT' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.ff_manuscript_revisions(world_id,revision,manuscripts,author_id)
    VALUES (p_world_id,v_revision,p_manuscripts,auth.uid());
  -- Keep the latest 30 durable snapshots. Export remains available to the author.
  DELETE FROM public.ff_manuscript_revisions AS history
    WHERE history.world_id=p_world_id AND history.revision <= v_revision-30;
  RETURN QUERY SELECT v_revision,v_updated;
END;$$;

REVOKE ALL ON TABLE public.ff_manuscript_worlds, public.ff_manuscript_revisions FROM anon, authenticated;
GRANT SELECT ON public.ff_manuscript_worlds, public.ff_manuscript_revisions TO authenticated;
REVOKE ALL ON FUNCTION public.ff_save_manuscript_world(uuid,bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ff_save_manuscript_world(uuid,bigint,jsonb) TO authenticated;
COMMIT;
