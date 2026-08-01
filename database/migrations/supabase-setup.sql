-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack Concentration Tool — Supabase Database Setup
--  Run ALL of this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════
--  1. PROFILES TABLE  (stores username + email)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username  TEXT UNIQUE NOT NULL,
  email     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Allow username lookup during login (public read for username→email mapping)
CREATE POLICY "Anyone can look up username to email"
  ON public.profiles FOR SELECT
  USING (true);


-- ══════════════════════════════════════════
--  2. ALARMS TABLE
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.alarms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  time       TEXT NOT NULL,              -- HH:MM (24h)
  date       DATE,                       -- optional specific date
  label      TEXT NOT NULL,
  repeat     TEXT DEFAULT 'none',        -- none | daily | weekdays | weekends | weekly
  sound      TEXT NOT NULL,             -- sound id from SOUNDS array
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.alarms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own alarms"
  ON public.alarms FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS alarms_user_idx ON public.alarms(user_id);
CREATE INDEX IF NOT EXISTS alarms_time_idx ON public.alarms(time);


-- ══════════════════════════════════════════
--  3. TIMETABLES TABLE
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.timetables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tt_type    TEXT NOT NULL,             -- user-defined title/type
  columns    TEXT[] NOT NULL,           -- array of column names
  rows       JSONB DEFAULT '[]'::JSONB, -- array of arrays (row data)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own timetables"
  ON public.timetables FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS tt_user_idx ON public.timetables(user_id);


-- ══════════════════════════════════════════
--  4. FOLDERS TABLE
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own folders"
  ON public.folders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS folders_user_idx ON public.folders(user_id);


-- ══════════════════════════════════════════
--  5. FILES TABLE
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id  UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,             -- storage path
  url        TEXT NOT NULL,             -- public URL
  size       BIGINT DEFAULT 0,
  mime       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own files"
  ON public.files FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS files_user_idx    ON public.files(user_id);
CREATE INDEX IF NOT EXISTS files_folder_idx  ON public.files(folder_id);


-- ══════════════════════════════════════════
--  6. PLANS TABLE
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  duration   TEXT NOT NULL,             -- daily | weekly | monthly | yearly
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  activities JSONB DEFAULT '[]'::JSONB, -- [{text, status: null|'done'|'not-done'}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own plans"
  ON public.plans FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS plans_user_idx     ON public.plans(user_id);
CREATE INDEX IF NOT EXISTS plans_duration_idx ON public.plans(duration);


-- ══════════════════════════════════════════
--  7. AUTO-UPDATE updated_at trigger
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER timetables_updated_at
  BEFORE UPDATE ON public.timetables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ══════════════════════════════════════════
--  DONE! All tables created.
-- ══════════════════════════════════════════
