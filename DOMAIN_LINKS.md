# Domain + NFC link setup

A physical plaque is encoded with an HTTPS URL like:

```text
https://saidhere.app/t/<secret-tag-token>
```

The same link is the browser fallback and can also be an iOS Universal Link / Android App Link once the platform association files are deployed correctly.

## iOS Universal Links

Production iOS uses:

- Apple team ID: `7MB2M6PX4Y`
- bundle ID: `com.9ab3.saidhere`
- associated domain: `applinks:saidhere.app`

The production association file is committed at:

```text
site/.well-known/apple-app-site-association
```

and must be served directly at:

```text
https://saidhere.app/.well-known/apple-app-site-association
```

The Codemagic iOS workflow checks that the final signed app still contains the `applinks:saidhere.app` entitlement.

## Android App Links

`tool/bootstrap_platforms.py` configures the Android manifest for `/t/*` and `/w/*` and generates an `assetlinks.json` template under `web/.well-known/`.

Before a production Android release, obtain the SHA-256 fingerprint of the certificate that signs the release installed by users (Google Play App Signing fingerprint when Play signing is enabled), replace `YOUR_ANDROID_SHA256_FINGERPRINT`, and deploy the finished file as:

```text
site/.well-known/assetlinks.json
```

served directly at:

```text
https://saidhere.app/.well-known/assetlinks.json
```

Do not publish the placeholder fingerprint and do not use a debug signing fingerprint for the production association.

## Creating and programming a Wall

Walls are provisioned through the Render/Postgres-backed The Wall admin/fulfilment workflow, not Supabase.

For a platform-created Wall:

1. Open the browser admin at `https://saidhere.app/admin`.
2. Create the Wall and copy the one-time NFC URL immediately.
3. Write that exact HTTPS URL to the NFC tag.
4. Test the tag on the supported phones before locking it.
5. Permanently write-lock the tag once the final URL is confirmed.

For a purchased plaque, the Main Admin assigns the next physical plaque from **Admin → Orders** after the Stripe order is paid. That action creates the Wall, ownership record and one-time NFC URL together.

The raw NFC secret is intentionally not stored. Only its SHA-256 hash is retained. If the physical tag or URL is compromised, use **Replace NFC** so the old URL is invalidated while the Wall history remains intact.

## NFC protection

An NTAG213/215/216 that is permanently write-locked prevents rewriting the physical chip, but its static URL can still be copied and replayed. The current server still limits writing to 15 minutes after a valid tag URL is opened.

For stronger proof of physical presence in a later production revision, move to a cryptographic dynamic tag such as NTAG 424 DNA and verify its dynamic authentication server-side.
