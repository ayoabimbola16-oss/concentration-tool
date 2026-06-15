-- Fix Friends Table RLS Policy to allow receivers to accept requests
DROP POLICY IF EXISTS "Users manage their own friend requests" ON public.friends;

CREATE POLICY "Users manage their own friend requests"
  ON public.friends FOR ALL
  USING (auth.uid() = user_id OR auth.uid() = friend_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = friend_id);
