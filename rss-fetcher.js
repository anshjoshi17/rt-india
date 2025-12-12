// rss-fetcher.js - Dedicated RSS feed fetching module
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

/* -------------------- RSS Feed Fetcher -------------------- */
async function fetchRSSFeed(feedUrl, maxItems = 10) {
  try {
    console.log(`📡 Fetching LATEST RSS: ${feedUrl}`);

    const response = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let xmlText = await response.text();
    xmlText = sanitizeXml(xmlText);

    const feed = await parser.parseString(xmlText);

    if (!feed.items || feed.items.length === 0) {
      console.warn(`No items in feed: ${feedUrl}`);
      return [];
    }

    let items = feed.items
      .sort((a, b) => {
        const dateA = new Date(a.pubDate || 0);
        const dateB = new Date(b.pubDate || 0);
        return dateB - dateA;
      })
      .slice(0, maxItems);

    console.log(`✅ Fetched ${items.length} LATEST items from RSS: ${feedUrl}`);

    if (items.length > 0) {
      const latestDate = new Date(items[0].pubDate).toLocaleString('hi-IN');
      console.log(`   📅 Latest RSS item: ${latestDate}`);
    }

    return items.map(item => {
      let image = null;

      if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
        image = item.enclosure.url;
      } else if (item['media:content'] && item['media:content'].url) {
        image = item['media:content'].url;
      } else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
        image = item['media:thumbnail'].url;
      } else if (item.content && item.content.includes('<img')) {
        const $ = cheerio.load(item.content);
        const firstImg = $('img').first();
        if (firstImg.length) {
          image = firstImg.attr('src');
        }
      }

      return {
        title: item.title || "No title",
        description: item.contentSnippet || item.description || item.title || "",
        url: item.link || item.guid,
        image: image,
        pubDate: item.pubDate,
        source: feed.title || feedUrl
      };
    });

  } catch (error) {
    console.warn(`❌ Failed to fetch RSS ${feedUrl}:`, error.message);
    return [];
  }
}

/* -------------------- RSS News Sources -------------------- */
const RSS_SOURCES = {
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
  }
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
        console.warn(`   ❌ Failed to fetch ${source.name}:`, error.message);
      }
      
      // Small delay between fetches
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results;
}

/* -------------------- RSS-Specific Normalization -------------------- */
function normalizeRSSArticle(apiArticle, sourceConfig) {
  return {
    title: apiArticle.title || 'No Title',
    description: apiArticle.description || '',
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
  parser
};