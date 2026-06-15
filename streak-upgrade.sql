-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack — Streak System Upgrade
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Add streak columns to profiles ──────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_streak   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_date DATE    DEFAULT NULL;

-- Migrate existing streak_public values into new columns
UPDATE public.profiles
SET current_streak = COALESCE(streak_public, 0),
    longest_streak = COALESCE(streak_public, 0)
WHERE current_streak = 0 AND COALESCE(streak_public, 0) > 0;


-- ── 2. Update PUBLIC PROFILE STATS view ────────────────────────────
DROP VIEW IF EXISTS public.public_profile_stats CASCADE;

CREATE OR REPLACE VIEW public.public_profile_stats AS
SELECT
  p.id,
  p.username,
  p.created_at AS joined_at,
  p.avatar_url,
  p.streak_public,
  p.current_streak,
  p.longest_streak,
  p.last_active_date,
  COUNT(f.id)           AS total_sessions,
  COALESCE(SUM(f.duration_mins), 0) AS total_focus_mins
FROM public.profiles p
LEFT JOIN public.focus_sessions f ON f.user_id = p.id
GROUP BY p.id, p.username, p.created_at, p.avatar_url,
         p.streak_public, p.current_streak, p.longest_streak, p.last_active_date;

GRANT SELECT ON public.public_profile_stats TO authenticated;


-- ── 3. Update ADMIN USER OVERVIEW view ─────────────────────────────
DROP VIEW IF EXISTS public.admin_user_overview CASCADE;

CREATE OR REPLACE VIEW public.admin_user_overview AS
SELECT
  p.id,
  p.username,
  p.email,
  p.created_at AS joined_at,
  p.is_admin,
  p.current_streak,
  p.longest_streak,
  p.last_active_date,
  COUNT(DISTINCT a.id)  AS total_alarms,
  COUNT(DISTINCT pl.id) AS total_plans,
  COUNT(DISTINCT fs.id) AS total_sessions,
  COALESCE(SUM(fs.duration_mins), 0) AS total_focus_mins,
  MAX(fs.completed_at)  AS last_focus_at
FROM public.profiles p
LEFT JOIN public.alarms        a  ON a.user_id  = p.id
LEFT JOIN public.plans         pl ON pl.user_id = p.id
LEFT JOIN public.focus_sessions fs ON fs.user_id = p.id
GROUP BY p.id, p.username, p.email, p.created_at, p.is_admin,
         p.current_streak, p.longest_streak, p.last_active_date;

-- Recreate the admin RPC function
CREATE OR REPLACE FUNCTION public.get_admin_overview()
RETURNS SETOF public.admin_user_overview
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT * FROM public.admin_user_overview
  WHERE EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_overview() TO authenticated;


-- ── 4. Reload schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
--  DONE! Run this SQL, then refresh the app.
-- ═══════════════════════════════════════════════════════════════════
