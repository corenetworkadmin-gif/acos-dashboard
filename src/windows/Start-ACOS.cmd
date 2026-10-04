@echo off
rem Requires the documented Ubuntu-24.04 installation in ~/acos-dashboard.
wsl.exe --distribution Ubuntu-24.04 --exec bash -lc "cd ~/acos-dashboard && exec bash src/host/start-local.sh"
if errorlevel 1 (
  echo.
  echo ACOS could not start. Read the error above or see docs/windows.md.
  pause
)
