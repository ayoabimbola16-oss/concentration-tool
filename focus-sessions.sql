-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack — Focus Sessions Tracking Table
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.focus_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  duration_secs  INTEGER NOT NULL,          -- how long the session was set for (seconds)
  duration_mins  INTEGER NOT NULL,          -- same in minutes (for easy querying)
  sound_used     TEXT DEFAULT 'chime',      -- which completion sound was chosen
  completed_at   TIMESTAMPTZ DEFAULT NOW(), -- when the session finished
  date           DATE DEFAULT CURRENT_DATE  -- date only (for daily aggregates)
);

-- Row Level Security
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own sessions
CREATE POLICY "Users manage their own focus sessions"
  ON public.focus_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS focus_user_idx ON public.focus_sessions(user_id);
CREATE INDEX IF NOT EXISTS focus_date_idx ON public.focus_sessions(date);

-- ── ADMIN VIEW (optional) ──────────────────────────────────────────
-- Run this separately if you want a convenient admin summary view:

CREATE OR REPLACE VIEW public.focus_summary AS
SELECT
  p.username,
  p.email,
  COUNT(f.id)            AS total_sessions,
  SUM(f.duration_mins)   AS total_focus_mins,
  MAX(f.completed_at)    AS last_session_at,
  f.date
FROM public.focus_sessions f
JOIN public.profiles p ON p.id = f.user_id
GROUP BY p.username, p.email, f.date
ORDER BY f.date DESC, total_focus_mins DESC;

-- ── DONE ──────────────────────────────────────────────────────────
-- To monitor in Supabase:
--   Table Editor → focus_sessions  (all raw sessions)
--   SQL Editor → SELECT * FROM focus_summary;  (per-user daily summary)
