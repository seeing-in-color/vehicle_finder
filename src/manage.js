#!/usr/bin/env node
/**
 * Manual listing management (no browser needed). Run the dashboard afterward.
 *
 *   node src/manage.js sold <id>      mark SOLD now (archives automatically 3 days later)
 *   node src/manage.js pending <id>   mark pending
 *   node src/manage.js active <id>    restore to active
 *   node src/manage.js delete <id>    permanently remove from the datastore
 *   node src/manage.js archive <id>   archive immediately (hide from dashboard)
 *   node src/manage.js sweep          run the 3-day sold->archived sweep now
 *   node src/manage.js list           print id / status / title for every listing
 */
const fs = require('fs');
const path = require('path');

const LISTINGS_PATH = path.join(__dirname, '..', 'data', 'listings.json');
const store = JSON.parse(fs.readFileSync(LISTINGS_PATH, 'utf8'));
const save = () => fs.writeFileSync(LISTINGS_PATH, JSON.stringify(store, null, 2));
const now = new Date().toISOString();

const [cmd, id] = process.argv.slice(2);
const need = () => { if (!store[id]) { console.error(`No listing ${id}`); process.exit(1); } };

switch (cmd) {
  case 'sold': need(); store[id].status = 'sold'; store[id].soldAt = now; save(); console.log(`Marked SOLD: ${store[id].title}`); break;
  case 'pending': need(); store[id].status = 'pending'; save(); console.log(`Marked pending: ${store[id].title}`); break;
  case 'active': need(); store[id].status = 'active'; delete store[id].soldAt; save(); console.log(`Restored active: ${store[id].title}`); break;
  case 'archive': need(); store[id].status = 'archived'; save(); console.log(`Archived: ${store[id].title}`); break;
  case 'delete': need(); { const t = store[id].title; delete store[id]; save(); console.log(`Deleted: ${t}`); } break;
  case 'sweep': {
    const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
    let n = 0;
    for (const l of Object.values(store)) {
      if (l.status === 'sold' && l.soldAt && new Date(l.soldAt).getTime() < cutoff) { l.status = 'archived'; n++; }
    }
    save(); console.log(`Archived ${n} sold listing(s) past the 3-day grace period.`);
    break;
  }
  case 'list': {
    for (const l of Object.values(store)) console.log(`${l.id}\t${(l.status || '?').padEnd(9)}\t${(l.title || '').slice(0, 60)}`);
    break;
  }
  default:
    console.log('Usage: node src/manage.js <sold|pending|active|archive|delete|sweep|list> [id]');
}
