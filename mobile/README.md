# DastaVault for Android

The Android app is the web app in `../frontend`, packaged with [Capacitor](https://capacitorjs.com).
Every screen and feature of the website is in the app; changes to `frontend/` reach the app with the next build.

The app follows the phone's light or dark mode, and the theme button in the top bar switches between them.

## Download

Open the [releases](../../../releases) of this repository and download `DastaVault-<version>.apk`.

## Release a new version

GitHub builds and publishes the APK: **Actions → Android APK → Run workflow**, enter the version (e.g. `1.1.0`).
Pushing a tag like `v1.1.0` does the same.

The workflow needs these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | Same as for the website, e.g. `https://abcd1234.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same as for the website |
| `VITE_API_URL` | The Worker, e.g. `https://dastavault-api.abhay.workers.dev` |
| `DV_KEYSTORE_BASE64` | The signing key, base64 encoded (see below) |
| `DV_KEYSTORE_PASSWORD` | Password of the key store |
| `DV_KEY_ALIAS` | `dastavault` |
| `DV_KEY_PASSWORD` | Password of the key |

### The signing key

Android installs an update only when it is signed with the same key as the installed app. Create the key once,
keep the file and the passwords safe, and never change it:

```bash
keytool -genkeypair -v -keystore dastavault-release.jks -alias dastavault \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DastaVault"
base64 -w0 dastavault-release.jks   # value of DV_KEYSTORE_BASE64 (macOS: base64 -i dastavault-release.jks)
```

Without the key secrets, the workflow still builds an APK but signs it with a temporary key, so a later
version cannot be installed over it (uninstall first).

## Backend settings for the app

- The Worker accepts requests from the app's origin `https://localhost` (see `worker/src/index.js`); deploy the
  Worker after updating.
- Sign-in with email and password works in the app. Google sign-in does not work inside an app's web view
  (Google blocks it); use email and password or a magic link in the app.

## Build on your computer

Needs Node.js 22, Java 21 and the Android SDK (Android Studio).

```bash
cd frontend && npm install && cd ..
cd mobile && npm install
npm run apk:debug          # android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android       # or open the project in Android Studio
```

`branding/make_icons.py` draws the app icon and writes the launcher icons.
