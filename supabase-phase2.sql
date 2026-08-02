-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack — Phase 2: Community, Admin, Ratings & Social
--  Run ALL of this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Add is_admin, streak_public, avatar_url to profiles ─────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS streak_public INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_url    TEXT    DEFAULT NULL;

-- Grant admin to Abimzz
UPDATE public.profiles SET is_admin = true WHERE username = 'Abimzz';


-- ── 2. FRIENDS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

-- Sender can insert + see their own requests
CREATE POLICY "Users manage their own friend requests"
  ON public.friends FOR ALL
  USING (auth.uid() = user_id OR auth.uid() = friend_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS friends_user_idx   ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS friends_friend_idx ON public.friends(friend_id);


-- ── 3. SOCIAL INTERACTIONS TABLE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('nudge','highfive')),
  seen        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.social_interactions ENABLE ROW LEVEL SECURITY;

-- Sender can insert; receiver can read + mark seen
CREATE POLICY "Send interactions"
  ON public.social_interactions FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Read own received interactions"
  ON public.social_interactions FOR SELECT
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id);

CREATE POLICY "Mark seen"
  ON public.social_interactions FOR UPDATE
  USING (auth.uid() = receiver_id);

CREATE INDEX IF NOT EXISTS si_receiver_idx ON public.social_interactions(receiver_id);
CREATE INDEX IF NOT EXISTS si_sender_idx   ON public.social_interactions(sender_id);


-- ── 4. USER PRESENCE TABLE (live counter) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own presence; anyone authenticated can count
CREATE POLICY "Update own presence"
  ON public.user_presence FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone authenticated can read presence count"
  ON public.user_presence FOR SELECT
  USING (auth.role() = 'authenticated');


-- ── 5. FEEDBACK / RATINGS TABLE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)   -- one feedback per user (upsert pattern)
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Users manage their own feedback
CREATE POLICY "Users manage own feedback"
  ON public.feedback FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin can read ALL feedback
CREATE POLICY "Admin reads all feedback"
  ON public.feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS feedback_user_idx ON public.feedback(user_id);


-- ── 6. PUBLIC PROFILE STATS VIEW ───────────────────────────────────
-- Lets any authenticated user see aggregate focus stats per user
CREATE OR REPLACE VIEW public.public_profile_stats AS
SELECT
  p.id,
  p.username,
  p.created_at AS joined_at,
  p.avatar_url,
  p.streak_public,
  COUNT(f.id)           AS total_sessions,
  COALESCE(SUM(f.duration_mins), 0) AS total_focus_mins
FROM public.profiles p
LEFT JOIN public.focus_sessions f ON f.user_id = p.id
GROUP BY p.id, p.username, p.created_at, p.avatar_url, p.streak_public;

-- RLS does not apply to views directly; the view uses the caller's
-- session so underlying RLS on profiles/focus_sessions applies.
-- Grant select to authenticated users:
GRANT SELECT ON public.public_profile_stats TO authenticated;


-- ── 7. ADMIN OVERVIEW VIEW ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.admin_user_overview AS
SELECT
  p.id,
  p.username,
  p.email,
  p.created_at AS joined_at,
  p.is_admin,
  COUNT(DISTINCT a.id)  AS total_alarms,
  COUNT(DISTINCT pl.id) AS total_plans,
  COUNT(DISTINCT fs.id) AS total_sessions,
  COALESCE(SUM(fs.duration_mins), 0) AS total_focus_mins,
  MAX(fs.completed_at)  AS last_focus_at
FROM public.profiles p
LEFT JOIN public.alarms        a  ON a.user_id  = p.id
LEFT JOIN public.plans         pl ON pl.user_id = p.id
LEFT JOIN public.focus_sessions fs ON fs.user_id = p.id
GROUP BY p.id, p.username, p.email, p.created_at, p.is_admin;

-- Only admin can query this view
-- We enforce this by wrapping access in a function with SECURITY DEFINER
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


-- ── 8. MAKE PROFILES READABLE BY ALL AUTHENTICATED USERS ───────────
-- (needed for user search + public profile viewing)
-- Drop the old restrictive policy if it exists and create a public-read one
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Authenticated users can read any profile"
  ON public.profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Re-add own-write policies (unchanged)
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);


-- ── DONE ──────────────────────────────────────────────────────────
-- Next: rebuild and sync the app (npx cap sync android)
