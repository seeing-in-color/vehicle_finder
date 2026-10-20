#!/usr/bin/env node
/**
 * Facebook Marketplace scraper — logged-out, no API keys.
 *
 * Flow per run:
 *   1. For each ACTIVE search x location hub: load search results, collect candidate listings.
 *   2. Filter by title regex, price, year. Dedupe by listing id.
 *   3. Fetch detail pages for NEW listings (capped) -> mileage, VIN, title status, description, photos.
 *   4. Re-verify known active listings not checked recently (capped) -> mark stale if gone.
 *   5. Persist to data/listings.json; print run summary JSON to stdout.
 *
 * Exits 0 with {skipped:true} if no searches are active (zero cost when paused).
 */

const fs = require('fs');
const path = require('path');
const { authorize, config: loadConfig, scrubAIEnvironment, DATA_DIR: PRIVATE_DATA } = require('./runtime');
scrubAIEnvironment();
authorize('scrape_logged_out_marketplace', loadConfig());
const { assertAccess } = require('./access');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'searches.json');
const DATA_DIR = PRIVATE_DATA;
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const LISTINGS_PATH = path.join(DATA_DIR, 'listings.json');



const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fixed, low-volume pacing; never disguise automation or defeat a challenge.
const jitter = (_min, max) => max;

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function saveJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function parsePrice(text) {
  const m = text.match(/\$([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

function parseYear(title) {
  const m = title.match(/\b(19[89]\d|20[0-2]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// Fallback mileage extraction from free text (description/title) when the
// structured "Driven X miles" field is absent. Requires an explicit miles/mi/odo
// cue so GVWR-style numbers ("9,500-lb") never match.
function extractMileage(text) {
  if (!text) return null;
  let m = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:\([^)]{0,12}\))?\s*(?:original\s+|actual\s+)?(?:miles|mi\b)/i);
  if (m) {
    const v = parseInt(m[1].replace(/,/g, ''), 10);
    if (v >= 1000 && v < 600000) return v;
  }
  m = text.match(/\b(\d{2,3})\s*k\s*(?:miles|mi\b)/i);
  if (m) return parseInt(m[1], 10) * 1000;
  m = text.match(/(?:odometer|mileage)[:\s]+(\d{1,3}(?:,\d{3})+|\d{4,6})/i);
  if (m) {
    const v = parseInt(m[1].replace(/,/g, ''), 10);
    if (v >= 1000 && v < 600000) return v;
  }
  return null;
}

async function newContext(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
  });
  // Block heavy resources; image URLs are still present in the DOM as src attrs.
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });
  return ctx;
}

async function scrapeSearchPage(page, hub, search) {
  const params = new URLSearchParams({ query: search.query });
  if (search.minPrice) params.set('minPrice', String(search.minPrice));
  if (search.maxPrice) params.set('maxPrice', String(search.maxPrice));
  const url = `https://www.facebook.com/marketplace/${hub}/search?${params.toString()}`;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(jitter(2500, 4500));
  await assertAccess(page, response);
  // Scroll to trigger lazy loading of more results.
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1800);
    await sleep(jitter(1000, 2000));
  }
  return page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const idMatch = a.href.match(/\/marketplace\/item\/(\d+)/);
      if (!idMatch) continue;
      const text = a.innerText || '';
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      out.push({ id: idMatch[1], lines });
    }
    return out;
  });
}

function candidateFromCard(card, search, hub) {
  const lines = card.lines;
  const priceLine = lines.find((l) => /^\$[\d,]+/.test(l)) || '';
  const price = parsePrice(priceLine);
  // Title: first line that isn't a price or a badge like "Just listed".
  const title = lines.find((l) => !/^\$[\d,]+/.test(l) && !/^just listed$/i.test(l) && l.length > 8) || '';
  const location = [...lines].reverse().find((l) => /,\s*[A-Z]{2}$/.test(l)) || '';
  if (!title) return null;
  if (search.titleMustMatch && !new RegExp(search.titleMustMatch, 'i').test(title)) return null;
  if (search.titleMustNotMatch && new RegExp(search.titleMustNotMatch, 'i').test(title)) return null;
  const year = parseYear(title);
  if (search.yearMin && year && year < search.yearMin) return null;
  if (search.yearMax && year && year > search.yearMax) return null;
  if (search.yearMin && !year) return null; // vehicles without a model year in the title are junk cards
  if (price == null || (search.minPrice && price < search.minPrice) || (search.maxPrice && price > search.maxPrice)) return null;
  return {
    id: card.id,
    url: `https://www.facebook.com/marketplace/item/${card.id}/`,
    title, price, year, location,
    searchId: search.id,
    foundVia: hub,
  };
}

const GONE_MARKERS = ["This content isn't available", 'content is currently unavailable', "Page couldn't load", 'This page isn’t available'];

// Detect seller-set sale state. "Sold" collapses the listing (archive after grace
// period); "Pending" is a soft signal we keep visible but flag. Markers are matched
// against the top of the page (near title/price) to avoid false hits from body text.
function saleState(text) {
  const head = text.slice(0, 700);
  if (/This listing was sold|\bMarked as sold\b|\nSold\n/i.test(head) || /This listing was sold/i.test(text)) return 'sold';
  if (/\bSale pending\b|\nPending\n/i.test(head)) return 'pending';
  return 'active';
}

async function scrapeDetail(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(jitter(2500, 4000));
  await assertAccess(page, response);
  // Expand truncated description if a "See more" toggle is present.
  try {
    const seeMore = page.locator('span:text-is("See more")').first();
    if (await seeMore.isVisible({ timeout: 1500 })) { await seeMore.click(); await sleep(600); }
  } catch { /* optional */ }
  const raw = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')]
      .map((i) => i.src)
      .filter((s) => s && s.includes('scontent') && !s.includes('static'));
    return { text: document.body.innerText, imgs: [...new Set(imgs)] };
  });
  const text = raw.text || '';
  if (GONE_MARKERS.some((m) => text.includes(m))) return { gone: true };
  const sale = saleState(text);

  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const mileage = (() => {
    const m = text.match(/Driven\s+([\d,]+)\s+miles/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  })();
  let description = null;
  // Try progressively looser end-markers; FB varies what follows the description.
  for (const re of [
    /Seller's description\n([\s\S]*?)\n(?:See less|See more|Location is approximate|Today's picks)/i,
    /Seller's description\n([\s\S]*?)\n[^\n]*·\s*Location is approximate/i,
    /Seller's description\n([\s\S]{20,3000}?)\n(?:Message|Save|Share|Seller information|Report listing)/i,
    /Seller's description\n([\s\S]{20,3000})$/i,
    // Non-vehicle-flow listings: description sits under Details > Condition.
    /\nDetails\nCondition\n[^\n]+\n([\s\S]{20,4000}?)\n[^\n]*·\s*Location is approximate/i,
    /\nDetails\n([\s\S]{20,4000}?)\n[^\n]*·\s*Location is approximate/i,
  ]) {
    const m = text.match(re);
    if (m) { description = m[1].trim(); break; }
  }

  return {
    gone: false,
    sale,
    price: parsePrice(text),
    mileage: mileage ?? extractMileage(description),
    vin: grab(/VIN:?\s*([A-HJ-NPR-Z0-9]{11,17})/i),
    transmission: grab(/(Automatic|Manual)\s+transmission/i),
    fuel: grab(/Fuel type:?\s*(\w+)/i),
    exteriorColor: grab(/Exterior color:?\s*([^·\n]+)/i),
    titleStatus: grab(/(Clean title|Rebuilt title|Salvage title)/i),
    sellerConditionClaim: grab(/\b((?:Excellent|Very good|Good|Fair|Poor) condition)\b/) || grab(/Condition\nUsed - (Like New|Excellent|Good|Fair|Poor)/i),
    listedAgo: grab(/Listed\s+(.+?)\s+in\s+/i),
    description,
    photoUrls: raw.imgs.slice(0, 12),
  };
}

async function downloadPhotos(listing, maxPhotos) {
  const dir = path.join(IMAGES_DIR, listing.id);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const [i, url] of (listing.photoUrls || []).slice(0, maxPhotos).entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue; // skip icons/blank tiles
      const file = path.join(dir, `photo_${i}.jpg`);
      fs.writeFileSync(file, buf);
      saved.push(path.relative(ROOT, file));
    } catch { /* photo download is best-effort */ }
  }
  return saved;
}

// One-off re-fetch of a single listing's detail page: node src/scrape.js --refetch <id>
async function refetchOne(id) {
  const config = loadJSON(CONFIG_PATH, null);
  const store = loadJSON(LISTINGS_PATH, {});
  const existing = store[id];
  const url = existing?.url || `https://www.facebook.com/marketplace/item/${id}/`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const detail = await scrapeDetail(page, url);
    const now = new Date().toISOString();
    if (detail.gone) {
      if (existing) { existing.status = 'stale'; existing.lastVerified = now; }
      console.log(JSON.stringify({ id, gone: true }));
    } else {
      const merged = { ...(existing || { id, url, firstSeen: now, status: 'active', priceHistory: [] }), ...detail };
      merged.mileage = detail.mileage ?? extractMileage(merged.title) ?? existing?.mileage ?? null;
      merged.price = detail.price ?? existing?.price ?? null;
      merged.lastSeen = now; merged.lastVerified = now;
      delete merged.gone;
      merged.photos = existing?.photos?.length ? existing.photos : await downloadPhotos(merged, config.limits.maxPhotosPerListing);
      store[id] = merged;
      console.log(JSON.stringify({ id, price: merged.price, mileage: merged.mileage, description: merged.description }, null, 2));
    }
  } finally {
    await browser.close();
  }
  saveJSON(LISTINGS_PATH, store);
}

async function main() {
  const config = loadJSON(CONFIG_PATH, null);
  if (!config) throw new Error(`Missing config at ${CONFIG_PATH}`);
  const refetchIdx = process.argv.indexOf('--refetch');
  if (refetchIdx !== -1) return refetchOne(process.argv[refetchIdx + 1]);
  const active = config.searches.filter((s) => s.status === 'active');
  if (active.length === 0) {
    console.log(JSON.stringify({ skipped: true, reason: 'no active searches' }));
    return;
  }

  const store = loadJSON(LISTINGS_PATH, {});
  const now = new Date().toISOString();
  const summary = { skipped: false, ranAt: now, searches: {}, newListings: [], markedStale: [], markedSold: [], archived: [], priceDrops: [], errors: [] };

  // Archive sweep: sold listings past the 3-day grace period drop out of the dashboard.
  const archiveCutoff = Date.now() - 3 * 24 * 3600 * 1000;
  for (const l of Object.values(store)) {
    if (l.status === 'sold' && l.soldAt && new Date(l.soldAt).getTime() < archiveCutoff) {
      l.status = 'archived';
      summary.archived.push(l.id);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await newContext(browser);
  const page = await ctx.newPage();

  try {
    // ---- Phase 1: search sweeps ----
    const candidates = new Map();
    for (const search of active) {
      summary.searches[search.id] = { cardsSeen: 0, matched: 0 };
      for (const hub of config.location.hubs) {
        try {
          const cards = await scrapeSearchPage(page, hub, search);
          summary.searches[search.id].cardsSeen += cards.length;
          for (const card of cards) {
            const c = candidateFromCard(card, search, hub);
            if (c && !candidates.has(c.id)) { candidates.set(c.id, c); summary.searches[search.id].matched++; }
          }
        } catch (e) {
          if (e.accessBlocked) throw e;
          summary.errors.push(`search ${search.id}@${hub}: ${e.message}`);
        }
        await sleep(jitter(3000, 6000));
      }
    }

    // ---- Phase 2: detail fetch for new listings ----
    // Round-robin across searches so one big search can't starve the others.
    const newOnes = [...candidates.values()].filter((c) => !store[c.id]);
    const bySearchQueue = new Map();
    for (const c of newOnes) {
      if (!bySearchQueue.has(c.searchId)) bySearchQueue.set(c.searchId, []);
      bySearchQueue.get(c.searchId).push(c);
    }
    const interleaved = [];
    while (interleaved.length < newOnes.length) {
      for (const q of bySearchQueue.values()) if (q.length) interleaved.push(q.shift());
    }
    const toFetch = interleaved.slice(0, config.limits.maxNewDetailFetchesPerRun);
    for (const cand of toFetch) {
      try {
        const detail = await scrapeDetail(page, cand.url);
        if (detail.gone) continue;
        if (detail.sale === 'sold') continue; // never surface a listing that's already sold
        const search = active.find((s) => s.id === cand.searchId);
        if (search && search.maxMileage && detail.mileage && detail.mileage > search.maxMileage) continue;
        const listing = {
          ...cand, ...detail,
          price: detail.price ?? cand.price,
          mileage: detail.mileage ?? extractMileage(cand.title),
          status: detail.sale === 'pending' ? 'pending' : 'active',
          firstSeen: now, lastSeen: now, lastVerified: now,
          priceHistory: [{ at: now, price: detail.price ?? cand.price }],
        };
        listing.photos = await downloadPhotos(listing, config.limits.maxPhotosPerListing);
        delete listing.gone;
        store[listing.id] = listing;
        summary.newListings.push(listing.id);
      } catch (e) {
        if (e.accessBlocked) throw e;
        summary.errors.push(`detail ${cand.id}: ${e.message}`);
      }
      await sleep(jitter(3000, 6000));
    }

    // ---- Phase 3: refresh listings we already knew about ----
    for (const id of Object.keys(store)) {
      if (candidates.has(id)) {
        store[id].lastSeen = now;
        const seenPrice = candidates.get(id).price;
        if (seenPrice != null && seenPrice !== store[id].price) {
          summary.priceDrops.push({ id, from: store[id].price, to: seenPrice });
          store[id].price = seenPrice;
          store[id].priceHistory = [...(store[id].priceHistory || []), { at: now, price: seenPrice }];
        }
      }
    }

    // ---- Phase 4: re-verify active/pending listings not seen in search AND not verified in 20h ----
    const cutoff = Date.now() - 20 * 3600 * 1000;
    const needsCheck = Object.values(store)
      .filter((l) => ['active', 'pending'].includes(l.status) && !candidates.has(l.id) && new Date(l.lastVerified).getTime() < cutoff)
      .slice(0, config.limits.maxReverificationsPerRun);
    for (const listing of needsCheck) {
      try {
        const detail = await scrapeDetail(page, listing.url);
        listing.lastVerified = now;
        if (detail.gone) {
          listing.status = 'stale';
          summary.markedStale.push(listing.id);
        } else if (detail.sale === 'sold') {
          if (listing.status !== 'sold') { listing.status = 'sold'; listing.soldAt = now; summary.markedSold.push(listing.id); }
        } else if (detail.sale === 'pending') {
          listing.status = 'pending';
        } else {
          listing.status = 'active';
          if (detail.price != null && detail.price !== listing.price) {
            summary.priceDrops.push({ id: listing.id, from: listing.price, to: detail.price });
            listing.price = detail.price;
            listing.priceHistory = [...(listing.priceHistory || []), { at: now, price: detail.price }];
          }
        }
      } catch (e) {
        if (e.accessBlocked) throw e;
        summary.errors.push(`verify ${listing.id}: ${e.message}`);
      }
      await sleep(jitter(3000, 6000));
    }
  } finally {
    await browser.close();
  }

  saveJSON(LISTINGS_PATH, store);
  saveJSON(path.join(DATA_DIR, 'last_run.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  saveJSON(path.join(DATA_DIR,'last_run.json'), {ranAt:new Date().toISOString(),blocked:!!e.accessBlocked,error:e.accessBlocked?e.message:'Collection failed; inspect local runtime.'});
  console.error(e.message);process.exitCode=1;
});
