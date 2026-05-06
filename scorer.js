
// Call filterAndRankItems(sortedItems, PROCESS_COUNT) in processAllNews()

function scoreItem(item) {
  let score = 0;
  const title = (item.title || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const text = title + " " + desc;

  // +40 for strong Uttarakhand relevance (highest priority)
  const ukKeywords = ["uttarakhand","dehradun","nainital","almora","pithoragarh",
    "rudraprayag","chamoli","pauri","champawat","haridwar","rishikesh",
    "उत्तराखंड","देहरादून","नैनीताल","हरिद्वार"];
  if (ukKeywords.some(k => text.includes(k))) score += 40;

  // +30 for specific high-value categories
  const highValue = ["politics","crime","sports","business","technology","health","environment"];
  const itemGenre = (item.genre || "").toLowerCase();
  if (highValue.some(cat => text.includes(cat) || itemGenre.includes(cat))) score += 30;

  // +20 for freshness (published within last 12 hours)
  const pubDate = new Date(item.pubDate || item.publishedAt || 0);
  const hoursAgo = (Date.now() - pubDate.getTime()) / (1000*60*60);
  if (hoursAgo <= 12) score += 20;
  else if (hoursAgo <= 24) score += 10;

  return score;
}

function filterAndRankItems(items, limit) {
  const scored = items.map(item => ({ ...item, score: scoreItem(item) }));
  const filtered = scored.filter(i => i.score >= 60);   // only high‑value articles
  filtered.sort((a,b) => b.score - a.score);
  return filtered.slice(0, limit);
}

module.exports = { filterAndRankItems };