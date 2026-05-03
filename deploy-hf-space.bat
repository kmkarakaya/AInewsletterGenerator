@echo off
setlocal EnableExtensions

pushd "%~dp0"

set "SPACE_ID=kmkarakaya/AInewsletterGenerator"
set "SPACE_REMOTE_NAME=hf-space"
set "SPACE_REMOTE_URL=https://huggingface.co/spaces/%SPACE_ID%"
set "HF_USERNAME=kmkarakaya"
set "DOCKER_IMAGE_NAME=ai-newsletter-generator-hf-check"

echo.
echo === HF Space Deploy ===
echo Repo   : %SPACE_ID%
echo Remote : %SPACE_REMOTE_NAME%
echo.

where git >nul 2>&1
if errorlevel 1 goto :missing_git

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :not_git_repo

set "HAS_CHANGES="
for /f "delims=" %%i in ('git status --porcelain') do set "HAS_CHANGES=1"
if defined HAS_CHANGES goto :dirty_repo

echo [1/6] Frontend build dogrulaniyor...
call npm run build
if errorlevel 1 goto :fail

if /I "%SKIP_DOCKER_BUILD%"=="1" (
  echo [2/6] Docker build atlandi. ^(SKIP_DOCKER_BUILD=1^)
) else (
  where docker >nul 2>&1
  if errorlevel 1 goto :missing_docker

  echo [2/6] Docker image build dogrulaniyor...
  docker build -t %DOCKER_IMAGE_NAME% .
  if errorlevel 1 goto :fail
)

echo [3/6] Hugging Face kimlik dogrulamasi kontrol ediliyor...
set "PUSH_TARGET=%SPACE_REMOTE_NAME%"

where hf >nul 2>&1
if errorlevel 1 goto :configure_git_remote

hf auth whoami >nul 2>&1
if not errorlevel 1 goto :configure_git_remote

if "%HF_TOKEN%"=="" goto :missing_hf_auth

echo HF CLI ile login yapiliyor...
hf auth login --token "%HF_TOKEN%" --add-to-git-credential >nul
if errorlevel 1 goto :fail

:configure_git_remote
echo [4/6] Hugging Face remote ayarlaniyor...
git remote get-url %SPACE_REMOTE_NAME% >nul 2>&1
if errorlevel 1 (
  git remote add %SPACE_REMOTE_NAME% %SPACE_REMOTE_URL%
  if errorlevel 1 goto :fail
) else (
  git remote set-url %SPACE_REMOTE_NAME% %SPACE_REMOTE_URL%
  if errorlevel 1 goto :fail
)

if "%HF_TOKEN%"=="" goto :maybe_dry_run

where hf >nul 2>&1
if not errorlevel 1 goto :maybe_dry_run

set "PUSH_TARGET=https://%HF_USERNAME%:%HF_TOKEN%@huggingface.co/spaces/%SPACE_ID%"

:maybe_dry_run
if /I "%DRY_RUN%"=="1" (
  echo [5/6] Dry run aktif. Push atlandi.
  echo Push target: %SPACE_REMOTE_URL%
  goto :success
)

echo [5/6] Hugging Face Space'e push yapiliyor...
echo Bu islem sadece %SPACE_REMOTE_NAME% remote'unu force update eder.
git push --force %PUSH_TARGET% HEAD:main
if errorlevel 1 goto :fail

echo [6/6] Deploy tamamlandi.
goto :success

:missing_git
echo [HATA] Git bulunamadi. Lutfen Git for Windows kurun.
goto :exit_fail

:missing_docker
echo [HATA] Docker CLI bulunamadi. Docker Desktop'i baslatin veya SKIP_DOCKER_BUILD=1 ile tekrar deneyin.
goto :exit_fail

:not_git_repo
echo [HATA] Script bir git reposu icinde calistirilmali.
goto :exit_fail

:dirty_repo
echo [HATA] Commit edilmemis degisiklikler var. Once commit edip tekrar deneyin.
git status --short
goto :exit_fail

:missing_hf_auth
echo [HATA] Hugging Face kimlik bilgisi bulunamadi.
echo Cozumlerden biri:
echo   1. once ^`hf auth login^` calistirin
echo   2. veya bu scripti ^`HF_TOKEN=... deploy-hf-space.bat^` ile calistirin
goto :exit_fail

:fail
echo [HATA] Deploy akisi basarisiz oldu.
goto :exit_fail

:success
echo [OK] Script tamamlandi.
popd
endlocal
exit /b 0

:exit_fail
popd
endlocal
exit /b 1