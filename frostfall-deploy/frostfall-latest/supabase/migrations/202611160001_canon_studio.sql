-- Frostfall Studio P2: additive, world-isolated Canon Studio schema.
-- STAGING ONLY until a backup and policy tests have been completed.
-- Does not modify or migrate existing articles/manuscripts.
BEGIN;

-- Membership helpers: owner by default; world_members is optional in legacy deployments.
-- SECURITY DEFINER avoids recursive member RLS policies. Caller identity is always auth.uid().
CREATE OR REPLACE FUNCTION public.ff_canon_can_read(target_world uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); member_access boolean := false;
BEGIN
  IF actor IS NULL OR target_world IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.worlds WHERE id = target_world AND user_id = actor) THEN RETURN true; END IF;
  IF to_regclass('public.world_members') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.world_members WHERE world_id = $1 AND user_id = $2 AND role IN (''owner'', ''editor'', ''viewer''))'
      INTO member_access USING target_world, actor;
  END IF;
  RETURN COALESCE(member_access, false);
END; $$;

CREATE OR REPLACE FUNCTION public.ff_canon_can_write(target_world uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); member_access boolean := false;
BEGIN
  IF actor IS NULL OR target_world IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.worlds WHERE id = target_world AND user_id = actor) THEN RETURN true; END IF;
  IF to_regclass('public.world_members') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.world_members WHERE world_id = $1 AND user_id = $2 AND role IN (''owner'', ''editor''))'
      INTO member_access USING target_world, actor;
  END IF;
  RETURN COALESCE(member_access, false);
END; $$;
REVOKE ALL ON FUNCTION public.ff_canon_can_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ff_canon_can_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ff_canon_can_read(uuid), public.ff_canon_can_write(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.ff_canon_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 60 AND slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, slug), UNIQUE(world_id, id)
);
CREATE INDEX IF NOT EXISTS ff_canon_branches_world ON public.ff_canon_branches(world_id);

CREATE TABLE IF NOT EXISTS public.ff_canon_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'author_note' CHECK(kind IN ('author_note', 'codex', 'document', 'import')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  excerpt text NOT NULL DEFAULT '' CHECK(length(excerpt) <= 12000),
  citation text NOT NULL DEFAULT '' CHECK(length(citation) <= 2000),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, id)
);
CREATE INDEX IF NOT EXISTS ff_canon_sources_world ON public.ff_canon_sources(world_id);

CREATE TABLE IF NOT EXISTS public.ff_canon_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 200),
  subject_article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE RESTRICT,
  predicate text NOT NULL CHECK(length(predicate) BETWEEN 1 AND 80 AND predicate ~ '^[a-z][a-z0-9_]*$'),
  object_id text CHECK(object_id IS NULL OR length(object_id) <= 200),
  object_article_id uuid REFERENCES public.articles(id) ON DELETE RESTRICT,
  value jsonb,
  from_year numeric(14, 3),
  until_year numeric(14, 3),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('canon','draft','disputed','superseded','alternate')),
  exclusive boolean NOT NULL DEFAULT false,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 12000),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ff_canon_assertions_branch_world FOREIGN KEY (world_id,branch_id)
    REFERENCES public.ff_canon_branches(world_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ff_canon_assertions_world_branch ON public.ff_canon_assertions(world_id, branch_id, status);
CREATE INDEX IF NOT EXISTS ff_canon_assertions_subject ON public.ff_canon_assertions(world_id,subject_id);

CREATE TABLE IF NOT EXISTS public.ff_canon_findings (
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  finding_key text NOT NULL CHECK(length(finding_key) BETWEEN 1 AND 600),
  signature text NOT NULL CHECK(length(signature) BETWEEN 1 AND 150),
  disposition text NOT NULL CHECK(disposition IN ('acknowledged','intentional','dismissed')),
  rationale text NOT NULL DEFAULT '' CHECK(length(rationale) <= 4000),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id,branch_id,finding_key),
  FOREIGN KEY (world_id,branch_id) REFERENCES public.ff_canon_branches(world_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ff_canon_findings_world ON public.ff_canon_findings(world_id,branch_id);

-- Cross-world provenance and codex source references are forbidden.
CREATE OR REPLACE FUNCTION public.ff_canon_verify_source_world()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.article_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.articles WHERE id = NEW.article_id AND world_id = NEW.world_id
  ) THEN RAISE EXCEPTION 'Canon source article does not belong to this world'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ff_canon_sources_verify_world ON public.ff_canon_sources;
CREATE TRIGGER ff_canon_sources_verify_world BEFORE INSERT OR UPDATE OF world_id,article_id
 ON public.ff_canon_sources FOR EACH ROW EXECUTE FUNCTION public.ff_canon_verify_source_world();

CREATE OR REPLACE FUNCTION public.ff_canon_verify_claim_sources()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- UUIDs are the stable canonical identity; slugs are a readable snapshot only.
  SELECT a.slug INTO NEW.subject_id FROM public.articles a
    WHERE a.world_id = NEW.world_id AND a.id = NEW.subject_article_id;
  IF NEW.subject_id IS NULL THEN RAISE EXCEPTION 'Canon subject article does not exist in this world'; END IF;
  IF NEW.object_article_id IS NOT NULL THEN
    SELECT a.slug INTO NEW.object_id FROM public.articles a
      WHERE a.world_id = NEW.world_id AND a.id = NEW.object_article_id;
    IF NEW.object_id IS NULL THEN RAISE EXCEPTION 'Canon object article does not exist in this world'; END IF;
  ELSIF NEW.object_id IS NOT NULL THEN
    RAISE EXCEPTION 'Canon related entry requires a stable article UUID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.source_ids) AS sid
    WHERE NOT EXISTS (SELECT 1 FROM public.ff_canon_sources s WHERE s.id = sid AND s.world_id = NEW.world_id)
  ) THEN RAISE EXCEPTION 'Canon assertion contains a source from another world or a missing source'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ff_canon_assertions_verify_sources ON public.ff_canon_assertions;
CREATE TRIGGER ff_canon_assertions_verify_sources BEFORE INSERT OR UPDATE ON public.ff_canon_assertions
 FOR EACH ROW EXECUTE FUNCTION public.ff_canon_verify_claim_sources();

CREATE OR REPLACE FUNCTION public.ff_canon_findings_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at := now(); NEW.updated_by := auth.uid(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS ff_canon_findings_touch ON public.ff_canon_findings;
CREATE TRIGGER ff_canon_findings_touch BEFORE INSERT OR UPDATE ON public.ff_canon_findings
 FOR EACH ROW EXECUTE FUNCTION public.ff_canon_findings_touch();

-- Branch/source provenance cannot be forged through direct PostgREST writes.
CREATE OR REPLACE FUNCTION public.ff_canon_set_created_by()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ff_canon_branches_creator ON public.ff_canon_branches;
CREATE TRIGGER ff_canon_branches_creator BEFORE INSERT OR UPDATE ON public.ff_canon_branches
 FOR EACH ROW EXECUTE FUNCTION public.ff_canon_set_created_by();
DROP TRIGGER IF EXISTS ff_canon_sources_creator ON public.ff_canon_sources;
CREATE TRIGGER ff_canon_sources_creator BEFORE INSERT OR UPDATE ON public.ff_canon_sources
 FOR EACH ROW EXECUTE FUNCTION public.ff_canon_set_created_by();

-- Ensure every existing and future world has a main branch, without changing any codex data.
INSERT INTO public.ff_canon_branches (world_id,slug,name)
 SELECT id,'main','Main Canon' FROM public.worlds
 ON CONFLICT (world_id,slug) DO NOTHING;
CREATE OR REPLACE FUNCTION public.ff_canon_initialize_world()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.ff_canon_branches(world_id,slug,name,created_by)
  VALUES(NEW.id,'main','Main Canon',NEW.user_id) ON CONFLICT(world_id,slug) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ff_canon_world_create_main ON public.worlds;
CREATE TRIGGER ff_canon_world_create_main AFTER INSERT ON public.worlds
 FOR EACH ROW EXECUTE FUNCTION public.ff_canon_initialize_world();

-- RLS is on every table. No service-role key is ever exposed to browser clients.
ALTER TABLE public.ff_canon_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_canon_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_canon_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_canon_findings ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['ff_canon_branches','ff_canon_sources','ff_canon_assertions','ff_canon_findings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS ff_canon_read ON public.%I',tab);
    EXECUTE format('DROP POLICY IF EXISTS ff_canon_insert ON public.%I',tab);
    EXECUTE format('DROP POLICY IF EXISTS ff_canon_update ON public.%I',tab);
    EXECUTE format('DROP POLICY IF EXISTS ff_canon_delete ON public.%I',tab);
    EXECUTE format('CREATE POLICY ff_canon_read ON public.%I FOR SELECT TO authenticated USING (public.ff_canon_can_read(world_id))',tab);
    EXECUTE format('CREATE POLICY ff_canon_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.ff_canon_can_write(world_id))',tab);
    EXECUTE format('CREATE POLICY ff_canon_update ON public.%I FOR UPDATE TO authenticated USING (public.ff_canon_can_write(world_id)) WITH CHECK (public.ff_canon_can_write(world_id))',tab);
    EXECUTE format('CREATE POLICY ff_canon_delete ON public.%I FOR DELETE TO authenticated USING (public.ff_canon_can_write(world_id))',tab);
  END LOOP;
END $$;

REVOKE ALL ON public.ff_canon_branches, public.ff_canon_sources, public.ff_canon_assertions, public.ff_canon_findings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ff_canon_branches, public.ff_canon_sources, public.ff_canon_assertions, public.ff_canon_findings TO authenticated;
COMMIT;
