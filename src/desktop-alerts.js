#!/usr/bin/env node
// Prepares and records desktop delivery; does not drive Telegram or send anything.
const path=require('node:path');
const {DATA_DIR,readJSON,writeJSON,config,authorize,audit,withLock,digest}=require('./runtime');
const {eligible}=require('./eligibility');
const {message}=require('./notify');
function transition(ledger,id,operation,evidence,now=new Date()) {
  const entry=ledger[id];
  if(!entry || !['begin','confirm','uncertain'].includes(operation)) throw new Error('Unknown desktop delivery.');
  if(operation==='begin') {
    if(entry.status!=='ready') throw new Error('Delivery is already attempted; inspect the chat, never blindly retry.');
    entry.status='sending';entry.at=now.toISOString();
  } else {
    if(entry.status!=='sending' || !evidence?.trim()) throw new Error('Delivery needs pending send state and visible confirmation evidence.');
    entry.status=operation==='confirm'?'sent':'uncertain';entry.evidence=evidence;entry.confirmedAt=now.toISOString();
  }
  return ledger;
}
async function main(){
  const c=config(),a=authorize('send_desktop_alerts',c);
  if(a.desktop?.chatTitle!=='Swoop_OS' || !a.desktop.identityEvidence) throw new Error('Verified Swoop OS desktop destination is missing.');
  const ledgerFile=path.join(DATA_DIR,'deliveries.json'),file=path.join(DATA_DIR,'listings.json');
  const ledger=readJSON(ledgerFile,{}),store=readJSON(file,{}),now=new Date();
  const [operation='prepare',id,...rest]=process.argv.slice(2);
  if(operation==='prepare'){
    let used=Object.values(ledger).filter(e=>['sent','sending','uncertain'].includes(e.status)&&e.at?.slice(0,10)===now.toISOString().slice(0,10)).length;
    const limit=Math.min(5,a.constraints.maxAlertsPerRun,Math.max(0,Math.min(10,a.constraints.maxAlertsPerDay)-used));
    const queue=Object.values(store).filter(l=>eligible(l,c,now)&&!l.alertedAt&&(!ledger[l.id]||ledger[l.id].status==='ready'))
      .sort((x,y)=>y.analysis.score-x.analysis.score).slice(0,limit).map(l=>({id:l.id,text:message(l)}));
    for(const l of queue)ledger[l.id]={status:'ready',route:'desktop',authorizationId:a.id,textHash:digest(l.text)};
    writeJSON(ledgerFile,ledger);writeJSON(path.join(DATA_DIR,'outbox.json'),queue);
    audit(a,'desktop.prepare',{listingIds:queue.map(l=>l.id)});console.log(JSON.stringify(queue,null,2));return;
  }
  if(operation==='begin'){
    const l=store[id];
    if(!l||!eligible(l,c,now)||ledger[id]?.textHash!==digest(message(l)))throw new Error('Listing is no longer eligible or prepared text changed.');
    const used=Object.values(ledger).filter(e=>['sent','sending','uncertain'].includes(e.status)&&e.at?.slice(0,10)===now.toISOString().slice(0,10)).length;
    if(used>=Math.min(10,a.constraints.maxAlertsPerDay))throw new Error('Daily alert limit reached.');
  }
  transition(ledger,id,operation,rest.join(' '),now);writeJSON(ledgerFile,ledger);
  if(operation==='confirm'&&store[id]){store[id].alertedAt=now.toISOString();writeJSON(file,store);}
  audit(a,`desktop.${operation}`,{listingId:id,evidence:operation==='begin'?undefined:rest.join(' ')});
  console.log(JSON.stringify({id,status:ledger[id].status}));
}
if(require.main===module)withLock(main).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={transition};
