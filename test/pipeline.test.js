const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vehicle-finder-'));
process.env.VEHICLE_FINDER_DATA_DIR=tmp;
process.env.VEHICLE_FINDER_AUTHORIZATION=path.join(tmp,'authorization.json');
const r=require('../src/runtime');
const {eligible}=require('../src/eligibility');
const {run}=require('../src/notify');
const {importListings}=require('../src/collect');
const {applyAnalyses}=require('../src/apply-analysis');
const {accessBlock}=require('../src/access');
const {transition}=require('../src/desktop-alerts');
const c=r.config(),now=new Date();
const auth=()=>({id:'test-authorization',app:'Vehicle Finder',approvedBy:'user',status:'active',startsAt:new Date(+now-10000).toISOString(),expiresAt:null,searchHash:r.searchHash(c),allowedActions:['send_listing_alerts','send_test_message','send_desktop_alerts','build_private_dashboard'],constraints:{maxAlertsPerRun:5,maxAlertsPerDay:10},telegram:{botId:123,botUsername:'swoop_test_bot',chatId:'-12345',chatTitle:'Swoop_OS'},desktop:{chatTitle:'Swoop_OS',identityEvidence:'Test-only existing group fixture'}});
const saveAuth=a=>r.writeJSON(process.env.VEHICLE_FINDER_AUTHORIZATION,a);
const env={SWOOP_TELEGRAM_BOT_TOKEN:'test-value',SWOOP_TELEGRAM_CHAT_ID:'-12345'};
function listing(id='111'){
  const l={id,url:`https://www.facebook.com/marketplace/item/${id}/`,searchId:'ford-transit-350',status:'active',title:'2018 Ford Transit 350 passenger high roof',price:18000,year:2018,mileage:110000,location:'Austin, TX',description:'Full cash price. Clean title. Passenger high roof.',titleStatus:'Clean title',lastVerified:now.toISOString(),observationEvidence:'Visible exact listing details and photos'};
  l.analysis={score:85,grade:'B',summary:'Good fit',reasoning:'Confirmed visible facts',redFlags:[],positives:['Passenger'],meetsRequirements:true,requirementNotes:'Passenger body and high roof visible in photos',excluded:false,photosReviewed:true,requiresReview:false,distanceMiles:10,locationEvidence:'Visible Austin map location',analyzedAt:now.toISOString(),factsHash:r.factsHash(l)};return l;
}
function reset(listings=[listing()]) {saveAuth(auth());r.writeJSON(path.join(tmp,'listings.json'),Object.fromEntries(listings.map(l=>[l.id,l])));r.writeJSON(path.join(tmp,'deliveries.json'),{});}
function mock(send){return async(url,opts)=>{const method=url.split('/').at(-1);let result;if(method==='getMe')result={id:123,username:'swoop_test_bot'};else if(method==='getChat')result={id:-12345,type:'group',title:'Swoop_OS'};else result=await send(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>({ok:true,result})};};}
test('authorization rejects pause, revoke, expiry, changed criteria and absent caps',()=>{
  for(const changes of [{status:'paused'},{status:'revoked'},{expiresAt:new Date(+now-1).toISOString()},{startsAt:new Date(+now+10000).toISOString()},{searchHash:'different'},{constraints:{}}]){saveAuth({...auth(),...changes});assert.throws(()=>r.authorize('send_listing_alerts',c,now));}
  saveAuth(auth());assert.equal(r.authorize('send_listing_alerts',c,now).id,'test-authorization');assert.throws(()=>r.authorize('purchase_vehicle',c,now));
});
test('only freshly verified, analyzed, confirmed full-fit options alert',()=>{
  assert.equal(eligible(listing(),c,now),true);
  for(const changes of [{status:'pending'},{status:'sold'},{price:22000},{mileage:138001},{mileage:null},{year:2016},{titleStatus:'Rebuilt title'},{lastVerified:'bad'},{lastVerified:new Date(+now-25*3600e3).toISOString()},{description:'new changed facts'},{url:'https://evil.example/'}]){const l={...listing(),...changes};assert.equal(eligible(l,c,now),false,JSON.stringify(changes));}
  for(const changes of [{score:79},{score:'85'},{score:101},{excluded:true},{meetsRequirements:false},{requiresReview:true},{requiresReview:undefined},{photosReviewed:false},{distanceMiles:null},{distanceMiles:251},{locationEvidence:''},{analyzedAt:'bad'},{factsHash:'old'}]){const l=listing();Object.assign(l.analysis,changes);assert.equal(eligible(l,c,now),false,JSON.stringify(changes));}
});
test('login, CAPTCHA, restriction and rate limit stop collection',()=>{
  for(const input of [{url:'https://www.facebook.com/checkpoint/123'},{passwordVisible:true},{status:429},{status:403},{text:'Verify you’re human'},{text:'Try again later'},{text:'CAPTCHA'}])assert.ok(accessBlock(input));
  assert.equal(accessBlock({text:'2018 Ford Transit 350 · $18000'}),null);
});
test('browser import preserves delivery and invalidates analysis when facts change',()=>{
  const old=listing();old.alertedAt=now.toISOString();const observation={...old,price:17000,analysis:{score:100},alertedAt:null};
  const next=importListings([observation],c,{'111':old},now);
  assert.equal(next['111'].analysis,undefined);assert.equal(next['111'].alertedAt,old.alertedAt);
  assert.throws(()=>importListings([{...observation,url:'https://evil.example/'}],c,{},now));
  assert.throws(()=>importListings([{...observation,searchId:'landcruiser-80-series'}],c,{},now));
});
test('analysis application rejects stale binding and malformed score atomically',()=>{
  const l=listing();assert.equal(applyAnalyses({'111':l},{'111':l.analysis},now)['111'].analysis.score,85);
  assert.throws(()=>applyAnalyses({'111':l},{'111':{...l.analysis,factsHash:'old'}},now));
  assert.throws(()=>applyAnalyses({'111':l},{'111':{...l.analysis,score:NaN}},now));
});
test('partial failure persists first success and suppresses uncertain retry',async()=>{
  reset([listing('111'),listing('222')]);let calls=0;
  const request=mock(async()=>{calls++;if(calls===2)throw new Error('network timeout');return {message_id:1,chat:{id:-12345}};});
  await assert.rejects(run({env,request,now}),/uncertain/);
  const ledger=r.readJSON(path.join(tmp,'deliveries.json'));assert.equal(ledger['111'].status,'sent');assert.equal(ledger['222'].status,'uncertain');
  assert.deepEqual(await run({env,request,now}),{sent:0});assert.equal(calls,2);
});
test('changed bot identity prevents any send',async()=>{
  reset();let sends=0;
  const request=async url=>({ok:true,status:200,json:async()=>url.endsWith('/getMe')?{ok:true,result:{id:999,username:'other'}}:url.endsWith('/getChat')?{ok:true,result:{id:-12345,type:'group',title:'Swoop_OS'}}:(sends++,{ok:true,result:{message_id:1,chat:{id:-12345}}})});
  await assert.rejects(run({env,request,now}),/identity/);assert.equal(sends,0);
});
test('pause between sends stops immediately after the confirmed first delivery',async()=>{
  reset([listing('111'),listing('222')]);let sends=0;
  const request=mock(async()=>{sends++;saveAuth({...auth(),status:'paused'});return {message_id:1,chat:{id:-12345}};});
  await assert.rejects(run({env,request,now}),/not active/);assert.equal(sends,1);
});
test('desktop ledger requires begin, evidence and no blind resends',()=>{
  const ledger={'111':{status:'ready'}};
  assert.throws(()=>transition(ledger,'111','confirm','seen',now));
  transition(ledger,'111','begin',null,now);assert.throws(()=>transition(ledger,'111','begin',null,now));
  assert.throws(()=>transition(ledger,'111','confirm','',now));transition(ledger,'111','uncertain','outcome unknown',now);
  assert.throws(()=>transition(ledger,'111','begin',null,now));
});
test('desktop CLI end-to-end prepares, begins, confirms and deduplicates',()=>{
  reset();const script=path.join(r.ROOT,'src/desktop-alerts.js');
  const cli=(...args)=>execFileSync(process.execPath,[script,...args],{encoding:'utf8',env:process.env});
  assert.equal(JSON.parse(cli('prepare')).length,1);assert.equal(JSON.parse(cli('begin','111')).status,'sending');
  assert.equal(JSON.parse(cli('confirm','111','Visible outgoing bubble and delivered checkmark')).status,'sent');
  assert.equal(JSON.parse(cli('prepare')).length,0);
});
test('daily and per-run caps stop additional sends',async()=>{
  reset(Array.from({length:7},(_,i)=>listing(String(111+i))));let sends=0;
  const request=mock(async()=>({message_id:++sends,chat:{id:-12345}}));
  assert.equal((await run({env,request,now})).sent,5);assert.equal(sends,5);
  const ledger=r.readJSON(path.join(tmp,'deliveries.json'));
  for(let i=0;i<5;i++)ledger['previous-'+i]={status:'sent',at:now.toISOString()};
  r.writeJSON(path.join(tmp,'deliveries.json'),ledger);
  assert.equal((await run({env,request,now})).sent,0);assert.equal(sends,5);
});
test('private dashboard build cannot overwrite public project page',()=>{
  reset();const file=path.join(r.ROOT,'public/index.html'),before=fs.readFileSync(file,'utf8');
  execFileSync(process.execPath,[path.join(r.ROOT,'src/dashboard.js')],{env:process.env});
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.ok(fs.existsSync(path.join(tmp,'dashboard.html')));
});
test('desktop-only authorization prevents bot delivery without reading credentials',async()=>{
  reset();saveAuth({...auth(),delivery:{route:'telegram_desktop',secretProviders:[]}});
  let requests=0;
  await assert.rejects(run({env:{},request:async()=>{requests++;throw new Error('must not call');},now}),/desktop only/);
  assert.equal(requests,0);
  const p=JSON.parse(fs.readFileSync(path.join(r.ROOT,'package.json'),'utf8'));
  assert.equal(p.scripts.notify,'node src/desktop-alerts.js prepare');
  const script=path.join(r.ROOT,'src/desktop-alerts.js');
  const result=execFileSync(process.execPath,[script,'prepare'],{encoding:'utf8',env:process.env});
  assert.equal(JSON.parse(result).length,1);
  assert.equal(r.readJSON(path.join(tmp,'deliveries.json'))['111'].status,'ready');
});
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
