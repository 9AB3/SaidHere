#!/usr/bin/env python3
"""Apply Android-only production configuration after Flutter platform bootstrap.

This is deliberately separate from the shared/iOS bootstrap so Android release
work can evolve without changing the iOS build currently submitted to Apple.
"""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / 'android'
MAIN_ACTIVITY_PACKAGE = 'app.saidhere.said_here'
MAIN_ACTIVITY_PATH = ANDROID / 'app/src/main/kotlin/app/saidhere/said_here/MainActivity.kt'


def patch_manifest(host: str) -> None:
    manifest = ANDROID / 'app/src/main/AndroidManifest.xml'
    if not manifest.exists():
        raise RuntimeError(f'Missing generated Android manifest: {manifest}')

    text = manifest.read_text(encoding='utf-8')
    manifest_open = text.find('<manifest')
    manifest_end = text.find('>', manifest_open)
    if manifest_open < 0 or manifest_end < 0:
        raise RuntimeError('Could not locate <manifest> in AndroidManifest.xml')

    permissions = (
        'android.permission.INTERNET',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.NFC',
    )
    additions = ''
    for permission in permissions:
        if permission not in text:
            additions += f'\n    <uses-permission android:name="{permission}" />'
    if 'android.hardware.nfc' not in text:
        additions += '\n    <uses-feature android:name="android.hardware.nfc" android:required="false" />'
    if additions:
        text = text[:manifest_end + 1] + additions + text[manifest_end + 1:]

    if 'SAIDHERE_CUSTOM_SCHEME' not in text:
        custom_scheme = '''
            <!-- SAIDHERE_CUSTOM_SCHEME -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="saidhere" />
            </intent-filter>
'''
        if '</activity>' not in text:
            raise RuntimeError('Could not locate Android activity for SaidHere custom scheme')
        text = text.replace('</activity>', custom_scheme + '        </activity>', 1)

    if f'android:host="{host}"' not in text:
        raise RuntimeError(f'Android App Link host {host!r} is missing from generated manifest')
    if 'android:pathPrefix="/t/"' not in text or 'android:pathPrefix="/w/"' not in text:
        raise RuntimeError('Android App Link paths /t/* and /w/* are missing')
    if 'com.google.android.geo.API_KEY' not in text:
        raise RuntimeError('Google Maps Android metadata is missing. Supply GOOGLE_MAPS_API_KEY before bootstrap.')

    manifest.write_text(text, encoding='utf-8')


def patch_gradle_kts(path: Path) -> None:
    text = path.read_text(encoding='utf-8')
    marker = '// SAIDHERE_RELEASE_SIGNING'
    if marker not in text:
        build_types = '    buildTypes {'
        if build_types not in text:
            raise RuntimeError('Could not locate buildTypes in Android build.gradle.kts')
        signing = '''    // SAIDHERE_RELEASE_SIGNING
    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("CM_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("CM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CM_KEY_ALIAS")
                keyPassword = System.getenv("CM_KEY_PASSWORD")
            }
        }
    }

'''
        text = text.replace(build_types, signing + build_types, 1)

    debug_signing = 'signingConfig = signingConfigs.getByName("debug")'
    release_signing = 'signingConfig = signingConfigs.getByName("release")'
    if debug_signing in text:
        text = text.replace(debug_signing, release_signing, 1)
    elif release_signing not in text:
        match = re.search(r'(?m)^(\s*)release\s*\{\s*$', text)
        if not match:
            raise RuntimeError('Could not locate release build type in Android build.gradle.kts')
        line_end = text.find('\n', match.end())
        if line_end < 0:
            raise RuntimeError('Malformed release build type in Android build.gradle.kts')
        indent = match.group(1) + '    '
        text = text[:line_end + 1] + f'{indent}{release_signing}\n' + text[line_end + 1:]

    path.write_text(text, encoding='utf-8')


def patch_gradle_groovy(path: Path) -> None:
    text = path.read_text(encoding='utf-8')
    marker = '// SAIDHERE_RELEASE_SIGNING'
    if marker not in text:
        build_types = '    buildTypes {'
        if build_types not in text:
            raise RuntimeError('Could not locate buildTypes in Android build.gradle')
        signing = '''    // SAIDHERE_RELEASE_SIGNING
    signingConfigs {
        release {
            def keystorePath = System.getenv("CM_KEYSTORE_PATH")
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv("CM_KEYSTORE_PASSWORD")
                keyAlias System.getenv("CM_KEY_ALIAS")
                keyPassword System.getenv("CM_KEY_PASSWORD")
            }
        }
    }

'''
        text = text.replace(build_types, signing + build_types, 1)

    text = text.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release', 1)
    if 'signingConfig signingConfigs.release' not in text:
        text = text.replace('        release {', '        release {\n            signingConfig signingConfigs.release', 1)
    path.write_text(text, encoding='utf-8')


def patch_signing() -> None:
    kts = ANDROID / 'app/build.gradle.kts'
    groovy = ANDROID / 'app/build.gradle'
    if kts.exists():
        patch_gradle_kts(kts)
        return
    if groovy.exists():
        patch_gradle_groovy(groovy)
        return
    raise RuntimeError('Could not find generated Android app Gradle file')


def install_main_activity() -> None:
    template = ROOT / 'tool/android_main_activity.kt'
    if not template.exists():
        raise RuntimeError(f'Missing Android activity template: {template}')
    MAIN_ACTIVITY_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(template, MAIN_ACTIVITY_PATH)
    activity = MAIN_ACTIVITY_PATH.read_text(encoding='utf-8')
    if f'package {MAIN_ACTIVITY_PACKAGE}' not in activity:
        raise RuntimeError('Android activity template package does not match generated application package')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='nfc.saidhere.app')
    args = parser.parse_args()

    if not ANDROID.exists():
        raise RuntimeError('Run tool/bootstrap_platforms.py before Android release patching')

    patch_manifest(args.host)
    patch_signing()
    install_main_activity()
    print('Android production patch applied')
    print(f'Package: {MAIN_ACTIVITY_PACKAGE}')
    print(f'App Link host: {args.host}')
    print('Release signing: CM_KEYSTORE_* / CM_KEY_* environment variables')


if __name__ == '__main__':
    main()
