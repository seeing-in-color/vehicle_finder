#!/usr/bin/env node
/**
 * Telegram notifier. Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from .env
 * (or environment). No-ops with a warning until both are configured.
 *
 * Usage: node src/notify.js            -> alerts for analyzed listings with score >= alerts.minScoreForAlert not yet notified
 *        node src/notify.js --test     -> sends a test message
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

async function send(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram error: ${JSON.stringify(body)}`);
}

async function main() {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env) — skipping alerts.');
    return;
  }

  if (process.argv.includes('--test')) {
    await send(token, chatId, '✅ Vehicle Finder: Telegram alerts are working.');
    console.log('Test message sent.');
    return;
  }

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'searches.json'), 'utf8'));
  const listingsPath = path.join(ROOT, 'data', 'listings.json');
  const store = JSON.parse(fs.readFileSync(listingsPath, 'utf8'));
  const threshold = config.alerts.minScoreForAlert ?? 80;

  const hot = Object.values(store).filter(
    (l) => ['active', 'pending'].includes(l.status) && l.analysis && !l.analysis.excluded
      && l.analysis.score >= threshold && !l.alertedAt,
  );
  if (hot.length === 0) { console.log('No new hot deals to alert.'); return; }

  for (const l of hot.sort((a, b) => b.analysis.score - a.analysis.score)) {
    const vinLine = l.vin
      ? `🔑 VIN: <code>${l.vin}</code>`
      : `🔑 No VIN listed — open the listing and ask the seller for it.`;
    const lines = [
      `🚨 <b>Hot deal (${l.analysis.score}/100)</b> — ${l.title}`,
      `💰 $${l.price?.toLocaleString()}  ·  ${l.mileage ? l.mileage.toLocaleString() + ' mi' : 'mileage n/a'}  ·  ${l.location}`,
      `🔎 ${l.analysis.grade} condition — ${l.analysis.summary}`,
      l.analysis.redFlags?.length ? `⚠️ ${l.analysis.redFlags.join('; ')}` : null,
      vinLine,
      l.url,
    ].filter(Boolean);
    await send(token, chatId, lines.join('\n'));
    l.alertedAt = new Date().toISOString();
  }
  fs.writeFileSync(listingsPath, JSON.stringify(store, null, 2));
  console.log(`Sent ${hot.length} alert(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
