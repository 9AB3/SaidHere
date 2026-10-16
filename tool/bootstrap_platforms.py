#!/usr/bin/env python3
"""Create Flutter platform folders and apply SaidHere deep-link configuration."""
from __future__ import annotations

import argparse
import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPLE_TEAM_ID = '7MB2M6PX4Y'
IOS_BUNDLE_ID = 'com.9ab3.saidhere'


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def patch_android(host: str) -> None:
    manifest = ROOT / 'android/app/src/main/AndroidManifest.xml'
    text = manifest.read_text(encoding='utf-8')
    text = text.replace('android:label="said_here"', 'android:label="SaidHere"')
    marker = 'android:name="io.flutter.embedding.android.NormalTheme"'
    if 'flutter_deeplinking_enabled' not in text and marker in text:
        meta_end = text.find('/>', text.find(marker)) + 2
        text = text[:meta_end] + '\n            <meta-data android:name="flutter_deeplinking_enabled" android:value="true" />' + text[meta_end:]
    if 'SAIDHERE_APP_LINK' not in text:
        intent = f'''\n            <!-- SAIDHERE_APP_LINK -->\n            <intent-filter android:autoVerify="true">\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="https" android:host="{host}" android:pathPrefix="/t/" />\n                <data android:scheme="https" android:host="{host}" android:pathPrefix="/w/" />\n            </intent-filter>\n'''
        text = text.replace('</activity>', intent + '        </activity>', 1)
    manifest.write_text(text, encoding='utf-8')


def patch_ios(host: str) -> None:
    plist_path = ROOT / 'ios/Runner/Info.plist'
    with plist_path.open('rb') as handle:
        info = plistlib.load(handle)
    info['FlutterDeepLinkingEnabled'] = True
    info['CFBundleDisplayName'] = 'SaidHere'
    info['CFBundleName'] = 'SaidHere'
    info['CFBundleURLTypes'] = [{'CFBundleURLName': 'com.9ab3.saidhere', 'CFBundleURLSchemes': ['saidhere']}]
    with plist_path.open('wb') as handle:
        plistlib.dump(info, handle, sort_keys=False)

    entitlements = ROOT / 'ios/Runner/Runner.entitlements'
    with entitlements.open('wb') as handle:
        plistlib.dump({'com.apple.developer.associated-domains': [f'applinks:{host}']}, handle, sort_keys=False)

    project = ROOT / 'ios/Runner.xcodeproj/project.pbxproj'
    text = project.read_text(encoding='utf-8')
    text = text.replace('app.saidhere.saidHere', IOS_BUNDLE_ID)
    if 'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;' not in text:
        text = text.replace(
            'CODE_SIGN_STYLE = Automatic;',
            'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;\n\t\t\t\tCODE_SIGN_STYLE = Automatic;',
        )
    project.write_text(text, encoding='utf-8')

    for name in ('Debug', 'Profile', 'Release'):
        xcconfig = ROOT / f'ios/Flutter/{name}.xcconfig'
        if not xcconfig.exists():
            continue
        xc = xcconfig.read_text(encoding='utf-8')
        line = 'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements'
        if line not in xc:
            if not xc.endswith('\n'):
                xc += '\n'
            xc += f'{line}\n'
            xcconfig.write_text(xc, encoding='utf-8')


def write_domain_templates(host: str) -> None:
    well_known = ROOT / 'web/.well-known'
    well_known.mkdir(parents=True, exist_ok=True)
    (well_known / 'apple-app-site-association').write_text(f'''{{\n  "applinks": {{\n    "details": [\n      {{\n        "appIDs": ["{APPLE_TEAM_ID}.{IOS_BUNDLE_ID}"],\n        "components": [\n          {{ "/": "/t/*" }},\n          {{ "/": "/w/*" }}\n        ]\n      }}\n    ]\n  }}\n}}\n''', encoding='utf-8')
    (well_known / 'assetlinks.json').write_text('''[\n  {\n    "relation": ["delegate_permission/common.handle_all_urls"],\n    "target": {\n      "namespace": "android_app",\n      "package_name": "app.saidhere.said_here",\n      "sha256_cert_fingerprints": ["YOUR_ANDROID_SHA256_FINGERPRINT"]\n    }\n  }\n]\n''', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='saidhere.app')
    args = parser.parse_args()

    needed = [name for name in ('android', 'ios', 'web') if not (ROOT / name).exists()]
    if needed:
        temp = ROOT / '.platform_bootstrap'
        if temp.exists():
            shutil.rmtree(temp)
        run('flutter', 'create', '--project-name', 'said_here', '--org', 'app.saidhere', '--platforms', 'android,ios,web', str(temp))
        for name in needed:
            shutil.copytree(temp / name, ROOT / name)
        shutil.rmtree(temp)

    patch_android(args.host)
    patch_ios(args.host)
    write_domain_templates(args.host)
    run('python3', 'tool/generate_brand_assets.py')
    print(f'SaidHere platform configuration ready for {args.host}')
    print(f'iOS bundle identifier: {IOS_BUNDLE_ID}')


if __name__ == '__main__':
    main()
