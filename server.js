// server.js - ENHANCED VERSION WITH LATEST NEWS FETCHING
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

/* -------------------- ENHANCED NEWS API CONFIGURATION WITH LATEST NEWS -------------------- */
const NEWS_SOURCES = {
  // PRIORITY 1: LATEST UTTARAKHAND NEWS (Real-time)
  UTTARAKHAND_NEWS18: {
    priority: 1,
    name: "News18 Uttarakhand",
    type: "RSS",
    config: {
      url: "https://hindi.news18.com/rss/uttarakhand/",
      maxItems: 10,
      freshness: "latest"  // RSS feeds usually show latest first
    }
  },
  
  UTTARAKHAND_GNEWS_LATEST: {
    priority: 2,
    name: "GNews Uttarakhand Latest",
    type: "GNEWS",
    config: {
      q: "Uttarakhand OR उत्तराखंड",
      lang: "hi",
      country: "in",
      max: 10,
      sortby: "publishedAt"  // GNews supports sorting
    }
  },
  
  // PRIORITY 2: LATEST NATIONAL NEWS (Real-time)
  INDIA_NEWSAPI_LATEST: {
    priority: 3,
    name: "India National Latest",
    type: "NEWSAPI",
    config: {
      q: "India OR भारत",
      language: "en",
      pageSize: 12,
      sortBy: "publishedAt",  // NewsAPI sorting
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()  // Last 24 hours
    }
  },
  
  INDIA_GNEWS_LATEST: {
    priority: 4,
    name: "India Hindi Latest",
    type: "GNEWS",
    config: {
      q: "India hindi latest",
      lang: "hi",
      country: "in",
      max: 10,
      sortby: "publishedAt"
    }
  },
  
  // PRIORITY 3: LATEST INTERNATIONAL NEWS (Real-time)
  INTERNATIONAL_GNEWS_LATEST: {
    priority: 5,
    name: "International News Latest",
    type: "GNEWS",
    config: {
      q: "world OR international latest",
      lang: "en",
      max: 8,
      sortby: "publishedAt"
    }
  },
  
  INTERNATIONAL_NEWSAPI_LATEST: {
    priority: 6,
    name: "World News Latest",
    type: "NEWSAPI",
    config: {
      q: "world latest",
      language: "en",
      pageSize: 8,
      sortBy: "publishedAt",
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }
  }
};

// Legacy RSS feeds for fallback (already show latest first)
const UTTRAKHAND_FEEDS = [
  "https://www.amarujala.com/rss/uttarakhand.xml",
  "https://zeenews.india.com/hindi/rss/state/uttarakhand.xml"
];

const INDIA_FEEDS = [
  "https://feeds.feedburner.com/ndtvkhabar",
  "https://aajtak.intoday.in/rssfeeds/?id=home"
];

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
  
  // Uttarakhand specific images
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
    
    // NewsAPI free tier only supports 'everything' endpoint with certain limitations
    let url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${language}&pageSize=${pageSize}&sortBy=${sortBy || 'publishedAt'}&apiKey=${apiKey}`;
    
    // Add date filter for latest news (last 24 hours)
    if (from) {
      url += `&from=${from}`;
    } else {
      // Default: last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      url += `&from=${yesterday.split('T')[0]}`;
    }
    
    console.log(`📡 Fetching LATEST from NewsAPI: ${q} (${sortBy || 'publishedAt'})`);
    
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
    
    // Sort by date (newest first) if not already sorted
    let articles = data.articles || [];
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });
    
    console.log(`✅ NewsAPI returned ${articles.length} LATEST articles`);
    
    // Log timestamps of fetched articles
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
    
    // GNews API v4 endpoint with sorting
    const baseUrl = country ? 
      `https://gnews.io/api/v4/top-headlines?q=${encodeURIComponent(q)}&lang=${lang}&country=${country}&max=${max || 10}&apikey=${apiKey}` :
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&max=${max || 10}&apikey=${apiKey}`;
    
    // Add sorting if specified
    let url = baseUrl;
    if (sortby) {
      url += `&sortby=${sortby}`;
    }
    
    console.log(`📡 Fetching LATEST from GNews: ${q} (${lang}, sort: ${sortby || 'relevance'})`);
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }
    
    const data = await response.json();
    
    // GNews returns articles in 'articles' property
    let articles = data.articles || [];
    
    // Sort by date (newest first)
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });
    
    console.log(`✅ GNews returned ${articles.length} LATEST articles`);
    
    // Log timestamps
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

// 3. RSS Feed Fetcher (already shows latest first)
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
    
    // RSS feeds typically show latest first, but we'll sort just in case
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
      // Extract image from various RSS formats
      let image = null;
      
      if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
        image = item.enclosure.url;
      } else if (item['media:content'] && item['media:content'].url) {
        image = item['media:content'].url;
      } else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
        image = item['media:thumbnail'].url;
      } else if (item['media:group'] && item['media:group']['media:content']) {
        const mediaContent = item['media:group']['media:content'];
        if (Array.isArray(mediaContent)) {
          const img = mediaContent.find(m => m.medium === 'image' || m.type?.startsWith('image/'));
          image = img?.url || mediaContent[0]?.url;
        } else if (mediaContent.url) {
          image = mediaContent.url;
        }
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

// 4. Normalize articles from different sources to common format
function normalizeArticle(apiArticle, sourceConfig) {
  // Handle different API response formats
  
  if (sourceConfig.type === "NEWSAPI") {
    // NewsAPI format
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
    // GNews format
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
    // RSS format
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

// Enhanced Article Content Fetcher
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
    
    // Remove unwanted elements
    $('script, style, nav, footer, header, aside, .sidebar, .advertisement, .ads, .social-share').remove();
    
    // Common content selectors
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

// Extract Videos from Article
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
    
    // Extract Twitter videos/embeds
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
    
    // Extract YouTube videos
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

/* -------------------- PARALLEL AI PROVIDERS (300+ words) -------------------- */

// 1. OpenRouter Provider
async function rewriteWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }
  
  const prompt = `तुम एक अनुभवी हिंदी पत्रकार हो। निम्नलिखित समाचार को कम से कम 300-400 शब्दों में विस्तार से हिंदी में रीराइट करो। 

निम्नलिखित दिशानिर्देशों का पालन करें:
1. विस्तृत और जानकारीपूर्ण लेख लिखें (कम से कम 300 शब्द)
2. केवल हिंदी में लिखें, अंग्रेजी नहीं
3. समाचार को संपूर्ण विवरण दें
4. तथ्यात्मक और आकर्षक भाषा का प्रयोग करें
5. यदि मूल लेख में वीडियो है तो उसका उल्लेख करें

शीर्षक: ${title}

मुख्य जानकारी: ${content.substring(0, 1000)}`;
  
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://rt-india.com",
      "X-Title": "Hindi News Rewriter"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free",
      messages: [{
        role: "user",
        content: prompt
      }],
      max_tokens: 1500,
      temperature: 0.4
    }),
    timeout: 60000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 400) {
    throw new Error("OpenRouter returned empty or too short content");
  }
  
  return aiContent;
}

// 2. Groq Provider
async function rewriteWithGroq(title, content) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured");
  }
  
  const prompt = `You are an expert Hindi journalist. Rewrite the following news in Hindi with at least 300-400 words. 

Guidelines:
1. Write detailed, informative article (minimum 300 words)
2. Write only in Hindi Devanagari script
3. Provide complete details and context
4. Use factual and engaging language
5. Mention if there are videos in the original article

Title: ${title}

Content: ${content.substring(0, 1000)}`;
  
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages: [{
        role: "user",
        content: prompt
      }],
      max_tokens: 1500,
      temperature: 0.4
    }),
    timeout: 40000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 400) {
    throw new Error("Groq returned empty or too short content");
  }
  
  return aiContent;
}

// 3. Enhanced Fallback Generator
function generateFallbackHindi(title, content) {
  const baseContent = content.length > 300 ? content.substring(0, 500) : content;
  
  const templates = [
    `${title} - यह समाचार आजकल चर्चा में बना हुआ है। सूत्रों के अनुसार, ${baseContent}... स्थानीय प्रशासन ने मामले में जांच शुरू कर दी है और शीघ्र ही आधिकारिक बयान जारी किया जाएगा। विशेषज्ञों का मानना है कि यह मामला भविष्य के लिए महत्वपूर्ण सबक देता है। 
    
    इस घटना के बारे में और अधिक जानकारी जुटाई जा रही है। प्रारंभिक जानकारी के अनुसार, यह मामला काफी गंभीर है। अधिकारियों ने तुरंत कार्रवाई करते हुए जांच शुरू की है। स्थानीय निवासियों ने इस मामले पर चिंता जताई है और त्वरित न्याय की मांग की है।`
  ];
  
  const template = templates[Math.floor(Math.random() * templates.length)];
  return template;
}

/* -------------------- PARALLEL AI PROCESSING -------------------- */
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
      const wordCount = parsed.content.split(/\s+/).length;
      
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

/* -------------------- Helper Functions -------------------- */
function parseAIResponse(aiOutput) {
  if (!aiOutput) return { title: "", content: "" };
  
  const text = aiOutput.trim();
  
  let cleaned = text
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`#\[\]]/g, '')
    .replace(/^(शीर्षक|लेख|समाचार|आर्टिकल|न्यूज़|Title|Article|News):\s*/gi, '')
    .replace(/^(Here is|This is|I have|According to)\s+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  const lines = cleaned.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    return { title: "", content: "" };
  }
  
  let title = lines[0].trim();
  if (title.length > 150) {
    const sentences = title.split(/[।.!?]/);
    title = sentences[0] || title.substring(0, 100);
  }
  
  const content = lines.slice(1).join('\n\n').trim() || lines[0];
  
  return { title, content };
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
    
    const aiResult = await rewriteWithParallelAI(item.title, articleContent, videos.length > 0);
    
    if (!aiResult.success) {
      console.log(`❌ AI rewrite failed`);
      return null;
    }
    
    const slug = makeSlug(aiResult.title);
    const fullText = aiResult.title + " " + aiResult.content;
    const genre = detectGenreKeyword(fullText);
    const sourceHost = item.url ? new URL(item.url).hostname : "";
    const region = detectRegionFromText(fullText, sourceHost);
    
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
      meta: {
        original_title: item.title,
        source: item.source || sourceType,
        ai_provider: aiResult.provider,
        word_count: aiResult.wordCount,
        image_source: articleImage ? 'scraped' : 'default',
        api_source: item.meta?.api || "unknown",
        source_name: item.meta?.sourceName || item.source || "unknown",
        has_videos: videos.length > 0,
        videos: videos.length > 0 ? videos : null,
        is_latest: true  // Mark as latest news
      }
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

/* -------------------- MAIN PROCESSING FUNCTION WITH LATEST NEWS PRIORITY -------------------- */
async function processAllNews() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 STARTING LATEST NEWS PROCESSING CYCLE");
  console.log("=".repeat(60));
  console.log("📰 FETCHING LATEST NEWS ONLY (Last 24 hours)");
  console.log("=".repeat(60));
  
  const allItems = [];
  const sourceStats = {};
  
  const sourcesByPriority = Object.entries(NEWS_SOURCES)
    .map(([key, config]) => ({ key, ...config }))
    .sort((a, b) => a.priority - b.priority);
  
  console.log(`📊 Processing ${sourcesByPriority.length} sources for LATEST news...\n`);
  
  // Track the timestamp of the newest article we find
  let newestArticleTime = new Date(0);
  
  for (const source of sourcesByPriority) {
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
      
      // Sort articles by date (newest first)
      rawArticles.sort((a, b) => {
        const dateA = new Date(a.publishedAt || a.pubDate || 0);
        const dateB = new Date(b.publishedAt || b.pubDate || 0);
        return dateB - dateA;
      });
      
      const normalizedArticles = rawArticles.map(article => 
        normalizeArticle(article, source)
      );
      
      // Track the newest article
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
  
  // Remove duplicates by URL
  const uniqueItems = [];
  const seenUrls = new Set();
  
  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }
  
  console.log(`📊 UNIQUE LATEST ITEMS: ${uniqueItems.length}`);
  
  // Sort ALL items by date (newest first) before processing
  const sortedItems = uniqueItems.sort((a, b) => {
    const dateA = new Date(a.pubDate || a.published_at || 0);
    const dateB = new Date(b.pubDate || b.published_at || 0);
    return dateB - dateA;
  });
  
  // Process only the newest 10-12 articles
  const itemsToProcess = sortedItems.slice(0, 12);
  
  console.log(`🔄 Processing ${itemsToProcess.length} NEWEST articles (sorted by date)...\n`);
  
  // Display what we're processing
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
  console.log(`🎯 LATEST NEWS PROCESSING COMPLETE:`);
  console.log(`   ✅ ${successful} NEWEST articles added`);
  console.log(`   ❌ ${failed} articles failed`);
  console.log(`   ⏭️ ${itemsToProcess.length - successful - failed} duplicates skipped`);
  console.log("=".repeat(60) + "\n");
  
  return successful;
}

/* -------------------- Schedule -------------------- */
let isProcessing = false;

async function runScheduledProcessing() {
  if (isProcessing) {
    console.log("⚠️  Processing already in progress, skipping...");
    return;
  }
  
  isProcessing = true;
  
  try {
    await processAllNews();
    
    // Cleanup old articles (keep 3 days for latest news focus)
    try {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { error, count } = await supabase
        .from("ai_news")
        .delete()
        .lt("created_at", cutoff);
        
      if (error) {
        console.warn("Cleanup error:", error.message);
      } else {
        console.log(`🧹 Cleanup completed: ${count || 0} old articles (older than 3 days) removed`);
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

// Run more frequently for latest news (every 15 minutes)
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 15;
setInterval(runScheduledProcessing, POLL_MINUTES * 60 * 1000);

/* -------------------- API Routes -------------------- */
app.get("/api/news", async (req, res) => {
  try {
    const { limit = 30, genre, region, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    let query = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta", { count: "exact" })
      .order("created_at", { ascending: false })  // Show newest first
      .range(offset, offset + pageSize - 1);

    if (genre && genre !== "All") query = query.eq("genre", genre);
    if (region && region !== "All") query = query.eq("region", region);

    const { data, error, count } = await query;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    res.json({
      success: true,
      data: data || [],
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0
      }
    });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/news/:slug", async (req, res) => {
  try {
    const { data: article, error } = await supabase
      .from("ai_news")
      .select("*")
      .eq("slug", req.params.slug)
      .single();

    if (error || !article) {
      return res.status(404).json({ 
        success: false, 
        error: "Article not found" 
      });
    }

    res.json(article);
    
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (!q.trim()) return res.json({ success: true, data: [] });

    const { data, error } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at")
      .or(`title.ilike.%${q}%,ai_content.ilike.%${q}%,short_desc.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ 
        success: false, 
        error: "Database error",
        details: error.message 
      });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/run-now", async (req, res) => {
  try {
    if (isProcessing) {
      return res.json({ 
        success: false, 
        message: "Processing already in progress" 
      });
    }
    
    res.json({ 
      success: true, 
      message: "Latest news processing started in background" 
    });
    
    runScheduledProcessing();
    
  } catch (error) {
    console.error("Manual run error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ai_news")
      .select("genre, region, created_at, meta")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const stats = {
      total: data?.length || 0,
      byGenre: {},
      byRegion: {},
      byApiSource: {},
      latestArticle: null,
      wordStats: {
        totalWords: 0,
        averageWords: 0
      }
    };

    let latestDate = new Date(0);
    
    data?.forEach(item => {
      stats.byGenre[item.genre] = (stats.byGenre[item.genre] || 0) + 1;
      stats.byRegion[item.region] = (stats.byRegion[item.region] || 0) + 1;
      
      const apiSource = item.meta?.api_source || "unknown";
      stats.byApiSource[apiSource] = (stats.byApiSource[apiSource] || 0) + 1;
      
      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;
      
      // Track latest article
      const itemDate = new Date(item.created_at);
      if (itemDate > latestDate) {
        latestDate = itemDate;
        stats.latestArticle = {
          time: item.created_at,
          age: Math.floor((Date.now() - itemDate.getTime()) / (1000 * 60)) + " minutes ago"
        };
      }
    });

    if (data?.length > 0) {
      stats.wordStats.averageWords = Math.round(stats.wordStats.totalWords / data.length);
    }

    res.json({ success: true, stats });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/health", (req, res) => {
  const providers = [];
  if (process.env.OPENROUTER_API_KEY) providers.push("OpenRouter");
  if (process.env.GROQ_API_KEY) providers.push("Groq");
  
  const apiSources = [];
  if (process.env.NEWSAPI_KEY) apiSources.push("NewsAPI");
  if (process.env.GNEWS_API_KEY) apiSources.push("GNews");
  
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Hindi News AI Rewriter - LATEST NEWS FOCUS",
    version: "7.0",
    features: ["Latest News Only", "300+ Word Articles", "Video Extraction", "Real-time Updates"],
    ai_providers: providers.length > 0 ? providers : ["Fallback"],
    news_apis: apiSources.length > 0 ? apiSources : ["RSS Fallback Only"],
    config: {
      poll_interval: `${POLL_MINUTES} minutes`,
      focus: "Latest news (last 24 hours)",
      cleanup: "3 days retention"
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Hindi News Rewriter API - LATEST NEWS FOCUS",
    version: "7.0",
    description: "Fetching and rewriting only the LATEST news (last 24 hours) with 300+ word articles",
    features: [
      "LATEST NEWS ONLY (last 24 hours focus)",
      "300+ word Hindi articles",
      "Twitter/YouTube video extraction",
      "Real-time news fetching",
      "Priority: Uttarakhand → National → International",
      "Frequent updates (every 15 minutes)",
      "Automatic cleanup (3 days retention)"
    ],
    endpoints: {
      news: "/api/news (shows newest first)",
      article: "/api/news/:slug",
      search: "/api/search",
      stats: "/api/stats",
      sources: "/api/sources",
      health: "/health",
      manual_run: "/api/run-now"
    }
  });
});

/* -------------------- Error Handling -------------------- */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message
  });
});

/* -------------------- Start Server -------------------- */
const PORT = process.env.PORT || 10000;

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
  🚀 SERVER STARTED SUCCESSFULLY!
  ============================================
  Port: ${PORT}
  URL: https://rt-india.onrender.com
  
  🔥 LATEST NEWS CONFIGURATION:
  - Max concurrent tasks: ${MAX_CONCURRENT_TASKS}
  - Poll interval: ${POLL_MINUTES} minutes (FAST!)
  - Focus: LATEST NEWS ONLY (last 24 hours)
  - Priority: Uttarakhand → National → International
  - Retention: 3 days cleanup
  - Features: 300+ words, video extraction
  
  📰 NEWS SOURCES (LATEST FIRST):
  1. News18 Uttarakhand (RSS - Latest)
  2. GNews Uttarakhand (Hindi - Latest)
  3. India National (NewsAPI - Latest 24h)
  4. India Hindi (GNews - Latest)
  5. International (GNews - Latest)
  6. World News (NewsAPI - Latest 24h)
  
  ⚡ SYSTEM FEATURES:
  - Always fetches NEWEST articles first
  - Date sorting on all sources
  - Time-limited queries (last 24 hours)
  - Frequent updates every ${POLL_MINUTES} minutes
  - Real-time news processing
  
  📊 EXPECTED OUTPUT:
  - Only recent news (last 24 hours)
  - 300+ word detailed articles
  - Video extraction when available
  - Fresh content with every run
  
  🚀 Ready to deliver LATEST Hindi news!
  `);
});