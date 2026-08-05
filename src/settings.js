#!/usr/bin/env node
/**
 * View and edit search settings in config/searches.json.
 *
 *   node src/settings.js list                       show every search + its parameters
 *   node src/settings.js pause <id>                 stop searching (costs nothing)
 *   node src/settings.js activate <id>              resume searching
 *   node src/settings.js found <id>                 mark as found (stops searching)
 *   node src/settings.js set <id> <field> <value>   edit a filter
 *
 * Editable fields: maxMileage, minPrice, maxPrice, yearMin, yearMax, query, label.
 * Use "null" to clear a numeric field (e.g. set landcruiser-80-series maxMileage null).
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'searches.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const save = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
const find = (id) => config.searches.find((s) => s.id === id);
const NUMERIC = ['maxMileage', 'minPrice', 'maxPrice', 'yearMin', 'yearMax'];

const [cmd, id, field, ...rest] = process.argv.slice(2);
const value = rest.join(' ');

function need() {
  const s = find(id);
  if (!s) { console.error(`No search "${id}". Known: ${config.searches.map((x) => x.id).join(', ')}`); process.exit(1); }
  return s;
}
const fmt = (n) => (n == null ? '—' : n.toLocaleString());

switch (cmd) {
  case 'list': case undefined: {
    for (const s of config.searches) {
      const mark = s.status === 'active' ? '●' : '○';
      console.log(`${mark} ${s.id}  [${s.status}]  "${s.label}"`);
      console.log(`    query: "${s.query}"`);
      console.log(`    price: $${fmt(s.minPrice)} – $${fmt(s.maxPrice)}   mileage ≤ ${fmt(s.maxMileage)}   years ${s.yearMin || '—'}–${s.yearMax || 'now'}`);
      if (s.requirements) console.log(`    requires: ${s.requirements}`);
    }
    console.log(`\nLocation: ${config.location.centerCity}, ${config.location.radiusMiles} mi   ·   alert score ≥ ${config.alerts.minScoreForAlert}`);
    break;
  }
  case 'pause': need().status = 'paused'; save(); console.log(`Paused ${id} — it won't be searched until reactivated.`); break;
  case 'activate': need().status = 'active'; save(); console.log(`Activated ${id}.`); break;
  case 'found': need().status = 'found'; save(); console.log(`Marked ${id} as found — searching stopped.`); break;
  case 'set': {
    const s = need();
    if (!['maxMileage', 'minPrice', 'maxPrice', 'yearMin', 'yearMax', 'query', 'label'].includes(field)) {
      console.error(`Can't set "${field}". Editable: maxMileage, minPrice, maxPrice, yearMin, yearMax, query, label.`); process.exit(1);
    }
    if (NUMERIC.includes(field)) {
      s[field] = (value === 'null' || value === '') ? null : parseInt(value.replace(/[,$]/g, ''), 10);
    } else {
      s[field] = value;
    }
    save();
    console.log(`${id}.${field} = ${s[field]}`);
    break;
  }
  default:
    console.log('Usage: node src/settings.js <list|pause|activate|found|set> [id] [field] [value]');
}
