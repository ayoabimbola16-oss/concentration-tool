-- ═══════════════════════════════════════════════════════════════
--  FIX: Add avatar_url column to profiles table
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- Add avatar_url column if it doesn't already exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- Done! The app can now save profile pictures to the database.
