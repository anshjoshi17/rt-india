// rss-fetcher.js - Dedicated RSS feed fetching module (expanded Hindi feeds)
// Node 18+ assumed (global fetch available)
const RSSParser = require("rss-parser");
const cheerio = require("cheerio");

/* -------------------- RSS Parser -------------------- */
const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: true }],
      ['media:group', 'media:group'],
      ['enclosure', 'enclosure', { keepArray: true }]
    ]
  }
});

/* -------------------- Utils -------------------- */
function sanitizeXml(xml) {
  if (!xml) return xml;
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/g, "&amp;");
}

function safeDate(val) {
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/* -------------------- Default fetch options -------------------- */
const DEFAULT_FETCH_OPTIONS = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  },
  // note: node's fetch accepts signal for timeouts; caller may add AbortController if needed
};

/* -------------------- RSS Feed Fetcher -------------------- */
async function fetchRSSFeed(feedUrl, maxItems = 10) {
  try {
    console.log(`📡 Fetching RSS: ${feedUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(feedUrl, {
      ...DEFAULT_FETCH_OPTIONS,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let xmlText = await response.text();
    xmlText = sanitizeXml(xmlText);

    const feed = await parser.parseString(xmlText);

    if (!feed.items || feed.items.length === 0) {
      console.warn(`⚠️ No items in feed: ${feedUrl}`);
      return [];
    }

    let items = feed.items
      .map(it => {
        // some feeds use isoDate / pubDate / published
        const pubDate = it.isoDate || it.pubDate || it.published || null;
        return { ...it, pubDate };
      })
      .sort((a, b) => {
        const dateA = new Date(a.pubDate || 0);
        const dateB = new Date(b.pubDate || 0);
        return dateB - dateA;
      })
      .slice(0, Math.max(0, Math.min(maxItems, 200))); // cap for safety

    console.log(`   ✅ Fetched ${items.length} items from RSS: ${feed.title || feedUrl}`);

    if (items.length > 0) {
      const latestDate = new Date(items[0].pubDate || Date.now()).toLocaleString('hi-IN');
      console.log(`   📅 Latest RSS item: ${latestDate}`);
    }

    return items.map(item => {
      let image = null;

      try {
        if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
          image = item.enclosure.url;
        } else if (item['media:content'] && item['media:content'].url) {
          image = item['media:content'].url;
        } else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
          image = item['media:thumbnail'].url;
        } else if (item.content && typeof item.content === 'string' && item.content.includes('<img')) {
          const $ = cheerio.load(item.content);
          const firstImg = $('img').first();
          if (firstImg.length) image = firstImg.attr('src');
        }
      } catch (e) {
        // ignore image parse errors
      }

      const link = item.link || item.guid || (item.enclosure && item.enclosure.url) || null;

      return {
        title: item.title || "No title",
        description: item.contentSnippet || item.description || item.summary || "",
        url: typeof link === 'object' && link['#'] ? link['#'] : link,
        image: image,
        pubDate: item.pubDate ? safeDate(item.pubDate) : new Date().toISOString(),
        source: feed.title || feedUrl,
        raw: item
      };
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`❌ Timeout fetching RSS ${feedUrl}`);
    } else {
      console.warn(`❌ Failed to fetch RSS ${feedUrl}:`, error.message || error);
    }
    return [];
  }
}

/* -------------------- RSS NEWS SOURCES (expanded Hindi + Uttarakhand + categories) -------------------- */
const RSS_SOURCES = {
  /* ---------------- Region-first: Uttarakhand & city feeds ---------------- */
  AMARU_UTTARAKHAND: {
    priority: 1,
    name: "Amar Ujala - Uttarakhand",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/uttarakhand.xml", maxItems: 25, freshness: "latest" }
  },
  AMARU_DEHRADUN: {
    priority: 1,
    name: "Amar Ujala - Dehradun",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/dehradun.xml", maxItems: 18, freshness: "latest" }
  },
  AMARU_NAINITAL: {
    priority: 1,
    name: "Amar Ujala - Nainital",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/nainital.xml", maxItems: 15, freshness: "latest" }
  },
  AMARU_ALMORA: {
    priority: 1,
    name: "Amar Ujala - Almora",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/almora.xml", maxItems: 12, freshness: "latest" }
  },
  AMARU_PITHORAGARH: {
    priority: 1,
    name: "Amar Ujala - Pithoragarh",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/pithoragarh.xml", maxItems: 12, freshness: "latest" }
  },
  AMARU_RUDRAPRAYAG: {
    priority: 1,
    name: "Amar Ujala - Rudraprayag",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/rudraprayag.xml", maxItems: 12, freshness: "latest" }
  },
  AMARU_CHAMOLI: {
    priority: 1,
    name: "Amar Ujala - Chamoli",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/chamoli.xml", maxItems: 12, freshness: "latest" }
  },
  AMARU_HARIDWAR: {
    priority: 1,
    name: "Amar Ujala - Haridwar",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/haridwar.xml", maxItems: 12, freshness: "latest" }
  },
  AMARU_RISHIKESH: {
    priority: 1,
    name: "Amar Ujala - Rishikesh",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/rishikesh.xml", maxItems: 12, freshness: "latest" }
  },

  /* ---------------- National hubs & major Hindi publishers ---------------- */
  AAJTAK_HOME: {
    priority: 2,
    name: "AajTak - Home (RSS hub)",
    type: "RSS",
    config: { url: "https://aajtak.intoday.in/rssfeeds/?id=home", maxItems: 30, freshness: "latest" }
  },
  NEWS18_HINDI_GENERAL: {
    priority: 3,
    name: "News18 Hindi - General",
    type: "RSS",
    config: { url: "https://hindi.news18.com/rss/", maxItems: 30, freshness: "latest" }
  },
  NEWS18_UTTARAKHAND: {
    priority: 3,
    name: "News18 Hindi - Uttarakhand",
    type: "RSS",
    config: { url: "https://hindi.news18.com/rss/uttarakhand/", maxItems: 20, freshness: "latest" }
  },
  LIVEHINDUSTAN_HUB: {
    priority: 4,
    name: "Live Hindustan - RSS hub",
    type: "RSS",
    config: { url: "https://www.livehindustan.com/rss", maxItems: 30, freshness: "latest" }
  },
  ONEINDIA_HINDI_INDIAN: {
    priority: 4,
    name: "OneIndia Hindi - India",
    type: "RSS",
    config: { url: "https://hindi.oneindia.com/rss/feeds/hindi-india-fb.xml", maxItems: 25, freshness: "latest" }
  },
  ONEINDIA_SPORTS: {
    priority: 5,
    name: "OneIndia - Sports (Hindi)",
    type: "RSS",
    config: { url: "https://hindi.oneindia.com/rss/feeds/hindi-sports-fb.xml", maxItems: 30, freshness: "latest" }
  },
  ONEINDIA_BUSINESS: {
    priority: 5,
    name: "OneIndia - Business (Hindi)",
    type: "RSS",
    config: { url: "https://hindi.oneindia.com/rss/feeds/hindi-business-fb.xml", maxItems: 25, freshness: "latest" }
  },
  AMARU_SPORTS: {
    priority: 6,
    name: "Amar Ujala - Sports",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/sports.xml", maxItems: 40, freshness: "latest" }
  },
  AMARU_BUSINESS: {
    priority: 6,
    name: "Amar Ujala - Business",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/business.xml", maxItems: 30, freshness: "latest" }
  },
  AMARU_CRICKET: {
    priority: 6,
    name: "Amar Ujala - Cricket",
    type: "RSS",
    config: { url: "https://www.amarujala.com/rss/cricket.xml", maxItems: 40, freshness: "latest" }
  },

  NDTV_RSS_HUB: {
    priority: 7,
    name: "NDTV - RSS hub",
    type: "RSS",
    config: { url: "https://www.ndtv.com/rss", maxItems: 30, freshness: "latest" }
  },
  ZEE_NEWS_RSS: {
    priority: 8,
    name: "Zee News - RSS hub",
    type: "RSS",
    config: { url: "https://zeenews.india.com/rss.html", maxItems: 25, freshness: "latest" }
  },

  /* ---------------- Other popular Hindi publishers (useful coverage) ---------------- */
  BBC_WORLD_ASIA: {
    priority: 20,
    name: "BBC - World/Asia (English; rewrite to Hindi)",
    type: "RSS",
    config: { url: "http://feeds.bbci.co.uk/news/world/asia/rss.xml", maxItems: 15, freshness: "latest" }
  },
  /* NOTE: Add more publishers below as you discover/verify their feed URLs */
  /* e.g., Dainik Jagran, Dainik Bhaskar, Jansatta, Navbharat Times, TV9 Hindi, BBC Hindi etc. */
};

/* -------------------- Helper: fetchAllRSSFeeds (with dedupe & normalization) -------------------- */
async function fetchAllRSSFeeds({ sources = RSS_SOURCES, maxPerSource = 12, delayMs = 500 } = {}) {
  const results = [];
  const seenUrls = new Set();

  const entries = Object.entries(sources)
    .map(([key, s]) => ({ key, ...s }))
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));

  for (const src of entries) {
    if (!src || src.type !== "RSS") continue;

    const url = src.config?.url;
    if (!url) continue;

    try {
      console.log(`🔍 Fetching RSS source: ${src.name} (${url})`);
      const items = await fetchRSSFeed(url, src.config?.maxItems || maxPerSource);

      const normalizedItems = items.map(item => {
        const article = normalizeRSSArticle(item, src);
        article.meta = {
          api: "RSS",
          sourceKey: src.key,
          sourceName: src.name,
          priority: src.priority || 999,
          isLatest: true
        };
        return article;
      });

      // dedupe by URL
      for (const it of normalizedItems) {
        const u = it.url || (it.raw && it.raw.link) || null;
        if (!u) continue;
        if (seenUrls.has(u)) continue;
        seenUrls.add(u);
        results.push(it);
      }

      console.log(`   ✅ Added ${normalizedItems.length} items from ${src.name} (deduped to ${results.length} total)`);

    } catch (err) {
      console.warn(`   ❌ Error fetching source ${src.name}:`, err.message || err);
    }

    // small delay so we don't hammer sources
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  // sort final results by pubDate desc
  results.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  return results;
}

/* -------------------- RSS-Specific Normalization -------------------- */
function normalizeRSSArticle(apiArticle, sourceConfig = {}) {
  const url = apiArticle.url || (apiArticle.raw && (apiArticle.raw.link || apiArticle.raw.guid)) || null;
  const title = (apiArticle.title || "No Title").toString().trim();
  const description = (apiArticle.description || apiArticle.contentSnippet || "").toString().trim();
  const pubDate = apiArticle.pubDate ? safeDate(apiArticle.pubDate) : new Date().toISOString();
  const image = apiArticle.image || null;

  return {
    title,
    description,
    url,
    image,
    pubDate,
    source: sourceConfig.name || apiArticle.source || "rss",
    raw: apiArticle.raw || null,
    meta: {
      api: "RSS",
      sourceName: sourceConfig.name || apiArticle.source || "rss",
      isLatest: true
    }
  };
}

/* -------------------- Utilities -------------------- */
function listSources(sources = RSS_SOURCES) {
  return Object.entries(sources).map(([key, val]) => ({
    key,
    name: val.name,
    url: val.config?.url,
    priority: val.priority,
    type: val.type
  }));
}

function findSourceByName(name, sources = RSS_SOURCES) {
  const k = Object.keys(sources).find(k => (sources[k].name || "").toLowerCase() === (name || "").toLowerCase());
  return k ? { key: k, ...sources[k] } : null;
}

/* -------------------- Export -------------------- */
module.exports = {
  parser,
  fetchRSSFeed,
  fetchAllRSSFeeds,
  normalizeRSSArticle,
  RSS_SOURCES,
  listSources,
  findSourceByName
};
