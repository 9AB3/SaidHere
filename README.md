# The Wall / SaidHere

**Every place has something to say.**

The Wall is a place-based anonymous message app. A physical NFC Wall identifies a conversation tied to a real place. Scanning it discovers the Wall and unlocks anonymous writing for 15 minutes. Reading remains available from **Walls You've Found**, while writing requires another physical scan after the window expires.

## Current product

- Flutter app for iOS and Android, with web build support
- HTTPS/NFC deep links at `/t/<secret-tag-token>` and `/w/<wall-slug>`
- Anonymous app sessions with no public profile or username
- Render Node/Express API + private Render Postgres
- 15-minute server-enforced write/reply window
- Text-only posts up to 300 characters
- One-level replies
- Reporting and automatic hiding after three distinct reports
- Wall-owner portal at `/my-walls`
- Wall owners can change name/location, pause/reactivate, see aggregate activity and moderate **reported** posts
- Wall owners are not shown who authored posts
- Platform admin with Main Admin / per-Wall Moderator roles and audit logging
- Stripe Checkout for physical Wall purchases
- SMTP2GO order and activation email
- Admin fulfilment: assign NFC → program tag → mark shipped
- Customer first-scan setup for Wall name/location and account recovery
- iOS Universal Links support
- Android App Link bootstrap support; production `assetlinks.json` still requires the real release signing SHA-256

## Product rules

The public conversation does **not** use profiles, handles, likes, direct messages, follower counts, global feeds or searchable public Walls. The place is the network.

A Wall owner manages the Wall, not the identities of the people using it. Owner moderation exposes reported content and report counts, not post-author identities.

## Stack

- Flutter / Dart
- Node.js / Express
- Render Web Service
- Render Postgres
- Stripe Checkout
- Nodemailer + SMTP2GO
- `go_router`
- `shared_preferences`

## Backend deployment

See [RENDER_SETUP.md](RENDER_SETUP.md).

The root `render.yaml` defines:

- `saidhere-api-9ab3` — Node web service
- `saidhere-db-9ab3` — private Render Postgres

The service starts with:

```text
npm run migrate && npm start
```

Health check:

```text
https://saidhere.app/health
```

## Flutter platform bootstrap

Generated platform boilerplate is recreated from the current Flutter stable templates:

```bash
python3 tool/bootstrap_platforms.py --host saidhere.app
flutter pub get
```

Run against production:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://saidhere.app \
  --dart-define=APP_HOST=saidhere.app
```

`API_BASE_URL` and `APP_HOST` already default to `saidhere.app`.

## Purchased Wall workflow

1. Customer buys one or more Walls at `/shop` through Stripe Checkout.
2. Stripe confirms payment and the order is linked to the purchaser email/account.
3. Customer and internal order emails are attempted through SMTP2GO and delivery status is recorded.
4. Admin opens `/admin/orders` and clicks **Assign next NFC**.
5. Admin programs the one-time `https://saidhere.app/t/<secret>` URL into the physical tag.
6. If that URL is lost before shipping, **Replace NFC** invalidates it and creates a new one.
7. Admin clicks **Mark shipped**.
8. Customer scans the physical Wall on arrival and chooses its name/location. If the owner account was never activated, that first scan can verify the purchase email and create the password.
9. Later owner changes and reported-post moderation happen through `/my-walls`.

## NFC security model

The raw NFC secret is never stored in Postgres. Only its SHA-256 hash is retained.

A normal locked NTAG213/215/216 prevents rewriting the chip, but a static URL can still be copied and replayed. The 15-minute writing window is server-enforced, but static tags are not cryptographic proof of physical presence.

For a future higher-security version, use a dynamic cryptographic tag such as NTAG 424 DNA and verify its dynamic authentication server-side.

See [DOMAIN_LINKS.md](DOMAIN_LINKS.md) for iOS Universal Links and Android App Links.

## Validation

GitHub Actions runs:

- platform bootstrap
- `flutter analyze`
- Flutter tests
- release web build
- Android debug APK build
- Node/Express production-module syntax checks

Codemagic contains the signed iOS/TestFlight workflow and verifies the Associated Domains entitlement.

Before a public launch, complete at least one end-to-end Stripe test-mode order through payment, email, Admin Orders, NFC programming/replacement, shipping and customer first-scan setup. Also deploy Android `assetlinks.json` using the real release/Google Play signing SHA-256 before relying on Android App Links.
