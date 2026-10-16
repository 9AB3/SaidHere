-- Run this from Supabase > SQL Editor whenever you manufacture a new plaque.
select *
from public.admin_create_wall(
  'THE WALL',
  'Somewhere in Newcastle',
  'saidhere.app'
);

-- The result includes slug, tag_token and the exact nfc_url to encode.
-- Test the tag before permanently write-locking it.
