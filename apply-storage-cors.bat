@echo off
SETLOCAL
cd /d "%~dp0"

echo Applying Firebase Storage CORS policy for gamon-tawing...

where gsutil >nul 2>nul
if not errorlevel 1 (
  gsutil cors set cors.json gs://gamon-tawing.appspot.com
  exit /b 0
)

where gcloud >nul 2>nul
if not errorlevel 1 (
  gcloud storage buckets update gs://gamon-tawing.appspot.com --cors-file=cors.json
  exit /b 0
)

echo Tidak ada gsutil atau gcloud yang ditemukan di PATH.
echo Install Google Cloud SDK atau jalankan perintah berikut di terminal:
echo   gsutil cors set cors.json gs://gamon-tawing.appspot.com
pause
