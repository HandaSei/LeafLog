#!/bin/bash
# LeafLog - Android build script
# Usage: ./build-android.sh https://your-production-url.replit.app

set -e

API_URL="${1:-}"

if [ -z "$API_URL" ]; then
  if [ -f ".env.android" ]; then
    API_URL=$(grep "VITE_API_BASE_URL" .env.android | cut -d'=' -f2-)
  fi
fi

if [ -z "$API_URL" ]; then
  echo ""
  echo "ERROR: No production URL provided."
  echo ""
  echo "Usage:   ./build-android.sh https://your-app.replit.app"
  echo "     OR  create a .env.android file with: VITE_API_BASE_URL=https://your-app.replit.app"
  echo ""
  echo "You can find your production URL in Replit under the Deploy section."
  echo ""
  exit 1
fi

echo ""
echo "Building LeafLog Android APK..."
echo "API URL: $API_URL"
echo ""

VITE_API_BASE_URL="$API_URL" npm run build

npx cap sync android

echo ""
echo "Done! Open the android/ folder in Android Studio and build the APK."
echo "Build > Build Bundle(s) / APK(s) > Build APK(s)"
echo ""
