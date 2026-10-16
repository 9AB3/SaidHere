# SaidHere

**Real places. Real people. Anonymous thoughts.**

SaidHere is a location-bound anonymous message app. A physical NFC plaque identifies a specific Wall. Tapping the plaque discovers that Wall and unlocks writing for 15 minutes. After that, the Wall remains readable from the user's discovered-Walls list, but writing requires another plaque tap.

## What is implemented

- Flutter app for iOS, Android and web
- NFC/deep-link route: `/t/<secret-tag-token>`
- Public Wall route: `/w/<wall-slug>`
- Anonymous API sessions — no sign-up UI
- Render Node web service + Render Postgres
- Per-Wall discovery history
- 15-minute server-enforced write/reply window after a plaque tap
- Text-only anonymous posts, max 300 characters
- One-level replies
- Dates only; no username, avatar, likes or followers
- Previous-year browsing on long-lived Walls
- Reporting flow
- Automatic hiding after three distinct reports
- Private anonymous session IDs retained only for abuse controls
- NFC tag token stored only as a SHA-256 hash
- Wall/NFC provisioning command
- Render Blueprint (`render.yaml`)
- Codemagic build workflow
- GitHub analyze/test workflow
- iOS Universal Link / Android App Link bootstrap templates

## Product rules

SaidHere deliberately does **not** have profiles, handles, likes, DMs, follower counts, global feeds or searchable public Walls. The place is the network.

A user can revisit a Wall they previously found and read it, but posting is locked unless that anonymous session currently has a non-expired write window created by opening the plaque link.

## Stack

- Flutter / Dart
- Node.js / Express
- Render Web Service
- Render Postgres
- `go_router` for web/native deep links
- `shared_preferences` for the anonymous API token and lightweight local history

## 1. Deploy the backend on Render

Follow [RENDER_SETUP.md](RENDER_SETUP.md).

The repository includes a root `render.yaml` Blueprint that creates:

- `saidhere-api-9ab3` — Node web service
- `saidhere-db-9ab3` — private Render Postgres database

Both are configured in Render's Singapore region.

## 2. Generate native Flutter platform folders

The repository keeps generated Flutter platform boilerplate out of source control so the current Flutter stable templates are used.

```bash
python3 tool/bootstrap_platforms.py --host saidhere.app
flutter pub get
```

The script runs `flutter create` if needed, then adds SaidHere's Android/iOS deep-link configuration.

## 3. Run the app

Once the Render Blueprint is live:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://saidhere-api-9ab3.onrender.com \
  --dart-define=APP_HOST=saidhere.app
```

`API_BASE_URL` already defaults to that Render service, so it can be omitted unless you are overriding it.

## 4. Create your first Wall

Open the Render Shell for `saidhere-api-9ab3` and run:

```bash
npm run create-wall -- "The Crown - Upstairs" "Newcastle"
```

It returns a URL similar to:

```text
https://saidhere.app/t/4ca8...<random secret>...31af
```

Encode that exact URL onto the NFC tag, test it, then permanently write-lock the tag.

See [DOMAIN_LINKS.md](DOMAIN_LINKS.md) for Universal Link / App Link deployment.

## Privacy and security model

The phone never talks directly to Postgres. It receives a random anonymous API token and sends that to the Render API as a Bearer token.

Post author/session IDs never appear in the public feed. The server returns only post ID, Wall ID, parent ID, body, date and reply count.

A plaque token is hashed with SHA-256 before it is stored. The raw token only appears in the one-time NFC URL printed by the provisioning command.

Render Postgres is configured with `ipAllowList: []`, so the database is reachable only over Render's private network from the web service.

## Important limitation of ordinary NFC tags

A permanently locked NTAG213/215/216 prevents someone from rewriting the physical tag, but a static NFC URL can still be copied after somebody legitimately scans it. The 15-minute access window is server-enforced, but a copied static tag URL could be replayed later.

For strict proof that a user physically tapped the plaque each time, move production plaques to a cryptographic dynamic tag such as NTAG 424 DNA, or add another proximity check. The current static-tag MVP is suitable for field testing but should not be described as cryptographically location-proof.

## Physical plaque recommendation

```text
SAIDHERE

(( NFC ))
TAP HERE

Leave something behind.
```

Put the locked NFC in a non-metallic window/layer inside the plaque. If the face itself is metal, use an on-metal NFC tag or isolate the antenna from the metal with a ferrite layer.

## Before a large public launch

The MVP is complete enough to test with real plaques. Before deploying at scale, add automated text moderation, a moderator/admin dashboard, stronger bot controls, legal/privacy pages, production signing/store metadata and final Apple/Android domain-association credentials.

## Suggested first field test

Create 2–3 Walls, install them in controlled locations, and seed each with a few messages. Test cold/warm NFC taps on iPhone and Android, replies, 15-minute expiry, revisiting from **Walls you've found**, reporting, and NFC read range through the final plaque material.
