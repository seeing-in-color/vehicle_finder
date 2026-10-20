const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.VEHICLE_FINDER_DATA_DIR || path.join(ROOT, 'data'));
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function config() { return readJSON(path.join(ROOT, 'config/searches.json')); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function factsHash(l) {
  return digest(['title','price','year','mileage','location','description','titleStatus','photoUrls'].map(k => l[k] ?? null));
}
function searchHash(c) { return digest({ location: c.location, searches: c.searches }); }
function authorize(action, c = config(), now = new Date()) {
  const file = process.env.VEHICLE_FINDER_AUTHORIZATION;
  if (!file) throw new Error('Set VEHICLE_FINDER_AUTHORIZATION to the private approved authorization file.');
  const a = readJSON(file);
  if (!a.id || a.app !== 'Vehicle Finder' || a.approvedBy !== 'user' || a.status !== 'active'
      || !Number.isFinite(Date.parse(a.startsAt)) || Date.parse(a.startsAt) > +now
      || (a.expiresAt != null && (!Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= +now))) {
    throw new Error('Vehicle Finder authorization is not active.');
  }
  if (!Number.isInteger(a.constraints?.maxAlertsPerRun) || a.constraints.maxAlertsPerRun < 1 || a.constraints.maxAlertsPerRun > 5
      || !Number.isInteger(a.constraints?.maxAlertsPerDay) || a.constraints.maxAlertsPerDay < 1 || a.constraints.maxAlertsPerDay > 10) throw new Error('Authorization alert limits are missing or outside scope.');
  if (a.delivery?.route === 'telegram_desktop' && ['send_listing_alerts','send_test_message'].includes(action)) throw new Error('Vehicle Finder delivery uses the signed-in Telegram desktop only.');
  if (!a.allowedActions?.includes(action)) throw new Error(`Action outside authorization: ${action}`);
  if (a.searchHash !== searchHash(c)) throw new Error('Search scope changed; update the explicit authorization before running.');
  return a;
}
function audit(a, action, details = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(DATA_DIR, 'audit.jsonl'), JSON.stringify({at:new Date().toISOString(), authorizationId:a.id, approvedRequestId:a.approvedRequestId, action, ...details}) + '\n', { mode:0o600 });
}
async function withLock(fn) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, '.execution.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another run holds the execution lock. Inspect it before recovery.'); throw e; }
  fs.writeFileSync(fd, String(process.pid));
  try { return await fn(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function scrubAIEnvironment() {
  for (const k of Object.keys(process.env)) {
    if (/^(?:OPENAI|AZURE_OPENAI|ANTHROPIC|AI_GATEWAY|LITELLM|OPENROUTER).*(?:KEY|TOKEN|BASE_URL|API_BASE)$/i.test(k)) delete process.env[k];
  }
}
module.exports = {ROOT, DATA_DIR, readJSON, writeJSON, config, digest, factsHash, searchHash, authorize, audit, withLock, scrubAIEnvironment};
