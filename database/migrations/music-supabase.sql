-- ================================================================
--  Run this in Supabase Dashboard → SQL Editor → New Query
-- ================================================================

CREATE TABLE IF NOT EXISTS public.user_sounds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  url        TEXT NOT NULL,
  size       BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_sounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sounds"
  ON public.user_sounds FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS sounds_user_idx ON public.user_sounds(user_id);
