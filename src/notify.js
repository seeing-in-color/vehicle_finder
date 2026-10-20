#!/usr/bin/env node
// Environment-only Swoop credentials: never read .env or substitute another bot.
const path = require('node:path');
const {DATA_DIR, readJSON, writeJSON, config, authorize, audit, withLock, scrubAIEnvironment} = require('./runtime');
const { eligible } = require('./eligibility');
const LEDGER = path.join(DATA_DIR, 'deliveries.json');
const LISTINGS = path.join(DATA_DIR, 'listings.json');
const clip = (v,n) => String(v ?? '').slice(0,n);
function message(l) {
  const a = l.analysis;
  return [`🚐 Vehicle Finder — ${a.score}/100`,clip(l.title,180),
    `$${l.price.toLocaleString('en-US')} · ${l.mileage.toLocaleString('en-US')} miles · ${clip(l.location,120)}`,
    `${clip(a.grade,2)} condition — ${clip(a.summary,600)}`,
    `Fit: ${clip(a.requirementNotes,450)}`,
    a.redFlags?.length ? `Check: ${clip(a.redFlags.join('; '),450)}` : null,
    l.vin ? `VIN: ${clip(l.vin,17)}` : 'VIN not provided — verify before buying.',
    `Verified ${l.lastVerified}`,l.url].filter(Boolean).join('\n');
}
async function telegram(method, body, env = process.env, request = fetch) {
  let response;
  try {
    response = await request(`https://api.telegram.org/bot${env.SWOOP_TELEGRAM_BOT_TOKEN}/${method}`, {
      method:'POST', redirect:'error', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) {
      const error = new Error(`Telegram ${method} rejected the request (HTTP ${response.status}).`);
      // Only an explicit Telegram rejection is safely retryable. Malformed/unknown
      // responses remain uncertain because sendMessage may have been accepted.
      error.rejected = data.ok === false;
      throw error;
    }
    return data.result;
  } catch (e) {
    const error = new Error(e.rejected ? e.message : `Telegram ${method} outcome is uncertain; inspect the chat before retrying.`);
    error.rejected = e.rejected === true;
    throw error;
  }
}
async function verifyTarget(a, env, request) {
  const t = a.telegram;
  if (!t?.chatId || !t?.botId || !t?.botUsername || t.chatTitle !== 'Swoop_OS'
      || !env.SWOOP_TELEGRAM_BOT_TOKEN || String(env.SWOOP_TELEGRAM_CHAT_ID) !== String(t.chatId)) throw new Error('Exact Swoop bot and destination are not configured.');
  const me = await telegram('getMe',{},env,request);
  const chat = await telegram('getChat',{chat_id:t.chatId},env,request);
  if (String(me.id) !== String(t.botId) || me.username !== t.botUsername || String(chat.id) !== String(t.chatId)
      || chat.title !== t.chatTitle || !['group','supergroup'].includes(chat.type)) throw new Error('Swoop bot/chat identity did not match the approved destination.');
}
async function run({test=false, dryRun=false, env=process.env, request=fetch, now=new Date()} = {}) {
  scrubAIEnvironment();
  const c = config();
  const a = authorize(test ? 'send_test_message' : 'send_listing_alerts', c, now);
  const ledger = readJSON(LEDGER,{});
  const store = readJSON(LISTINGS,{});
  const hot = Object.values(store).filter(l => eligible(l,c,now) && !l.alertedAt && (!ledger[l.id] || ledger[l.id].status === 'rejected'))
    .sort((a,b) => b.analysis.score-a.analysis.score);
  if (dryRun) return {eligible:hot.map(l=>({id:l.id,text:message(l)}))};
  const entries = test ? [{id:'connection-test',text:'✅ Vehicle Finder connection test. Qualifying new listings will be sent here after fresh verification.'}] : hot.map(l=>({id:l.id,text:message(l)}));
  if (!entries.length) return {sent:0};
  await verifyTarget(a,env,request);
  const sentToday = Object.values(ledger).filter(e => ['sent','sending','uncertain'].includes(e.status) && e.at?.slice(0,10)===now.toISOString().slice(0,10)).length;
  const dailyLimit = Math.min(10, a.constraints?.maxAlertsPerDay || 10);
  const runLimit = Math.min(5, a.constraints?.maxAlertsPerRun || 5);
  let sent=0;
  for (const entry of entries.slice(0,Math.max(0,Math.min(runLimit,dailyLimit-sentToday)))) {
    // Recheck pause/revoke/expiry and current search scope immediately before every send.
    authorize(test ? 'send_test_message' : 'send_listing_alerts',config());
    if (ledger[entry.id] && ledger[entry.id].status !== 'rejected') continue;
    ledger[entry.id] = {status:'sending',at:now.toISOString(),authorizationId:a.id,chatId:a.telegram.chatId};
    writeJSON(LEDGER,ledger);
    audit(a,'telegram.send.pending',{listingId:entry.id});
    try {
      const result = await telegram('sendMessage',{chat_id:a.telegram.chatId,text:entry.text,disable_web_page_preview:true},env,request);
      if (!Number.isInteger(result?.message_id) || String(result.chat?.id) !== String(a.telegram.chatId)) throw new Error('Telegram delivery confirmation incomplete.');
      ledger[entry.id] = {...ledger[entry.id],status:'sent',messageId:result.message_id};
      writeJSON(LEDGER,ledger); // Save each success before the next send, even on partial failure.
      if (store[entry.id]) { store[entry.id].alertedAt=now.toISOString(); writeJSON(LISTINGS,store); }
      audit(a,'telegram.send.confirmed',{listingId:entry.id,messageId:result.message_id});
      sent++;
    } catch(e) {
      ledger[entry.id].status = e.rejected ? 'rejected' : 'uncertain';
      writeJSON(LEDGER,ledger);
      audit(a,'telegram.send.'+ledger[entry.id].status,{listingId:entry.id});
      throw e;
    }
  }
  return {sent};
}
if (require.main === module) withLock(()=>run({test:process.argv.includes('--test'),dryRun:process.argv.includes('--dry-run')}))
  .then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{ console.error(e.message); process.exitCode=1; });
module.exports = {message,telegram,verifyTarget,run};
