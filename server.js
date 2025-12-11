// server.js - ENHANCED VERSION WITH UTTARAKHAND FOCUS & HINDI NEWS ONLY
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

/* -------------------- ENHANCED UTTARAKHAND NEWS SOURCES -------------------- */
// UTTARAKHAND REGIONAL PORTALS (Hindi Only)
const UTTARAKHAND_REGIONAL_SOURCES = {
  // PRIORITY 1: UTTARAKHAND NEWS PORTALS (Hindi)
  UTTARAKHAND_JAGRAN: {
    priority: 1,
    name: "Jagran Uttarakhand",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.jagran.com/rss/uttarakhand.xml",
      maxItems: 15,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  UTTARAKHAND_AMARUJALA: {
    priority: 2,
    name: "Amar Ujala Uttarakhand",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/uttarakhand.xml",
      maxItems: 15,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  UTTARAKHAND_DB_POST: {
    priority: 3,
    name: "Divya Bhaskar Uttarakhand",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.divyabhaskar.co.in/rss/uttarakhand-feed.xml",
      maxItems: 10,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  UTTARAKHAND_HINDUSTAN: {
    priority: 4,
    name: "Hindustan Uttarakhand",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.livehindustan.com/rss/uttarakhand.xml",
      maxItems: 12,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  UTTARAKHAND_NAVA_UTTARAKHAND: {
    priority: 5,
    name: "Nava Uttarakhand",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.navuttarakhand.com/feed/",
      maxItems: 10,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  // District-wise Uttarakhand News
  DEHRADUN_NEWS: {
    priority: 6,
    name: "Dehradun News",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.jagran.com/rss/city/dehradun.xml",
      maxItems: 8,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  HARIDWAR_NEWS: {
    priority: 7,
    name: "Haridwar News",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.amarujala.com/rss/city/haridwar.xml",
      maxItems: 8,
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  // PRIORITY 2: NATIONAL HINDI NEWS
  HINDI_NATIONAL_NEWS18: {
    priority: 8,
    name: "News18 Hindi",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://hindi.news18.com/rss/news.xml",
      maxItems: 10,
      isRegional: false,
      region: "india"
    }
  },
  
  AAJ_TAK_NATIONAL: {
    priority: 9,
    name: "Aaj Tak",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://aajtak.intoday.in/rssfeeds/?id=home",
      maxItems: 10,
      isRegional: false,
      region: "india"
    }
  },
  
  INDIA_TV_HINDI: {
    priority: 10,
    name: "India TV Hindi",
    language: "hi",
    type: "RSS",
    config: {
      url: "https://www.indiatv.in/rssfeed/news.xml",
      maxItems: 8,
      isRegional: false,
      region: "india"
    }
  },
  
  // PRIORITY 3: API-BASED HINDI NEWS
  UTTARAKHAND_GNEWS_HINDI: {
    priority: 11,
    name: "GNews Uttarakhand Hindi",
    language: "hi",
    type: "GNEWS",
    config: {
      q: "उत्तराखंड OR Uttarakhand",
      lang: "hi",
      country: "in",
      max: 12,
      sortby: "publishedAt",
      isRegional: true,
      region: "uttarakhand"
    }
  },
  
  NATIONAL_GNEWS_HINDI: {
    priority: 12,
    name: "GNews India Hindi",
    language: "hi",
    type: "GNEWS",
    config: {
      q: "भारत OR India hindi news",
      lang: "hi",
      country: "in",
      max: 10,
      sortby: "publishedAt",
      isRegional: false,
      region: "india"
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

/* -------------------- Default Images for Uttarakhand -------------------- */
function getDefaultImage(genre, region) {
  const uttarakhandImages = {
    'Politics': 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&auto=format&fit=crop',
    'Crime': 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&auto=format&fit=crop',
    'Sports': 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&auto=format&fit=crop',
    'Entertainment': 'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?w=800&auto=format&fit=crop',
    'Business': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop',
    'Technology': 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&auto=format&fit=crop',
    'Health': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&auto=format&fit=crop',
    'Environment': 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop',
    'Education': 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&auto=format&fit=crop',
    'Lifestyle': 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&auto=format&fit=crop',
    'Weather': 'https://images.unsplash.com/photo-1592210454359-9043f067919b?w=800&auto=format&fit=crop',
    'Tourism': 'https://images.unsplash.com/photo-1564507004663-b6dfb3e2ede5?w=800&auto=format&fit=crop',
    'Culture': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop',
    'Other': 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'
  };
  
  const indiaImages = {
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
    return uttarakhandImages[genre] || uttarakhandImages['Other'];
  }
  
  return indiaImages[genre] || indiaImages['Other'];
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
  "Tourism",
  "Culture",
  "Other"
];

function detectRegionFromText(text, sourceHost = "") {
  const t = (text || "").toLowerCase();
  const s = (sourceHost || "").toLowerCase();
  
  // Uttarakhand districts and cities
  const uttCities = [
    "uttarakhand", "dehradun", "nainital", "almora", "pithoragarh",
    "rudraprayag", "chamoli", "pauri", "champawat", "haridwar", "rishikesh",
    "uttarkashi", "bageshwar", "udham singh nagar", "tehri", "roorkee",
    "kotdwar", "srinagar", "mussoorie", "himalaya", "gangotri", "yamunotri",
    "kedarnath", "badrinath", "hemkund", "valley of flowers"
  ];
  
  const uttKeywordsHindi = [
    "उत्तराखंड", "देहरादून", "नैनीताल", "हरिद्वार", "ऋषिकेश", "अल्मोड़ा",
    "पिथौरागढ़", "रुद्रप्रयाग", "चमोली", "पौड़ी", "चंपावत", "उत्तरकाशी",
    "बागेश्वर", "उधम सिंह नगर", "टिहरी", "हिमालय", "गंगोत्री", "यमुनोत्री",
    "केदारनाथ", "बद्रीनाथ", "हेमकुंड", "फूलों की घाटी"
  ];
  
  const allUttKeywords = [...uttCities, ...uttKeywordsHindi];
  
  if (allUttKeywords.some((k) => t.includes(k) || s.includes(k))) return "uttarakhand";
  
  const indiaKeywords = [
    "india", "delhi", "mumbai", "kolkata", "chennai", "bengaluru",
    "hyderabad", "pune", "ahmedabad", "lucknow", "patna", "jaipur",
    "भारत", "दिल्ली", "मुंबई", "कोलकाता", "चेन्नई", "बेंगलुरु",
    "हैदराबाद", "पुणे", "अहमदाबाद", "लखनऊ", "पटना", "जयपुर"
  ];
  
  if (indiaKeywords.some((k) => t.includes(k) || s.includes(k))) return "india";
  
  return "international";
}

function detectGenreKeyword(text) {
  const t = (text || "").toLowerCase();
  
  // Hindi keywords detection
  if (/\b(पुलिस|मर्डर|हत्या|दुर्घटना|अपराध|गिरफ्तारी|कोर्ट|मुकदमा|जेल)\b/.test(t)) return "Crime";
  if (/\b(चुनाव|मंत्री|सरकार|विधायक|सांसद|राजनीति|पार्टी|बीजेपी|कांग्रेस)\b/.test(t)) return "Politics";
  if (/\b(क्रिकेट|फुटबॉल|खेल|टूर्नामेंट|खिलाड़ी|स्टेडियम|स्कोर)\b/.test(t)) return "Sports";
  if (/\b(फिल्म|सिनेमा|अभिनेता|अभिनेत्री|गायक|गायिका|संगीत|बॉलीवुड)\b/.test(t)) return "Entertainment";
  if (/\b(बाजार|शेयर|अर्थव्यवस्था|कंपनी|व्यापार|निवेश|रुपया|पैसा)\b/.test(t)) return "Business";
  if (/\b(तकनीक|कंप्यूटर|मोबाइल|एप|सॉफ्टवेयर|इंटरनेट|डिजिटल)\b/.test(t)) return "Technology";
  if (/\b(स्वास्थ्य|डॉक्टर|हॉस्पिटल|बीमारी|दवा|कोविड|वैक्सीन)\b/.test(t)) return "Health";
  if (/\b(पर्यावरण|वन|जंगल|पेड़|प्रदूषण|जलवायु|हिमालय|गंगा)\b/.test(t)) return "Environment";
  if (/\b(स्कूल|कॉलेज|विद्यालय|शिक्षा|परीक्षा|रिजल्ट|विद्यार्थी)\b/.test(t)) return "Education";
  if (/\b(पर्यटन|यात्रा|टूरिस्ट|होटल|रिसोर्ट|पहाड़|तीर्थ|धाम)\b/.test(t)) return "Tourism";
  if (/\b(संस्कृति|त्योहार|उत्सव|परंपरा|लोक|नृत्य|गीत|कला)\b/.test(t)) return "Culture";
  if (/\b(खाना|फैशन|शादी|रिश्ता|जीवनशैली|सौंदर्य|आराम)\b/.test(t)) return "Lifestyle";
  if (/\b(मौसम|बारिश|बर्फ|तूफान|बाढ़|सर्दी|गर्मी|तापमान)\b/.test(t)) return "Weather";
  
  // English keywords as fallback
  if (/\b(police|murder|accident|crime|arrest|case|court|jail)\b/.test(t)) return "Crime";
  if (/\b(election|minister|government|mp|mla|politic|party|bjp|congress)\b/.test(t)) return "Politics";
  if (/\b(match|score|tournament|cricket|football|player|sports|stadium)\b/.test(t)) return "Sports";
  if (/\b(movie|film|actor|song|celebrity|bollywood|tv|music)\b/.test(t)) return "Entertainment";
  if (/\b(stock|market|economy|business|company|shares|price|money)\b/.test(t)) return "Business";
  if (/\b(tech|ai|software|startup|google|microsoft|apple|computer)\b/.test(t)) return "Technology";
  if (/\b(health|covid|hospital|doctor|disease|vaccine|medicine)\b/.test(t)) return "Health";
  if (/\b(climate|forest|river|pollution|environment|wildlife|tree)\b/.test(t)) return "Environment";
  if (/\b(school|college|education|exam|university|student|result)\b/.test(t)) return "Education";
  if (/\b(tourism|travel|tourist|hotel|resort|mountain|temple)\b/.test(t)) return "Tourism";
  if (/\b(culture|festival|tradition|art|dance|music|custom)\b/.test(t)) return "Culture";
  if (/\b(food|travel|fashion|marriage|relationship|lifestyle|beauty)\b/.test(t)) return "Lifestyle";
  if (/\b(weather|rain|storm|flood|temperature|snow|cold|heat)\b/.test(t)) return "Weather";
  
  return "Other";
}

/* -------------------- HINDI LANGUAGE DETECTION -------------------- */
function isHindiContent(text) {
  if (!text) return false;
  
  // Hindi Unicode range: Devanagari (0900-097F), Devanagari Extended (A8E0-A8FF)
  const hindiRegex = /[\u0900-\u097F\uA8E0-\uA8FF]/;
  
  // Count Hindi characters
  const hindiChars = text.match(hindiRegex) || [];
  const totalChars = text.length;
  
  // If more than 30% characters are Hindi, consider it Hindi content
  return (hindiChars.length / totalChars) > 0.3;
}

/* -------------------- HINDI NEWS API FUNCTIONS -------------------- */

// RSS Feed Fetcher for Hindi sources
async function fetchHindiRSSFeed(feedUrl, maxItems = 10, sourceName = "") {
  try {
    console.log(`📡 Fetching Hindi RSS: ${feedUrl}`);
    
    const response = await fetch(feedUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml",
        "Accept-Language": "hi, en-US;q=0.9, en;q=0.8"
      },
      timeout: 15000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    let xmlText = await response.text();
    xmlText = sanitizeXml(xmlText);
    
    const feed = await parser.parseString(xmlText);
    
    if (!feed.items || feed.items.length === 0) {
      console.warn(`No items in Hindi feed: ${feedUrl}`);
      return [];
    }
    
    // Sort by date (newest first)
    let items = feed.items
      .filter(item => {
        // Filter for Hindi content
        const title = item.title || "";
        const desc = item.description || item.contentSnippet || "";
        const content = title + " " + desc;
        return isHindiContent(content);
      })
      .sort((a, b) => {
        const dateA = new Date(a.pubDate || a.isoDate || 0);
        const dateB = new Date(b.pubDate || b.isoDate || 0);
        return dateB - dateA;
      })
      .slice(0, maxItems);
    
    console.log(`✅ Fetched ${items.length} Hindi items from RSS: ${sourceName || feedUrl}`);
    
    return items.map(item => {
      // Extract image from various RSS formats
      let image = null;
      
      if (item.enclosure) {
        const enclosure = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
        if (enclosure && enclosure.url && enclosure.type && enclosure.type.startsWith('image/')) {
          image = enclosure.url;
        }
      }
      
      if (!image && item['media:content']) {
        const media = Array.isArray(item['media:content']) ? item['media:content'][0] : item['media:content'];
        if (media && media.url) {
          image = media.url;
        }
      }
      
      if (!image && item['media:thumbnail']) {
        const thumbnail = Array.isArray(item['media:thumbnail']) ? item['media:thumbnail'][0] : item['media:thumbnail'];
        if (thumbnail && thumbnail.url) {
          image = thumbnail.url;
        }
      }
      
      if (!image && item.content && item.content.includes('<img')) {
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
        pubDate: item.pubDate || item.isoDate,
        source: sourceName || feed.title || feedUrl,
        language: "hi",
        isHindi: true
      };
    });
    
  } catch (error) {
    console.warn(`❌ Failed to fetch Hindi RSS ${feedUrl}:`, error.message);
    return [];
  }
}

// GNews Hindi API Integration
async function fetchHindiGNewsAPI(params) {
  try {
    const { q, lang, country, max, sortby } = params;
    const apiKey = process.env.GNEWS_API_KEY;
    
    if (!apiKey) {
      console.warn("GNEWS_API_KEY not configured, skipping GNews Hindi");
      return [];
    }
    
    // Ensure Hindi language
    const queryLang = lang === "hi" ? "hi" : "hi";
    
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${queryLang}&country=${country || 'in'}&max=${max || 10}&apikey=${apiKey}&sortby=${sortby || 'publishedAt'}`;
    
    console.log(`📡 Fetching Hindi GNews: ${q} (${queryLang}, sort: ${sortby})`);
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews Hindi HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }
    
    const data = await response.json();
    let articles = data.articles || [];
    
    // Filter for Hindi content
    articles = articles.filter(article => {
      const content = (article.title || "") + " " + (article.description || "");
      return isHindiContent(content);
    });
    
    // Sort by date (newest first)
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });
    
    console.log(`✅ GNews Hindi returned ${articles.length} articles`);
    
    return articles.map(article => ({
      title: article.title || 'No Title',
      description: article.description || article.content || '',
      url: article.url,
      image: article.image,
      pubDate: article.publishedAt,
      source: article.source?.name || "GNews Hindi",
      language: "hi",
      isHindi: true
    }));
    
  } catch (error) {
    console.warn(`❌ GNews Hindi fetch failed:`, error.message);
    return [];
  }
}

/* -------------------- Normalize articles to common format -------------------- */
function normalizeHindiArticle(apiArticle, sourceConfig) {
  return {
    title: apiArticle.title || 'No Title',
    description: apiArticle.description || '',
    url: apiArticle.url,
    image: apiArticle.image,
    pubDate: apiArticle.pubDate || apiArticle.publishedAt,
    source: apiArticle.source || sourceConfig.name,
    language: apiArticle.language || sourceConfig.language || "hi",
    isHindi: apiArticle.isHindi || true,
    meta: {
      api: sourceConfig.type || "RSS",
      sourceName: sourceConfig.name,
      isRegional: sourceConfig.config?.isRegional || false,
      region: sourceConfig.config?.region || "unknown",
      isLatest: true
    }
  };
}

/* -------------------- CONTENT ENHANCEMENT FUNCTIONS -------------------- */

// Enhanced Article Content Fetcher for Hindi sites
async function fetchHindiArticleBody(url) {
  try {
    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "hi, en-US;q=0.9, en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
      },
      timeout: 20000
    });
    
    if (!res.ok) {
      console.log(`❌ Failed to fetch ${url}: HTTP ${res.status}`);
      return null;
    }
    
    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Remove unwanted elements common in Hindi news sites
    $('script, style, nav, footer, header, aside, .sidebar, .advertisement, .ads, .social-share, .trending, .recommended, .related').remove();
    
    // Hindi news sites content selectors
    const hindiContentSelectors = [
      'article', 
      '.article-body', 
      '.story-body', 
      '.story-content',
      '.entry-content',
      '.post-content',
      '.td-post-content',
      '.news-detail',
      '.wp-block-post-content',
      '.ArticleBody',
      '.cn__content',
      '.story-section',
      '.article-container',
      '.fullstory',
      '.story-element',
      '.content',
      '.storydetails',
      '.news_content',
      '.news-article',
      '.article-text'
    ];
    
    let mainContent = '';
    let contentElement = null;
    
    for (const selector of hindiContentSelectors) {
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
    
    // Fallback: collect all paragraphs
    if (!contentElement || mainContent.length < 1000) {
      const paragraphs = [];
      $('p, h2, h3, .para, .text, .description').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 50 && 
            !text.includes('©') && 
            !text.includes('Copyright') &&
            !text.includes('ADVERTISEMENT') &&
            !text.includes('फॉलो करें') &&
            !text.includes('ट्रेंडिंग') &&
            isHindiContent(text)) {
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
    console.warn(`❌ Failed to fetch Hindi article from ${url}:`, e.message);
    return null;
  }
}

// Extract Videos from Hindi Articles
async function extractVideosFromHindiArticle(url) {
  try {
    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "hi, en-US;q=0.9, en;q=0.8"
      },
      timeout: 15000
    });
    
    if (!res.ok) return null;
    
    const html = await res.text();
    const $ = cheerio.load(html);
    
    const videos = [];
    
    // Extract YouTube videos (common in Hindi news)
    $('iframe[src*="youtube.com"], iframe[src*="youtu.be"], .youtube-embed, .video-container iframe').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && src.includes('youtube')) {
        videos.push({
          type: 'youtube',
          url: src,
          embed_code: `<iframe src="${src}" frameborder="0" allowfullscreen></iframe>`
        });
      }
    });
    
    // Extract video links
    $('a[href*="youtube.com"], a[href*="youtu.be"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.includes('youtube')) {
        videos.push({
          type: 'youtube_link',
          url: href,
          embed_code: `<a href="${href}" target="_blank">यूट्यूब वीडियो देखें</a>`
        });
      }
    });
    
    return videos.length > 0 ? videos : null;
    
  } catch (error) {
    console.warn(`❌ Failed to extract videos from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- HINDI AI REWRITING -------------------- */

// OpenRouter for Hindi Rewriting
async function rewriteHindiWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }
  
  const prompt = `तुम एक अनुभवी हिंदी पत्रकार हो। निम्नलिखित समाचार को विस्तार से कम से कम 400-500 शब्दों में रीराइट करो। 

निम्नलिखित दिशानिर्देशों का कड़ाई से पालन करें:
1. विस्तृत और जानकारीपूर्ण लेख लिखें (कम से कम 400 शब्द)
2. केवल हिंदी देवनागरी लिपि में लिखें, कोई अंग्रेजी नहीं
3. समाचार को संपूर्ण विवरण दें - क्या, कहाँ, कब, क्यों, कैसे
4. तथ्यात्मक, आकर्षक और सरल भाषा का प्रयोग करें
5. यदि मूल लेख में वीडियो/फोटो है तो उसका उल्लेख करें
6. उत्तराखंड से संबंधित खबरों में स्थानीय संदर्भ जोड़ें

शीर्षक: ${title}

मुख्य जानकारी: ${content.substring(0, 1200)}`;
  
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
      max_tokens: 2000,
      temperature: 0.3
    }),
    timeout: 60000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 500) {
    throw new Error("OpenRouter returned empty or too short content");
  }
  
  return aiContent;
}

// Groq for Hindi Rewriting
async function rewriteHindiWithGroq(title, content) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured");
  }
  
  const prompt = `तुम एक अनुभवी हिंदी पत्रकार हो। निम्नलिखित समाचार को विस्तार से कम से कम 400-500 शब्दों में रीराइट करो। 

निम्नलिखित दिशानिर्देशों का कड़ाई से पालन करें:
1. विस्तृत और जानकारीपूर्ण लेख लिखें (कम से कम 400 शब्द)
2. केवल हिंदी देवनागरी लिपि में लिखें, कोई अंग्रेजी नहीं
3. समाचार को संपूर्ण विवरण दें - क्या, कहाँ, कब, क्यों, कैसे
4. तथ्यात्मक, आकर्षक और सरल भाषा का प्रयोग करें
5. यदि मूल लेख में वीडियो/फोटो है तो उसका उल्लेख करें
6. उत्तराखंड से संबंधित खबरों में स्थानीय संदर्भ जोड़ें

शीर्षक: ${title}

मुख्य जानकारी: ${content.substring(0, 1200)}`;
  
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
      max_tokens: 2000,
      temperature: 0.3
    }),
    timeout: 40000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 500) {
    throw new Error("Groq returned empty or too short content");
  }
  
  return aiContent;
}

// Enhanced Hindi Fallback Generator
function generateHindiFallback(title, content, region = "uttarakhand") {
  const baseContent = content.length > 300 ? content.substring(0, 600) : content;
  
  const uttarakhandTemplates = [
    `${title} - यह खबर उत्तराखंड में चर्चा का विषय बनी हुई है। स्थानीय सूत्रों के अनुसार, ${baseContent}... उत्तराखंड प्रशासन ने मामले में त्वरित कार्रवाई करते हुए जांच शुरू कर दी है। अधिकारियों का कहना है कि जल्द ही आधिकारिक बयान जारी किया जाएगा।
    
    इस मामले ने स्थानीय निवासियों की चिंता बढ़ा दी है। ग्रामीणों ने प्रशासन से त्वरित न्याय की मांग की है। विशेषज्ञों का मानना है कि यह घटना भविष्य के लिए महत्वपूर्ण सबक देती है। उत्तराखंड सरकार ने मामले की गंभीरता को समझते हुए उच्चस्तरीय जांच टीम गठित की है।
    
    स्थानीय प्रशासनिक अधिकारियों ने बताया कि घटना की तह तक जाने के लिए हर संभव प्रयास किए जा रहे हैं। पुलिस और प्रशासनिक टीमें घटनास्थल पर मौजूद हैं और तथ्यों का पता लगा रही हैं। जिला प्रशासन ने लोगों से शांति बनाए रखने की अपील की है।`
  ];
  
  const indiaTemplates = [
    `${title} - यह समाचार देश भर में चर्चा में है। आधिकारिक सूत्रों के मुताबिक, ${baseContent}... केंद्र सरकार ने मामले पर गंभीरता से विचार करते हुए जांच के आदेश दिए हैं।
    
    इस घटना ने राष्ट्रीय स्तर पर चर्चा शुरू कर दी है। विपक्षी दलों ने सरकार से त्वरित कार्रवाई की मांग की है। विशेषज्ञों का मानना है कि इस मामले में तत्काल ध्यान देने की आवश्यकता है। सरकारी अधिकारियों ने बताया कि पूरी जानकारी जुटाई जा रही है।
    
    संबंधित मंत्रालय ने एक बयान जारी कर कहा है कि मामले की गहन जांच की जा रही है। सरकार हर संभव कदम उठाएगी ताकि ऐसी घटनाओं को भविष्य में रोका जा सके। जनता से अनुरोध है कि अफवाहों पर ध्यान न दें और आधिकारिक सूचनाओं का इंतजार करें।`
  ];
  
  const template = region === "uttarakhand" ? 
    uttarakhandTemplates[0] : 
    indiaTemplates[0];
  
  return template;
}

/* -------------------- PARALLEL HINDI AI PROCESSING -------------------- */
async function rewriteHindiWithParallelAI(title, content, region = "uttarakhand", hasVideos = false) {
  const providers = [];
  
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      fn: () => rewriteHindiWithOpenRouter(title, content),
      timeout: 60000
    });
  }
  
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      fn: () => rewriteHindiWithGroq(title, content),
      timeout: 45000
    });
  }
  
  if (providers.length === 0) {
    const fallbackContent = generateHindiFallback(title, content, region);
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
      
      const parsed = parseHindiAIResponse(aiContent);
      const wordCount = parsed.content.split(/\s+/).length;
      
      if (parsed.content && wordCount >= 350) {
        let finalContent = parsed.content;
        if (hasVideos) {
          finalContent = finalContent + "\n\n[इस खबर से जुड़ा वीडियो भी उपलब्ध है। नीचे दिए गए लिंक से वीडियो देख सकते हैं।]";
        }
        
        // Add region-specific closing if needed
        if (region === "uttarakhand" && !finalContent.includes("उत्तराखंड")) {
          finalContent = finalContent + "\n\nयह खबर उत्तराखंड के लिए विशेष रूप से महत्वपूर्ण है।";
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
  
  const fallbackContent = generateHindiFallback(title, content, region);
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
function parseHindiAIResponse(aiOutput) {
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

/* -------------------- Process Hindi News Item -------------------- */
async function processHindiNewsItem(item, sourceType = "api") {
  try {
    // Skip if already exists
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
    
    console.log(`🔄 Processing Hindi: ${item.title.substring(0, 50)}...`);
    
    let articleContent = item.description || "";
    let articleImage = item.image || null;
    let videos = [];
    
    // Fetch content, image and videos in parallel
    if (item.url) {
      try {
        const [fetchedContent, fetchedImage, fetchedVideos] = await Promise.allSettled([
          fetchHindiArticleBody(item.url),
          fetchArticleImage(item.url),
          extractVideosFromHindiArticle(item.url)
        ]);
        
        if (fetchedContent.status === 'fulfilled' && fetchedContent.value && fetchedContent.value.length > 300) {
          articleContent = fetchedContent.value;
          console.log(`   📝 Fetched ${articleContent.length} chars of Hindi content`);
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
    
    // Ensure we have enough content
    if (!articleContent || articleContent.length < 200) {
      articleContent = item.title + ". " + (item.description || "");
    }
    
    // Determine region for AI context
    const sourceHost = item.url ? new URL(item.url).hostname : "";
    const region = detectRegionFromText(item.title + " " + articleContent, sourceHost);
    
    // Rewrite with Hindi AI
    const aiResult = await rewriteHindiWithParallelAI(item.title, articleContent, region, videos.length > 0);
    
    if (!aiResult.success) {
      console.log(`❌ Hindi AI rewrite failed`);
      return null;
    }
    
    const slug = makeSlug(aiResult.title);
    const fullText = aiResult.title + " " + aiResult.content;
    const genre = detectGenreKeyword(fullText);
    
    const record = {
      title: aiResult.title,
      slug: slug,
      source_url: item.url || "",
      ai_content: aiResult.content,
      short_desc: aiResult.content.substring(0, 300) + "...",
      image_url: articleImage || getDefaultImage(genre, region),
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      region: region,
      genre: genre,
      language: "hi",
      meta: {
        original_title: item.title,
        source: item.source || sourceType,
        ai_provider: aiResult.provider,
        word_count: aiResult.wordCount,
        image_source: articleImage ? 'scraped' : 'default',
        source_name: item.meta?.sourceName || item.source || "unknown",
        is_regional: item.meta?.isRegional || false,
        has_videos: videos.length > 0,
        videos: videos.length > 0 ? videos : null,
        is_latest: true,
        is_hindi: true
      }
    };
    
    const { error } = await supabase.from("ai_news").insert(record);
    
    if (error) {
      console.error(`❌ Database error:`, error.message);
      return null;
    }
    
    console.log(`✅ Added Hindi: ${aiResult.title.substring(0, 50)}...`);
    console.log(`   📊 ${aiResult.wordCount} words, ${aiResult.provider}`);
    console.log(`   🌍 Region: ${region}`);
    console.log(`   📷 Image: ${record.image_url ? 'Yes' : 'No'}`);
    console.log(`   🎥 Videos: ${videos.length}`);
    console.log(`   📅 Published: ${new Date(record.published_at).toLocaleTimeString('hi-IN')}`);
    
    return record;
    
  } catch (error) {
    console.error(`❌ Error processing Hindi item:`, error.message);
    return null;
  }
}

/* -------------------- MAIN PROCESSING FUNCTION - UTTARAKHAND PRIORITY -------------------- */
async function processHindiNews() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 STARTING HINDI NEWS PROCESSING - UTTARAKHAND PRIORITY");
  console.log("=".repeat(70));
  console.log("📰 FETCHING ONLY HINDI NEWS (Uttarakhand → National)");
  console.log("=".repeat(70));
  
  const allItems = [];
  const sourceStats = {};
  
  // Sort sources by priority (Uttarakhand first)
  const sourcesByPriority = Object.entries(UTTARAKHAND_REGIONAL_SOURCES)
    .map(([key, config]) => ({ key, ...config }))
    .sort((a, b) => a.priority - b.priority);
  
  console.log(`📊 Processing ${sourcesByPriority.length} Hindi sources...\n`);
  
  // Process sources in priority order
  for (const source of sourcesByPriority) {
    try {
      console.log(`🔍 [Priority ${source.priority}] Fetching ${source.name} (${source.language})...`);
      
      let rawArticles = [];
      
      switch (source.type) {
        case "RSS":
          rawArticles = await fetchHindiRSSFeed(
            source.config.url, 
            source.config.maxItems, 
            source.name
          );
          break;
          
        case "GNEWS":
          rawArticles = await fetchHindiGNewsAPI(source.config);
          break;
      }
      
      // Sort by date (newest first)
      rawArticles.sort((a, b) => {
        const dateA = new Date(a.pubDate || a.publishedAt || 0);
        const dateB = new Date(b.pubDate || b.publishedAt || 0);
        return dateB - dateA;
      });
      
      const normalizedArticles = rawArticles.map(article => 
        normalizeHindiArticle(article, source)
      );
      
      allItems.push(...normalizedArticles);
      sourceStats[source.name] = normalizedArticles.length;
      
      console.log(`   ✅ Added ${normalizedArticles.length} Hindi articles`);
      
      // Short delay between sources
      await sleep(800);
      
    } catch (error) {
      console.log(`   ❌ Failed to fetch ${source.name}:`, error.message);
      sourceStats[source.name] = 0;
    }
  }
  
  console.log("\n" + "=".repeat(70));
  console.log("📈 HINDI NEWS STATISTICS:");
  console.log("=".repeat(70));
  
  // Show Uttarakhand sources first
  const uttarakhandSources = Object.entries(sourceStats)
    .filter(([name]) => name.toLowerCase().includes('uttarakhand') || name.includes('Dehradun') || name.includes('Haridwar'));
  
  const nationalSources = Object.entries(sourceStats)
    .filter(([name]) => !name.toLowerCase().includes('uttarakhand') && !name.includes('Dehradun') && !name.includes('Haridwar'));
  
  console.log("\n🏔️  UTTARAKHAND REGIONAL SOURCES:");
  uttarakhandSources.forEach(([name, count]) => {
    console.log(`   ${name}: ${count} articles`);
  });
  
  console.log("\n🇮🇳 NATIONAL HINDI SOURCES:");
  nationalSources.forEach(([name, count]) => {
    console.log(`   ${name}: ${count} articles`);
  });
  
  const totalUttarakhand = uttarakhandSources.reduce((sum, [_, count]) => sum + count, 0);
  const totalNational = nationalSources.reduce((sum, [_, count]) => sum + count, 0);
  
  console.log("\n📊 TOTALS:");
  console.log(`   Uttarakhand: ${totalUttarakhand} articles`);
  console.log(`   National: ${totalNational} articles`);
  console.log(`   TOTAL HINDI ITEMS: ${allItems.length}`);
  
  // Remove duplicates by URL
  const uniqueItems = [];
  const seenUrls = new Set();
  
  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }
  
  console.log(`📊 UNIQUE HINDI ITEMS: ${uniqueItems.length}`);
  
  // Sort ALL items by date (newest first) before processing
  const sortedItems = uniqueItems.sort((a, b) => {
    const dateA = new Date(a.pubDate || a.published_at || 0);
    const dateB = new Date(b.pubDate || b.published_at || 0);
    return dateB - dateA;
  });
  
  // Show the newest articles being processed
  console.log("\n🔥 NEWEST ARTICLES TO PROCESS (sorted by date):");
  sortedItems.slice(0, 15).forEach((item, index) => {
    const date = new Date(item.pubDate || item.published_at || Date.now());
    const region = item.meta?.region || detectRegionFromText(item.title);
    const prefix = region === "uttarakhand" ? "🏔️" : "🇮🇳";
    console.log(`   ${index + 1}. ${prefix} ${item.title.substring(0, 60)}... (${date.toLocaleTimeString('hi-IN')})`);
  });
  
  // Process articles with priority to Uttarakhand
  const uttarakhandItems = sortedItems.filter(item => 
    item.meta?.region === "uttarakhand" || detectRegionFromText(item.title) === "uttarakhand"
  );
  
  const nationalItems = sortedItems.filter(item => 
    item.meta?.region === "india" || detectRegionFromText(item.title) === "india"
  );
  
  console.log(`\n🔄 PROCESSING PRIORITY:`);
  console.log(`   🏔️  Uttarakhand: ${uttarakhandItems.length} articles`);
  console.log(`   🇮🇳 National: ${nationalItems.length} articles`);
  
  // Process Uttarakhand articles first (up to 8)
  const uttarakhandToProcess = uttarakhandItems.slice(0, 8);
  // Then National articles (up to 4)
  const nationalToProcess = nationalItems.slice(0, 4);
  
  const itemsToProcess = [...uttarakhandToProcess, ...nationalToProcess];
  
  console.log(`\n🔄 Processing ${itemsToProcess.length} articles total...\n`);
  
  const processPromises = [];
  
  for (const item of itemsToProcess) {
    processPromises.push(
      enqueueTask(() => processHindiNewsItem(item, "hindi_api"))
    );
  }
  
  const processedResults = await Promise.allSettled(processPromises);
  
  const successful = processedResults.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  const failed = processedResults.filter(r => r.status === 'rejected').length;
  
  console.log("\n" + "=".repeat(70));
  console.log(`🎯 HINDI NEWS PROCESSING COMPLETE:`);
  console.log(`   ✅ ${successful} Hindi articles added`);
  console.log(`   ❌ ${failed} articles failed`);
  console.log(`   ⏭️ ${itemsToProcess.length - successful - failed} duplicates skipped`);
  console.log("=".repeat(70) + "\n");
  
  return successful;
}

/* -------------------- Schedule -------------------- */
let isProcessing = false;

async function runHindiScheduledProcessing() {
  if (isProcessing) {
    console.log("⚠️  Processing already in progress, skipping...");
    return;
  }
  
  isProcessing = true;
  
  try {
    await processHindiNews();
    
    // Cleanup old articles (keep 7 days for Hindi news)
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error, count } = await supabase
        .from("ai_news")
        .delete()
        .lt("created_at", cutoff);
        
      if (error) {
        console.warn("Cleanup error:", error.message);
      } else {
        console.log(`🧹 Cleanup completed: ${count || 0} old articles (older than 7 days) removed`);
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
setTimeout(runHindiScheduledProcessing, 5000);

// Run every 15 minutes for fresh Hindi news
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 15;
setInterval(runHindiScheduledProcessing, POLL_MINUTES * 60 * 1000);

/* -------------------- API Routes -------------------- */
app.get("/api/news", async (req, res) => {
  try {
    const { limit = 30, genre, region, page = 1, language = "hi" } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    let query = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta,language", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    // Filter by language (Hindi only by default)
    if (language && language !== "all") {
      query = query.eq("language", language);
    } else {
      // Default: Hindi only
      query = query.eq("language", "hi");
    }
    
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

app.get("/api/news/uttarakhand", async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 50);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    const { data, error, count } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta,language", { count: "exact" })
      .eq("region", "uttarakhand")
      .eq("language", "hi")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
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

app.get("/api/news/latest", async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const pageSize = Math.min(Number(limit), 30);

    const { data, error } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta,language")
      .eq("language", "hi")
      .order("created_at", { ascending: false })
      .limit(pageSize);

    if (error) {
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
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
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,language")
      .eq("language", "hi")
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
      message: "Hindi news processing started in background" 
    });
    
    runHindiScheduledProcessing();
    
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
      .select("genre, region, created_at, meta, language")
      .eq("language", "hi")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const stats = {
      total: data?.length || 0,
      byGenre: {},
      byRegion: {},
      bySource: {},
      latestArticle: null,
      wordStats: {
        totalWords: 0,
        averageWords: 0
      },
      uttarakhandStats: {
        total: 0,
        byDistrict: {}
      }
    };

    let latestDate = new Date(0);
    
    data?.forEach(item => {
      stats.byGenre[item.genre] = (stats.byGenre[item.genre] || 0) + 1;
      stats.byRegion[item.region] = (stats.byRegion[item.region] || 0) + 1;
      
      const source = item.meta?.source_name || "unknown";
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      
      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;
      
      // Uttarakhand specific stats
      if (item.region === "uttarakhand") {
        stats.uttarakhandStats.total++;
        
        // Detect district from title
        const districts = {
          "dehradun": "देहरादून",
          "haridwar": "हरिद्वार", 
          "nainital": "नैनीताल",
          "almora": "अल्मोड़ा",
          "pithoragarh": "पिथौरागढ़",
          "rudraprayag": "रुद्रप्रयाग",
          "chamoli": "चमोली",
          "pauri": "पौड़ी",
          "champawat": "चंपावत",
          "uttarkashi": "उत्तरकाशी",
          "bageshwar": "बागेश्वर",
          "tehri": "टिहरी"
        };
        
        const title = (item.meta?.original_title || "").toLowerCase();
        for (const [eng, hindi] of Object.entries(districts)) {
          if (title.includes(eng) || title.includes(hindi)) {
            stats.uttarakhandStats.byDistrict[hindi] = (stats.uttarakhandStats.byDistrict[hindi] || 0) + 1;
            break;
          }
        }
      }
      
      // Track latest article
      const itemDate = new Date(item.created_at);
      if (itemDate > latestDate) {
        latestDate = itemDate;
        stats.latestArticle = {
          time: item.created_at,
          age: Math.floor((Date.now() - itemDate.getTime()) / (1000 * 60)) + " minutes ago",
          region: item.region,
          title: item.meta?.original_title || "Unknown"
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
  if (process.env.GNEWS_API_KEY) apiSources.push("GNews Hindi");
  
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Hindi News AI Rewriter - UTTARAKHAND PRIORITY",
    version: "8.0",
    focus: "Hindi news only with Uttarakhand priority",
    features: [
      "Hindi language only",
      "Uttarakhand regional portals priority", 
      "400+ word Hindi articles",
      "Video extraction",
      "Real-time updates",
      "Newest articles processed first"
    ],
    ai_providers: providers.length > 0 ? providers : ["Hindi Fallback"],
    news_sources: ["Jagran Uttarakhand", "Amar Ujala Uttarakhand", "Divya Bhaskar", "Hindustan Uttarakhand", "News18 Hindi", "Aaj Tak"],
    config: {
      poll_interval: `${POLL_MINUTES} minutes`,
      focus: "Hindi news, Uttarakhand priority",
      cleanup: "7 days retention",
      language: "Hindi only",
      priority_order: "Uttarakhand → National Hindi"
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Hindi News Rewriter API - UTTARAKHAND PRIORITY",
    version: "8.0",
    description: "Fetching and rewriting ONLY Hindi news with priority to Uttarakhand regional portals",
    features: [
      "HINDI LANGUAGE ONLY",
      "UTTARAKHAND REGIONAL PORTALS PRIORITY",
      "400+ word detailed Hindi articles",
      "Twitter/YouTube video extraction",
      "Real-time news fetching",
      "Newest articles processed first",
      "Priority: Uttarakhand → National Hindi",
      "Frequent updates (every 15 minutes)"
    ],
    endpoints: {
      all_news: "/api/news (Hindi only)",
      uttarakhand_news: "/api/news/uttarakhand",
      latest_news: "/api/news/latest",
      article: "/api/news/:slug",
      search: "/api/search",
      stats: "/api/stats",
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
  
  🏔️  UTTARAKHAND PRIORITY CONFIGURATION:
  - Max concurrent tasks: ${MAX_CONCURRENT_TASKS}
  - Poll interval: ${POLL_MINUTES} minutes
  - Focus: HINDI NEWS ONLY
  - Priority: Uttarakhand Regional Portals
  - Retention: 7 days cleanup
  - Features: 400+ words Hindi, video extraction
  
  📰 HINDI NEWS SOURCES (Priority Order):
  
  1. 🏔️  UTTARAKHAND REGIONAL:
     - Jagran Uttarakhand (RSS)
     - Amar Ujala Uttarakhand (RSS) 
     - Divya Bhaskar Uttarakhand (RSS)
     - Hindustan Uttarakhand (RSS)
     - Nava Uttarakhand (RSS)
     - Dehradun News (RSS)
     - Haridwar News (RSS)
     - GNews Uttarakhand Hindi (API)
  
  2. 🇮🇳 NATIONAL HINDI:
     - News18 Hindi (RSS)
     - Aaj Tak (RSS)
     - India TV Hindi (RSS)
     - GNews India Hindi (API)
  
  ⚡ SYSTEM FEATURES:
  - Hindi language detection and filtering
  - Uttarakhand regional news priority
  - Newest articles processed first
  - 400+ word detailed Hindi articles
  - District-wise Uttarakhand coverage
  
  📊 EXPECTED OUTPUT:
  - Only Hindi language content
  - Priority to Uttarakhand news
  - 400+ word detailed articles
  - Fresh content with every run
  
  🚀 Ready to deliver HINDI news with UTTARAKHAND priority!
  `);
});