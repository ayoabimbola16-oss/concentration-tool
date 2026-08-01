-- ═══════════════════════════════════════════════════════════════════
--  PlanTrack — Admin & Social Enhancements SQL
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════

-- 1. Toggle Admin Role function (Allows an admin to promote/demote users)
CREATE OR REPLACE FUNCTION public.admin_toggle_user_role(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can manage roles.';
  END IF;

  -- Prevent admin from demoting themselves (failsafe)
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Admins cannot change their own role.';
  END IF;

  -- Toggle the target user's is_admin status
  UPDATE public.profiles
  SET is_admin = NOT COALESCE(is_admin, false)
  WHERE id = target_user_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_user_role(UUID) TO authenticated;


-- 2. Reset User Streak function (Allows an admin to reset a user's streak)
CREATE OR REPLACE FUNCTION public.admin_reset_user_streak(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can reset streaks.';
  END IF;

  -- Reset streak fields in profiles table
  UPDATE public.profiles
  SET current_streak = 0,
      longest_streak = 0,
      last_active_date = NULL
  WHERE id = target_user_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_user_streak(UUID) TO authenticated;


-- 3. Delete Feedback function (Allows an admin to moderate and delete feedback posts)
CREATE OR REPLACE FUNCTION public.admin_delete_feedback(target_feedback_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete feedback.';
  END IF;

  -- Delete the feedback row
  DELETE FROM public.feedback
  WHERE id = target_feedback_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_feedback(UUID) TO authenticated;


-- 4. Safe RPC function to accept friend request (bypasses RLS issues for receivers)
CREATE OR REPLACE FUNCTION public.accept_friend_request(request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify that the caller is the receiver of this friend request
  IF NOT EXISTS (
    SELECT 1 FROM public.friends
    WHERE id = request_id AND friend_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You are not the recipient of this friend request.';
  END IF;

  -- Update status to accepted
  UPDATE public.friends
  SET status = 'accepted'
  WHERE id = request_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_friend_request(UUID) TO authenticated;


-- 5. Safe RPC function to decline/cancel friend request (bypasses RLS issues)
CREATE OR REPLACE FUNCTION public.decline_friend_request(request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify that the caller is either the sender or receiver
  IF NOT EXISTS (
    SELECT 1 FROM public.friends
    WHERE id = request_id AND (user_id = auth.uid() OR friend_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You are not a party to this friend request.';
  END IF;

  -- Delete the friendship row
  DELETE FROM public.friends
  WHERE id = request_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_friend_request(UUID) TO authenticated;


-- 6. Reload schema cache for changes to take effect
NOTIFY pgrst, 'reload schema';
