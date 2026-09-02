@echo off
REM ---------------------------------------------------------------------------
REM  Daily ledger backup, for Windows Task Scheduler.
REM
REM  Task Scheduler runs with a bare environment and whatever working directory
REM  it feels like, so this pins both: it changes to the project folder (where
REM  .env lives) and writes everything it did to a log, because a scheduled job
REM  that fails silently is worse than no scheduled job.
REM
REM  Register it to run every day at 20:00 (see README-BACKUP.md):
REM    schtasks /create /tn "Aviation Backup" /tr "C:\Aviation\scripts\backup-daily.cmd" /sc daily /st 20:00
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."
if errorlevel 1 (
  echo Cannot reach the project folder. >> "%~dp0..\backup.log"
  exit /b 1
)

echo. >> backup.log
echo ===== %DATE% %TIME% ===== >> backup.log

call npx tsx scripts/backup-ledger.ts >> backup.log 2>&1

if errorlevel 1 (
  echo RESULT: FAILED >> backup.log
  exit /b 1
)

echo RESULT: ok >> backup.log
exit /b 0
