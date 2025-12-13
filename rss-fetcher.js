// rss-fetcher.js - Dedicated RSS feed fetching module (enhanced + extra Uttarakhand feeds)
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

function timeoutFetch(resource, options = {}) {
  const { timeout = 15000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const fetchOptions = {
    ...options,
    signal: controller.signal
  };
  return fetch(resource, fetchOptions)
    .finally(() => clearTimeout(id));
}

/* -------------------- Retry wrapper -------------------- */
async function fetchWithRetries(url, opts = {}, retries = 2, backoffBase = 500) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      const res = await timeoutFetch(url, opts);
      return res;
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > retries) break;
      const wait = backoffBase * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/* -------------------- RSS Feed Fetcher -------------------- */
async function fetchRSSFeed(feedUrl, maxItems = 10) {
  try {
    console.log(`📡 Fetching LATEST RSS: ${feedUrl}`);

    const response = await fetchWithRetries(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*;q=0.1"
      },
      timeout: 15000
    }, 2, 400);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let xmlText = await response.text();
    xmlText = sanitizeXml(xmlText);

    const feed = await parser.parseString(xmlText);

    if (!feed || !feed.items || feed.items.length === 0) {
      console.warn(`No items in feed: ${feedUrl}`);
      return [];
    }

    let items = feed.items
      .sort((a, b) => {
        const dateA = new Date(a.pubDate || a.isoDate || 0);
        const dateB = new Date(b.pubDate || b.isoDate || 0);
        return dateB - dateA;
      })
      .slice(0, maxItems);

    console.log(`✅ Fetched ${items.length} LATEST items from RSS: ${feedUrl}`);

    if (items.length > 0) {
      try {
        const latestDate = new Date(items[0].pubDate || items[0].isoDate).toLocaleString('hi-IN');
        console.log(`   📅 Latest RSS item: ${latestDate}`);
      } catch (e) { /* ignore */ }
    }

    return items.map(item => {
      let image = null;

      // enclosure array or object
      if (item.enclosure && typeof item.enclosure === 'object') {
        const enc = item.enclosure;
        if (Array.isArray(enc)) {
          const found = enc.find(e => e && e.url && e.type && e.type.startsWith('image/'));
          if (found) image = found.url;
        } else if (enc.url && enc.type && String(enc.type).startsWith('image/')) {
          image = enc.url;
        }
      }

      // media:content or media:thumbnail
      if (!image && item['media:content']) {
        const mc = item['media:content'];
        if (Array.isArray(mc)) {
          const m = mc.find(x => x && x.url);
          if (m) image = m.url;
        } else if (mc.url) {
          image = mc.url;
        }
      }

      if (!image && item['media:thumbnail']) {
        const mt = item['media:thumbnail'];
        if (Array.isArray(mt)) {
          const m = mt.find(x => x && x.url);
          if (m) image = m.url;
        } else if (mt.url) {
          image = mt.url;
        }
      }

      // fallback: look into content/html for first <img>
      if (!image && item.content && typeof item.content === 'string' && item.content.includes('<img')) {
        try {
          const $ = cheerio.load(item.content);
          const firstImg = $('img').first();
          if (firstImg.length) {
            image = firstImg.attr('src');
          }
        } catch (e) {
          // ignore parsing errors
        }
      }

      // final fallback: media:group or content:encoded
      if (!image && item['media:group']) {
        const mg = item['media:group'];
        if (Array.isArray(mg) && mg.length > 0) {
          const candidate = mg[0];
          if (candidate['media:content'] && candidate['media:content'].url) image = candidate['media:content'].url;
        }
      }

      return {
        title: item.title || "No title",
        description: item.contentSnippet || item.description || (item.summary || "") || item.title || "",
        url: item.link || item.guid || item.url,
        image: image,
        pubDate: item.pubDate || item.isoDate || null,
        source: (feed && feed.title) ? feed.title : feedUrl,
        raw: item
      };
    });

  } catch (error) {
    console.warn(`❌ Failed to fetch RSS ${feedUrl}:`, error && error.message ? error.message : error);
    return [];
  }
}

/* -------------------- RSS News Sources -------------------- */
/* Keep your earlier sources and append more Uttarakhand-specific feeds here */
const RSS_SOURCES = {
  /* Existing sources (keep these if you already have them) */
  UTTARAKHAND_NEWS18: {
    priority: 1,
    name: "News18 Uttarakhand",
    type: "RSS",
    config: {
      url: "https://hindi.news18.com/rss/uttarakhand/",
      maxItems: 12,
      freshness: "latest"
    }
  },

  UTTARAKHAND_AMARUJALA: {
    priority: 2,
    name: "Amar Ujala Uttarakhand",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/uttarakhand.xml",
      maxItems: 12,
      freshness: "latest"
    }
  },

  INDIA_AAJ_TAK: {
    priority: 3,
    name: "AajTak - India (Hindi)",
    type: "RSS",
    config: {
      url: "https://aajtak.intoday.in/rssfeeds/?id=home",
      maxItems: 15,
      freshness: "latest"
    }
  },

  /* --------- Additional Uttarakhand feeds (recommended additions) --------- */

  DEVBHOOMI_MEDIA: {
    priority: 1,
    name: "Devbhoomi Media",
    type: "RSS",
    config: {
      url: "https://devbhoomimedia.com/feed",
      maxItems: 12,
      freshness: "latest"
    }
  },

  THE_BETTER_INDIA_UTTARAKHAND: {
    priority: 3,
    name: "The Better India — Uttarakhand (tag)",
    type: "RSS",
    config: {
      url: "https://www.thebetterindia.com/tags/uttarakhand/feed",
      maxItems: 10,
      freshness: "latest"
    }
  },

  LIVEHINDUSTAN_SITE: {
    priority: 3,
    name: "Live Hindustan - site RSS",
    type: "RSS",
    config: {
      url: "https://www.livehindustan.com/rss",
      maxItems: 12,
      freshness: "latest"
    }
  },

  AMARUJALA_ALMORA: {
    priority: 4,
    name: "Amar Ujala — Almora",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/almora.xml",
      maxItems: 8,
      freshness: "latest"
    }
  },

  AMARUJALA_NAINITAL: {
    priority: 4,
    name: "Amar Ujala — Nainital",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/nainital.xml",
      maxItems: 8,
      freshness: "latest"
    }
  },

  AMARUJALA_PITHORAGARH: {
    priority: 5,
    name: "Amar Ujala — Pithoragarh",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/pithoragarh.xml",
      maxItems: 6,
      freshness: "latest"
    }
  },

  AMARUJALA_RISHIKESH: {
    priority: 5,
    name: "Amar Ujala — Rishikesh",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/rishikesh.xml",
      maxItems: 6,
      freshness: "latest"
    }
  },

  AMARUJALA_HARIDWAR: {
    priority: 5,
    name: "Amar Ujala — Haridwar",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/haridwar.xml",
      maxItems: 6,
      freshness: "latest"
    }
  }

  /* You can append more city/regional feeds here as needed */
};

/* -------------------- Helper Functions -------------------- */
async function fetchAllRSSFeeds() {
  const results = [];

  for (const [key, source] of Object.entries(RSS_SOURCES)) {
    if (source.type === "RSS") {
      try {
        console.log(`🔍 Fetching RSS: ${source.name}...`);
        const items = await fetchRSSFeed(source.config.url, source.config.maxItems);

        const normalizedItems = items.map(item => ({
          ...item,
          meta: {
            api: "RSS",
            sourceName: source.name,
            isLatest: true,
            priority: source.priority
          }
        }));

        results.push(...normalizedItems);
        console.log(`   ✅ Added ${normalizedItems.length} items from ${source.name}`);
      } catch (error) {
        console.warn(`   ❌ Failed to fetch ${source.name}:`, error && error.message ? error.message : error);
      }

      // Small delay between fetches to reduce load
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/* -------------------- Test / Health helper -------------------- */
/**
 * Test a single feed quickly and return a small diagnostics object
 * Useful for admin routes or CI checks
 */
async function testRSSSource(feedUrl, maxItems = 3) {
  try {
    const items = await fetchRSSFeed(feedUrl, maxItems);
    return {
      url: feedUrl,
      ok: Array.isArray(items) && items.length > 0,
      count: items.length,
      sample: items.slice(0, 3).map(i => ({ title: i.title, url: i.url, pubDate: i.pubDate }))
    };
  } catch (err) {
    return {
      url: feedUrl,
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

/* -------------------- RSS-Specific Normalization -------------------- */
function normalizeRSSArticle(apiArticle, sourceConfig) {
  return {
    title: apiArticle.title || 'No Title',
    description: apiArticle.description || apiArticle.description || '',
    url: apiArticle.url,
    image: apiArticle.image,
    pubDate: apiArticle.pubDate,
    source: apiArticle.source || sourceConfig.name,
    meta: {
      api: "RSS",
      sourceName: sourceConfig.name,
      isLatest: true
    }
  };
}

/* -------------------- Export -------------------- */
module.exports = {
  fetchRSSFeed,
  fetchAllRSSFeeds,
  RSS_SOURCES,
  normalizeRSSArticle,
  parser,
  testRSSSource
};
