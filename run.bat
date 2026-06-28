@echo off
REM Launch the Oakville schedule analytics desktop app.
cd /d "%~dp0"
python -m app.server %*
