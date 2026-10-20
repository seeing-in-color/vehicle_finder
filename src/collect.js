#!/usr/bin/env node
// Import only observations made through the supported local browser tools.
const fs = require('node:fs');
const path = require('node:path');
const {DATA_DIR, config, readJSON, writeJSON, authorize, audit, withLock, factsHash} = require('./runtime');
function importListings(observations, c, store, now = new Date()) {
  if (!Array.isArray(observations) || observations.length > 25) throw new Error('Import must contain at most 25 observed listings.');
  const next = structuredClone(store);
  for (const input of observations) {
    const s = c.searches.find(s=>s.id===input.searchId && s.status==='active');
    const age=+now-Date.parse(input.lastVerified);
    if (!s || !/^\d+$/.test(input.id) || input.url!==`https://www.facebook.com/marketplace/item/${input.id}/`
        || !['active','pending','sold','stale'].includes(input.status) || typeof input.title!=='string' || !input.title.trim()
        || !Number.isFinite(age) || age<0 || age>3600e3 || !input.observationEvidence?.trim()) throw new Error('Observation missing exact listing identity, active search, evidence or fresh verification.');
    const old=next[input.id];
    const l={};
    // No analysis, notification state, paths, or executable commands may enter via listing content.
    for (const k of ['id','url','searchId','status','title','price','year','mileage','location','description','titleStatus','vin','lastVerified','observationEvidence','photoUrls']) if (input[k]!==undefined) l[k]=input[k];
    l.firstSeen=old?.firstSeen || now.toISOString();l.lastSeen=now.toISOString();
    l.priceHistory=old?.priceHistory || [];
    if (!l.priceHistory.length || l.priceHistory.at(-1).price!==l.price) l.priceHistory=[...l.priceHistory,{at:now.toISOString(),price:l.price}];
    if (old?.analysis && factsHash(old)===factsHash(l)) l.analysis=old.analysis;
    if (old?.alertedAt) l.alertedAt=old.alertedAt;
    if (l.status==='sold') l.soldAt=old?.soldAt || now.toISOString();
    next[l.id]=l;
  }
  return next;
}
async function main() {
  const c=config(), a=authorize('import_observed_listings',c);
  const observations=JSON.parse(fs.readFileSync(process.argv[2] || 0,'utf8'));
  const file=path.join(DATA_DIR,'listings.json');
  const store=importListings(observations,c,readJSON(file,{}));
  writeJSON(file,store);audit(a,'listings.import',{listingIds:observations.map(l=>l.id)});
  console.log(`Imported ${observations.length} observed listings.`);
}
if(require.main===module) withLock(main).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={importListings};
