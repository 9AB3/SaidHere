# The Wall Android release

Android release work lives on the `android-release` branch so the iOS build currently submitted to Apple is not changed.

## What is already configured

- Flutter Android project is generated from the current stable template.
- App name and icon use The Wall branding.
- API base URL: `https://saidhere.app`.
- NFC/App Link host: `nfc.saidhere.app`.
- Android App Links handle `/t/*` and `/w/*`.
- `saidhere://` custom links open the app for the fulfilment NFC writer.
- Location permissions support the private Found Walls map.
- Production internet permission is included.
- NFC is optional at install time, but the native writer uses Android NFC when available.
- Native Android NDEF writing supports the Admin Orders `Write NFC` flow and attempts automatic Tagged confirmation.
- Release signing is wired to Codemagic's `CM_KEYSTORE_*` variables.
- GitHub Actions creates a temporary CI-only key and compiles a signed release AAB to catch release-only build problems.

## Codemagic prerequisites

### 1. Android upload keystore

Create a long-lived Android upload keystore and keep a backup outside Codemagic. Do not commit the keystore or passwords to GitHub.

In Codemagic Team settings:

1. Open **codemagic.yaml settings → Code signing identities → Android keystores**.
2. Upload the keystore.
3. Enter the store password, key alias and key password.
4. Set the reference name exactly to:

```text
saidhere_android_upload
```

The `saidhere-android` workflow references this identity and will fail rather than fall back to debug signing.

### 2. Android Google Maps key

Create a separate Google Maps Platform key for Android. Do not reuse the iOS-restricted key.

In Codemagic create an environment variable group named:

```text
android_maps_config
```

Add a secure variable:

```text
ANDROID_GOOGLE_MAPS_API_KEY
```

After the app exists in Google Play Console, restrict the key to:

```text
package: app.saidhere.said_here
certificate: Google Play production/app-signing SHA-1
```

## Build

Run the Codemagic workflow:

```text
The Wall Android release
```

It produces:

- signed Play Store AAB: `build/app/outputs/bundle/release/app-release.aab`
- signed release APK for direct device testing

The workflow verifies the manifest, native NFC bridge, release signing configuration and AAB signature before publishing the artifacts.

## First Google Play upload

1. Create The Wall app in Google Play Console.
2. Use package name `app.saidhere.said_here`.
3. Upload the signed AAB to **Internal testing** first.
4. Complete Play App Signing setup.
5. In **Setup → App integrity**, copy the **App signing key certificate SHA-256**.
6. Deploy that SHA-256 in `assetlinks.json` at:

```text
https://nfc.saidhere.app/.well-known/assetlinks.json
```

Use the Play **app-signing** certificate fingerprint, not the upload-key fingerprint.

## Android App Link check

After `assetlinks.json` is live and the Play-signed app is installed, Android can be forced to re-check links with ADB:

```text
adb shell pm verify-app-links --re-verify app.saidhere.said_here
adb shell pm get-app-links app.saidhere.said_here
```

A physical Wall URL such as `https://nfc.saidhere.app/t/<token>` should then open The Wall app directly rather than Chrome.

## Before production rollout

Test on a real Android NFC phone:

- cold launch from an NFC Wall tag
- already-running app from an NFC Wall tag
- first-scan setup
- post/reply/report flow
- Walls You've Found list and map
- location permission denied and allowed paths
- `saidhere://write-nfc` from Admin Orders
- blank NTAG write
- write receipt/automatic Tagged confirmation
- app restart and anonymous session persistence
- Play-installed build, not just a sideloaded APK

The final Play Store Data safety answers must match the shipped behaviour, especially location use for the private Found Walls map.
