const { factsHash } = require('./runtime');
function eligible(l, c, now = new Date()) {
  const s = c.searches.find(s => s.id === l.searchId && s.status === 'active');
  const a = l.analysis;
  const age = +now - Date.parse(l.lastVerified);
  const analysisAge = +now - Date.parse(a?.analyzedAt);
  if (!s || l.status !== 'active' || !a || a.excluded !== false || a.meetsRequirements !== true
      || a.requiresReview !== false || a.photosReviewed !== true || !a.requirementNotes?.trim()
      || !Number.isFinite(a.score) || a.score < Math.max(80, c.alerts.minScoreForAlert ?? 80) || a.score > 100
      || !Number.isFinite(age) || age < 0 || age > 24*3600e3
      || !Number.isFinite(analysisAge) || analysisAge < 0 || analysisAge > 24*3600e3
      || a.factsHash !== factsHash(l)) return false;
  if (/salvage|rebuilt/i.test(l.titleStatus || '')) return false;
  if (!Number.isFinite(l.price) || l.price <= 0 || !Number.isInteger(l.year)
      || !Number.isFinite(l.mileage) || l.mileage < 0) return false;
  if ((s.minPrice != null && l.price < s.minPrice) || (s.maxPrice != null && l.price > s.maxPrice)
      || (s.maxMileage != null && l.mileage > s.maxMileage)
      || (s.yearMin != null && l.year < s.yearMin) || (s.yearMax != null && l.year > s.yearMax)) return false;
  if (s.titleMustMatch && !new RegExp(s.titleMustMatch,'i').test(l.title)) return false;
  if (s.titleMustNotMatch && new RegExp(s.titleMustNotMatch,'i').test(l.title)) return false;
  if (!Number.isFinite(a.distanceMiles) || a.distanceMiles < 0 || a.distanceMiles > c.location.radiusMiles || !a.locationEvidence?.trim()) return false;
  return /^\d+$/.test(l.id) && l.url === `https://www.facebook.com/marketplace/item/${l.id}/`;
}
module.exports = { eligible };
