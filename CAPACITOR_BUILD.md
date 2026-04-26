# Building LeafLog as a Native Android App

This guide walks you through building LeafLog as an Android APK.
No prior experience needed — just follow the steps.

---

## What You'll Need (One-Time Setup)

### 1. Install Node.js
- Go to https://nodejs.org
- Download the **LTS** version (the big green button)
- Run the installer, click through all the defaults

### 2. Install Git
- Go to https://git-scm.com/downloads
- Download and install for your OS
- Click through the defaults during installation

### 3. Install Android Studio
- Go to https://developer.android.com/studio
- Download and install it (~1 GB)
- When it first opens, let it download the extra SDK components — wait for it to finish
- During setup, make sure **Android SDK** is selected

---

## Building the APK

### Step 1: Clone the project from GitHub

Open a terminal (Command Prompt on Windows, Terminal on Mac):

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Set your production URL

Copy `.env.android.example` to `.env.android`, then open `.env.android` in a text editor (Notepad is fine).
Replace the placeholder with your actual deployed Replit URL:

```
VITE_API_BASE_URL=https://your-app-name.replit.app
```

> You find this URL in Replit by clicking **Deploy** — it is shown as the published URL.
> It starts with `https://` and ends with `.replit.app` (no trailing slash).

### Step 4: Run the build script

**On Windows (Command Prompt or PowerShell):**
```
build-android.bat
```

**On Mac / Linux (Terminal):**
```bash
chmod +x build-android.sh
./build-android.sh
```

This will:
1. Build the web app with your production URL baked in
2. Copy the built files into the Android project

You can also pass the URL directly without editing `.env.android`:
```bash
# Windows
build-android.bat https://your-app.replit.app

# Mac / Linux
./build-android.sh https://your-app.replit.app
```

### Step 5: Open in Android Studio

```bash
npx cap open android
```

Or manually: open Android Studio → **File → Open** → select the `android/` subfolder inside the project.

Let Gradle sync finish (progress bar at the bottom — can take a few minutes the first time).

### Step 6: Build the APK

1. Top menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Wait for the build to complete
3. A popup appears in the bottom-right corner — click **locate**
4. Your APK is there: `app-debug.apk`

### Step 7: Install on your phone

Transfer the `.apk` to your Android phone via:
- Email it to yourself → open the attachment on your phone
- Upload to Google Drive → download on phone
- USB cable → copy the file over

When installing, if you see **"Install from unknown sources is not allowed"**:
1. **Settings → Security → Install unknown apps**
2. Allow it for the browser or file manager you're using
3. Try installing again

---

## Updating the App

Whenever you make changes in Replit and want a fresh APK:

```bash
git pull
npm install
```

Then re-run the build script (Step 4 above) and rebuild in Android Studio.

---

## Troubleshooting

**App opens but shows a blank screen or network errors**
- Check that `.env.android` has the correct URL (starts with `https://`, no trailing slash)
- Make sure your Replit app is **deployed** (not just running in dev mode)
- The deployed URL is stable; the dev URL changes every session

**"SDK location not found" in Android Studio**
- Open Android Studio → **File → Settings → Languages & Frameworks → Android SDK**
- Copy the "Android SDK Location" path
- Create `android/local.properties` with: `sdk.dir=C:\path\to\your\sdk`

**"JAVA_HOME is not set"**
- Android Studio includes Java — go to **File → Settings → Build → Gradle**, note the JDK path
- Set `JAVA_HOME` as a system environment variable to that path

**Login doesn't work / API requests fail**
- The app must point to your deployed (production) Replit URL
- CORS is already configured on the server to accept Android app requests

**Gradle sync fails with "cordova.variables.gradle does not exist"**
- Make sure you're using the latest code from GitHub
- Run `git pull` to get the latest version that includes the generated files

---

## Technical Notes

- **Session cookies**: The app uses `https` scheme (`androidScheme: "https"`) so session cookies work correctly on Android.
- **CORS**: The server allows requests from `capacitor://localhost` and all `*.replit.app` / `*.replit.dev` domains.
- **Routing**: Wouter (the SPA router) works correctly with Capacitor in history mode — no hash mode needed.
- **iOS**: Building for iOS requires a Mac, Xcode, and an Apple Developer Account ($99/year). Steps are the same but use `npx cap sync ios` and `npx cap open ios`.
