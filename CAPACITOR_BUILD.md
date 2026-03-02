# Building LeafLog as a Native Android App

This guide walks you through building LeafLog as an Android app using Capacitor.
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
- Download and install it (it's a large download, ~1 GB)
- When it first opens, it will download some extra components — let it finish
- During setup, make sure **Android SDK** is selected

---

## Building the App

### Step 1: Clone the project from GitHub

Open a terminal (Command Prompt on Windows, Terminal on Mac) and run:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
```

Replace `YOUR-USERNAME` and `YOUR-REPO-NAME` with your actual GitHub username and repository name.

### Step 2: Install dependencies

```bash
npm install
```

This downloads all the packages the project needs. It might take a minute or two.

### Step 3: Set the API URL

The app on your phone needs to know where the server is. Create a file called `.env` in the project root:

**On Windows (Command Prompt):**
```bash
echo VITE_API_BASE_URL=https://YOUR-REPLIT-APP-URL > .env
```

**On Mac/Linux (Terminal):**
```bash
echo "VITE_API_BASE_URL=https://YOUR-REPLIT-APP-URL" > .env
```

Replace `YOUR-REPLIT-APP-URL` with your deployed Replit app URL. It looks something like:
`https://your-app-name.replit.app`

You can find this URL by clicking "Deploy" in Replit and looking at the published URL.

### Step 4: Build the web app

```bash
npm run build
```

This compiles your web app into files the native app can use.

### Step 5: Sync to Android

```bash
npx cap sync android
```

This copies the built web files into the Android project.

### Step 6: Open in Android Studio

```bash
npx cap open android
```

This opens the project in Android Studio. The first time it opens, it may take a few minutes to download Gradle and set things up. Let it finish (you'll see a progress bar at the bottom).

### Step 7: Build the APK

Once Android Studio is ready (no more loading bars):

1. In the top menu, click **Build**
2. Click **Build Bundle(s) / APK(s)**
3. Click **Build APK(s)**
4. Wait for it to finish (you'll see a notification at the bottom)
5. Click **locate** in the notification to find the `.apk` file

The APK file will be somewhere like:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Step 8: Install on your phone

Transfer the `.apk` file to your Android phone. You can:
- Email it to yourself and open the attachment on your phone
- Upload it to Google Drive and download it on your phone
- Connect your phone via USB and copy it over

When you try to install it, your phone may say "Install from unknown sources is not allowed." To fix this:
1. Go to **Settings** > **Security** (or **Apps & notifications**)
2. Look for **Install unknown apps** or **Unknown sources**
3. Allow it for the app you're using to install (Chrome, Files, etc.)
4. Try installing the APK again

---

## Updating the App After Making Changes

Whenever you make changes to the web app in Replit and want to update the native app:

1. Pull the latest code:
   ```bash
   git pull
   ```

2. Install any new packages:
   ```bash
   npm install
   ```

3. Rebuild and sync:
   ```bash
   npm run build
   npx cap sync android
   ```

4. Open Android Studio and build the APK again:
   ```bash
   npx cap open android
   ```
   Then **Build > Build APK(s)** like before.

---

## Troubleshooting

**"JAVA_HOME is not set"**
- Android Studio installs Java for you, but sometimes the terminal can't find it
- In Android Studio, go to **File > Settings > Build > Gradle** and note the JDK location
- Set it in your terminal: `export JAVA_HOME="/path/to/jdk"` (Mac/Linux) or set it as a system environment variable (Windows)

**"SDK location not found"**
- Open Android Studio, go to **File > Settings > Languages & Frameworks > Android SDK**
- Note the "Android SDK Location" path
- Create a file called `local.properties` in the `android/` folder with:
  ```
  sdk.dir=/path/to/your/Android/sdk
  ```

**App opens but shows a blank screen or errors**
- Make sure you set `VITE_API_BASE_URL` correctly in step 3
- Make sure your Replit app is deployed and running
- The URL should start with `https://` and NOT end with a `/`

**Login doesn't work from the app**
- This is usually a cookie/CORS issue
- Make sure your Replit app is deployed (not just running in dev mode)
- The CORS and session settings are already configured to handle this

---

## Building for iOS (iPhone)

Building for iOS requires:
- A **Mac** computer (Apple doesn't allow building iOS apps on Windows)
- **Xcode** installed from the Mac App Store (free, but large download)
- An **Apple Developer Account** ($99/year) to install on a real iPhone

If you have those, the steps are similar:

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Then in Xcode, select your device and click the Play button to build and run.
