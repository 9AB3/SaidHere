# Domain + NFC link setup

Each physical Wall is encoded with an HTTPS URL like:

```text
https://nfc.saidhere.app/t/<secret-tag-token>
```

The same link is the browser fallback and can also be an iOS Universal Link / Android App Link when the platform association files are deployed correctly.

## iOS Universal Links

Production iOS uses:

- Apple team ID: `7MB2M6PX4Y`
- bundle ID: `com.9ab3.saidhere`
- associated domain: `applinks:nfc.saidhere.app`

The live association file must be served directly at:

```text
https://nfc.saidhere.app/.well-known/apple-app-site-association
```

The Codemagic iOS workflow checks that the final signed app still contains the `applinks:nfc.saidhere.app` entitlement.

## Android App Links

The generated Android app uses:

- package name: `app.saidhere.said_here`
- verified host: `nfc.saidhere.app`
- verified paths: `/t/*` and `/w/*`

`tool/bootstrap_platforms.py` creates the Android App Link intent filter and `tool/android_release_patch.py` applies the Android production permissions, custom `saidhere://` scheme support, native NFC writer and release-signing configuration.

**Production Android App Links are not complete until the Google Play app-signing SHA-256 fingerprint is known.** For new Play apps, upload the first signed AAB, enable/use Play App Signing, then copy the **App signing key certificate** SHA-256 from Play Console. Do not use the debug certificate and do not substitute the upload-key fingerprint when Play App Signing is enabled.

Deploy the finished association as:

```text
https://nfc.saidhere.app/.well-known/assetlinks.json
```

with this structure:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.saidhere.said_here",
      "sha256_cert_fingerprints": ["PLAY_APP_SIGNING_SHA256"]
    }
  }
]
```

Do not publish a placeholder fingerprint.

## Android Google Maps key

Use a separate Android-restricted Google Maps API key. The Codemagic Android workflow expects it as the secure variable `ANDROID_GOOGLE_MAPS_API_KEY` in the `android_maps_config` group.

Once the app is in Play Console, restrict the key to Android apps using:

- package: `app.saidhere.said_here`
- the production signing certificate SHA-1 shown by Google Play App Signing

Do not reuse the iOS-restricted Maps key.

## Programming a purchased Wall

For a paid order:

1. Open `https://saidhere.app/admin/orders`.
2. Click **Assign next NFC**.
3. Click **Write NFC** to open the native writer in The Wall app, or copy/write the one-time HTTPS URL manually.
4. Test the tag before permanently write-locking it.
5. If the URL is lost before shipping, use **Replace NFC** from the order. The old URL is disabled and a new one-time URL is generated.
6. Pack the Wall and click **Mark shipped**.
7. The purchaser sets the Wall name and location on the first physical scan after receiving it.

The Android release branch includes a native NDEF writer for the same `saidhere://write-nfc` fulfilment flow used by iOS. Successful writes attempt to mark the order item Tagged automatically; if confirmation cannot reach the server, the physical write still succeeds and Tagged can be ticked manually in Orders.

For a platform-created/test Wall, use the browser admin Wall-management flow instead.

The raw NFC secret is intentionally not stored. Only its SHA-256 hash is retained. A replacement invalidates the previous active URL while preserving the Wall and its history.

## NFC protection

An NTAG213/215/216 that is permanently write-locked prevents rewriting the physical chip, but its static URL can still be copied and replayed. The current server limits anonymous writing to 15 minutes after a valid Wall URL is opened.

For stronger proof of physical presence in a future revision, use a cryptographic dynamic tag such as NTAG 424 DNA and verify its dynamic authentication server-side.
