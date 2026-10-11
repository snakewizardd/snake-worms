@echo off
rem Starts the game on this machine only (127.0.0.1) and opens it in your browser.
cd /d "%~dp0"
call npm run dev -- --open
