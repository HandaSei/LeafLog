@echo off
REM LeafLog - Android build script for Windows
REM Usage: build-android.bat https://your-production-url.replit.app

setlocal

set "API_URL=%~1"

if "%API_URL%"=="" (
  if exist ".env.android" (
    for /f "tokens=2 delims==" %%a in ('findstr "VITE_API_BASE_URL" .env.android') do set "API_URL=%%a"
  )
)

if "%API_URL%"=="" (
  echo.
  echo ERROR: No production URL provided.
  echo.
  echo Usage:   build-android.bat https://your-app.replit.app
  echo      OR  create a .env.android file with: VITE_API_BASE_URL=https://your-app.replit.app
  echo.
  echo You can find your production URL in Replit under the Deploy section.
  echo.
  exit /b 1
)

echo.
echo Building LeafLog Android APK...
echo API URL: %API_URL%
echo.

set "VITE_API_BASE_URL=%API_URL%"
call npm run build
if errorlevel 1 goto :error

call npx cap sync android
if errorlevel 1 goto :error

echo.
echo Done! Open the android\ folder in Android Studio and build the APK.
echo Build ^> Build Bundle(s) / APK(s) ^> Build APK(s)
echo.
goto :eof

:error
echo.
echo Build failed. See errors above.
exit /b 1
