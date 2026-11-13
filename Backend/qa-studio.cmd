@echo off
cd /d "%~dp0Worker"
set QA_OPEN_BROWSER=true
call npm start
