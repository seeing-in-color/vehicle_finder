#!/usr/bin/env node
const path=require('node:path');
const {DATA_DIR,readJSON,writeJSON,config,authorize,audit,withLock,factsHash}=require('./runtime');
function applyAnalyses(store,analyses,now=new Date()) {
  const next=structuredClone(store);
  for(const [id,a] of Object.entries(analyses)) {
    const l=next[id];
    if(!l) throw new Error(`Unknown listing ${id}`);
    const age=+now-Date.parse(a.analyzedAt);
    if(a.factsHash!==factsHash(l) || !Number.isFinite(age) || age<0 || age>3600e3
        || !Number.isFinite(a.score) || a.score<0 || a.score>100 || !/^[ABCDF]$/.test(a.grade)
        || typeof a.meetsRequirements!=='boolean' || typeof a.excluded!=='boolean'
        || typeof a.photosReviewed!=='boolean' || typeof a.requiresReview!=='boolean'
        || typeof a.summary!=='string' || typeof a.reasoning!=='string'
        || !Array.isArray(a.redFlags) || !a.redFlags.every(v=>typeof v==='string')
        || !Array.isArray(a.positives) || !a.positives.every(v=>typeof v==='string')) throw new Error(`Invalid, outdated or unbound analysis: ${id}`);
    l.analysis=a;
  }
  return next;
}
async function main(){
  const a=authorize('apply_listing_analysis',config());
  const file=path.join(DATA_DIR,'listings.json');
  const analyses=readJSON(process.argv[2] || path.join(DATA_DIR,'analyses.json'));
  writeJSON(file,applyAnalyses(readJSON(file,{}),analyses));
  audit(a,'analysis.apply',{listingIds:Object.keys(analyses)});
  console.log(`Applied ${Object.keys(analyses).length} analyses.`);
}
if(require.main===module) withLock(main).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={applyAnalyses};
