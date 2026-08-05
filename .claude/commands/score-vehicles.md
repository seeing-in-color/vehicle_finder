---
description: Score any unscored vehicle listings now, refresh the dashboard, and send Telegram alerts (runs in this Claude session on your subscription — no API key, no re-scrape)
---
Score the vehicle_finder listings that don't have a score yet, right now, in this session. Do NOT re-scrape (that's the scheduled task's job) — only score what's already been pulled.

Steps:

1. List the listings that need scoring:
   `node -e "const s=require('./data/listings.json');for(const l of Object.values(s)){if(['active','pending','sold'].includes(l.status)&&!(l.analysis&&l.analysis.excluded)&&(!l.analysis||l.analysis.score==null))console.log(l.id,'|',l.searchId,'|',(l.photos||[]).length+'ph','|',(l.title||'').slice(0,50));}"`
   If none, say so and stop.

2. For each listing needing a score, read its description and its photos in `data/images/<id>/` (use the Read tool on the image files to actually look at them). Score it with the project rubric:
   - **Requirements**: for Ford Transit, it MUST be a passenger van (12/15-pax) with MEDIUM or HIGH roof — verify roof/config FROM PHOTOS, titles lie. For Land Cruiser, it must be a genuine 1990–1997 80-series (Prado/70-series/60-series/100-series do NOT count). Set meetsRequirements + requirementNotes.
   - **Mileage**: if the listing's `mileage` is null, look in the description/title; if still unknown, read the odometer off a dashboard photo (the larger total number, not the trip meter) and write it into that listing's `mileage` field in data/listings.json.
   - **Down-payment / scam**: if the advertised price is really a down payment or financing hook (low round price on a late-model van, dealer financing push, true price hidden) or an obvious scam, set excluded=true with excludeReason.
   - **Seats**: do NOT penalize missing/removed seats — the buyer sources them easily (especially Transit); minor note/positive only.
   - Fields: score 0-100 (act ≥75), grade A-F (condition only), summary, reasoning, redFlags[], positives[], meetsRequirements, requirementNotes, excluded, excludeReason, analyzedAt (ISO).
   If there are more than ~8 to score, parallelize with background Agent calls in batches of ~6, each writing a partial JSON to merge.

3. Write the results to `data/analyses.json` and run `node src/apply-analysis.js`.

4. Regenerate the dashboard with `node src/dashboard.js` (run outside the sandbox so sips thumbnails work), then republish `dashboard.html` to the EXISTING artifact titled "Vehicle Finder — Austin, TX" (use Artifact action "list" to find its URL, publish with that url so the link stays the same; favicon "🚐").

5. Run `node src/notify.js` to send Telegram alerts for anything scoring ≥ the alert threshold.

6. Summarize: how many you scored, the new top listings with scores, and any alerts sent.
