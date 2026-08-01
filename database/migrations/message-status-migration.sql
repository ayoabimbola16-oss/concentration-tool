-- Migration to add message status fields
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('sent', 'delivered', 'read')) DEFAULT 'sent';

ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ DEFAULT NULL;

-- Migrate existing data: if is_read is true, set status = 'read', else 'sent'
UPDATE public.messages
SET status = 'read',
    read_at = created_at,
    delivered_at = created_at
WHERE is_read = TRUE;

UPDATE public.messages
SET status = 'sent'
WHERE is_read = FALSE OR is_read IS NULL;
