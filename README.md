# Vehicle Finder

Scans Facebook Marketplace twice a day for vehicles you're hunting, verifies every
listing is live, has Claude grade condition from the photos + description, and
publishes a ranked dashboard. No paid scraping APIs — uses a logged-out headless
browser session.

## How it works

1. **`config/searches.json`** holds your saved searches. Each has a `status`:
   - `active` — scraped every run
   - `paused` / `found` — skipped entirely (zero cost). Flip back to `active` any time.
2. **`npm run scrape`** — sweeps Marketplace search results across Texas hub cities
   (Austin-centered, ~250 mi), fetches detail pages for *new* listings only
   (mileage, VIN, title status, description, photos), and re-verifies known
   listings so dead links get marked `stale`.
3. **Claude analysis** (runs inside the scheduled Claude Code session) — reads each
   new listing's description and photos, writes `data/analyses.json` with a
   condition grade, red flags, and a 0–100 priority score;
   `npm run apply-analysis` merges it in.
4. **`npm run dashboard`** — builds `dashboard.html`, which the scheduled session
   republishes to the same private Artifact URL.
5. **`npm run notify`** — Telegram alert for unnotified listings scoring ≥
   `alerts.minScoreForAlert` (set bot credentials in `.env`, see `.env.example`).

## Schedule & on-demand runs

A Claude Code scheduled task (`vehicle-finder-run`) runs the whole pipeline at
8:00 and 18:00 daily *while the Claude Code app is open* (missed runs fire on next
launch). Scoring happens automatically inside each run, right after the pull. If
every search is paused, the run exits immediately.

**Run it on demand two ways:**
- **Scheduled sidebar → "Run now"** on `vehicle-finder-run` — full fresh pull +
  score + publish + alert (the 5–10 min scrape).
- **`/score-vehicles`** slash command — quick: scores anything already pulled but
  unscored, refreshes the dashboard, and sends alerts. No re-scrape, runs on your
  Claude subscription (no API key).

Alerts (`notify.js`) fire for non-excluded listings scoring ≥ the threshold and
include the score, condition, VIN (or a "no VIN — ask the seller" prompt), and a
direct link.

## Search settings

Each search in `config/searches.json` supports: `minPrice`/`maxPrice`, `maxMileage`
(listings over the cap are moved to the collapsed "don't fit" group), `yearMin`/`yearMax`,
`titleMustMatch`/`titleMustNotMatch` (regex prefilters), and `requirements` — a
plain-English hard requirement (e.g. "passenger van, medium or high roof only")
that the analysis verifies **from photos**, since Facebook titles are unreliable.
Non-fitting listings collapse under "N listings that don't fit your requirements".

Mileage is taken from the structured "Driven X miles" field, falling back to the
description/title text ("238,500(ish) miles" works), and finally to reading the
odometer off a dashboard photo during analysis. One-off re-check of a listing:
`node src/scrape.js --refetch <listingId>`.

**Dealer down-payment / bait tactics** (an advertised price that's really a down
payment or financing hook, e.g. "$5,000" on a late-model van, plus obvious scams)
are flagged `excluded` during analysis and dropped from the dashboard entirely,
listed only in a small "hidden as bait" footer.

Filters enforced: `maxPrice`, `minPrice`, and `maxMileage` (per search). New
listings over a cap aren't fetched; existing ones over a cap move to the collapsed
"don't fit" group.

## Listing states & the dashboard controls

Each run tags listings `active` / `pending` / `sold` / `stale` / `archived`.
- **Sold**: title shows a bold **SOLD**; the listing is auto-archived (hidden) 3
  days later. Detection is best-effort from the listing page; you can also set it
  yourself.
- The dashboard has a sticky control bar: free-text filter (title/location), sort
  (score, price ↑/↓, mileage, recently found), a minimum-grade filter, and a
  "Hide sold" toggle. Each row has an **×** to hide it — hides persist in your
  browser (localStorage) across updates, with a "Show N hidden" restore link.
- The vehicle-category chips at the top are clickable toggles — tap one to
  show/hide that entire search (e.g. hide Land Cruisers to focus on Transits).
  State persists in localStorage.

Manual management (`node src/manage.js ...`, then re-run `node src/dashboard.js`):
`sold <id>`, `pending <id>`, `active <id>`, `archive <id>`, `delete <id>` (permanent),
`sweep` (archive sold past 3 days), `list`. Or just ask Claude ("mark the Kyle van
sold", "delete listing 123") and it runs these for you.

## Changing what you're hunting

Edit `config/searches.json` (or just ask Claude: "switch the vehicle finder to
look for X" / "pause the Transit search — I found one"). Old searches stay in the
file for reuse.

## Notes

- Scraping Marketplace is against Facebook ToS; this is personal, hobbyist-scale
  use (a few dozen page loads per run, well under logged-out rate limits).
- If Facebook changes markup, fix selectors in `src/scrape.js` (`scrapeSearchPage`,
  `scrapeDetail`).
