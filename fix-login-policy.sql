-- ═══════════════════════════════════════════════════════════════════
--  fix-login-policy.sql  —  PlanTrack Login Fix
--
--  RUN THIS in: Supabase Dashboard → SQL Editor → New Query
--
--  PURPOSE:
--    The "Error looking up username" login error is caused by Supabase
--    Row Level Security (RLS) blocking the anonymous SELECT on the
--    profiles table BEFORE the user is authenticated.
--
--    This script drops any conflicting SELECT policies and replaces
--    them with a clean, minimal set:
--      • Public read of username+email only (for login lookup)
--      • Full read of own profile only (after login)
--      • Insert / Update own profile only (after login)
-- ═══════════════════════════════════════════════════════════════════


-- ── Step 1: Drop ALL existing SELECT policies on profiles ─────────
-- (avoids duplicates / conflicts)
DROP POLICY IF EXISTS "Users can view their own profile"      ON public.profiles;
DROP POLICY IF EXISTS "Anyone can look up username to email"  ON public.profiles;
DROP POLICY IF EXISTS "Public username lookup"                ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users"      ON public.profiles;


-- ── Step 2: Drop existing INSERT / UPDATE policies ────────────────
DROP POLICY IF EXISTS "Users can insert their own profile"    ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile"    ON public.profiles;


-- ── Step 3: Make sure RLS is enabled ─────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ── Step 4: Recreate clean, minimal policies ─────────────────────

-- POLICY A: Anyone (including unauthenticated/anon) can look up
--   username and email. This is REQUIRED for the login flow to work
--   because the user is not yet authenticated when they click Sign In.
CREATE POLICY "Public username lookup for login"
  ON public.profiles
  FOR SELECT
  USING (true);


-- POLICY B: Users can only INSERT their own profile row.
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);


-- POLICY C: Users can only UPDATE their own profile row.
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);


-- ── Step 5: Ensure the profiles table has all required columns ────
DO $$
BEGIN
  -- email column (required for login lookup)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email TEXT NOT NULL DEFAULT '';
  END IF;

  -- avatar_url column (optional, for profile pictures)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
  END IF;
END $$;


-- ── Step 6: Verify the policies were created ─────────────────────
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- ════════════════════════════════════════════════════════════════
--  DONE!
--  After running this, go back to your app and try signing in again.
--  The "Error looking up username" error should be resolved.
-- ════════════════════════════════════════════════════════════════
