# Domain + NFC link setup

Each physical Wall is encoded with an HTTPS URL like:

```text
https://saidhere.app/t/<secret-tag-token>
```

The same link is the browser fallback and can also be an iOS Universal Link / Android App Link when the platform association files are deployed correctly.

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

**Production Android App Links are not complete until the release signing SHA-256 is known.** Obtain the certificate fingerprint that signs the build installed by users — use the Google Play App Signing fingerprint when Play signing is enabled — and deploy the finished file as:

```text
site/.well-known/assetlinks.json
```

served directly at:

```text
https://saidhere.app/.well-known/assetlinks.json
```

Do not publish `YOUR_ANDROID_SHA256_FINGERPRINT`, and do not use a debug signing fingerprint for the production association.

## Programming a purchased Wall

For a paid order:

1. Open `https://saidhere.app/admin/orders`.
2. Click **Assign next NFC**.
3. Write the one-time HTTPS URL shown into the physical NFC tag.
4. Test the tag before permanently write-locking it.
5. If the URL is lost before shipping, use **Replace NFC** from the order. The old URL is disabled and a new one-time URL is generated.
6. Pack the Wall and click **Mark shipped**.
7. The purchaser sets the Wall name and location on the first physical scan after receiving it.

For a platform-created/test Wall, use the browser admin Wall-management flow instead.

The raw NFC secret is intentionally not stored. Only its SHA-256 hash is retained. A replacement invalidates the previous active URL while preserving the Wall and its history.

## NFC protection

An NTAG213/215/216 that is permanently write-locked prevents rewriting the physical chip, but its static URL can still be copied and replayed. The current server limits anonymous writing to 15 minutes after a valid Wall URL is opened.

For stronger proof of physical presence in a future revision, use a cryptographic dynamic tag such as NTAG 424 DNA and verify its dynamic authentication server-side.
