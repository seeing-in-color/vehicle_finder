# Running Vehicle Finder on your always-on Windows laptop

This makes the laptop the **engine**: twice a day it scrapes Facebook (from your
home's residential IP, which works — cloud datacenter IPs get blocked), scores
listings on your Claude subscription (free), and pushes the refreshed dashboard to
GitHub — which auto-deploys to **https://vehicle-finder-alpha.vercel.app**.

You only do this once. After that it runs itself.

## 1. Install prerequisites (one time)
- **Node.js LTS** — https://nodejs.org (Windows installer, "LTS")
- **Git for Windows** — https://git-scm.com/download/win (accept defaults; this includes Git Credential Manager, which handles the GitHub login for you)
- **Claude Code** — install it and **sign in with the SAME Claude account you use on the Mac** (this is what powers the free scoring)

Check in PowerShell:
```powershell
node --version
git --version
```

## 2. Clone the repo
```powershell
cd $HOME
git clone https://github.com/seeing-in-color/vehicle_finder.git
cd vehicle_finder
```

## 3. Run the bootstrap script
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```
Installs dependencies + the Playwright browser, creates `.env`, and stops the laptop from sleeping on AC.

## 4. Fill in Telegram credentials
Open `.env` in Notepad and paste the two values Andres gives you in chat:
```
TELEGRAM_BOT_TOKEN=<your bot token>
TELEGRAM_CHAT_ID=7021918098
```

## 5. First manual run (proves it works + authorizes GitHub push)
```powershell
node src/scrape.js
node src/dashboard.js
git add public/index.html data/listings.json
git commit -m "chore: first laptop run"
git push
```
The first `git push` pops a browser — **sign in to GitHub as `seeing-in-color`** and authorize. Git Credential Manager remembers it, so future pushes (including the automated ones) are silent. Then confirm https://vehicle-finder-alpha.vercel.app refreshed.

## 6. Create the twice-daily automation in Claude Code
Open Claude Code **in this folder** and say:

> Create a scheduled task called `vehicle-finder-run` that runs at 8:00 AM and 6:00 PM daily and executes the pipeline in SETUP-WINDOWS.md (scrape, score new listings on my Claude subscription, rebuild the dashboard, commit public/index.html + data/listings.json and git push so Vercel redeploys, then run notify.js). Use the full prompt at the bottom of SETUP-WINDOWS.md.

## 7. Keep it healthy
- Leave **Claude Code open and signed in** (scheduled tasks run while the app is open).
- `setup.ps1` already disabled AC sleep; also set Settings → System → Power → "When plugged in, put my device to sleep" = **Never**.
- Turn on your laptop maker's **battery charge limit (60–80%)** — ASUS Armoury Crate (Battery Care), Lenovo Vantage (Conservation Mode), MSI Center (Battery Master) — to protect the battery while it lives on the charger.

---

## Full scheduled-task prompt (paste this into Claude Code on the laptop if asked)
Run from the repo root. This machine must have a residential IP (home Wi-Fi/ethernet).

1. Read `config/searches.json`. If NO search is `active`, output "All searches paused" and stop.
2. `node src/scrape.js` (needs real network to facebook.com; ~5–10 min). It respects each search's maxMileage/maxPrice/minPrice/year filters, detects sold/pending, archives sold listings 3+ days old. If cardsSeen is 0 across all hubs, Facebook is blocking this IP — report and stop.
3. For each new listing: read its description and photos in `data/images/<id>/` and score it. Requirements (Transit = passenger van, medium/high roof — verify from PHOTOS, titles lie; Land Cruiser = genuine 1990–1997 80-series, not Prado/70/60/100). If mileage is null, read the odometer off a dashboard photo. Exclude dealer down-payment/financing-hook listings and scams (excluded=true). Do NOT penalize missing/removed seats (buyer sources them). Write `data/analyses.json` {score, grade, summary, reasoning, redFlags[], positives[], meetsRequirements, requirementNotes, excluded, excludeReason, analyzedAt}, then `node src/apply-analysis.js`. Parallelize with background agents if >~8 new.
4. `node src/dashboard.js` (writes dashboard.html and public/index.html).
5. `git add public/index.html data/listings.json && git commit -m "chore: refresh dashboard" && git push` (Vercel auto-deploys). "nothing to commit" is fine.
6. `node src/notify.js` (Telegram alerts for score ≥ threshold).
7. Summarize: new listings per search, fit vs don't-fit, excluded bait, top new listing + score, sold/stale/archived, price drops, errors, and confirm the push.
