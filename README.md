# Vehicle Finder

Private local monitoring of 2017+ Ford Transit 350 passenger vans for Swoop,
using the owner's existing Chrome Facebook session and ChatGPT-plan analysis.
Good new listings go to the existing Swoop_OS Telegram conversation.

Current filters: medium/high roof, passenger configuration, $5,000–$21,000,
≤138,000 miles, within 250 miles of Austin. Land Cruiser search is paused.

## Run

Node 20+ is sufficient for import, analysis, dashboard and notification commands.
Read [the monitoring workflow](docs/monitor.md). Set
`VEHICLE_FINDER_AUTHORIZATION` to your private active authorization JSON. Local
state defaults to ignored `data/`; `VEHICLE_FINDER_DATA_DIR` can override it.

- `npm run collect -- /path/observations.json` imports fresh browser observations.
- `npm run apply-analysis` validates evidence-bound session analyses.
- `npm run alerts:prepare` prepares qualifying desktop alerts.
- `node src/desktop-alerts.js begin ID`, then send the exact prepared text through
  the signed-in Telegram desktop, then `confirm ID "observed delivery evidence"`.
- `npm run notify` supports the exact identity-verified Swoop bot when configured.
- `npm run dashboard` builds the private local `dashboard.html`.
- `npm test` runs authorization, fit, freshness, access-stop and delivery tests.

An alert requires score ≥80, active availability verified within 24h, reviewed
photos, confirmed roof/passenger fit, known qualifying year/price/mileage/location,
no review flag, no salvage/rebuilt title and no prior delivery attempt. Changed
facts invalidate the analysis. Unknowns stay quiet. At most five alerts per run,
ten per UTC day. The ledger saves each send before advancing; an ambiguous send
needs chat inspection and is never automatically retried.

The recurring task runs in the existing Codex chat at 08:00 and 18:00 Central.
The computer must be on, Codex running, and Chrome/Telegram signed in. It uses the
ChatGPT login, without API-key authentication or paid scraping services. Pause
or revoke the private standing authorization and/or pause the scheduled task.
The old Claude and Windows instructions are historical and not this deployment.

## Facebook access

Use the supported browser tools in the owner's existing Chrome profile. Do not
export cookies, automate passwords, spoof browser identity, rotate proxies,
solve CAPTCHAs, bypass checkpoints or repeatedly retry restrictions. Stop when
Facebook requests sign-in or shows an access challenge. Native Marketplace saved
searches may also be used from the visible UI when available; they do not provide
a Telegram delivery guarantee. No seller messages, purchases or spending.

The legacy logged-out `npm run scrape` is disabled unless a separate explicit
`scrape_logged_out_marketplace` authorization is present. The scheduled workflow never uses it. It now
stops at detected access challenges rather than interpreting a login wall as an
empty search or unavailable listing.

## Privacy and deployment

`data/`, `.env*`, `dashboard.html`, authorization records, photos and delivery logs
are private local state and must not be committed. Notifications use environment
credentials only and verify the exact bot/chat before any listing is disclosed.
The default credential source is the Jarvis Infisical broker; desktop delivery
uses the existing sign-in when that broker is unavailable.

The existing Vercel project is `vehicle-finder` at
`vehicle-finder-alpha.vercel.app`. Its static project page does not expose the
private live listing store. Routine monitoring never commits or publishes data.
