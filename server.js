// server.js - ENHANCED VERSION WITH LATEST NEWS FETCHING AND UTTARAKHAND ENDPOINTS
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
      throw new Error(`HTTP ${res.status}`);
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
      .order("published_at", { ascending: false })  // Show newest first based on published date
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
      .order("published_at", { ascending: false })
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

/* -------------------- UTTARAKHAND SPECIFIC ENDPOINTS -------------------- */

// HERO SECTION ENDPOINT - For homepage hero section
app.get("/api/hero-news", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    
    // Step 1: Fetch Uttarakhand news first (priority 1)
    const { data: uttarakhandNews } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("published_at", { ascending: false })
      .limit(Math.ceil(limit * 0.6)); // 60% Uttarakhand

    // Step 2: Fetch National news (priority 2)
    const { data: nationalNews } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
      .or("region.ilike.%india%,region.ilike.%national%,title.ilike.%india%,title.ilike.%भारत%,title.ilike.%राष्ट्रीय%")
      .neq("region", "uttarakhand") // Exclude Uttarakhand
      .order("published_at", { ascending: false })
      .limit(Math.ceil(limit * 0.3)); // 30% National

    // Step 3: Fetch International news (priority 3)
    const { data: internationalNews } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
      .or("region.ilike.%world%,region.ilike.%international%,genre.ilike.%world%,genre.ilike.%international%")
      .order("published_at", { ascending: false })
      .limit(Math.ceil(limit * 0.2)); // 20% International

    // Combine and deduplicate
    const allNews = [...(uttarakhandNews || []), ...(nationalNews || []), ...(internationalNews || [])];
    const uniqueNews = [];
    const seenIds = new Set();

    allNews.forEach(news => {
      if (!seenIds.has(news.id)) {
        seenIds.add(news.id);
        uniqueNews.push(news);
      }
    });

    // Sort by published date (newest first)
    const sortedNews = uniqueNews.sort((a, b) => 
      new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)
    ).slice(0, limit);

    res.json({
      success: true,
      data: sortedNews,
      meta: {
        total: sortedNews.length,
        uttarakhand_count: uttarakhandNews?.length || 0,
        national_count: nationalNews?.length || 0,
        international_count: internationalNews?.length || 0,
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Hero news error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

// Main Uttarakhand news endpoint
app.get("/api/uttarakhand-news", async (req, res) => {
  try {
    const { limit = 30, genre, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    // Build query for Uttarakhand news
    let query = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta", { count: "exact" })
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("published_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (genre && genre !== "all") query = query.eq("genre", genre);

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
      },
      meta: {
        region: "uttarakhand",
        description: "Latest Uttarakhand news from all districts",
        total_news: count || 0,
        updated_at: new Date().toISOString()
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

app.get("/api/uttarakhand/stats", async (req, res) => {
  try {
    // Get Uttarakhand specific stats
    const { data, error } = await supabase
      .from("ai_news")
      .select("genre, created_at, meta, title")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const stats = {
      total: data?.length || 0,
      byGenre: {},
      latestArticle: null,
      sources: {},
      wordStats: {
        totalWords: 0,
        averageWords: 0
      }
    };

    let latestDate = new Date(0);
    const uttarakhandKeywords = [
      "dehradun", "haridwar", "rishikesh", "nainital", "almora",
      "uttarakhand", "गढ़वाल", "कुमाऊं", "देहरादून", "हरिद्वार",
      "मसूरी", "ऋषिकेश", "कोटद्वार", "रुद्रप्रयाग", "चमोली",
      "पौड़ी", "उत्तरकाशी", "टिहरी", "चंपावत", "पिथौरागढ़"
    ];
    
    let relevantCount = 0;

    data?.forEach(item => {
      // Count by genre
      const genre = item.genre || "Other";
      stats.byGenre[genre] = (stats.byGenre[genre] || 0) + 1;
      
      // Count by source
      const sourceName = item.meta?.source_name || "unknown";
      stats.sources[sourceName] = (stats.sources[sourceName] || 0) + 1;
      
      // Word count
      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;
      
      // Check if content is relevant to Uttarakhand
      const content = item.title + " " + (item.meta?.original_title || "");
      const isRelevant = uttarakhandKeywords.some(keyword => 
        content.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isRelevant) relevantCount++;
      
      // Track latest article
      const itemDate = new Date(item.created_at);
      if (itemDate > latestDate) {
        latestDate = itemDate;
        stats.latestArticle = {
          time: item.created_at,
          age: Math.floor((Date.now() - itemDate.getTime()) / (1000 * 60)) + " minutes ago",
          title: item.title.substring(0, 100)
        };
      }
    });

    if (data?.length > 0) {
      stats.wordStats.averageWords = Math.round(stats.wordStats.totalWords / data.length);
      stats.relevance_score = Math.round((relevantCount / data.length) * 100);
    }

    res.json({ 
      success: true, 
      stats,
      districts_coverage: [
        "Dehradun", "Haridwar", "Nainital", "Almora", "Pithoragarh",
        "Chamoli", "Uttarkashi", "Rudraprayag", "Pauri", "Champawat",
        "Bageshwar", "Udham Singh Nagar", "Tehri Garhwal"
      ]
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/uttarakhand/districts/:district", async (req, res) => {
  try {
    const district = req.params.district.toLowerCase();
    
    // District keywords mapping
    const districtKeywords = {
      "dehradun": ["dehradun", "dehra", "देहरादून", "गढ़वाल"],
      "haridwar": ["haridwar", "हरिद्वार", "गंगा", "हर की पौड़ी"],
      "nainital": ["nainital", "नैनीताल", "झील", "भीमताल"],
      "almora": ["almora", "अल्मोड़ा", "कुमाऊं"],
      "rishikesh": ["rishikesh", "ऋषिकेश", "योग", "गंगा"],
      "uttarkashi": ["uttarkashi", "उत्तरकाशी", "गंगोत्री", "यमुनोत्री"],
      "chamoli": ["chamoli", "चमोली", "बद्रीनाथ", "हेमकुंड"],
      "rudraprayag": ["rudraprayag", "रुद्रप्रयाग", "केदारनाथ"],
      "pauri": ["pauri", "पौड़ी", "गढ़वाल", "लैंसडाउन"],
      "pithoragarh": ["pithoragarh", "पिथौरागढ़", "कालापानी"],
      "bageshwar": ["bageshwar", "बागेश्वर"],
      "champawat": ["champawat", "चंपावत", "बनबसा"],
      "tehri": ["tehri", "टिहरी", "गढ़वाल", "धनोल्टी"],
      "udhamsinghnagar": ["udham singh nagar", "उधमसिंह नगर", "काशीपुर", "रुद्रपुर"],
      "all": ["uttarakhand", "उत्तराखंड", "गढ़वाल", "कुमाऊं"]
    };

    const keywords = districtKeywords[district] || [district];

    // Build query with district keywords
    let query = supabase
      .from("ai_news")
      .select("*")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%");
    
    // Add district-specific search if not "all"
    if (district !== "all") {
      const searchConditions = keywords.map(kw => 
        `title.ilike.%${kw}%,ai_content.ilike.%${kw}%,short_desc.ilike.%${kw}%`
      ).join(",");
      query = query.or(searchConditions);
    }
    
    const { data, error } = await query
      .order("published_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    res.json({
      success: true,
      data: data || [],
      district: district,
      count: data?.length || 0,
      keywords: keywords
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

app.get("/api/uttarakhand/breaking", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ai_news")
      .select("title, slug, created_at")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      breaking_news: data || [],
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Breaking news error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

// Serve Uttarakhand news page
app.get("/uttarakhand", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Uttarakhand News | RT-India - उत्तराखंड की ताज़ा खबरें</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@300;400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #1a5276;
                --primary-dark: #154360;
                --secondary: #d35400;
                --accent: #27ae60;
                --light: #f8f9fa;
                --dark: #2c3e50;
                --gray: #7f8c8d;
                --border: #e0e0e0;
                --shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                --shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.12);
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Poppins', 'Noto Sans Devanagari', sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f5f7fa;
            }

            .hindi-text {
                font-family: 'Noto Sans Devanagari', sans-serif;
            }

            /* Header Styles */
            .header {
                background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
                color: white;
                padding: 1rem 0;
                box-shadow: var(--shadow);
                position: sticky;
                top: 0;
                z-index: 1000;
            }

            .header-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .logo {
                display: flex;
                align-items: center;
                gap: 10px;
                text-decoration: none;
                color: white;
            }

            .logo-icon {
                font-size: 2rem;
                color: var(--secondary);
            }

            .logo-text h1 {
                font-size: 1.8rem;
                font-weight: 700;
            }

            .logo-text span {
                font-size: 0.9rem;
                opacity: 0.9;
                font-weight: 300;
            }

            .nav-links {
                display: flex;
                gap: 2rem;
                list-style: none;
            }

            .nav-links a {
                color: white;
                text-decoration: none;
                font-weight: 500;
                font-size: 1.1rem;
                padding: 0.5rem 1rem;
                border-radius: 4px;
                transition: all 0.3s ease;
            }

            .nav-links a:hover {
                background-color: rgba(255, 255, 255, 0.1);
                transform: translateY(-2px);
            }

            .nav-links a.active {
                background-color: var(--secondary);
                color: white;
            }

            /* Uttarakland Hero Section */
            .uttarakhand-hero {
                background: linear-gradient(rgba(26, 82, 118, 0.85), rgba(21, 67, 96, 0.9)), 
                            url('https://images.unsplash.com/photo-1548013146-72479768bada?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80');
                background-size: cover;
                background-position: center;
                color: white;
                padding: 4rem 0;
                text-align: center;
                margin-bottom: 2rem;
            }

            .hero-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
            }

            .hero-title {
                font-size: 3.5rem;
                font-weight: 700;
                margin-bottom: 1rem;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            }

            .hero-subtitle {
                font-size: 1.4rem;
                max-width: 800px;
                margin: 0 auto 2rem;
                opacity: 0.95;
            }

            .stats {
                display: flex;
                justify-content: center;
                gap: 3rem;
                margin-top: 2rem;
            }

            .stat-item {
                text-align: center;
            }

            .stat-number {
                font-size: 2.5rem;
                font-weight: 700;
                color: var(--secondary);
                display: block;
            }

            .stat-label {
                font-size: 1rem;
                opacity: 0.9;
            }

            /* Main Content */
            .main-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px 40px;
                display: grid;
                grid-template-columns: 1fr 300px;
                gap: 2rem;
            }

            /* Filter Section */
            .filter-section {
                background: white;
                padding: 1.5rem;
                border-radius: 12px;
                box-shadow: var(--shadow);
                margin-bottom: 2rem;
                display: flex;
                gap: 1rem;
                align-items: center;
                flex-wrap: wrap;
            }

            .filter-btn {
                padding: 0.5rem 1.5rem;
                border: 2px solid var(--border);
                background: white;
                border-radius: 25px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.3s ease;
            }

            .filter-btn:hover {
                border-color: var(--primary);
                color: var(--primary);
            }

            .filter-btn.active {
                background: var(--primary);
                color: white;
                border-color: var(--primary);
            }

            .refresh-btn {
                background: var(--accent);
                color: white;
                border: none;
                padding: 0.5rem 1.5rem;
                border-radius: 25px;
                cursor: pointer;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.3s ease;
            }

            .refresh-btn:hover {
                background: #219653;
                transform: translateY(-2px);
            }

            /* News Grid */
            .news-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                gap: 2rem;
                margin-bottom: 2rem;
            }

            .news-card {
                background: white;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: var(--shadow);
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
            }

            .news-card:hover {
                transform: translateY(-8px);
                box-shadow: var(--shadow-hover);
            }

            .news-image {
                height: 200px;
                overflow: hidden;
                position: relative;
            }

            .news-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.5s ease;
            }

            .news-card:hover .news-image img {
                transform: scale(1.05);
            }

            .news-content {
                padding: 1.5rem;
                flex-grow: 1;
                display: flex;
                flex-direction: column;
            }

            .news-category {
                display: inline-block;
                background: var(--primary);
                color: white;
                padding: 0.3rem 1rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                margin-bottom: 1rem;
                align-self: flex-start;
            }

            .news-title {
                font-size: 1.3rem;
                font-weight: 600;
                margin-bottom: 1rem;
                line-height: 1.4;
                color: var(--dark);
            }

            .news-desc {
                color: var(--gray);
                margin-bottom: 1.5rem;
                flex-grow: 1;
                font-size: 0.95rem;
            }

            .news-meta {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: auto;
                padding-top: 1rem;
                border-top: 1px solid var(--border);
            }

            .news-source {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
                color: var(--gray);
            }

            .news-time {
                font-size: 0.9rem;
                color: var(--gray);
            }

            .read-more {
                color: var(--secondary);
                text-decoration: none;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                transition: gap 0.3s ease;
            }

            .read-more:hover {
                gap: 10px;
            }

            /* Loading State */
            .loading {
                text-align: center;
                padding: 3rem;
                grid-column: 1 / -1;
            }

            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 5px solid var(--border);
                border-top-color: var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 1rem;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            /* Sidebar */
            .sidebar {
                display: flex;
                flex-direction: column;
                gap: 2rem;
            }

            .sidebar-section {
                background: white;
                border-radius: 12px;
                padding: 1.5rem;
                box-shadow: var(--shadow);
            }

            .section-title {
                font-size: 1.2rem;
                font-weight: 600;
                margin-bottom: 1.5rem;
                padding-bottom: 0.5rem;
                border-bottom: 2px solid var(--primary);
                color: var(--primary);
            }

            .top-districts {
                display: flex;
                flex-wrap: wrap;
                gap: 0.8rem;
            }

            .district-tag {
                padding: 0.5rem 1rem;
                background: #e8f4fc;
                border-radius: 20px;
                font-size: 0.9rem;
                color: var(--primary);
                font-weight: 500;
                transition: all 0.3s ease;
                cursor: pointer;
            }

            .district-tag:hover {
                background: var(--primary);
                color: white;
            }

            .quick-link {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0.8rem;
                border-radius: 8px;
                color: var(--dark);
                text-decoration: none;
                transition: all 0.3s ease;
                margin-bottom: 0.5rem;
            }

            .quick-link:hover {
                background: var(--light);
                color: var(--primary);
                padding-left: 1rem;
            }

            .quick-link i {
                color: var(--primary);
                width: 20px;
            }

            /* Footer */
            .footer {
                background: var(--dark);
                color: white;
                padding: 3rem 0 2rem;
                margin-top: 4rem;
            }

            .footer-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 2rem;
            }

            .footer-section h3 {
                font-size: 1.2rem;
                margin-bottom: 1.5rem;
                color: var(--secondary);
            }

            .footer-links {
                list-style: none;
            }

            .footer-links li {
                margin-bottom: 0.8rem;
            }

            .footer-links a {
                color: #ddd;
                text-decoration: none;
                transition: color 0.3s ease;
            }

            .footer-links a:hover {
                color: var(--secondary);
            }

            .copyright {
                text-align: center;
                padding-top: 2rem;
                margin-top: 2rem;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                color: #aaa;
                font-size: 0.9rem;
            }

            /* Back to Top */
            .back-to-top {
                position: fixed;
                bottom: 30px;
                right: 30px;
                background: var(--primary);
                color: white;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                text-decoration: none;
                box-shadow: var(--shadow);
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
                z-index: 100;
            }

            .back-to-top.visible {
                opacity: 1;
                transform: translateY(0);
            }

            .back-to-top:hover {
                background: var(--primary-dark);
                transform: translateY(-5px);
            }

            /* Responsive Design */
            @media (max-width: 992px) {
                .main-container {
                    grid-template-columns: 1fr;
                }
                
                .hero-title {
                    font-size: 2.8rem;
                }
            }

            @media (max-width: 768px) {
                .header-container {
                    flex-direction: column;
                    gap: 1rem;
                }
                
                .nav-links {
                    gap: 1rem;
                }
                
                .hero-title {
                    font-size: 2.2rem;
                }
                
                .hero-subtitle {
                    font-size: 1.1rem;
                }
                
                .news-grid {
                    grid-template-columns: 1fr;
                }
                
                .stats {
                    flex-direction: column;
                    gap: 1.5rem;
                }
            }

            @media (max-width: 480px) {
                .filter-section {
                    flex-direction: column;
                    align-items: stretch;
                }
                
                .filter-btn, .refresh-btn {
                    width: 100%;
                    text-align: center;
                }
            }

            /* Weather Widget */
            .weather-widget {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 12px;
                padding: 1.5rem;
                margin-bottom: 1rem;
            }

            .weather-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 1rem;
            }

            .weather-temp {
                font-size: 2.5rem;
                font-weight: 700;
            }

            .weather-desc {
                font-size: 1.1rem;
                opacity: 0.9;
            }

            .weather-details {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1rem;
                margin-top: 1rem;
            }

            .weather-detail {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
            }

            .weather-detail i {
                width: 20px;
            }

            /* Breaking News Banner */
            .breaking-news {
                background: linear-gradient(90deg, #ff6b6b 0%, #ee5a24 100%);
                color: white;
                padding: 0.8rem;
                margin-bottom: 2rem;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 15px;
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.8; }
                100% { opacity: 1; }
            }

            .breaking-label {
                background: white;
                color: #ff6b6b;
                padding: 0.3rem 1rem;
                border-radius: 20px;
                font-weight: 700;
                font-size: 0.9rem;
                white-space: nowrap;
            }

            .breaking-text {
                flex-grow: 1;
                font-weight: 500;
                overflow: hidden;
            }

            .marquee {
                overflow: hidden;
                white-space: nowrap;
                width: 100%;
            }

            .marquee span {
                display: inline-block;
                padding-left: 100%;
                animation: marquee 30s linear infinite;
            }

            @keyframes marquee {
                0% { transform: translate(0, 0); }
                100% { transform: translate(-100%, 0); }
            }

            /* Video Indicator */
            .video-indicator {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(255, 0, 0, 0.8);
                color: white;
                padding: 0.3rem 0.6rem;
                border-radius: 4px;
                font-size: 0.8rem;
                display: flex;
                align-items: center;
                gap: 5px;
                z-index: 2;
            }
        </style>
    </head>
    <body>
        <!-- Header -->
        <header class="header">
            <div class="header-container">
                <a href="/" class="logo">
                    <div class="logo-icon">
                        <i class="fas fa-newspaper"></i>
                    </div>
                    <div class="logo-text">
                        <h1>RT-India</h1>
                        <span>Real Time News Updates</span>
                    </div>
                </a>
                <nav>
                    <ul class="nav-links">
                        <li><a href="/">Home</a></li>
                        <li><a href="/uttarakhand" class="active">Uttarakhand</a></li>
                        <li><a href="/api/news">All News</a></li>
                        <li><a href="#about">About</a></li>
                    </ul>
                </nav>
            </div>
        </header>

        <!-- Breaking News Banner -->
        <div class="breaking-news">
            <div class="breaking-label">BREAKING</div>
            <div class="marquee">
                <span id="breakingNewsText">Loading latest Uttarakhand news...</span>
            </div>
        </div>

        <!-- Uttarakhand Hero Section -->
        <section class="uttarakhand-hero">
            <div class="hero-container">
                <h1 class="hero-title hindi-text">उत्तराखंड समाचार</h1>
                <p class="hero-subtitle hindi-text">देवभूमि की ताज़ा खबरें, राजनीति, मौसम, और सम्पूर्ण जानकारी</p>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-number" id="newsCount">0</span>
                        <span class="stat-label hindi-text">ताज़ा खबरें</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" id="updatedTime">0</span>
                        <span class="stat-label">Minutes Ago</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number hindi-text">१३</span>
                        <span class="stat-label hindi-text">जिले कवर</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- Main Content -->
        <div class="main-container">
            <!-- Main News Section -->
            <main class="main-content">
                <!-- Filter Section -->
                <div class="filter-section">
                    <button class="filter-btn active" data-filter="all">All News</button>
                    <button class="filter-btn" data-filter="Politics">Politics</button>
                    <button class="filter-btn" data-filter="Crime">Crime</button>
                    <button class="filter-btn" data-filter="Environment">Environment</button>
                    <button class="filter-btn" data-filter="Weather">Weather</button>
                    <button class="refresh-btn" id="refreshNews">
                        <i class="fas fa-sync-alt"></i> Refresh News
                    </button>
                </div>

                <!-- News Grid -->
                <div class="news-grid" id="newsGrid">
                    <!-- News cards will be dynamically inserted here -->
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <p class="hindi-text">उत्तराखंड समाचार लोड हो रहे हैं...</p>
                    </div>
                </div>
            </main>

            <!-- Sidebar -->
            <aside class="sidebar">
                <!-- Weather Widget -->
                <div class="weather-widget">
                    <div class="weather-header">
                        <div>
                            <h3><i class="fas fa-map-marker-alt"></i> Dehradun</h3>
                            <p class="weather-desc hindi-text">आंशिक रूप से धूप</p>
                        </div>
                        <div class="weather-temp">24°C</div>
                    </div>
                    <div class="weather-details">
                        <div class="weather-detail">
                            <i class="fas fa-wind"></i>
                            <span>हवा: 12 km/h</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-tint"></i>
                            <span>नमी: 65%</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-sun"></i>
                            <span>दृश्यता: 10 km</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-thermometer-half"></i>
                            <span>Feels: 26°C</span>
                        </div>
                    </div>
                </div>

                <!-- Top Districts -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">प्रमुख जिले</h3>
                    <div class="top-districts">
                        <span class="district-tag hindi-text" data-district="dehradun">देहरादून</span>
                        <span class="district-tag hindi-text" data-district="haridwar">हरिद्वार</span>
                        <span class="district-tag hindi-text" data-district="rishikesh">ऋषिकेश</span>
                        <span class="district-tag hindi-text" data-district="nainital">नैनीताल</span>
                        <span class="district-tag hindi-text" data-district="almora">अल्मोड़ा</span>
                        <span class="district-tag hindi-text" data-district="pithoragarh">पिथौरागढ़</span>
                        <span class="district-tag hindi-text" data-district="chamoli">चमोली</span>
                        <span class="district-tag hindi-text" data-district="uttarkashi">उत्तरकाशी</span>
                        <span class="district-tag hindi-text" data-district="rudraprayag">रुद्रप्रयाग</span>
                        <span class="district-tag hindi-text" data-district="pauri">पौड़ी</span>
                    </div>
                </div>

                <!-- Quick Links -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">जल्दी पहुंच</h3>
                    <a href="/api/uttarakhand-news" class="quick-link">
                        <i class="fas fa-rss"></i>
                        <span class="hindi-text">सभी समाचार</span>
                    </a>
                    <a href="/api/uttarakhand/stats" class="quick-link">
                        <i class="fas fa-chart-bar"></i>
                        <span class="hindi-text">आंकड़े</span>
                    </a>
                    <a href="/api/uttarakhand/breaking" class="quick-link">
                        <i class="fas fa-bolt"></i>
                        <span class="hindi-text">ब्रेकिंग न्यूज़</span>
                    </a>
                    <a href="/api/news" class="quick-link">
                        <i class="fas fa-globe"></i>
                        <span class="hindi-text">सभी राज्य</span>
                    </a>
                    <a href="/health" class="quick-link">
                        <i class="fas fa-heartbeat"></i>
                        <span class="hindi-text">सेवा स्थिति</span>
                    </a>
                </div>

                <!-- Latest Updates -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">ताज़ा अपडेट</h3>
                    <div id="latestUpdates">
                        <p class="hindi-text" style="color: var(--gray); font-size: 0.9rem;">
                            लोड हो रहा है...
                        </p>
                    </div>
                </div>
            </aside>
        </div>

        <!-- Footer -->
        <footer class="footer">
            <div class="footer-container">
                <div class="footer-section">
                    <h3 class="hindi-text">RT-India उत्तराखंड</h3>
                    <p class="hindi-text">देवभूमि की ताज़ा और विश्वसनीय खबरें। राजनीति, मौसम, पर्यटन और समाज से जुड़ी हर खबर आप तक पहुँचाना हमारा उद्देश्य है।</p>
                </div>
                <div class="footer-section">
                    <h3 class="hindi-text">त्वरित लिंक</h3>
                    <ul class="footer-links">
                        <li><a href="/api/uttarakhand-news" class="hindi-text">उत्तराखंड समाचार</a></li>
                        <li><a href="/api/uttarakhand/stats" class="hindi-text">आंकड़े</a></li>
                        <li><a href="/api/uttarakhand/breaking" class="hindi-text">ब्रेकिंग न्यूज़</a></li>
                        <li><a href="/api/news" class="hindi-text">सभी समाचार</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3 class="hindi-text">संपर्क करें</h3>
                    <ul class="footer-links">
                        <li><i class="fas fa-server"></i> API Status: <span id="apiStatus">Checking...</span></li>
                        <li><i class="fas fa-clock"></i> Last Updated: <span id="lastApiUpdate">Loading...</span></li>
                        <li><i class="fas fa-database"></i> Total News: <span id="totalNewsCount">0</span></li>
                    </ul>
                </div>
            </div>
            <div class="copyright">
                <p>© 2024 RT-India उत्तराखंड. सर्वाधिकार सुरक्षित।</p>
                <p class="hindi-text" style="margin-top: 0.5rem;">स्वचालित समाचार संकलन सेवा - प्रति ${process.env.POLL_MINUTES || 15} मिनट अपडेट</p>
            </div>
        </footer>

        <!-- Back to Top Button -->
        <a href="#" class="back-to-top" id="backToTop">
            <i class="fas fa-arrow-up"></i>
        </a>

        <script>
            // Configuration
            const API_BASE_URL = window.location.origin; // Use same origin
            const UPDATE_INTERVAL = 300000; // 5 minutes
            
            // DOM Elements
            const newsGrid = document.getElementById('newsGrid');
            const newsCount = document.getElementById('newsCount');
            const updatedTime = document.getElementById('updatedTime');
            const refreshBtn = document.getElementById('refreshNews');
            const filterBtns = document.querySelectorAll('.filter-btn');
            const backToTop = document.getElementById('backToTop');
            const breakingNewsText = document.getElementById('breakingNewsText');
            const apiStatus = document.getElementById('apiStatus');
            const lastApiUpdate = document.getElementById('lastApiUpdate');
            const totalNewsCount = document.getElementById('totalNewsCount');

            // State
            let allNews = [];
            let currentFilter = 'all';
            let lastUpdateTime = new Date();

            // Format date to relative time
            function formatRelativeTime(dateString) {
                const date = new Date(dateString);
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffMins < 1) return 'अभी अभी';
                if (diffMins < 60) return \`\${diffMins} मिनट पहले\`;
                if (diffHours < 24) return \`\${diffHours} घंटे पहले\`;
                if (diffDays < 7) return \`\${diffDays} दिन पहले\`;
                return date.toLocaleDateString('hi-IN');
            }

            // Create news card HTML
            function createNewsCard(article) {
                const hasVideo = article.meta?.has_videos || false;
                const category = article.genre || 'Other';
                const categoryHindi = {
                    'Politics': 'राजनीति',
                    'Crime': 'अपराध',
                    'Environment': 'पर्यावरण',
                    'Weather': 'मौसम',
                    'Sports': 'खेल',
                    'Entertainment': 'मनोरंजन',
                    'Business': 'व्यापार',
                    'Health': 'स्वास्थ्य',
                    'Education': 'शिक्षा',
                    'Other': 'अन्य'
                }[category] || 'अन्य';

                return \`
                    <div class="news-card" data-category="\${category.toLowerCase()}">
                        <div class="news-image">
                            \${hasVideo ? '<div class="video-indicator"><i class="fas fa-play-circle"></i> वीडियो</div>' : ''}
                            <img src="\${article.image_url || 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'}" 
                                 alt="\${article.title}" 
                                 onerror="this.src='https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'">
                        </div>
                        <div class="news-content">
                            <span class="news-category hindi-text">\${categoryHindi}</span>
                            <h3 class="news-title hindi-text">\${article.title}</h3>
                            <p class="news-desc hindi-text">\${article.short_desc || 'विस्तृत जानकारी के लिए पढ़ें...'}</p>
                            <div class="news-meta">
                                <div class="news-source">
                                    <i class="fas fa-newspaper"></i>
                                    <span>\${article.meta?.source_name || 'RT-India'}</span>
                                </div>
                                <div class="news-time hindi-text">
                                    \${formatRelativeTime(article.published_at || article.created_at)}
                                </div>
                            </div>
                            <a href="/api/news/\${article.slug}" target="_blank" class="read-more hindi-text">
                                पूरी खबर पढ़ें <i class="fas fa-arrow-right"></i>
                            </a>
                        </div>
                    </div>
                \`;
            }

            // Filter news by category
            function filterNews() {
                const filteredNews = currentFilter === 'all' 
                    ? allNews 
                    : allNews.filter(article => 
                        article.genre?.toLowerCase() === currentFilter.toLowerCase());

                newsGrid.innerHTML = filteredNews.length > 0 
                    ? filteredNews.map(createNewsCard).join('')
                    : \`<div class="loading">
                        <i class="fas fa-newspaper" style="font-size: 3rem; color: var(--gray); margin-bottom: 1rem;"></i>
                        <p class="hindi-text">\${currentFilter} श्रेणी में कोई समाचार नहीं मिला</p>
                    </div>\`;

                // Update news count
                newsCount.textContent = filteredNews.length;
            }

            // Fetch Uttarakhand news from API
            async function fetchUttarakhandNews() {
                try {
                    newsGrid.innerHTML = \`
                        <div class="loading">
                            <div class="loading-spinner"></div>
                            <p class="hindi-text">उत्तराखंड समाचार लोड हो रहे हैं...</p>
                        </div>
                    \`;

                    // Update API status
                    apiStatus.textContent = 'Loading...';
                    apiStatus.style.color = '#f39c12';
                    
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand-news?limit=50\`);
                    
                    if (!response.ok) {
                        throw new Error(\`HTTP error! status: \${response.status}\`);
                    }

                    const data = await response.json();
                    
                    if (data.success && data.data) {
                        // Sort by date (newest first)
                        allNews = data.data.sort((a, b) => 
                            new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)
                        );
                        
                        // Update breaking news with latest headline
                        if (allNews.length > 0) {
                            breakingNewsText.textContent = allNews[0].title;
                        }
                        
                        // Update last update time
                        lastUpdateTime = new Date();
                        updatedTime.textContent = Math.floor((new Date() - lastUpdateTime) / 60000) || '0';
                        lastApiUpdate.textContent = new Date().toLocaleTimeString('hi-IN');
                        
                        // Update stats
                        totalNewsCount.textContent = data.meta?.total_news || allNews.length;
                        apiStatus.textContent = 'Online';
                        apiStatus.style.color = '#27ae60';
                        
                        // Update sidebar stats
                        updateSidebarStats();
                        
                        // Render news
                        filterNews();
                        
                        // Show success notification
                        showNotification('ताज़ा समाचार लोड हो गए!', 'success');
                    } else {
                        throw new Error('Invalid response format');
                    }
                } catch (error) {
                    console.error('Error fetching news:', error);
                    newsGrid.innerHTML = \`
                        <div class="loading">
                            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #e74c3c; margin-bottom: 1rem;"></i>
                            <p class="hindi-text">समाचार लोड करने में त्रुटि</p>
                            <p style="color: var(--gray); margin-top: 1rem;">कृपया बाद में पुनः प्रयास करें</p>
                        </div>
                    \`;
                    
                    apiStatus.textContent = 'Offline';
                    apiStatus.style.color = '#e74c3c';
                    
                    showNotification('समाचार लोड करने में असफल', 'error');
                }
            }

            // Update sidebar with latest updates
            async function updateSidebarStats() {
                const latestUpdates = document.getElementById('latestUpdates');
                const topNews = allNews.slice(0, 5);
                
                latestUpdates.innerHTML = topNews.map(article => \`
                    <div style="margin-bottom: 1rem; padding-bottom: 0.8rem; border-bottom: 1px solid var(--border);">
                        <a href="/api/news/\${article.slug}" 
                           target="_blank" 
                           style="color: var(--primary); text-decoration: none; font-weight: 500; display: block; margin-bottom: 0.3rem;"
                           class="hindi-text">
                           \${article.title.substring(0, 60)}...
                        </a>
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--gray);">
                            <span class="hindi-text">\${article.genre || 'अन्य'}</span>
                            <span>\${formatRelativeTime(article.published_at)}</span>
                        </div>
                    </div>
                \`).join('');
                
                // Fetch breaking news
                try {
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand/breaking\`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success && data.breaking_news.length > 0) {
                            breakingNewsText.textContent = data.breaking_news[0].title;
                        }
                    }
                } catch (error) {
                    console.log('Could not fetch breaking news:', error);
                }
            }

            // Show notification
            function showNotification(message, type = 'info') {
                const notification = document.createElement('div');
                notification.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 1rem 1.5rem;
                    background: \${type === 'success' ? '#27ae60' : '#e74c3c'};
                    color: white;
                    border-radius: 8px;
                    box-shadow: var(--shadow);
                    z-index: 1000;
                    animation: slideIn 0.3s ease;
                    font-family: 'Noto Sans Devanagari', sans-serif;
                \`;
                
                notification.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-\${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
                        <span>\${message}</span>
                    </div>
                \`;
                
                document.body.appendChild(notification);
                
                setTimeout(() => {
                    notification.style.animation = 'slideOut 0.3s ease';
                    setTimeout(() => notification.remove(), 300);
                }, 3000);
            }

            // Fetch district news
            async function fetchDistrictNews(district) {
                try {
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand/districts/\${district}\`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success) {
                            allNews = data.data;
                            filterNews();
                            showNotification(\`\${district} समाचार लोड किया गया\`, 'success');
                        }
                    }
                } catch (error) {
                    showNotification('जिला समाचार लोड करने में त्रुटि', 'error');
                }
            }

            // Initialize page
            async function initPage() {
                // Fetch initial news
                await fetchUttarakhandNews();
                
                // Set up auto-refresh
                setInterval(fetchUttarakhandNews, UPDATE_INTERVAL);
                
                // Update time counter every minute
                setInterval(() => {
                    const mins = Math.floor((new Date() - lastUpdateTime) / 60000);
                    updatedTime.textContent = mins;
                }, 60000);
            }

            // Event Listeners
            refreshBtn.addEventListener('click', fetchUttarakhandNews);

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentFilter = btn.dataset.filter;
                    filterNews();
                });
            });

            // District tag click handler
            document.querySelectorAll('.district-tag').forEach(tag => {
                tag.addEventListener('click', function() {
                    const district = this.dataset.district;
                    fetchDistrictNews(district);
                });
            });

            // Back to top button
            window.addEventListener('scroll', () => {
                backToTop.classList.toggle('visible', window.scrollY > 300);
            });

            backToTop.addEventListener('click', (e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            // Add CSS for animations
            const style = document.createElement('style');
            style.textContent = \`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
                
                .news-card {
                    animation: fadeIn 0.5s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            \`;
            document.head.appendChild(style);

            // Initialize the page
            document.addEventListener('DOMContentLoaded', initPage);
        </script>
    </body>
    </html>
  `);
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
      hero_news: "/api/hero-news (for homepage hero section)",
      uttarakhand_news: "/api/uttarakhand-news",
      uttarakhand_stats: "/api/uttarakhand/stats",
      uttarakhand_districts: "/api/uttarakhand/districts/:district",
      uttarakhand_breaking: "/api/uttarakhand/breaking",
      article: "/api/news/:slug",
      search: "/api/search",
      stats: "/api/stats",
      health: "/health",
      manual_run: "/api/run-now",
      uttarakhand_page: "/uttarakhand"
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
  
  🏔️ UTTARAKHAND NEWS PAGE:
  - URL: /uttarakhand
  - API: /api/uttarakhand-news
  - Stats: /api/uttarakhand/stats
  - Districts: /api/uttarakhand/districts/:district
  - Breaking: /api/uttarakhand/breaking
  - Hero Section: /api/hero-news (for homepage)
  
  ⚡ SYSTEM FEATURES:
  - Uttarakhand-specific news filtering
  - District-wise organization
  - Hindi language support
  - Real-time updates every ${POLL_MINUTES} minutes
  - Breaking news ticker
  
  📊 EXPECTED OUTPUT:
  - Only Uttarakhand news
  - 300+ word detailed articles in Hindi
  - Video extraction when available
  - Fresh content with every run
  
  🚀 Ready to deliver LATEST Hindi news from Uttarakhand!
  `);
});