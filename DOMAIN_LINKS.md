# Domain + NFC link setup

A physical plaque should be encoded with an HTTPS URL like:

```text
https://saidhere.app/t/<secret-tag-token>
```

The same link works as a web fallback, an Android App Link and an iOS Universal Link once domain association is configured.

Run:

```bash
python3 tool/bootstrap_platforms.py --host your-real-domain.com
```

This configures the native projects and creates templates under `web/.well-known/`.

Before launch, replace `YOUR_APPLE_TEAM_ID` in the Apple association file and `YOUR_ANDROID_SHA256_FINGERPRINT` in `assetlinks.json`.

The web server must serve the Apple file at `https://YOUR_DOMAIN/.well-known/apple-app-site-association` and the Android file at `https://YOUR_DOMAIN/.well-known/assetlinks.json`.

## NFC protection

For the first production batch, provision the Wall in Supabase, write the returned `nfc_url` to an NTAG213/215/216 tag, test it on iPhone and Android, permanently write-lock the tag and encapsulate it inside the plaque.

Later, the `wall_tags` design can be upgraded to NTAG 424 DNA dynamic authentication without changing Wall/post/reply data.
