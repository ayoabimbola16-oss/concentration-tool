-- ═══════════════════════════════════════════════════════════════
--  master-schema.sql — PlanTrack Master Database Setup
--  Consolidated Schema for Supabase PostgreSQL
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. PROFILES TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  avatar_url TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  daily_streak INT DEFAULT 0,
  last_active_date DATE DEFAULT CURRENT_DATE,
  is_admin BOOLEAN DEFAULT FALSE,
  is_pro BOOLEAN DEFAULT FALSE,
  pro_subscription_expires TIMESTAMPTZ,
  trial_started_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. ALARMS TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alarms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  time TIME NOT NULL,
  date DATE,
  repeat TEXT DEFAULT 'none',
  label TEXT NOT NULL,
  sound TEXT DEFAULT 'chime',
  custom_sound_url TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. TIMETABLES TABLE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timetables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'General',
  columns JSONB NOT NULL DEFAULT '["Day","Subject","Time","Venue"]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. PLANS & ACTIVITIES TABLE ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'daily', -- daily, weekly, monthly, yearly
  tasks JSONB DEFAULT '[]'::jsonb, -- array of { id, text, completed }
  due_date DATE,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. FOCUS SESSIONS LOG ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.focus_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  duration_minutes INT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- ── 6. FRIENDS & FRIEND REQUESTS ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'accepted', -- pending, accepted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- ── 7. NEXUS MESSAGES TABLE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT,
  attachment_type TEXT, -- text, image, audio, file, timetable, plan
  attachment_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. FEEDBACK & RATINGS TABLE ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY (RLS) POLICIES ──────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles read access" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Alarms Policies
CREATE POLICY "Users view own alarms" ON public.alarms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users modify own alarms" ON public.alarms FOR ALL USING (auth.uid() = user_id);

-- Timetables Policies
CREATE POLICY "Users view own timetables" ON public.timetables FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users modify own timetables" ON public.timetables FOR ALL USING (auth.uid() = user_id);

-- Plans Policies
CREATE POLICY "Users view own plans" ON public.plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users modify own plans" ON public.plans FOR ALL USING (auth.uid() = user_id);

-- Focus Sessions Policies
CREATE POLICY "Users view own focus sessions" ON public.focus_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users modify own focus sessions" ON public.focus_sessions FOR ALL USING (auth.uid() = user_id);

-- Friends Policies
CREATE POLICY "Users view own friends" ON public.friends FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "Users modify own friends" ON public.friends FOR ALL USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Messages Policies
CREATE POLICY "Users view own messages" ON public.messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Users send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Users update own messages" ON public.messages FOR UPDATE USING (auth.uid() = receiver_id OR auth.uid() = sender_id);

-- Feedback Policies
CREATE POLICY "Public read feedback" ON public.feedback FOR SELECT USING (true);
CREATE POLICY "Users insert feedback" ON public.feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
