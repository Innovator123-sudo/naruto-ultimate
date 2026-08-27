@echo off
echo Starting Ultimate Jutsu Hub at http://127.0.0.1:8000/index.html
echo Press Ctrl+C to stop
python -m http.server 8000 --directory "%~dp0"
pause
