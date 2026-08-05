#!/usr/bin/env node
/**
 * Generates dashboard.html from config/searches.json + data/listings.json.
 * Self-contained page (inline CSS, thumbnails as data URIs via macOS `sips`).
 * Sorted by analysis.score desc; unanalyzed listings ranked after analyzed ones.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'searches.json'), 'utf8'));
const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'listings.json'), 'utf8'));
const OUT = path.join(ROOT, 'dashboard.html');
const THUMB_DIR = path.join(ROOT, 'data', 'thumbs');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => (n == null ? '—' : '$' + n.toLocaleString());
const miles = (n) => (n == null ? '—' : n.toLocaleString() + ' mi');

function thumbDataUri(listing) {
  const src = (listing.photos || [])[0];
  if (!src) return null;
  const abs = path.join(ROOT, src);
  if (!fs.existsSync(abs)) return null;
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const thumb = path.join(THUMB_DIR, `${listing.id}.jpg`);
  try {
    if (!fs.existsSync(thumb)) {
      execFileSync('sips', ['-Z', '220', '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', abs, '--out', thumb], { stdio: 'ignore' });
    }
    const buf = fs.readFileSync(thumb);
    if (buf.length > 60000) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    // sips unavailable (e.g. sandboxed run) — embed the original if it's small enough.
    const buf = fs.readFileSync(abs);
    if (buf.length > 120000) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
}

function scoreClass(score) {
  if (score == null) return 'pending';
  if (score >= 75) return 'hot';
  if (score >= 50) return 'mid';
  return 'low';
}

function daysAgo(iso) {
  if (!iso) return '—';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (d < 1) return 'just now';
  if (d < 24) return `${d}h ago`;
  return `${Math.round(d / 24)}d ago`;
}

function priceDropBadge(l) {
  const h = l.priceHistory || [];
  if (h.length < 2) return '';
  const prev = h[h.length - 2].price, curr = h[h.length - 1].price;
  if (curr < prev) return `<span class="drop">▼ was ${money(prev)}</span>`;
  return '';
}

function listingRow(l, rank, fitReasonText) {
  const a = l.analysis || {};
  const sc = scoreClass(a.score);
  const thumb = thumbDataUri(l);
  const reasonChip = fitReasonText ? `<span class="flag fitflag">${esc(fitReasonText)}</span>` : '';
  const flags = (a.redFlags || []).map((f) => `<span class="flag">${esc(f)}</span>`).join('');
  const pros = (a.positives || []).map((f) => `<span class="pro">${esc(f)}</span>`).join('');
  const sold = l.status === 'sold';
  const pending = l.status === 'pending';
  const soldTag = sold ? '<b class="soldtag">SOLD</b> ' : '';
  const pendingChip = pending ? '<span class="chip pending">Sale pending</span>' : '';
  const listedTs = l.firstSeen ? new Date(l.firstSeen).getTime() : 0;
  return `
  <details class="listing ${sc}${sold ? ' is-sold' : ''}" data-id="${esc(l.id)}" data-score="${a.score ?? -1}" data-price="${l.price ?? ''}" data-mileage="${l.mileage ?? ''}" data-listed="${listedTs}" data-title="${esc((l.title || '').toLowerCase())}" data-location="${esc((l.location || '').toLowerCase())}" data-grade="${esc(a.grade || '')}" data-status="${esc(l.status || '')}">
    <summary>
      <span class="rank">${rank}</span>
      <span class="thumbwrap">${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : '<span class="nothumb">no photo</span>'}</span>
      <span class="main">
        <span class="title">${soldTag}${esc(l.title)}</span>
        <span class="sub">${esc(l.location)} · listed ${esc(l.listedAgo || '—')} · verified ${daysAgo(l.lastVerified)}</span>
        <span class="chips">${pendingChip}${a.grade ? `<span class="chip grade">${esc(a.grade)} condition</span>` : ''}${esc(l.titleStatus) ? `<span class="chip">${esc(l.titleStatus)}</span>` : ''}${reasonChip}${flags}</span>
      </span>
      <span class="nums">
        <span class="price">${money(l.price)} ${priceDropBadge(l)}</span>
        <span class="miles">${miles(l.mileage)}</span>
      </span>
      <span class="scorewrap">
        <span class="score">${a.score ?? '·'}</span>
        <span class="scorelabel">${a.score != null ? 'score' : 'pending'}</span>
      </span>
      <button class="delbtn" data-del="${esc(l.id)}" title="Hide this listing" aria-label="Hide this listing">×</button>
    </summary>
    <div class="body">
      ${a.summary ? `<p class="verdict">${esc(a.summary)}</p>` : '<p class="verdict muted">Not yet analyzed.</p>'}
      ${a.reasoning ? `<p class="reasoning">${esc(a.reasoning)}</p>` : ''}
      ${pros ? `<div class="proslist">${pros}</div>` : ''}
      <dl class="specs">
        ${l.vin ? `<div><dt>VIN</dt><dd>${esc(l.vin)}</dd></div>` : ''}
        ${l.transmission ? `<div><dt>Trans</dt><dd>${esc(l.transmission)}</dd></div>` : ''}
        ${l.fuel ? `<div><dt>Fuel</dt><dd>${esc(l.fuel)}</dd></div>` : ''}
        ${l.exteriorColor ? `<div><dt>Color</dt><dd>${esc(l.exteriorColor)}</dd></div>` : ''}
        <div><dt>First seen</dt><dd>${daysAgo(l.firstSeen)}</dd></div>
      </dl>
      ${l.description ? `<details class="desc"><summary>Seller's description</summary><p>${esc(l.description)}</p></details>` : ''}
      <a class="gobtn" href="${esc(l.url)}" target="_blank" rel="noopener">Open listing on Facebook ↗</a>
    </div>
  </details>`;
}

const all = Object.values(store);
const VISIBLE = ['active', 'pending', 'sold'];
const scoreThenPrice = (x, y) => (y.analysis?.score ?? -1) - (x.analysis?.score ?? -1) || (x.price ?? 9e9) - (y.price ?? 9e9);
// Listings flagged as dealer down-payment / bait tactics are dropped entirely.
const isExcluded = (l) => l.analysis && l.analysis.excluded === true;
const excluded = all.filter((l) => VISIBLE.includes(l.status) && isExcluded(l));
const active = all.filter((l) => VISIBLE.includes(l.status) && !isExcluded(l)).sort(scoreThenPrice);
const stale = all.filter((l) => l.status === 'stale');

const searchChips = config.searches
  .map((s) => ({ s, n: active.filter((l) => l.searchId === s.id).length }))
  .filter(({ n }) => n > 0)
  .map(({ s, n }) => `<button class="searchchip s-${esc(s.status)}" data-toggle="${esc(s.id)}" aria-pressed="true" title="Show/hide ${esc(s.label)}"><span class="dot"></span><b>${esc(s.label)}</b> · ${n}</button>`)
  .join('');

// A listing "doesn't fit" when analysis marked it meetsRequirements:false or it
// exceeds the search's mileage cap. Non-fits render in a collapsed group so the
// main table only shows actionable vehicles.
function fitReason(l, s) {
  if (l.analysis && l.analysis.meetsRequirements === false) {
    return l.analysis.requirementNotes || 'does not meet search requirements';
  }
  if (s.maxMileage && l.mileage != null && l.mileage > s.maxMileage) {
    return `over ${s.maxMileage.toLocaleString()} mi cap`;
  }
  if (s.maxPrice && l.price != null && l.price > s.maxPrice) {
    return `over $${s.maxPrice.toLocaleString()} price cap`;
  }
  return null;
}

const sections = config.searches.map((s) => {
  const rows = active.filter((l) => l.searchId === s.id);
  if (!rows.length) return '';
  const fits = [], notFits = [];
  for (const l of rows) {
    const reason = fitReason(l, s);
    if (reason) notFits.push({ l, reason }); else fits.push(l);
  }
  const notFitHtml = notFits.length
    ? `<details class="notfitwrap"><summary>${notFits.length} listing${notFits.length > 1 ? 's' : ''} that don't fit your requirements</summary><div class="notfitlist">${notFits
        .map(({ l, reason }, i) => listingRow(l, fits.length + i + 1, reason))
        .join('')}</div></details>`
    : '';
  return `<section data-search="${esc(s.id)}"><h2>${esc(s.label)} <span class="count" data-count-fit>${fits.length} fit${notFits.length ? ` · ${notFits.length} don't` : ''}</span></h2><div class="fitlist">${fits.map((l, i) => listingRow(l, i + 1)).join('')}</div>${notFitHtml}</section>`;
}).join('');

const controls = `
<div class="controls">
  <input id="q" type="search" placeholder="Filter by title or location…" autocomplete="off">
  <label>Sort
    <select id="sortby">
      <option value="score">Priority score</option>
      <option value="price-asc">Price: low → high</option>
      <option value="price-desc">Price: high → low</option>
      <option value="mileage-asc">Mileage: low → high</option>
      <option value="listed-desc">Recently found</option>
    </select>
  </label>
  <label>Min grade
    <select id="gradefilter">
      <option value="all">Any</option>
      <option value="A">A only</option>
      <option value="B">B or better</option>
      <option value="C">C or better</option>
    </select>
  </label>
  <label class="chk"><input id="hidesold" type="checkbox"> Hide sold</label>
  <button id="showdeleted" class="linkbtn" hidden></button>
</div>`;

const fmtNum = (n) => (n == null ? 'any' : n.toLocaleString());
const settingsPanel = `
<details class="settings">
  <summary>⚙ Search settings — ${config.searches.filter((s) => s.status === 'active').length} of ${config.searches.length} active</summary>
  <div class="settingsbody">
    <p class="settingsnote">These drive what gets scraped twice a day. To change them, just tell Claude ("pause the Land Cruiser search", "set Transit max mileage to 150k") or run <code>node src/settings.js</code>.</p>
    ${config.searches.map((s) => `
    <div class="setcard set-${esc(s.status)}">
      <div class="sethead">
        <span class="setstatus st-${esc(s.status)}">${esc(s.status)}</span>
        <span class="setlabel">${esc(s.label)}</span>
        <span class="setquery">“${esc(s.query)}”</span>
      </div>
      <dl class="setgrid">
        <div><dt>Price</dt><dd>$${fmtNum(s.minPrice)} – $${fmtNum(s.maxPrice)}</dd></div>
        <div><dt>Max mileage</dt><dd>${s.maxMileage ? s.maxMileage.toLocaleString() + ' mi' : 'any'}</dd></div>
        <div><dt>Years</dt><dd>${s.yearMin || 'any'} – ${s.yearMax || 'now'}</dd></div>
      </dl>
      ${s.requirements ? `<p class="setreq"><b>Requires:</b> ${esc(s.requirements)}</p>` : ''}
    </div>`).join('')}
    <p class="settingsnote">Center: ${esc(config.location.centerCity)} · ${config.location.radiusMiles} mi radius · Telegram alerts fire at score ≥ ${config.alerts.minScoreForAlert}.</p>
  </div>
</details>`;

const html = `<title>Vehicle Finder — ${esc(config.location.centerCity)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{
  --bg:#F3F4F6; --panel:#FFFFFF; --ink:#1B1E24; --muted:#5A616D; --line:#DDE0E6;
  --accent:#2B5F8E; --hot:#1E8E5A; --mid:#B8860B; --low:#B93A2E;
  --hot-bg:#E7F4EE; --flag-bg:#F8ECEA; --pro-bg:#EAF3EE; --chipbg:#EDEFF2;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#16181D; --panel:#1E2128; --ink:#E8EAEE; --muted:#9BA3B0; --line:#31353E;
  --accent:#6FA7D6; --hot:#4CC38A; --mid:#D9A93D; --low:#E0705F;
  --hot-bg:#1D2C25; --flag-bg:#2E2220; --pro-bg:#1F2A23; --chipbg:#2A2E36;
}}
:root[data-theme="dark"]{
  --bg:#16181D; --panel:#1E2128; --ink:#E8EAEE; --muted:#9BA3B0; --line:#31353E;
  --accent:#6FA7D6; --hot:#4CC38A; --mid:#D9A93D; --low:#E0705F;
  --hot-bg:#1D2C25; --flag-bg:#2E2220; --pro-bg:#1F2A23; --chipbg:#2A2E36;
}
:root[data-theme="light"]{
  --bg:#F3F4F6; --panel:#FFFFFF; --ink:#1B1E24; --muted:#5A616D; --line:#DDE0E6;
  --accent:#2B5F8E; --hot:#1E8E5A; --mid:#B8860B; --low:#B93A2E;
  --hot-bg:#E7F4EE; --flag-bg:#F8ECEA; --pro-bg:#EAF3EE; --chipbg:#EDEFF2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Avenir Next","Helvetica Neue",-apple-system,system-ui,sans-serif;padding:20px clamp(12px,3vw,36px) 60px}
header{max-width:1060px;margin:0 auto 18px}
h1{font-size:1.5rem;font-weight:600;margin:0;letter-spacing:-.01em}
.meta{color:var(--muted);font-size:.85rem;margin-top:2px}
.chipsrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.searchchip{font-size:.8rem;padding:5px 13px;border-radius:999px;background:var(--chipbg);color:var(--ink);border:1px solid var(--line);cursor:pointer;display:inline-flex;align-items:center;transition:opacity .12s}
.searchchip.s-active{border-color:var(--hot)}
.searchchip b{font-weight:600}
.searchchip .dot{width:8px;height:8px;border-radius:50%;background:var(--hot);margin-right:7px}
.searchchip[aria-pressed="false"]{opacity:.4}
.searchchip[aria-pressed="false"] .dot{background:var(--muted)}
.searchchip:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
main{max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:26px}
h2{font-size:1.05rem;font-weight:600;margin:0 0 10px;letter-spacing:.01em}
.count{color:var(--muted);font-weight:400}
section{display:flex;flex-direction:column}
.listing{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;margin-bottom:8px}
.listing.hot{border-left-color:var(--hot)}
.listing.mid{border-left-color:var(--mid)}
.listing.low{border-left-color:var(--low)}
.listing>summary{display:grid;grid-template-columns:auto auto 1fr auto auto auto;gap:14px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none}
.listing>summary::-webkit-details-marker{display:none}
.listing.is-sold{opacity:.72}
.soldtag{color:var(--low);font-weight:800;letter-spacing:.03em}
.chip.pending{background:var(--flag-bg);color:var(--mid);font-weight:600}
.delbtn{border:none;background:transparent;color:var(--muted);font-size:1.25rem;line-height:1;width:26px;height:26px;border-radius:6px;cursor:pointer;opacity:.5}
.delbtn:hover{opacity:1;background:var(--flag-bg);color:var(--low)}
.delbtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px;opacity:1}
.rank{color:var(--muted);font:600 .8rem ui-monospace,Menlo,monospace;min-width:1.4em;text-align:right}
.thumbwrap img{width:88px;height:64px;object-fit:cover;border-radius:5px;display:block}
.nothumb{display:flex;align-items:center;justify-content:center;width:88px;height:64px;border-radius:5px;background:var(--chipbg);color:var(--muted);font-size:.7rem}
.main{display:flex;flex-direction:column;gap:3px;min-width:0}
.title{font-weight:600;text-wrap:balance}
.sub{color:var(--muted);font-size:.78rem}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.chip{font-size:.7rem;padding:1px 8px;border-radius:999px;background:var(--chipbg);color:var(--muted)}
.chip.grade{background:var(--hot-bg);color:var(--hot);font-weight:600}
.flag{font-size:.7rem;padding:1px 8px;border-radius:999px;background:var(--flag-bg);color:var(--low)}
.pro{font-size:.75rem;padding:2px 9px;border-radius:999px;background:var(--pro-bg);color:var(--hot)}
.nums{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.price{font-weight:700}
.drop{color:var(--hot);font-size:.72rem;font-weight:600}
.miles{color:var(--muted);font-size:.82rem}
.scorewrap{display:flex;flex-direction:column;align-items:center;min-width:52px}
.score{font:700 1.3rem ui-monospace,Menlo,monospace}
.hot .score{color:var(--hot)} .mid .score{color:var(--mid)} .low .score{color:var(--low)} .pending .score{color:var(--muted)}
.scorelabel{font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.body{padding:4px 18px 16px;border-top:1px solid var(--line)}
.verdict{font-weight:600;margin:10px 0 4px}
.muted{color:var(--muted);font-weight:400}
.reasoning{color:var(--muted);margin:4px 0 10px;max-width:72ch}
.proslist{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.specs{display:flex;flex-wrap:wrap;gap:6px 26px;margin:8px 0;font-size:.82rem}
.specs div{display:flex;gap:6px}
.specs dt{color:var(--muted)} .specs dd{margin:0;font-family:ui-monospace,Menlo,monospace}
.desc{margin:8px 0;font-size:.85rem}
.desc summary{cursor:pointer;color:var(--accent)}
.desc p{white-space:pre-wrap;color:var(--muted);max-width:72ch}
.gobtn{display:inline-block;margin-top:8px;padding:7px 16px;border-radius:6px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:.85rem}
.gobtn:focus-visible,.listing>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.notfitwrap{margin-top:6px}
.notfitwrap>summary{cursor:pointer;color:var(--muted);font-size:.85rem;padding:6px 2px;list-style:revert}
.notfitwrap .listing{opacity:.62}
.fitflag{background:var(--chipbg);color:var(--muted)}
.controls{max-width:1060px;margin:0 auto 18px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;position:sticky;top:8px;z-index:5}
.controls input[type=search]{flex:1 1 220px;min-width:160px;padding:7px 11px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font-size:.9rem}
.controls label{font-size:.8rem;color:var(--muted);display:flex;align-items:center;gap:6px}
.controls select{padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font-size:.85rem}
.controls .chk{cursor:pointer}
.controls .linkbtn{border:none;background:none;color:var(--accent);font-size:.82rem;cursor:pointer;text-decoration:underline}
.controls input:focus-visible,.controls select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.emptynote{color:var(--muted);font-size:.85rem;padding:8px 2px}
.settings{max-width:1060px;margin:0 auto 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.settings>summary{cursor:pointer;padding:12px 16px;font-weight:600;font-size:.92rem;list-style:revert}
.settingsbody{padding:4px 16px 16px;display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--line)}
.settingsnote{color:var(--muted);font-size:.8rem;margin:6px 0 0;max-width:80ch}
.settingsnote code{background:var(--chipbg);padding:1px 6px;border-radius:4px;font-size:.9em}
.setcard{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:8px;padding:10px 14px}
.setcard.set-active{border-left-color:var(--hot)}
.setcard.set-found{border-left-color:var(--accent)}
.sethead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.setstatus{font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;padding:2px 8px;border-radius:999px;background:var(--chipbg);color:var(--muted)}
.setstatus.st-active{background:var(--hot-bg);color:var(--hot);font-weight:700}
.setlabel{font-weight:600}
.setquery{color:var(--muted);font-size:.82rem}
.setgrid{display:flex;flex-wrap:wrap;gap:6px 26px;margin:8px 0 0;font-size:.82rem}
.setgrid div{display:flex;gap:6px}
.setgrid dt{color:var(--muted)} .setgrid dd{margin:0;font-family:ui-monospace,Menlo,monospace}
.setreq{color:var(--muted);font-size:.8rem;margin:8px 0 0;max-width:80ch}
.stalewrap{max-width:1060px;margin:26px auto 0;color:var(--muted)}
.stalewrap summary{cursor:pointer;font-size:.9rem}
.stale-item{font-size:.83rem;padding:6px 0;border-bottom:1px solid var(--line)}
@media (max-width:680px){
  .listing>summary{grid-template-columns:auto 1fr auto auto;grid-template-areas:"thumb main score del" "thumb nums score del"}
  .rank{display:none}
  .thumbwrap{grid-area:thumb} .main{grid-area:main} .nums{grid-area:nums;flex-direction:row;gap:10px;align-items:center} .scorewrap{grid-area:score} .delbtn{grid-area:del;align-self:start}
  .controls{position:static}
}
</style>
<header>
  <h1>Vehicle Finder</h1>
  <div class="meta">${esc(config.location.centerCity)} · ${config.location.radiusMiles} mi radius · updated ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT · ${active.length} live listings</div>
  <div class="chipsrow">${searchChips}</div>
</header>
${controls}
${settingsPanel}
<main>${sections}</main>
${excluded.length ? `<details class="stalewrap"><summary>${excluded.length} listing${excluded.length > 1 ? 's' : ''} hidden as dealer down-payment / bait tactics</summary>${excluded.map((l) => `<div class="stale-item">${esc(l.title)} — ${money(l.price)} — ${esc(l.analysis?.excludeReason || 'bait pricing')}</div>`).join('')}</details>` : ''}
${stale.length ? `<details class="stalewrap"><summary>${stale.length} inactive (no longer live) listings</summary>${stale.map((l) => `<div class="stale-item">${esc(l.title)} — ${money(l.price)} — last verified ${daysAgo(l.lastVerified)}</div>`).join('')}</details>` : ''}
<script>
(function(){
  var KEY='vf_hidden_v1';
  var hidden=new Set();
  try{ hidden=new Set(JSON.parse(localStorage.getItem(KEY)||'[]')); }catch(e){}
  var save=function(){ try{ localStorage.setItem(KEY, JSON.stringify([].concat(Array.from(hidden)))); }catch(e){} };
  var q=document.getElementById('q'), sortby=document.getElementById('sortby'),
      gradeSel=document.getElementById('gradefilter'), hideSold=document.getElementById('hidesold'),
      showDel=document.getElementById('showdeleted');
  var GRADE_MIN={A:['A'],B:['A','B'],C:['A','B','C']};
  // Which whole vehicle categories are toggled off (persisted).
  var SKEY='vf_hidesearch_v1', hiddenSearch=new Set();
  try{ hiddenSearch=new Set(JSON.parse(localStorage.getItem(SKEY)||'[]')); }catch(e){}
  var saveSearch=function(){ try{ localStorage.setItem(SKEY, JSON.stringify([].concat(Array.from(hiddenSearch)))); }catch(e){} };
  function num(v){ return v===''||v==null?NaN:parseFloat(v); }
  function cmp(a,b){
    var s=sortby.value;
    if(s==='price-asc'){ return (num(a.dataset.price)||1e12)-(num(b.dataset.price)||1e12); }
    if(s==='price-desc'){ return (num(b.dataset.price)||-1)-(num(a.dataset.price)||-1); }
    if(s==='mileage-asc'){ return (num(a.dataset.mileage)||1e12)-(num(b.dataset.mileage)||1e12); }
    if(s==='listed-desc'){ return (num(b.dataset.listed)||0)-(num(a.dataset.listed)||0); }
    return (num(b.dataset.score)||-1)-(num(a.dataset.score)||-1); // score
  }
  function passes(row){
    if(hidden.has(row.dataset.id)) return false;
    if(hideSold.checked && row.dataset.status==='sold') return false;
    var term=(q.value||'').toLowerCase().trim();
    if(term && (row.dataset.title.indexOf(term)<0 && row.dataset.location.indexOf(term)<0)) return false;
    var g=gradeSel.value;
    if(g!=='all'){ var ok=GRADE_MIN[g]||[]; if(ok.indexOf((row.dataset.grade||'').charAt(0))<0) return false; }
    return true;
  }
  function apply(){
    document.querySelectorAll('section[data-search]').forEach(function(sec){
      sec.style.display = hiddenSearch.has(sec.dataset.search) ? 'none' : '';
    });
    document.querySelectorAll('.fitlist, .notfitlist').forEach(function(list){
      var rows=Array.prototype.slice.call(list.children).filter(function(el){return el.classList.contains('listing');});
      rows.sort(cmp).forEach(function(r){ list.appendChild(r); });
      var n=0;
      rows.forEach(function(r){
        var show=passes(r);
        r.style.display=show?'':'none';
        if(show){ n++; var rk=r.querySelector('.rank'); if(rk) rk.textContent=n; }
      });
    });
    var delCount=hidden.size;
    if(delCount>0){ showDel.hidden=false; showDel.textContent='Show '+delCount+' hidden'; }
    else { showDel.hidden=true; }
  }
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.delbtn');
    if(btn){ e.preventDefault(); e.stopPropagation(); hidden.add(btn.getAttribute('data-del')); save(); apply(); }
  });
  showDel.addEventListener('click',function(){ hidden.clear(); save(); apply(); });
  document.querySelectorAll('.searchchip[data-toggle]').forEach(function(chip){
    var id=chip.getAttribute('data-toggle');
    if(hiddenSearch.has(id)) chip.setAttribute('aria-pressed','false');
    chip.addEventListener('click',function(){
      if(hiddenSearch.has(id)){ hiddenSearch.delete(id); chip.setAttribute('aria-pressed','true'); }
      else { hiddenSearch.add(id); chip.setAttribute('aria-pressed','false'); }
      saveSearch(); apply();
    });
  });
  [q,sortby,gradeSel,hideSold].forEach(function(el){ el.addEventListener('input',apply); el.addEventListener('change',apply); });
  apply();
})();
</script>
`;

// Strip characters that break the Artifact publisher: replacement/object glyphs
// (from mojibake in scraped listing text) and any unpaired UTF-16 surrogates,
// while leaving valid surrogate pairs (emoji) intact.
const clean = html
  .replace(/[￼�]/g, '')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
  .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1');

fs.writeFileSync(OUT, clean);
console.log(`Wrote ${OUT} (${active.length} active/pending/sold, ${stale.length} stale)`);
