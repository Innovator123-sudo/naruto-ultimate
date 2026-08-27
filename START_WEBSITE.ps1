Write-Host "Starting Ultimate Jutsu Hub at http://127.0.0.1:8000/index.html" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Set-Location $PSScriptRoot
python -m http.server 8000
