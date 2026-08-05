#!/usr/bin/env node
/**
 * Merges data/analyses.json (written by the Claude analysis step) into
 * data/listings.json under each listing's `analysis` key.
 *
 * analyses.json shape: { "<listingId>": { score, grade, summary, reasoning,
 *                        redFlags: [], positives: [], analyzedAt } }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const listingsPath = path.join(ROOT, 'data', 'listings.json');
const analysesPath = path.join(ROOT, 'data', 'analyses.json');

const store = JSON.parse(fs.readFileSync(listingsPath, 'utf8'));
const analyses = JSON.parse(fs.readFileSync(analysesPath, 'utf8'));

let applied = 0;
for (const [id, analysis] of Object.entries(analyses)) {
  if (store[id]) { store[id].analysis = analysis; applied++; }
}
fs.writeFileSync(listingsPath, JSON.stringify(store, null, 2));
console.log(`Applied ${applied} analyses.`);
