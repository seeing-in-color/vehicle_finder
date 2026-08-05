# Vehicle Finder - Windows laptop setup.
# Run from the repo root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"

Write-Host "== Installing Node dependencies ==" -ForegroundColor Cyan
npm install

Write-Host "== Installing Playwright Chromium ==" -ForegroundColor Cyan
npx playwright install chromium

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example - EDIT IT with your Telegram token + chat id." -ForegroundColor Yellow
} else {
  Write-Host ".env already exists - leaving it as is." -ForegroundColor Green
}

Write-Host "== Preventing sleep/hibernate on AC power (so the twice-daily job can run) ==" -ForegroundColor Cyan
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Write-Host ""
Write-Host "Setup complete. Next steps (see SETUP-WINDOWS.md):" -ForegroundColor Green
Write-Host "  1) Edit .env with your Telegram credentials"
Write-Host "  2) First manual run + 'git push' to authorize GitHub (step 5)"
Write-Host "  3) In Claude Code, create the twice-daily scheduled task (step 6)"
