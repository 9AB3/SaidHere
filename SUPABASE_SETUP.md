# Supabase setup

1. Create a Supabase project.
2. Open **Authentication → Providers / Sign In Methods** and enable **Anonymous Sign-Ins**.
3. In **SQL Editor**, run `supabase/migrations/001_initial.sql`.
4. For development only, optionally run `supabase/seed.sql`.
5. Copy the project URL and public anon/publishable key.

Run the app with:

```bash
flutter run \
  --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY \
  --dart-define=APP_HOST=saidhere.app \
  --dart-define=DEMO_TAG_TOKEN=demo-newcastle-wall-2026
```

## Provision a plaque

Run `supabase/NEW_WALL.sql` in the SQL editor. It returns the exact `nfc_url` to write to the tag.

The NFC token is deliberately kept in `wall_tags`, separate from `walls`, and is never returned by normal app APIs.

## Moderation

- Messages are max 300 characters.
- Every post stores the anonymous Supabase user ID privately.
- The app never returns author IDs in its public post view.
- A user can report a message only after discovering that Wall.
- Three distinct reports temporarily hide a message in the MVP.
- For production, add server-side automated moderation before/after insert and an admin review queue.

## Abuse controls recommended before public launch

Supabase recommends CAPTCHA for anonymous sign-ins at scale. Add Cloudflare Turnstile/hCaptcha plus API-level rate limiting before a large public rollout.
