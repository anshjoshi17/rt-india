// server.js - ENHANCED VERSION: LATEST HINDI NEWS (Uttarakhand → National → International)
// Focus: fetch latest live news, rewrite into Hindi, save to Supabase, delete >2 days old

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const RSSParser = require("rss-parser");
const slugify = require("slugify");
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* -------------------- CORS Configuration -------------------- */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://rt-india.com",
  "https://www.rt-india.com",
  "https://rt-india.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173"
];

const extraOrigins = (process.env.ADDITIONAL_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set(DEFAULT_ALLOWED_ORIGINS.concat(extraOrigins)));
const allowAll = String(process.env.CORS_ALLOW_ALL || "false").toLowerCase() === "true";
const allowCredentials = String(process.env.CORS_ALLOW_CREDENTIALS || "false").toLowerCase() === "true";

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowAll) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS: " + origin));
  },
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Cache-Control",
    "Pragma",
    "X-Requested-With",
    "Origin",
    "X-CSRF-Token"
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  credentials: allowCredentials,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

/* -------------------- Supabase -------------------- */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* -------------------- NEWS SOURCES (LATEST, HINDI FOCUS) -------------------- */
const NEWS_SOURCES = {
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

  INDIA_GNEWS_HI: {
    priority: 4,
    name: "GNews India (Hindi)",
    type: "GNEWS",
    config: {
      q: "भारत OR India",
      lang: "hi",
      country: "in",
      max: 15,
      sortby: "publishedAt"
    }
  },

  INTERNATIONAL_GNEWS: {
    priority: 5,
    name: "International News (GNews)",
    type: "GNEWS",
    config: {
      q: "world OR international",
      lang: "en", // fetch in English, then rewrite to Hindi
      max: 10,
      sortby: "publishedAt"
    }
  },

  INTERNATIONAL_NEWSAPI: {
    priority: 6,
    name: "World News (NewsAPI)",
    type: "NEWSAPI",
    config: {
      q: "world OR international",
      language: "en",
      pageSize: 10,
      sortBy: "publishedAt",
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }
  }
};

/* -------------------- Utils -------------------- */
function makeSlug(text) {
  return (
    slugify(String(text || "").slice(0, 120), { lower: true, strict: true }) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

function sanitizeXml(xml) {
  if (!xml) return xml;
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/g, "&amp;");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------- Advanced Concurrency Queue -------------------- */
const MAX_CONCURRENT_TASKS = Number(process.env.MAX_CONCURRENT_TASKS) || 5;
let runningTasks = 0;
const taskQueue = [];

function enqueueTask(fn) {
  return new Promise((resolve, reject) => {
    taskQueue.push({ fn, resolve, reject });
    processNextTask();
  });
}

function processNextTask() {
  if (runningTasks >= MAX_CONCURRENT_TASKS || taskQueue.length === 0) return;

  const task = taskQueue.shift();
  runningTasks++;

  task.fn()
    .then(task.resolve)
    .catch(task.reject)
    .finally(() => {
      runningTasks--;
      setImmediate(processNextTask);
    });
}

/* -------------------- Default Images -------------------- */
function getDefaultImage(genre, region) {
  const defaultImages = {
    'Politics': 'https://images.unsplash.com/photo-1551135049-8a33b2fb7f53?w=800&auto=format&fit=crop',
    'Crime': 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&auto=format&fit=crop',
    'Sports': 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&auto=format&fit=crop',
    'Entertainment': 'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?w=800&auto=format&fit=crop',
    'Business': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop',
    'Technology': 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&auto=format&fit=crop',
    'Health': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&auto=format&fit=crop',
    'Environment': 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&auto=format&fit=crop',
    'Education': 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&auto=format&fit=crop',
    'Lifestyle': 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&auto=format&fit=crop',
    'Weather': 'https://images.unsplash.com/photo-1592210454359-9043f067919b?w=800&auto=format&fit=crop',
    'Other': 'https://images.unsplash.com/photo-1588681664899-f142ff2dc9b1?w=800&auto=format&fit=crop'
  };

  if (region === 'uttarakhand') {
    const uttarakhandImages = {
      'Politics': 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&auto=format&fit=crop',
      'Environment': 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop',
      'default': 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'
    };
    return uttarakhandImages[genre] || uttarakhandImages.default;
  }

  return defaultImages[genre] || defaultImages['Other'];
}

/* -------------------- Detection Helpers -------------------- */
const GENRE_CANDIDATES = [
  "Politics",
  "Crime",
  "Sports",
  "Entertainment",
  "Business",
  "Technology",
  "Health",
  "Environment",
  "Education",
  "Lifestyle",
  "Weather",
  "Other"
];

function detectRegionFromText(text, sourceHost = "") {
  const t = (text || "").toLowerCase();
  const s = (sourceHost || "").toLowerCase();
  const uttKeywords = [
    "uttarakhand", "dehradun", "nainital", "almora", "pithoragarh",
    "rudraprayag", "chamoli", "pauri", "champawat", "haridwar", "rishikesh",
    "उत्तराखंड", "देहरादून", "नैनीताल", "हरिद्वार"
  ];
  if (uttKeywords.some((k) => t.includes(k) || s.includes(k))) return "uttarakhand";
  const indiaKeywords = ["india", "delhi", "mumbai", "kolkata", "chennai", "bengaluru", "भारत", "दिल्ली"];
  if (indiaKeywords.some((k) => t.includes(k) || s.includes(k))) return "india";
  return "international";
}

function detectGenreKeyword(text) {
  const t = (text || "").toLowerCase();
  if (/\b(police|murder|accident|crime|arrest|case|court|अपराध|हत्या|चोरी|पुलिस)\b/.test(t)) return "Crime";
  if (/\b(election|minister|congress|bjp|government|mp|mla|politic|चुनाव|राजनीति|सरकार|मंत्री)\b/.test(t)) return "Politics";
  if (/\b(match|score|tournament|cricket|football|player|खेल|क्रिकेट|फुटबॉल)\b/.test(t)) return "Sports";
  if (/\b(movie|film|actor|song|celebrity|bollywood|tv|फिल्म|सिनेमा|अभिनेता)\b/.test(t)) return "Entertainment";
  if (/\b(stock|market|economy|business|company|shares|price|बाजार|शेयर|अर्थव्यवस्था)\b/.test(t)) return "Business";
  if (/\b(tech|ai|software|startup|google|microsoft|apple|तकनीक|कंप्यूटर)\b/.test(t)) return "Technology";
  if (/\b(health|covid|hospital|doctor|disease|vaccine|स्वास्थ्य|डॉक्टर|बीमारी)\b/.test(t)) return "Health";
  if (/\b(climate|forest|river|pollution|environment|wildlife|पर्यावरण|प्रदूषण|जलवायु)\b/.test(t)) return "Environment";
  if (/\b(school|college|education|exam|university|स्कूल|कॉलेज|शिक्षा|परीक्षा)\b/.test(t)) return "Education";
  if (/\b(food|travel|fashion|lifestyle|culture|भोजन|यात्रा|फैशन|संस्कृति)\b/.test(t)) return "Lifestyle";
  if (/\b(weather|rain|storm|flood|temperature|मौसम|बारिश|तूफान|बाढ़)\b/.test(t)) return "Weather";
  return "Other";
}

/* -------------------- REGION KEYWORDS -------------------- */
const REGION_KEYWORDS = {
  uttarakhand: [
    "uttarakhand", "उत्तराखंड", "dehradun", "देहरादून",
    "nainital", "नैनीताल", "almora", "अल्मोड़ा",
    "pithoragarh", "पिथौरागढ़", "rudraprayag", "रुद्रप्रयाग",
    "chamoli", "चमोली", "pauri", "पौड़ी", "champawat", "चम्पावत",
    "haridwar", "हरिद्वार", "rishikesh", "ऋषिकेश"
  ]
};

/* -------------------- ENHANCED NEWS API FUNCTIONS FOR LATEST NEWS -------------------- */

// 1. NEWSAPI.org Integration with LATEST news
async function fetchFromNewsAPI(params) {
  try {
    const { q, language, pageSize, sortBy, from } = params;
    const apiKey = process.env.NEWSAPI_KEY;

    if (!apiKey) {
      console.warn("NEWSAPI_KEY not configured, skipping NewsAPI");
      return [];
    }

    let url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${language || 'hi'}&pageSize=${pageSize || 10}&sortBy=${sortBy || 'publishedAt'}&apiKey=${apiKey}`;

    if (from) {
      url += `&from=${from}`;
    } else {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      url += `&from=${yesterday.split('T')[0]}`;
    }

    console.log(`📡 Fetching LATEST from NewsAPI: ${q} (lang=${language || 'hi'})`);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NewsAPI HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();

    if (data.status !== "ok") {
      console.warn(`NewsAPI error: ${data.message}`);
      return [];
    }

    let articles = data.articles || [];
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });

    console.log(`✅ NewsAPI returned ${articles.length} LATEST articles`);

    if (articles.length > 0) {
      const latestDate = new Date(articles[0].publishedAt).toLocaleString('hi-IN');
      console.log(`   📅 Latest article: ${latestDate}`);
    }

    return articles;

  } catch (error) {
    console.warn(`❌ NewsAPI fetch failed:`, error.message);
    return [];
  }
}

// 2. GNews.io Integration with LATEST news
async function fetchFromGNewsAPI(params) {
  try {
    const { q, lang, country, max, sortby } = params;
    const apiKey = process.env.GNEWS_API_KEY;

    if (!apiKey) {
      console.warn("GNEWS_API_KEY not configured, skipping GNews");
      return [];
    }

    const baseUrl = country ?
      `https://gnews.io/api/v4/top-headlines?q=${encodeURIComponent(q)}&lang=${lang || 'hi'}&country=${country}&max=${max || 10}&apikey=${apiKey}` :
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang || 'hi'}&max=${max || 10}&apikey=${apiKey}`;

    let url = baseUrl;
    if (sortby) {
      url += `&sortby=${sortby}`;
    }

    console.log(`📡 Fetching LATEST from GNews: ${q} (lang=${lang || 'hi'})`);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();

    let articles = data.articles || [];

    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });

    console.log(`✅ GNews returned ${articles.length} LATEST articles`);

    if (articles.length > 0) {
      const latestDate = new Date(articles[0].publishedAt).toLocaleString('hi-IN');
      console.log(`   📅 Latest article: ${latestDate}`);
    }

    return articles;

  } catch (error) {
    console.warn(`❌ GNews fetch failed:`, error.message);
    return [];
  }
}

// 3. RSS Feed Fetcher
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

/* -------------------- Normalization & Content Enhancement -------------------- */
function normalizeArticle(apiArticle, sourceConfig) {
  if (sourceConfig.type === "NEWSAPI") {
    return {
      title: apiArticle.title || 'No Title',
      description: apiArticle.description || apiArticle.content || '',
      url: apiArticle.url,
      image: apiArticle.urlToImage,
      pubDate: apiArticle.publishedAt,
      source: apiArticle.source?.name || sourceConfig.name,
      meta: {
        api: "NEWSAPI",
        sourceName: sourceConfig.name,
        isLatest: true
      }
    };
  } else if (sourceConfig.type === "GNEWS") {
    return {
      title: apiArticle.title || 'No Title',
      description: apiArticle.description || apiArticle.content || '',
      url: apiArticle.url,
      image: apiArticle.image,
      pubDate: apiArticle.publishedAt,
      source: apiArticle.source?.name || sourceConfig.name,
      meta: {
        api: "GNEWS",
        sourceName: sourceConfig.name,
        isLatest: true
      }
    };
  } else {
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
}

/* -------------------- CONTENT ENHANCEMENT FUNCTIONS -------------------- */
async function fetchArticleBody(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
      timeout: 20000
    });

    if (!res.ok) {
      console.log(`❌ Failed to fetch ${url}: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    $('script, style, nav, footer, header, aside, .sidebar, .advertisement, .ads, .social-share').remove();

    const contentSelectors = [
      'article',
      '.article-body',
      '.story-body',
      '.story-content',
      '.entry-content',
      '.post-content',
      '.td-post-content',
      '.news-detail',
      '.wp-block-post-content',
      '#content',
      '.ArticleBody',
      '.cn__content',
      '.story-section',
      '.article-container',
      'main',
      '.content-area'
    ];

    let mainContent = '';
    let contentElement = null;

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        const wordCount = text.split(/\s+/).length;

        if (wordCount > 200) {
          contentElement = element;
          mainContent = text;
          break;
        }
      }
    }

    if (!contentElement || mainContent.length < 1000) {
      const paragraphs = [];
      $('p, h2, h3').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 50 &&
            !text.includes('©') &&
            !text.includes('Copyright') &&
            !text.includes('ADVERTISEMENT')) {
          paragraphs.push(text);
        }
      });

      mainContent = paragraphs.join('\n\n');
    }

    mainContent = mainContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return mainContent.length > 500 ? mainContent : null;

  } catch (e) {
    console.warn(`❌ Failed to fetch article from ${url}:`, e.message);
    return null;
  }
}

async function extractVideosFromArticle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      timeout: 15000
    });

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const videos = [];

    $('blockquote.twitter-tweet').each((i, elem) => {
      const tweetLink = $(elem).find('a').attr('href');
      if (tweetLink && tweetLink.includes('twitter.com')) {
        const tweetIdMatch = tweetLink.match(/status\/(\d+)/);
        if (tweetIdMatch) {
          const tweetId = tweetIdMatch[1];
          videos.push({
            type: 'twitter',
            id: tweetId,
            embed_url: `https://twitter.com/i/status/${tweetId}`,
            embed_code: `<blockquote class="twitter-tweet"><a href="https://twitter.com/i/status/${tweetId}">Tweet</a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`
          });
        }
      }
    });

    $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src) {
        videos.push({
          type: 'youtube',
          url: src,
          embed_code: `<iframe src="${src}" frameborder="0" allowfullscreen></iframe>`
        });
      }
    });

    return videos.length > 0 ? videos : null;

  } catch (error) {
    console.warn(`❌ Failed to extract videos from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- AI RESPONSE CLEANUP & PARSING -------------------- */
function sanitizeAIText(text) {
  if (!text) return "";
  let t = String(text);

  t = t.replace(/\u0000/g, '');
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  t = t.replace(/\{(?:[^{}]|"(?:\\.|[^"\\])*")*\}/g, (m) => {
    if (/\b(_id|slug|type|status|category|title_hn|_source|_rev|_meta)\b/i.test(m)) return '\n';
    if (m.length > 120) return '\n';
    return '';
  });

  t = t.replace(/<script[\s\S]*?<\/script>/gi, '')
       .replace(/<style[\s\S]*?<\/style>/gi, '')
       .replace(/<\/?[^>]+(>|$)/g, '');

  t = t.replace(/(यह समाचार (आजकल|वर्तमान में) (चर्चा में|प्रचलित) (है|रहा है)[\s\S]*?)(\n|$)/gi, '\n');
  t = t.replace(/\b(This news|This article|According to sources)[\s\S]*?(\n|$)/gi, '\n');

  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.trim();

  return t;
}

function extractJSONIfAny(text) {
  if (!text) return null;
  const RE = /\{(?:[^{}]|"(?:\\.|[^"\\])*")*\}/g;
  let m;
  while ((m = RE.exec(text)) !== null) {
    const candidate = m[0];
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && (parsed.title || parsed.content || parsed.article || parsed.body)) {
        return parsed;
      }
    } catch (e) {
      // not valid JSON, continue
    }
  }
  return null;
}

function cleanupBoilerplate(text, titleCandidate = '') {
  let t = text || '';
  t = t.replace(/^(Title|शीर्षक|Title:|Title -|Title—|शीर्षक:)\s*/i, '');

  if (titleCandidate && t.startsWith(titleCandidate)) {
    t = t.slice(titleCandidate.length).trim();
    t = t.replace(/^[:\-\–\—\s]+/, '').trim();
  }

  t = t.split('\n').filter(line => {
    if (/^\s*(slug|_id|type|status|category|tags|author|date|title_hn)\s*[:=]/i.test(line)) return false;
    if (/^https?:\/\/\S+\/(wp-content|uploads|cdn)/i.test(line)) return false;
    return true;
  }).join('\n');

  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function enforceHindiOnly(text) {
  if (!text) return text;
  return text.replace(/[^ \n\u0900-\u097F0-9.,।—\-–:;()"?'?\/%&]/g, '');
}

function parseAIResponse(aiOutput) {
  let raw = aiOutput || '';
  if (typeof raw !== 'string') raw = String(raw);

  raw = raw.replace(/\u0000/g, '').trim();

  const jsonObj = extractJSONIfAny(raw);
  if (jsonObj) {
    const title = (jsonObj.title || jsonObj.headline || jsonObj.title_hn || '').toString().trim();
    let content = (jsonObj.content || jsonObj.article || jsonObj.body || jsonObj.text || '').toString().trim();

    if (!content) {
      const collect = (o) => {
        if (!o) return '';
        if (typeof o === 'string') return o;
        if (Array.isArray(o)) return o.map(collect).join('\n\n');
        if (typeof o === 'object') return Object.values(o).map(collect).join('\n\n');
        return '';
      };
      content = collect(jsonObj).trim();
      if (title) {
        content = content.replace(new RegExp(escapeRegExp(title)), '').trim();
      }
    }

    content = sanitizeAIText(content);
    content = cleanupBoilerplate(content, title);

    return {
      title: (title || '').substring(0, 240).trim(),
      content: content
    };
  }

  let cleaned = sanitizeAIText(raw);
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);

  let title = '';
  let content = cleaned;

  if (lines.length > 0) {
    const first = lines[0];
    if (first.length > 8 && first.length < 200 && /[।.?!]$/.test(first) === false) {
      title = first;
      content = cleaned.replace(first, '').trim();
      content = content.replace(/^[:\-\–\—\s]+/, '').trim();
    } else {
      const candidate = lines.find(l => l.length > 10 && l.length < 220 && l.split(' ').length < 20);
      if (candidate) {
        title = candidate;
        content = cleaned.replace(candidate, '').trim();
      }
    }
  }

  if (!content) content = cleaned;

  if (title) {
    content = cleanupBoilerplate(content, title);
  } else {
    const sentenceMatch = content.match(/^(.*?[\।\.\?!])\s/);
    if (sentenceMatch) {
      title = sentenceMatch[1].slice(0, 200).replace(/[\r\n]/g, ' ').trim();
      content = content.replace(sentenceMatch[0], '').trim();
    } else {
      title = content.split('\n')[0].slice(0, 200).trim();
      content = content.split('\n').slice(1).join('\n').trim();
    }
  }

  content = cleanupBoilerplate(content, title);
  content = content.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    title: title || '',
    content: content || ''
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------- PARALLEL AI PROVIDERS -------------------- */
async function rewriteWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }

  const systemMsg = `You are an expert Hindi journalist and MUST return output as a single valid JSON object only.
The JSON MUST have exactly two keys: "title" and "content".
- "title": a short Hindi headline (8-120 characters).
- "content": full article in Hindi (Devanagari) with clear paragraphs, minimum 300 words.
DO NOT output any text outside the JSON object. No explanation, no metadata, no markdown, no HTML, no code blocks.
If you cannot produce JSON, return ONLY plain Hindi text for the article content (no metadata).`;

  const userMsg = `शीर्षक: ${title}
स्रोत सार: ${content.substring(0, 2000)}`;

  const body = {
    model: process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg }
    ],
    max_tokens: 1500,
    temperature: 0.2
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rt-india.com",
        "X-Title": "Hindi News Rewriter - Strict JSON"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenRouter API error ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error("OpenRouter returned invalid JSON");

    let modelText = null;
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const c0 = data.choices[0];
      modelText = (c0.message && (c0.message.content || c0.message?.content?.trim())) || c0.text || c0.delta?.content || null;
    }

    if (!modelText) {
      modelText = data.output || data.result || (typeof data === "string" ? data : null);
    }

    if (!modelText) {
      throw new Error("OpenRouter returned empty content");
    }

    return modelText;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error("OpenRouter request timed out");
    }
    throw new Error(`OpenRouter failed: ${err.message || err}`);
  }
}

async function rewriteWithGroq(title, content) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured");
  }

  const systemMsg = `You are an expert Hindi journalist. MUST return output as a single VALID JSON object only.
The JSON MUST have exactly two keys: "title" and "content".
- "title": Hindi headline (8-120 characters).
- "content": Hindi article in Devanagari, clear paragraphs, minimum 300 words.
Return only the JSON object. No extra commentary, no HTML, no metadata, no code fences. If JSON is not possible, return only plain Hindi article text.`;

  const userMsg = `Title: ${title}
Content summary: ${content.substring(0, 2000)}`;

  const body = {
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg }
    ],
    max_tokens: 1500,
    temperature: 0.2
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Groq API error ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Groq returned invalid JSON");

    let modelText = null;
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const c0 = data.choices[0];
      modelText = (c0.message && (c0.message.content || c0.message?.content?.trim())) || c0.text || c0.delta?.content || null;
    }

    if (!modelText) {
      modelText = data.output || data.result || (typeof data === "string" ? data : null);
    }

    if (!modelText) {
      throw new Error("Groq returned empty content");
    }

    return modelText;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error("Groq request timed out");
    }
    throw new Error(`Groq failed: ${err.message || err}`);
  }
}

function generateFallbackHindi(title, content) {
  const baseContent = content.length > 300 ? content.substring(0, 500) : content;

  const templates = [
    `${title} - यह समाचार आजकल चर्चा में बना हुआ है। सूत्रों के अनुसार, ${baseContent}... स्थानीय प्रशासन ने मामले में जांच शुरू कर दी है और शीघ्र ही आधिकारिक बयान जारी किया जाएगा। विशेषज्ञों का मानना है कि यह मामला भविष्य के लिए महत्वपूर्ण सबक देता है। 
    
    इस घटना के बारे में और अधिक जानकारी जुटाई जा रही है। प्रारंभिक जानकारी के अनुसार, यह मामला काफी गंभीर है। अधिकारियों ने तुरंत कार्रवाई करते हुए जांच शुरू की है। स्थानीय निवासियों ने इस मामले पर चिंता जताई है और त्वरित न्याय की मांग की है।`
  ];

  const template = templates[Math.floor(Math.random() * templates.length)];
  return template;
}

async function rewriteWithParallelAI(title, content, hasVideos = false) {
  const providers = [];

  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      fn: () => rewriteWithOpenRouter(title, content),
      timeout: 60000
    });
  }

  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      fn: () => rewriteWithGroq(title, content),
      timeout: 45000
    });
  }

  if (providers.length === 0) {
    const fallbackContent = generateFallbackHindi(title, content);
    const wordCount = fallbackContent.split(/\s+/).length;

    return {
      success: true,
      title: title,
      content: fallbackContent,
      provider: "fallback",
      wordCount: wordCount
    };
  }

  const promises = providers.map(provider => {
    return Promise.race([
      provider.fn().then(result => ({
        success: true,
        result,
        provider: provider.name
      })),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout for ${provider.name}`)), provider.timeout)
      )
    ]).catch(error => ({
      success: false,
      error: error.message,
      provider: provider.name
    }));
  });

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success && result.value.result) {
      const aiContent = result.value.result;

      const parsed = parseAIResponse(aiContent);
      const wordCount = (parsed.content || '').split(/\s+/).filter(Boolean).length;

      if (parsed.content && wordCount >= 250) {
        let finalContent = parsed.content;
        if (hasVideos) {
          finalContent = finalContent + "\n\n[इस खबर से जुड़ा वीडियो भी उपलब्ध है। नीचे वीडियो देखें।]";
        }

        return {
          success: true,
          title: parsed.title || title,
          content: finalContent,
          provider: result.value.provider,
          wordCount: wordCount
        };
      } else {
        console.warn(`AI provider ${result.value.provider} produced too-short content (${wordCount} words) — ignoring`);
      }
    }
  }

  const fallbackContent = generateFallbackHindi(title, content);
  const wordCount = fallbackContent.split(/\s+/).length;

  return {
    success: true,
    title: title,
    content: hasVideos ?
      fallbackContent + "\n\n[इस खबर से जुड़ा वीडियो भी उपलब्ध है।]" :
      fallbackContent,
    provider: "fallback",
    wordCount: wordCount
  };
}

/* -------------------- Fetch Article Image -------------------- */
async function fetchArticleImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      timeout: 10000
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    const imageSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      '.article-img img',
      '.story-img img',
      '.featured-image img',
      '.wp-post-image'
    ];

    let imageUrl = null;

    for (const selector of imageSelectors.slice(0, 2)) {
      const meta = $(selector);
      if (meta.length) {
        const content = meta.attr('content');
        if (content && content.startsWith('http')) {
          imageUrl = content;
          break;
        }
      }
    }

    if (!imageUrl) {
      for (const selector of imageSelectors.slice(2)) {
        const img = $(selector).first();
        if (img.length) {
          const src = img.attr('src') || img.attr('data-src');
          if (src && src.startsWith('http')) {
            imageUrl = src;
            break;
          }
        }
      }
    }

    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        imageUrl = new URL(imageUrl, urlObj.origin).href;
      } catch (e) {
        imageUrl = null;
      }
    }

    return imageUrl;

  } catch (error) {
    console.warn(`❌ Failed to fetch image from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- Fetch Region-First Items (Uttarakhand) -------------------- */
async function fetchRegionFirst(regionKey, maxItems = 20) {
  const keywords = REGION_KEYWORDS[regionKey] || [regionKey];
  const q = keywords.join(" OR ");

  const regionItems = [];

  // 1) Prefer obvious RSS sources for Uttarakhand
  for (const [key, cfg] of Object.entries(NEWS_SOURCES)) {
    try {
      if (cfg.type === "RSS" && (cfg.name || "").toLowerCase().includes("uttarakhand")) {
        const items = await fetchRSSFeed(cfg.config.url, cfg.config.maxItems || maxItems);
        const normalized = items.map(it => {
          const n = normalizeArticle(it, { type: "RSS", name: cfg.name });
          n.meta = { ...(n.meta || {}), region_priority: true, sourceName: cfg.name };
          return n;
        });
        regionItems.push(...normalized);
      }
    } catch (e) {
      console.warn(`Region RSS fetch failed (${cfg.name}):`, e.message);
    }
  }

  // 2) Try GNews focused query for region (Hindi)
  try {
    const gnewsItems = await fetchFromGNewsAPI({ q, lang: "hi", country: "in", max: maxItems, sortby: "publishedAt" });
    const normalized = gnewsItems.map(it => {
      const n = normalizeArticle(it, { type: "GNEWS", name: "GNews (region)" });
      n.meta = { ...(n.meta || {}), region_priority: true, sourceName: n.source || "GNews (region)" };
      return n;
    });
    regionItems.push(...normalized);
  } catch (e) {
    console.warn("Region GNews fetch failed:", e.message);
  }

  // 3) Try NewsAPI for region keywords (fallback)
  try {
    const newsapiItems = await fetchFromNewsAPI({ q, language: "hi", pageSize: maxItems, sortBy: "publishedAt" });
    const normalized = newsapiItems.map(it => {
      const n = normalizeArticle(it, { type: "NEWSAPI", name: "NewsAPI (region)" });
      n.meta = { ...(n.meta || {}), region_priority: true, sourceName: n.source || "NewsAPI (region)" };
      return n;
    });
    regionItems.push(...normalized);
  } catch (e) {
    console.warn("Region NewsAPI fetch failed:", e.message);
  }

  // Sort by date and dedupe by URL
  const unique = [];
  const seen = new Set();
  regionItems
    .sort((a, b) => new Date(b.pubDate || b.publishedAt || 0) - new Date(a.pubDate || a.publishedAt || 0))
    .slice(0, maxItems)
    .forEach(it => {
      if (it.url && !seen.has(it.url)) {
        seen.add(it.url);
        unique.push(it);
      }
    });

  console.log(`   ✅ Region-first fetched ${unique.length} items for ${regionKey}`);
  return unique;
}

/* -------------------- Process Single News Item -------------------- */
async function processNewsItem(item, sourceType = "api") {
  try {
    const { data: existing } = await supabase
      .from("ai_news")
      .select("id")
      .eq("source_url", item.url)
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️ Skipping existing: ${item.title.substring(0, 50)}...`);
      return null;
    }

    console.log(`🔄 Processing: ${item.title.substring(0, 50)}...`);

    let articleContent = item.description || "";
    let articleImage = item.image || null;
    let videos = [];

    if (item.url && sourceType !== "static") {
      try {
        const [fetchedContent, fetchedImage, fetchedVideos] = await Promise.allSettled([
          fetchArticleBody(item.url),
          fetchArticleImage(item.url),
          extractVideosFromArticle(item.url)
        ]);

        if (fetchedContent.status === 'fulfilled' && fetchedContent.value && fetchedContent.value.length > 300) {
          articleContent = fetchedContent.value;
          console.log(`   📝 Fetched ${articleContent.length} chars of content`);
        }

        if (fetchedImage.status === 'fulfilled' && fetchedImage.value) {
          articleImage = fetchedImage.value;
        }

        if (fetchedVideos.status === 'fulfilled' && fetchedVideos.value) {
          videos = fetchedVideos.value;
          console.log(`   🎥 Found ${videos.length} video(s)`);
        }

      } catch (e) {
        console.warn(`❌ Failed to fetch content/image/videos:`, e.message);
      }
    }

    if (!articleContent || articleContent.length < 200) {
      articleContent = item.title + ". " + (item.description || "");
    }

    // Rewrite to Hindi
    const aiResult = await rewriteWithParallelAI(item.title, articleContent, videos.length > 0);

    if (!aiResult.success) {
      console.log(`❌ AI rewrite failed`);
      return null;
    }

    const slug = makeSlug(aiResult.title);
    const fullText = aiResult.title + " " + aiResult.content;
    const genre = detectGenreKeyword(fullText);
    const sourceHost = item.url ? (() => { try { return new URL(item.url).hostname } catch(e){ return "" } })() : "";
    const region = detectRegionFromText(fullText, sourceHost);

    const recordMeta = {
      original_title: item.title,
      source: item.source || sourceType,
      ai_provider: aiResult.provider,
      word_count: aiResult.wordCount,
      image_source: articleImage ? 'scraped' : 'default',
      api_source: item.meta?.api || item.meta?.api_source || "unknown",
      source_name: item.meta?.sourceName || item.source || "unknown",
      has_videos: videos.length > 0,
      videos: videos.length > 0 ? videos : null,
      is_latest: true,
      region_priority: !!item.meta?.region_priority
    };

    const record = {
      title: aiResult.title,
      slug: slug,
      source_url: item.url || "",
      ai_content: aiResult.content,
      short_desc: aiResult.content.substring(0, 250) + "...",
      image_url: articleImage || getDefaultImage(genre, region),
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      region: region,
      genre: genre,
      meta: recordMeta
    };

    const { error } = await supabase.from("ai_news").insert(record);

    if (error) {
      console.error(`❌ Database error:`, error.message);
      return null;
    }

    console.log(`✅ Added: ${aiResult.title.substring(0, 50)}...`);
    console.log(`   📊 ${aiResult.wordCount} words, ${aiResult.provider}`);
    console.log(`   📷 Image: ${record.image_url ? 'Yes' : 'No'}`);
    console.log(`   🎥 Videos: ${videos.length}`);
    console.log(`   📅 Published: ${new Date(record.published_at).toLocaleTimeString('hi-IN')}`);

    return record;

  } catch (error) {
    console.error(`❌ Error processing item:`, error.message);
    return null;
  }
}

/* -------------------- MAIN PROCESSING FUNCTION -------------------- */
const PROCESS_COUNT = Number(process.env.ITEMS_TO_PROCESS) || 18;

async function processAllNews() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 STARTING LATEST HINDI NEWS PROCESSING CYCLE");
  console.log("=".repeat(60));
  console.log("📰 FETCHING LATEST NEWS (Last 24 hours) - Will be rewritten to HINDI");
  console.log("=".repeat(60));

  const allItems = [];
  const sourceStats = {};

  const sourcesByPriority = Object.entries(NEWS_SOURCES)
    .map(([key, config]) => ({ key, ...config }))
    .sort((a, b) => a.priority - b.priority);

  console.log(`📊 Processing ${sourcesByPriority.length} sources for LATEST Hindi news...\n`);

  let newestArticleTime = new Date(0);

  // ---- REGION-FIRST: UTTARAKHAND ----
  try {
    console.log("🔎 Fetching region-priority (uttarakhand) items first...");
    const regionItems = await fetchRegionFirst("uttarakhand", 20);
    if (regionItems.length > 0) {
      allItems.push(...regionItems.map(it => {
        it.meta = { ...(it.meta || {}), region_priority: true, sourceName: it.meta?.sourceName || it.source || "region" };
        return it;
      }));
      sourceStats['Uttarakhand (region)'] = regionItems.length;
    } else {
      sourceStats['Uttarakhand (region)'] = 0;
    }
    await sleep(500);
  } catch (e) {
    console.warn("   ❌ Region-first fetch failed:", e.message);
    sourceStats['Uttarakhand (region)'] = 0;
  }

  // ---- THEN PROCESS REMAINING SOURCES BY PRIORITY ----
  for (const source of sourcesByPriority) {
    if ((source.name || "").toLowerCase().includes("uttarakhand")) {
      console.log(`   ⏭️ Skipping (already covered by region-first): ${source.name}`);
      continue;
    }

    try {
      console.log(`🔍 [Priority ${source.priority}] Fetching LATEST ${source.name}...`);

      let rawArticles = [];

      switch (source.type) {
        case "NEWSAPI":
          rawArticles = await fetchFromNewsAPI(source.config);
          break;
        case "GNEWS":
          rawArticles = await fetchFromGNewsAPI(source.config);
          break;
        case "RSS":
          rawArticles = await fetchRSSFeed(source.config.url, source.config.maxItems);
          break;
      }

      rawArticles.sort((a, b) => {
        const dateA = new Date(a.publishedAt || a.pubDate || 0);
        const dateB = new Date(b.publishedAt || b.pubDate || 0);
        return dateB - dateA;
      });

      const normalizedArticles = rawArticles.map(article =>
        normalizeArticle(article, source)
      );

      if (normalizedArticles.length > 0) {
        const articleTime = new Date(normalizedArticles[0].pubDate || normalizedArticles[0].published_at || 0);
        if (articleTime > newestArticleTime) {
          newestArticleTime = articleTime;
        }
      }

      allItems.push(...normalizedArticles);
      sourceStats[source.name] = normalizedArticles.length;

      console.log(`   ✅ Added ${normalizedArticles.length} LATEST articles from ${source.name}`);

      await sleep(1000);

    } catch (error) {
      console.log(`   ❌ Failed to fetch ${source.name}:`, error.message);
      sourceStats[source.name] = 0;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📈 LATEST NEWS STATISTICS:");
  Object.entries(sourceStats).forEach(([name, count]) => {
    console.log(`   ${name}: ${count} articles`);
  });
  console.log(`📊 TOTAL LATEST ITEMS FETCHED: ${allItems.length}`);

  if (newestArticleTime > new Date(0)) {
    console.log(`📅 NEWEST ARTICLE TIME: ${newestArticleTime.toLocaleString('hi-IN')}`);
  }

  // Deduplicate by URL
  const uniqueItems = [];
  const seenUrls = new Set();

  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }

  console.log(`📊 UNIQUE LATEST ITEMS: ${uniqueItems.length}`);

  const sortedItems = uniqueItems.sort((a, b) => {
    const dateA = new Date(a.pubDate || a.published_at || 0);
    const dateB = new Date(b.pubDate || b.published_at || 0);
    return dateB - dateA;
  });

  // Process only the newest PROCESS_COUNT
  const itemsToProcess = sortedItems.slice(0, PROCESS_COUNT);

  console.log(`🔄 Processing ${itemsToProcess.length} NEWEST articles (sorted by date)...\n`);

  itemsToProcess.forEach((item, index) => {
    const date = new Date(item.pubDate || item.published_at || Date.now());
    console.log(`   ${index + 1}. ${item.title.substring(0, 60)}... (${date.toLocaleTimeString('hi-IN')})`);
  });

  const processPromises = [];

  for (const item of itemsToProcess) {
    processPromises.push(
      enqueueTask(() => processNewsItem(item, "api"))
    );
  }

  const processedResults = await Promise.allSettled(processPromises);

  const successful = processedResults.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  const failed = processedResults.filter(r => r.status === 'rejected').length;

  console.log("\n" + "=".repeat(60));
  console.log(`🎯 LATEST HINDI NEWS PROCESSING COMPLETE:`);
  console.log(`   ✅ ${successful} NEWEST articles added`);
  console.log(`   ❌ ${failed} articles failed`);
  console.log(`   ⏭️ ${itemsToProcess.length - successful - failed} duplicates skipped`);
  console.log("=".repeat(60) + "\n");

  return successful;
}

/* -------------------- Schedule & Cleanup (2 days retention) -------------------- */
let isProcessing = false;

async function runScheduledProcessing() {
  if (isProcessing) {
    console.log("⚠️  Processing already in progress, skipping...");
    return;
  }

  isProcessing = true;

  try {
    await processAllNews();

    // Cleanup old articles (keep 2 days)
    try {
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const { error, count } = await supabase
        .from("ai_news")
        .delete()
        .lt("created_at", cutoff);

      if (error) {
        console.warn("Cleanup error:", error.message);
      } else {
        console.log(`🧹 Cleanup completed: ${count || 0} old articles (older than 2 days) removed`);
      }
    } catch (cleanupError) {
      console.warn("Cleanup failed:", cleanupError.message);
    }

  } catch (error) {
    console.error("Scheduled processing failed:", error.message);
  } finally {
    isProcessing = false;
  }
}

// Initial run after 5 seconds
setTimeout(runScheduledProcessing, 5000);

// Run frequently for latest news
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 5;
setInterval(runScheduledProcessing, POLL_MINUTES * 60 * 1000);

/* -------------------- Export for API routes -------------------- */
module.exports = {
  app,
  supabase,
  isProcessing,
  runScheduledProcessing,
  NEWS_SOURCES,
  POLL_MINUTES,
  PROCESS_COUNT
};