-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack Schema Update — ADD MISSING COLUMNS
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add parent_id to folders for subfolder support
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='folders' AND column_name='parent_id') THEN
    ALTER TABLE public.folders ADD COLUMN parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Add reminder columns to plans
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plans' AND column_name='reminder_time') THEN
    ALTER TABLE public.plans ADD COLUMN reminder_time TEXT DEFAULT '08:00';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plans' AND column_name='reminder_days') THEN
    ALTER TABLE public.plans ADD COLUMN reminder_days TEXT DEFAULT 'daily';
  END IF;
END $$;

-- 3. Add avatar_url to profiles if missing
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='avatar_url') THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
  END IF;
END $$;

-- 4. Re-cache the schema (not always necessary but good practice)
NOTIFY pgrst, 'reload schema';
