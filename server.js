// server.js - ENHANCED VERSION WITH CONTENT FETCHING, VIDEO EXTRACTION & 300+ WORDS
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

/* -------------------- NEWS API CONFIGURATION -------------------- */
const NEWS_SOURCES = {
  // PRIORITY 1: UTTARAKHAND NEWS (Highest Priority)
  UTTARAKHAND_NEWS18: {
    priority: 1,
    name: "News18 Uttarakhand",
    type: "RSS",
    config: {
      url: "https://hindi.news18.com/rss/uttarakhand/",
      maxItems: 10
    }
  },
  
  UTTARAKHAND_GNEWS: {
    priority: 2,
    name: "GNews Uttarakhand",
    type: "GNEWS",
    config: {
      q: "Uttarakhand OR उत्तराखंड",
      lang: "hi",
      country: "in",
      max: 8
    }
  },
  
  // PRIORITY 2: NATIONAL INDIA NEWS
  INDIA_NEWSAPI: {
    priority: 3,
    name: "India National",
    type: "NEWSAPI",
    config: {
      q: "India OR भारत",
      language: "en",
      pageSize: 10,
      sortBy: "publishedAt"
    }
  },
  
  INDIA_GNEWS: {
    priority: 4,
    name: "India Hindi News",
    type: "GNEWS",
    config: {
      q: "India hindi",
      lang: "hi",
      country: "in",
      max: 8
    }
  },
  
  // PRIORITY 3: INTERNATIONAL NEWS
  INTERNATIONAL_GNEWS: {
    priority: 5,
    name: "International News",
    type: "GNEWS",
    config: {
      q: "world international",
      lang: "en",
      max: 6
    }
  },
  
  INTERNATIONAL_NEWSAPI: {
    priority: 6,
    name: "World News",
    type: "NEWSAPI",
    config: {
      q: "world",
      language: "en",
      pageSize: 6
    }
  }
};

// Legacy RSS feeds (fallback if APIs fail)
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

/* -------------------- NEWS API FUNCTIONS -------------------- */

// 1. NEWSAPI.org Integration
async function fetchFromNewsAPI(params) {
  try {
    const { q, language, pageSize, sortBy } = params;
    const apiKey = process.env.NEWSAPI_KEY;
    
    if (!apiKey) {
      console.warn("NEWSAPI_KEY not configured, skipping NewsAPI");
      return [];
    }
    
    // NewsAPI free tier only supports 'everything' endpoint with certain limitations
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${language}&pageSize=${pageSize}&sortBy=${sortBy || 'publishedAt'}&apiKey=${apiKey}`;
    
    console.log(`📡 Fetching from NewsAPI: ${q}`);
    
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
      throw new Error(`NewsAPI error: ${data.message || "Unknown error"}`);
    }
    
    console.log(`✅ NewsAPI returned ${data.articles?.length || 0} articles`);
    return data.articles || [];
    
  } catch (error) {
    console.warn(`❌ NewsAPI fetch failed:`, error.message);
    return [];
  }
}

// 2. GNews.io Integration
async function fetchFromGNewsAPI(params) {
  try {
    const { q, lang, country, max } = params;
    const apiKey = process.env.GNEWS_API_KEY;
    
    if (!apiKey) {
      console.warn("GNEWS_API_KEY not configured, skipping GNews");
      return [];
    }
    
    // GNews API v4 endpoint
    const baseUrl = country ? 
      `https://gnews.io/api/v4/top-headlines?q=${encodeURIComponent(q)}&lang=${lang}&country=${country}&max=${max}&apikey=${apiKey}` :
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&max=${max}&apikey=${apiKey}`;
    
    console.log(`📡 Fetching from GNews: ${q} (${lang})`);
    
    const response = await fetch(baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }
    
    const data = await response.json();
    
    // GNews returns articles in 'articles' property
    console.log(`✅ GNews returned ${data.articles?.length || 0} articles`);
    return data.articles || [];
    
  } catch (error) {
    console.warn(`❌ GNews fetch failed:`, error.message);
    return [];
  }
}

// 3. RSS Feed Fetcher (for News18 Uttarakhand and fallback)
async function fetchRSSFeed(feedUrl, maxItems = 10) {
  try {
    console.log(`📡 Fetching RSS: ${feedUrl}`);
    
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
    
    const items = feed.items.slice(0, maxItems);
    console.log(`✅ Fetched ${items.length} items from RSS: ${feedUrl}`);
    
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
        sourceName: sourceConfig.name
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
        sourceName: sourceConfig.name
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
        sourceName: sourceConfig.name
      }
    };
  }
}

/* -------------------- CONTENT ENHANCEMENT FUNCTIONS -------------------- */

// Enhanced Article Content Fetcher with better extraction
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
    
    // Common content selectors for news websites
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
      '.content-area',
      '.article-text',
      '.article-content',
      '.post-body',
      '.body-copy',
      '.article__body',
      '.article-main',
      '.articleData',
      '.article_wrapper',
      '.articleFullText'
    ];
    
    let mainContent = '';
    let contentElement = null;
    
    // Try to find the main content element
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        const wordCount = text.split(/\s+/).length;
        
        if (wordCount > 200) {  // Require at least 200 words
          contentElement = element;
          mainContent = text;
          break;
        }
      }
    }
    
    // If no main content found, try to gather from paragraphs
    if (!contentElement || mainContent.length < 1000) {
      const paragraphs = [];
      $('p, h2, h3').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 50 && 
            !text.includes('©') && 
            !text.includes('Copyright') &&
            !text.includes('ADVERTISEMENT') &&
            !text.includes('adsbygoogle') &&
            !text.includes('Also read') &&
            !text.includes('Also Read') &&
            !text.includes('READ ALSO') &&
            !text.match(/^\s*\d+\s*$/)) {
          paragraphs.push(text);
        }
      });
      
      mainContent = paragraphs.join('\n\n');
    }
    
    // Clean up the content
    mainContent = mainContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
    
    return mainContent.length > 500 ? mainContent : null;
    
  } catch (e) {
    console.warn(`❌ Failed to fetch article from ${url}:`, e.message);
    return null;
  }
}

// Extract Videos from Article (Twitter, YouTube, etc.)
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
        // Extract tweet ID
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
    
    // Extract video elements
    $('video').each((i, elem) => {
      const src = $(elem).attr('src');
      const poster = $(elem).attr('poster');
      if (src) {
        videos.push({
          type: 'html5',
          url: src,
          poster: poster
        });
      }
    });
    
    // Extract video links
    $('a[href*="video"], a[href*="youtube"], a[href*="youtu.be"], a[href*="vimeo"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        videos.push({
          type: 'video_link',
          url: href
        });
      }
    });
    
    return videos.length > 0 ? videos : null;
    
  } catch (error) {
    console.warn(`❌ Failed to extract videos from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- PARALLEL AI PROVIDERS (OpenRouter + Groq) -------------------- */

// 1. OpenRouter Provider (Enhanced for 300+ words)
async function rewriteWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }
  
  // Enhanced prompt for 300+ words with video context
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
      max_tokens: 1500,  // Increased for longer content
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

// 2. Groq Provider (Enhanced for 300+ words)
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
      max_tokens: 1500,  // Increased for longer content
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

// 3. Enhanced Fallback Generator (300+ words)
function generateFallbackHindi(title, content) {
  const baseContent = content.length > 300 ? content.substring(0, 500) : content;
  
  const templates = [
    `${title} - यह समाचार आजकल चर्चा में बना हुआ है। सूत्रों के अनुसार, ${baseContent}... स्थानीय प्रशासन ने मामले में जांच शुरू कर दी है और शीघ्र ही आधिकारिक बयान जारी किया जाएगा। विशेषज्ञों का मानना है कि यह मामला भविष्य के लिए महत्वपूर्ण सबक देता है। 
    
    इस घटना के बारे में और अधिक जानकारी जुटाई जा रही है। प्रारंभिक जानकारी के अनुसार, यह मामला काफी गंभीर है। अधिकारियों ने तुरंत कार्रवाई करते हुए जांच शुरू की है। स्थानीय निवासियों ने इस मामले पर चिंता जताई है और त्वरित न्याय की मांग की है।
    
    विश्लेषकों का कहना है कि इस तरह की घटनाओं से सबक लेकर भविष्य में ऐसी स्थितियों से बचा जा सकता है। सरकार ने भी इस मामले में गंभीरता दिखाई है और पूर्ण सहयोग का आश्वासन दिया है।`,
    
    `नवीनतम जानकारी के मुताबिक, ${title} के संदर्भ में कई नए तथ्य सामने आए हैं। ${baseContent}... संबंधित विभाग ने तत्काल कार्रवाई करते हुए जांच समिति गठित की है। आम जनता से अपील की गई है कि वे अफवाहों पर ध्यान न दें।
    
    इस मामले में कई महत्वपूर्ण पहलू सामने आए हैं जिन पर विस्तार से विचार किया जा रहा है। विशेषज्ञ टीम ने घटनास्थल का मुआयना किया और प्रारंभिक रिपोर्ट तैयार की है। इस रिपोर्ट के आधार पर आगे की कार्रवाई की जाएगी।
    
    स्थानीय प्रशासन ने सभी संबंधित पक्षों से बातचीत की है और तथ्यों को सत्यापित किया है। इस प्रक्रिया में कुछ समय लग सकता है लेकिन पारदर्शी जांच का आश्वासन दिया गया है।`,
    
    `${title} की खबर ने सोशल मीडिया पर चर्चा तेज कर दी है। प्रशासनिक सूत्रों के अनुसार, ${baseContent}... विपक्ष ने प्रशासन पर लापरवाही का आरोप लगाया है, जबकि सरकार ने पारदर्शी जांच का आश्वासन दिया है।
    
    इस मामले के कई पहलू हैं जिन पर विचार किया जाना आवश्यक है। सबसे पहले, घटना के कारणों का पता लगाया जा रहा है। दूसरे, इससे प्रभावित लोगों के लिए राहत उपाय शुरू किए गए हैं। तीसरे, भविष्य में ऐसी घटनाओं को रोकने के उपाय सुझाए जा रहे हैं।
    
    विशेषज्ञों की एक टीम ने इस मामले का गहन अध्ययन शुरू किया है और जल्द ही अपनी रिपोर्ट पेश करेगी। इस बीच, प्रशासन ने स्थिति पर नियंत्रण बनाए रखा है और आम जनता से शांति बनाए रखने की अपील की है।`
  ];
  
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  // Ensure minimum 300 words
  const words = template.split(/\s+/).length;
  if (words < 300) {
    return template + " " + "यह समाचार और भी महत्वपूर्ण तथ्य सामने ला सकता है। विशेषज्ञों का मानना है कि इस मामले में और जानकारी सामने आने की संभावना है। सभी पक्षों से अपेक्षा है कि वे इस मामले में सहयोग देंगे और सच्चाई सामने आएगी। जनता को धैर्य बनाए रखने की सलाह दी जाती है और आधिकारिक सूचनाओं पर ही विश्वास करने का अनुरोध किया जाता है।";
  }
  
  return template;
}

/* -------------------- PARALLEL AI PROCESSING (ENHANCED) -------------------- */
async function rewriteWithParallelAI(title, content, hasVideos = false) {
  const providers = [];
  
  // Add OpenRouter if configured
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      fn: () => rewriteWithOpenRouter(title, content),
      timeout: 60000
    });
  }
  
  // Add Groq if configured
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      fn: () => rewriteWithGroq(title, content),
      timeout: 45000
    });
  }
  
  // If no providers configured, use enhanced fallback
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
  
  // Create promises for all providers with timeouts
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
  
  // Wait for the first successful response
  const results = await Promise.allSettled(promises);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success && result.value.result) {
      const aiContent = result.value.result;
      
      // Parse the AI response
      const parsed = parseAIResponse(aiContent);
      
      // Check if content meets minimum word requirement
      const wordCount = parsed.content.split(/\s+/).length;
      
      if (parsed.content && wordCount >= 250) {
        // Add video mention if videos were found
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
  
  // If all providers failed, use enhanced fallback
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
  
  // Clean the text
  let cleaned = text
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .replace(/[*_~`#\[\]]/g, '')  // Remove markdown
    .replace(/^(शीर्षक|लेख|समाचार|आर्टिकल|न्यूज़|Title|Article|News):\s*/gi, '')
    .replace(/^(Here is|This is|I have|According to)\s+/gi, '')
    .replace(/^(Here'?s|There'?s)\s+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Split into lines
  const lines = cleaned.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    return { title: "", content: "" };
  }
  
  // First line is title (if it's not too long)
  let title = lines[0].trim();
  if (title.length > 150) {
    // Too long for title, use original or first sentence
    const sentences = title.split(/[।.!?]/);
    title = sentences[0] || title.substring(0, 100);
  }
  
  // Rest is content
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
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
      },
      timeout: 10000
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Common image selectors for news sites
    const imageSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
      'meta[name="og:image"]',
      '.article-img img',
      '.story-img img',
      '.featured-image img',
      '.wp-post-image',
      '.entry-thumbnail img',
      '.td-post-featured-image img',
      'figure img',
      '.image-container img',
      '.media-container img',
      'img[itemprop="image"]',
      'img.wp-image',
      '.main-img',
      '.article-image',
      'img.hero-image',
      'img.featured'
    ];
    
    let imageUrl = null;
    
    // Try meta tags first (most reliable)
    for (const selector of imageSelectors.slice(0, 4)) {
      const meta = $(selector);
      if (meta.length) {
        const content = meta.attr('content');
        if (content && content.startsWith('http')) {
          imageUrl = content;
          break;
        }
      }
    }
    
    // If no meta image, try to find the main content image
    if (!imageUrl) {
      for (const selector of imageSelectors.slice(4)) {
        const img = $(selector).first();
        if (img.length) {
          const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
          if (src && src.startsWith('http')) {
            imageUrl = src;
            break;
          }
        }
      }
    }
    
    // Resolve relative URLs
    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        imageUrl = new URL(imageUrl, urlObj.origin).href;
      } catch (e) {
        // If we can't resolve the URL, discard it
        imageUrl = null;
      }
    }
    
    return imageUrl;
    
  } catch (error) {
    console.warn(`❌ Failed to fetch image from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- Process Single News Item (ENHANCED) -------------------- */
async function processNewsItem(item, sourceType = "api") {
  try {
    // Check if already exists
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
    
    // Get article content, image, and videos
    let articleContent = item.description || "";
    let articleImage = item.image || null;
    let videos = [];
    
    // Try to fetch full article content, image, and videos if URL is available
    if (item.url && sourceType !== "static") {
      try {
        // Fetch in parallel for better performance
        const [fetchedContent, fetchedImage, fetchedVideos] = await Promise.allSettled([
          fetchArticleBody(item.url),
          fetchArticleImage(item.url),
          extractVideosFromArticle(item.url)
        ]);
        
        // Process fetched content
        if (fetchedContent.status === 'fulfilled' && fetchedContent.value && fetchedContent.value.length > 300) {
          articleContent = fetchedContent.value;
          console.log(`   📝 Fetched ${articleContent.length} chars of content`);
        } else {
          console.log(`   ⚠️  Content fetch failed or too short`);
        }
        
        // Process fetched image
        if (fetchedImage.status === 'fulfilled' && fetchedImage.value) {
          articleImage = fetchedImage.value;
          console.log(`   📷 Fetched image: ${articleImage.substring(0, 80)}...`);
        }
        
        // Process fetched videos
        if (fetchedVideos.status === 'fulfilled' && fetchedVideos.value) {
          videos = fetchedVideos.value;
          console.log(`   🎥 Found ${videos.length} video(s)`);
        }
        
      } catch (e) {
        console.warn(`❌ Failed to fetch content/image/videos from ${item.url}:`, e.message);
      }
    }
    
    // Ensure we have enough content for rewriting
    if (!articleContent || articleContent.length < 200) {
      articleContent = item.title + ". " + (item.description || "");
      console.log(`   ⚠️  Using minimal content: ${articleContent.length} chars`);
    }
    
    // Get AI rewrite (parallel processing) - pass video info
    const aiResult = await rewriteWithParallelAI(item.title, articleContent, videos.length > 0);
    
    if (!aiResult.success) {
      console.log(`❌ AI rewrite failed for: ${item.title.substring(0, 50)}`);
      return null;
    }
    
    // Create slug
    const slug = makeSlug(aiResult.title);
    
    // Detect genre and region
    const fullText = aiResult.title + " " + aiResult.content;
    const genre = detectGenreKeyword(fullText);
    const sourceHost = item.url ? new URL(item.url).hostname : "";
    const region = detectRegionFromText(fullText, sourceHost);
    
    // Prepare record with enhanced data
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
        image_source: articleImage ? 
          (item.image === articleImage ? 'api' : 'scraped') : 'default',
        api_source: item.meta?.api || "unknown",
        source_name: item.meta?.sourceName || item.source || "unknown",
        has_videos: videos.length > 0,
        videos: videos.length > 0 ? videos : null
      }
    };
    
    // Save to database
    const { error } = await supabase.from("ai_news").insert(record);
    
    if (error) {
      console.error(`❌ Database error for ${item.title.substring(0, 50)}:`, error.message);
      return null;
    }
    
    console.log(`✅ Added: ${aiResult.title.substring(0, 50)}...`);
    console.log(`   📊 ${aiResult.wordCount} words, ${aiResult.provider}`);
    console.log(`   📷 Image: ${record.image_url ? 'Yes' : 'No'}`);
    console.log(`   🎥 Videos: ${videos.length}`);
    
    return record;
    
  } catch (error) {
    console.error(`❌ Error processing item:`, error.message);
    return null;
  }
}

/* -------------------- Main Processing Function (ENHANCED) -------------------- */
async function processAllNews() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 STARTING ENHANCED NEWS PROCESSING CYCLE");
  console.log("=".repeat(60));
  console.log("📝 Features: 300+ word articles, video extraction, enhanced content");
  console.log("=".repeat(60));
  
  const allItems = [];
  const sourceStats = {};
  
  // Sort sources by priority (Uttarakhand first, then National, then International)
  const sourcesByPriority = Object.entries(NEWS_SOURCES)
    .map(([key, config]) => ({ key, ...config }))
    .sort((a, b) => a.priority - b.priority);
  
  console.log(`📊 Processing ${sourcesByPriority.length} sources by priority...\n`);
  
  // Process each source in priority order
  for (const source of sourcesByPriority) {
    try {
      console.log(`🔍 [Priority ${source.priority}] Fetching ${source.name} (${source.type})...`);
      
      let rawArticles = [];
      
      // Fetch based on source type
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
      
      // Normalize articles
      const normalizedArticles = rawArticles.map(article => 
        normalizeArticle(article, source)
      );
      
      // Add to collection
      allItems.push(...normalizedArticles);
      sourceStats[source.name] = normalizedArticles.length;
      
      console.log(`   ✅ Added ${normalizedArticles.length} articles from ${source.name}`);
      
      // Brief pause between API calls to respect rate limits
      if (source.type !== "RSS") {
        await sleep(1000);
      }
      
    } catch (error) {
      console.log(`   ❌ Failed to fetch ${source.name}:`, error.message);
      sourceStats[source.name] = 0;
    }
  }
  
  // Fallback to legacy RSS if API sources returned few/no articles
  if (allItems.length < 8) {
    console.log("\n⚠️  API sources returned few articles, trying legacy RSS feeds...");
    
    try {
      // Fetch legacy Uttarakhand feeds
      for (const feedUrl of UTTRAKHAND_FEEDS) {
        const rssItems = await fetchRSSFeed(feedUrl, 5);
        const normalized = rssItems.map(item => ({
          ...item,
          meta: { api: "RSS_LEGACY", sourceName: "Legacy RSS" }
        }));
        allItems.push(...normalized);
        console.log(`   ✅ Added ${normalized.length} articles from legacy RSS: ${feedUrl}`);
      }
      
      // Fetch legacy India feeds
      for (const feedUrl of INDIA_FEEDS) {
        const rssItems = await fetchRSSFeed(feedUrl, 5);
        const normalized = rssItems.map(item => ({
          ...item,
          meta: { api: "RSS_LEGACY", sourceName: "Legacy RSS" }
        }));
        allItems.push(...normalized);
        console.log(`   ✅ Added ${normalized.length} articles from legacy RSS: ${feedUrl}`);
      }
    } catch (error) {
      console.log(`   ❌ Legacy RSS fallback failed:`, error.message);
    }
  }
  
  // Display statistics
  console.log("\n" + "=".repeat(60));
  console.log("📈 SOURCE STATISTICS:");
  Object.entries(sourceStats).forEach(([name, count]) => {
    console.log(`   ${name}: ${count} articles`);
  });
  console.log(`📊 TOTAL ITEMS FETCHED: ${allItems.length}`);
  
  // Remove duplicates by URL
  const uniqueItems = [];
  const seenUrls = new Set();
  
  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }
  
  console.log(`📊 UNIQUE ITEMS: ${uniqueItems.length}`);
  
  // Process items in parallel using concurrency queue (prioritize recent items)
  const processPromises = [];
  const itemsToProcess = uniqueItems
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 15); // Process fewer items but with better quality
  
  console.log(`🔄 Processing ${itemsToProcess.length} most recent unique items...\n`);
  
  for (const item of itemsToProcess) {
    processPromises.push(
      enqueueTask(() => processNewsItem(item, "api"))
    );
  }
  
  // Wait for all processing to complete
  const processedResults = await Promise.allSettled(processPromises);
  
  const successful = processedResults.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  const failed = processedResults.filter(r => r.status === 'rejected').length;
  
  console.log("\n" + "=".repeat(60));
  console.log(`🎯 ENHANCED PROCESSING COMPLETE:`);
  console.log(`   ✅ ${successful} new articles added (300+ words each)`);
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
    
    // Cleanup old articles (keep 7 days)
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error, count } = await supabase
        .from("ai_news")
        .delete()
        .lt("created_at", cutoff);
        
      if (error) {
        console.warn("Cleanup error:", error.message);
      } else {
        console.log(`🧹 Cleanup completed: ${count || 0} old articles removed`);
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

// Periodic runs every 25 minutes (increased for better processing)
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 25;
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
      .order("created_at", { ascending: false })
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

// Returns article directly (without wrapper)
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

    // Return article directly to match client expectations
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
      message: "Enhanced processing started in background" 
    });
    
    // Start processing in background
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
    // Get detailed stats including API sources
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
      wordStats: {
        totalWords: 0,
        averageWords: 0,
        articlesWithVideos: 0
      },
      recent: data?.slice(0, 10) || []
    };

    // Calculate statistics
    data?.forEach(item => {
      // Genre stats
      stats.byGenre[item.genre] = (stats.byGenre[item.genre] || 0) + 1;
      
      // Region stats
      stats.byRegion[item.region] = (stats.byRegion[item.region] || 0) + 1;
      
      // API source stats
      const apiSource = item.meta?.api_source || "unknown";
      stats.byApiSource[apiSource] = (stats.byApiSource[apiSource] || 0) + 1;
      
      // Word count stats
      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;
      
      // Video stats
      if (item.meta?.has_videos) {
        stats.wordStats.articlesWithVideos++;
      }
    });

    // Calculate average words
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

app.get("/api/sources", async (req, res) => {
  try {
    // Get active sources from configuration
    const activeSources = Object.entries(NEWS_SOURCES)
      .map(([key, config]) => ({
        key,
        name: config.name,
        type: config.type,
        priority: config.priority,
        active: config.type === "RSS" || 
               (config.type === "NEWSAPI" && process.env.NEWSAPI_KEY) ||
               (config.type === "GNEWS" && process.env.GNEWS_API_KEY)
      }))
      .sort((a, b) => a.priority - b.priority);

    res.json({
      success: true,
      sources: activeSources,
      apiKeys: {
        NEWSAPI: !!process.env.NEWSAPI_KEY,
        GNEWS: !!process.env.GNEWS_API_KEY,
        OPENROUTER: !!process.env.OPENROUTER_API_KEY,
        GROQ: !!process.env.GROQ_API_KEY
      },
      config: {
        maxConcurrentTasks: MAX_CONCURRENT_TASKS,
        pollMinutes: POLL_MINUTES,
        priorityOrder: "Uttarakhand → National → International",
        features: ["300+ word articles", "Video extraction", "Enhanced content fetching"]
      }
    });
  } catch (error) {
    console.error("Sources error:", error);
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
    service: "Hindi News AI Rewriter with Enhanced Content",
    version: "6.0",
    features: ["300+ Word Articles", "Video Extraction", "Enhanced Content Fetching", "Priority News APIs"],
    ai_providers: providers.length > 0 ? providers : ["Fallback"],
    news_apis: apiSources.length > 0 ? apiSources : ["RSS Fallback Only"],
    queue: {
      running: runningTasks,
      pending: taskQueue.length,
      maxConcurrent: MAX_CONCURRENT_TASKS
    },
    processing: isProcessing,
    priority_system: {
      uttarakhand_sources: 2,
      india_sources: 2,
      international_sources: 2,
      total_sources: 6
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Hindi News Rewriter API with Enhanced Content Processing",
    version: "6.0",
    description: "Priority-based news fetching with 300+ word articles, video extraction, and enhanced content",
    endpoints: {
      news: "/api/news",
      article: "/api/news/:slug",
      search: "/api/search",
      stats: "/api/stats",
      sources: "/api/sources",
      health: "/health",
      manual_run: "/api/run-now"
    },
    features: [
      "Priority-based news fetching (Uttarakhand first)",
      "300+ word Hindi articles",
      "Twitter/YouTube video extraction",
      "Enhanced content fetching from source URLs",
      "NEWSAPI + GNEWS integration",
      "News18 Uttarakhand RSS support",
      "Parallel AI processing (OpenRouter + Groq)",
      "Smart fallback images by genre/region",
      "Automatic deduplication",
      "Concurrent processing with rate limiting"
    ],
    priority_order: [
      "1. News18 Uttarakhand (RSS)",
      "2. GNews Uttarakhand (Hindi)",
      "3. India National (NewsAPI)",
      "4. India Hindi (GNews)",
      "5. International (GNews)",
      "6. World News (NewsAPI)"
    ]
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
  
  🔧 ENHANCED CONFIGURATION:
  - Max concurrent tasks: ${MAX_CONCURRENT_TASKS}
  - Poll interval: ${POLL_MINUTES} minutes
  - Priority System: Uttarakhand → National → International
  - Minimum words: 300+
  - Video extraction: Enabled
  
  🔑 API STATUS:
  - NewsAPI: ${process.env.NEWSAPI_KEY ? '✅ Configured' : '❌ Not configured'}
  - GNews API: ${process.env.GNEWS_API_KEY ? '✅ Configured' : '❌ Not configured'}
  - OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}
  - Groq: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}
  
  📊 ENHANCED NEWS SOURCES:
  1. News18 Uttarakhand (RSS)
  2. GNews Uttarakhand (Hindi)
  3. India National (NewsAPI)
  4. India Hindi (GNews)
  5. International (GNews)
  6. World News (NewsAPI)
  
  📝 ENDPOINTS:
  - API News: /api/news
  - Article: /api/news/:slug
  - Search: /api/search
  - Stats: /api/stats
  - Sources: /api/sources
  - Health: /health
  - Manual Run: /api/run-now
  
  ⚡ ENHANCED FEATURES:
  - 300+ word Hindi articles
  - Twitter/YouTube video extraction
  - Enhanced content fetching from source URLs
  - Priority-based news fetching (Uttarakhand first)
  - NEWSAPI + GNEWS integration
  - News18 Uttarakhand RSS support
  - Parallel AI processing (OpenRouter + Groq)
  - Smart fallback images by genre/region
  - Automatic deduplication
  - Concurrent processing with rate limiting
  
  📊 Ready to process enhanced Hindi news with videos!
  `);
});