-- 1. Allow multiple reviews per user by dropping the UNIQUE constraint
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_user_id_key;

-- 2. Add foreign key to profiles so the Admin panel can join feedback with usernames
ALTER TABLE public.feedback
  ADD CONSTRAINT fk_feedback_profiles
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 3. Reload schema cache for changes to take effect
NOTIFY pgrst, 'reload schema';
