// server.js - ENHANCED VERSION: LATEST HINDI NEWS (Uttarakhand → National → International)
// Main orchestration file - RSS and API fetching separated into modules
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const slugify = require("slugify");
const { createClient } = require("@supabase/supabase-js");

// Import separated modules
const { fetchRSSFeed, RSS_SOURCES } = require("./rss-fetcher");
const { fetchFromNewsAPI, fetchFromGNewsAPI, API_SOURCES } = require("./api-fetchers");

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

/* -------------------- Supabase -------------------- */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* -------------------- COMBINED NEWS SOURCES (LATEST, HINDI FOCUS) -------------------- */
const NEWS_SOURCES = {
  ...RSS_SOURCES,
  ...API_SOURCES
};

/* -------------------- Utils -------------------- */
function makeSlug(text) {
  return (
    slugify(String(text || "").slice(0, 120), { lower: true, strict: true }) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
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
  if (/\b(health|covid|hospital|doctor|disease|vaccine|स्वास्थ्य|डॉक्टर|बीमार)\b/.test(t)) return "Health";
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
    const $ = require("cheerio").load(html);

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
    const $ = require("cheerio").load(html);

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

/* -------------------- AGGRESSIVE AI CLEANING + WHOLE-ARTICLE REWRITE -------------------- */

/* Utilities: strip links, emails, phones, handles, hashtags, social UI */
function stripLinksAndHandles(text) {
  if (!text || typeof text !== 'string') return '';

  let t = String(text);

  // Normalize newlines
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove URLs (http(s) and www and short links)
  t = t.replace(/\bhttps?:\/\/[^\s]+/gi, ' ');
  t = t.replace(/\bwww\.[^\s]+/gi, ' ');
  t = t.replace(/\bbit\.ly\/[^\s]+/gi, ' ');

  // Remove mailto and emails
  t = t.replace(/\bmailto:[^\s]+/gi, ' ');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ');

  // Remove phone numbers (various formats, Indian + international)
  t = t.replace(/(\+?\d{1,3}[-.\s]?)?(\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g, ' ');

  // Remove social handles like @username and hashtags
  t = t.replace(/@[A-Za-z0-9_.-]{1,50}/g, ' ');
  t = t.replace(/#[A-Za-z0-9_\-]+/g, ' ');

  // Remove emojis (basic)
  t = t.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}]/gu, ' ');

  // Remove common social/share words (isolated)
  t = t.replace(/\b(Facebook|Twitter|X|LinkedIn|WhatsApp|Telegram|Share|शेयर|Follow|Subscribe|Like|Comment)\b/gi, ' ');

  // Remove "Follow us", "For more", CTA lines
  t = t.replace(/\b(Follow us on|Follow us|For more updates|For more|Read more|और पढ़ें|ज़्यादा जानें|Click here|Subscribe here)\b/gi, ' ');

  // Remove trailing social toolbar fragments in lines
  t = t.split('\n').map(line => {
    // remove lines that are mostly non-alphanumeric or very short social fragments
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^(share|share:|follow|follow:|connect|connect:)$/i.test(trimmed)) return '';
    if (/^(Facebook|X|Twitter|LinkedIn|WhatsApp|Telegram)[\s:]*$/i.test(trimmed)) return '';
    // remove lines with many punctuation typical of share widget
    if ((trimmed.match(/[^A-Za-z\u0900-\u097F0-9]{4,}/) || []).length > 0 && trimmed.length < 80) return '';
    return line;
  }).join('\n');

  // Remove leftover parentheses or brackets that only contain URLs/handles
  t = t.replace(/\(\s*(https?:\/\/|www\.|@)[^)]+\)/gi, ' ');
  t = t.replace(/\[\s*(https?:\/\/|www\.|@)[^\]]+\]/gi, ' ');

  // Collapse multiple spaces/newlines
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

/* Remove typical site noise (copyrights, source stamps, "ज़्यादा जानें" blocks) but do NOT remove facts */
function removeNoisyFragmentsPreserveContent(text) {
  if (!text) return '';

  let t = String(text);

  // Remove "ज़्यादा जानें" blocks and "ज़्यादा जानें" lines
  t = t.replace(/\b(ज़्यादा जानें|और पढ़ें|Read more|More details|ज़्यादा|जानें)\b/gi, ' ');

  // Remove "ज़्यादा जानें" style trailing blocks like "ज़्यादा जानें\nDevbhoomi Media\n..."
  t = t.replace(/\b(ज़्यादा जानें|और पढ़ें|ज़्यादा)\b[\s\S]{0,200}?$/gi, ' ');

  // Remove "Follow us" / "Sources" lines
  t = t.replace(/\b(Follow us|Sources?:|स्रोत:|Source:|चित्र:|Image:)\b[^\n]*/gi, ' ');

  // Remove repetitive small site tokens that are not part of the news content
  t = t.replace(/\b(Devbhoomi Media|देवभूमिमेडिया|Devbhoomimedia|DEHRADUN|Dehradun|प्रथम चरण में|ज़्यादा जानें)\b/gi, ' ');

  // Remove lines that are purely UI artifacts e.g., "News | Video | Photos" etc.
  t = t.split('\n').filter(line => {
    const s = line.trim();
    if (!s) return false;
    if (/^(News|Video|Photos|Gallery|View Gallery|तस्वीरें|वीडियो|संपादक|Editor|Tags?):?/i.test(s)) return false;
    // if line is extremely short and not likely to be content (<=3 words), drop it
    if (s.split(/\s+/).length <= 3 && s.length < 40 && /[^0-9a-zA-Z\u0900-\u097F]/.test(s)) return false;
    return true;
  }).join('\n');

  // Collapse and trim
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ').trim();

  return t;
}

/* Combined aggressive cleaner: preserves whole content but removes noise */
function aggressiveCleanArticle(text) {
  if (!text) return '';

  // 1. Strip links/handles/phones/emails first
  let cleaned = stripLinksAndHandles(text);

  // 2. Remove noisy fragments while trying to preserve content
  cleaned = removeNoisyFragmentsPreserveContent(cleaned);

  // 3. Strip HTML tags (keeping text)
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<\/?[^>]+(>|$)/g, '');

  // 4. Remove leftover JSON-like or spammy blocks
  cleaned = cleaned.replace(/\{(?:[^{}]|"(?:\\.|[^"\\])*")*\}/g, ' ');

  // 5. Trim and collapse whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/* Parse AI response (prefer JSON with title/content; if plain text, split into title+content) */
function parseAIResponseStrict(aiOutput) {
  if (!aiOutput) return null;
  const raw = String(aiOutput).trim();

  // Try JSON extraction
  const RE = /\{(?:[^{}]|"(?:\\.|[^"\\])*")*\}/g;
  const matches = raw.match(RE);
  if (matches) {
    for (const m of matches) {
      try {
        const obj = JSON.parse(m);
        const title = (obj.title || obj.headline || obj.title_hn || '').toString().trim();
        const content = (obj.content || obj.article || obj.body || obj.text || '').toString().trim();
        if (title || content) {
          return { title: title, content: content };
        }
      } catch (e) {
        // ignore parse error and continue
      }
    }
  }

  // Fallback: treat whole output as content; derive headline from first line or first sentence
  const cleaned = String(raw).replace(/\s{2,}/g, ' ').trim();
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  let title = '';
  let content = cleaned;

  if (lines.length > 0) {
    const first = lines[0];
    if (first.length >= 6 && first.length <= 200 && first.split(' ').length <= 20 && !/[।\.\?\!"]$/.test(first)) {
      title = first;
      content = cleaned.replace(first, '').trim();
    } else {
      // pick a candidate line
      const cand = lines.find(l => l.length >= 10 && l.length <= 160 && l.split(' ').length <= 25);
      if (cand) {
        title = cand;
        content = cleaned.replace(cand, '').trim();
      }
    }
  }

  // fallback to first sentence if nothing else
  if (!title && content) {
    const sentenceMatch = content.match(/^(.*?[।\.\?\!])\s/);
    if (sentenceMatch) {
      title = sentenceMatch[1].slice(0, 240).trim();
      content = content.replace(sentenceMatch[0], '').trim();
    } else {
      title = content.split('\n')[0].slice(0, 240).trim();
      content = content.split('\n').slice(1).join('\n').trim();
    }
  }

  return { title: title || '', content: content || '' };
}

/* Finalize article: ensure title present, don't add boilerplate */
function finalizeArticleStrict(title, content) {
  let t = (title || '').toString().trim();
  let c = (content || '').toString().trim();

  // Ensure we didn't return empty content: if empty, keep short fallback from content
  if (!c) {
    c = t;
    t = c.split(/\s+/).slice(0, 12).join(' ').slice(0, 200);
  }

  // Trim excessively long title/content
  t = t.slice(0, 300).trim();
  // keep content as-is (user requested whole rewrite), but collapse many newlines
  c = c.replace(/\n{4,}/g, '\n\n').trim();

  return { title: t, content: c, wordCount: (c.split(/\s+/).filter(Boolean) || []).length };
}

/* Helper: check proportion of Devanagari characters (lower threshold since input may contain names/places) */
function isMostlyDevanagari(text, threshold = 0.30) {
  if (!text) return false;
  const letters = text.replace(/[^A-Za-z\u0900-\u097F]/g, '');
  if (!letters) return false;
  const devCount = (letters.match(/[\u0900-\u097F]/g) || []).length;
  return (devCount / letters.length) >= threshold;
}

/* -------------------- LLM wrappers: require JSON; rewrite WHOLE cleaned content into Hindi -------------------- */

async function rewriteWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }

  const systemMsg = `You are an expert Hindi journalist. RETURN ONLY valid JSON as the single output.
The JSON MUST contain exactly two keys: "title" and "content".
- "title": a concise Hindi headline in Devanagari (8-120 chars).
- "content": the full article in Hindi (Devanagari). Rewrite the ENTIRE provided source content faithfully in Hindi, preserving facts, names, places, numbers and structure. Do NOT add speculation, generic investigation boilerplate, "यह समाचार", social-share tokens, source names, or calls-to-action.
Return only the JSON object (no explanation, no markdown, no code fences). If you cannot produce JSON, return only the Hindi article text (no extra commentary).`;

  const userMsg = `SOURCE CONTENT (cleaned):\n\n${content}\n\n---\nRewrite the ENTIRE above content into a clear, factual Hindi news article in Devanagari. Produce JSON { "title": "...", "content": "..." } OR only the Hindi article text if JSON is impossible.`;

  const body = {
    model: process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg }
    ],
    max_tokens: 3000,
    temperature: 0.05
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Hindi News Rewriter - Full Article"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenRouter API error ${res.status}: ${txt.slice(0, 500)}`);
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error("OpenRouter returned invalid JSON");

    let modelText = null;
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const c0 = data.choices[0];
      modelText = (c0.message && (c0.message.content || c0.message?.content?.trim())) || c0.text || null;
    } else if (data.output) {
      modelText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    }

    if (!modelText) throw new Error("OpenRouter returned empty content");
    return modelText;

  } catch (err) {
    if (err.name === 'AbortError') throw new Error("OpenRouter request timed out");
    throw new Error(`OpenRouter failed: ${err.message || err}`);
  }
}

async function rewriteWithGroq(title, content) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured");
  }

  const systemMsg = `You are an expert Hindi journalist. RETURN ONLY valid JSON as the single output.
The JSON MUST contain exactly two keys: "title" and "content".
Rewrite the ENTIRE provided source content into Hindi (Devanagari), preserving facts and numbers. Do NOT include social-share text, source footers, or speculative boilerplate.`;

  const userMsg = `CLEANED SOURCE:\n\n${content}\n\nPlease rewrite the whole content above into a Hindi news article and return JSON { "title": "...", "content": "..." } or only the article text if JSON cannot be produced.`;

  const body = {
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg }
    ],
    max_tokens: 2800,
    temperature: 0.05
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 70000);

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
      throw new Error(`Groq API error ${res.status}: ${txt.slice(0, 500)}`);
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Groq returned invalid JSON");

    let modelText = null;
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const c0 = data.choices[0];
      modelText = (c0.message && (c0.message.content || c0.message?.content?.trim())) || c0.text || null;
    } else if (data.output) {
      modelText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    }
    if (!modelText) throw new Error("Groq returned empty content");
    return modelText;

  } catch (err) {
    if (err.name === 'AbortError') throw new Error("Groq request timed out");
    throw new Error(`Groq failed: ${err.message || err}`);
  }
}

/* -------------------- Parallel runner: send full cleaned content and validate result -------------------- */
async function rewriteWithParallelAI(title, sourceContent, hasVideos = false) {
  // 1) Aggressively clean the source content (remove links & noise but preserve facts)
  const cleanedContent = aggressiveCleanArticle(sourceContent || title || '');

  // Providers list
  const providers = [];
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({ name: 'openrouter', fn: () => rewriteWithOpenRouter(title || '', cleanedContent), timeout: 90000 });
  }
  if (process.env.GROQ_API_KEY) {
    providers.push({ name: 'groq', fn: () => rewriteWithGroq(title || '', cleanedContent), timeout: 70000 });
  }

  // If no provider configured, return cleaned excerpt as fallback (short)
  if (providers.length === 0) {
    const fallbackText = cleanedContent.split(/\s+/).slice(0, 300).join(' ');
    const final = finalizeArticleStrict(title || '', fallbackText);
    return { success: true, title: final.title, content: final.content, provider: 'fallback', wordCount: final.wordCount };
  }

  // Call providers concurrently and inspect results
  const attempts = await Promise.allSettled(providers.map(p =>
    Promise.race([p.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), p.timeout))])
      .then(res => ({ ok: true, provider: p.name, res }))
      .catch(err => ({ ok: false, provider: p.name, error: err && err.message ? err.message : String(err) }))
  ));

  // Evaluate their outputs in order; prefer first valid
  for (const a of attempts) {
    if (!a || !a.ok) {
      console.warn(`AI provider ${a.provider} failed: ${a.error || 'unknown'}`);
      continue;
    }

    let raw = a.res;
    try {
      const parsed = parseAIResponseStrict(raw);

      if (!parsed || !parsed.content) {
        console.warn(`AI ${a.provider} produced empty parsed content — ignoring`);
        continue;
      }

      // Finalize - keep entire content as the model returned
      let final = finalizeArticleStrict(parsed.title, parsed.content);

      // Minimal length requirement - we expect full rewrite so enforce >= 100 words
      if (final.wordCount < 100) {
        console.warn(`AI ${a.provider} output too short (${final.wordCount} words) — ignoring`);
        continue;
      }

      // Ensure a reasonable fraction is Devanagari (but allow some Latin for names/units)
      if (!isMostlyDevanagari(final.content, 0.25)) {
        console.warn(`AI ${a.provider} output not sufficiently Devanagari — ignoring`);
        continue;
      }

      // Optionally append video marker (kept minimal)
      if (hasVideos) {
        final.content += '\n\n[वीडियो उपलब्ध]';
        final.wordCount = (final.content.split(/\s+/).filter(Boolean) || []).length;
      }

      return {
        success: true,
        title: final.title || title,
        content: final.content,
        provider: a.provider,
        wordCount: final.wordCount
      };

    } catch (e) {
      console.warn(`Parsing/validation error for provider ${a.provider}:`, e && e.message ? e.message : e);
      continue;
    }
  }

  // All providers failed -> fallback: return cleaned content truncated to reasonable size (no boilerplate)
  const fallback = aggressiveCleanArticle(sourceContent || title || '');
  const truncated = fallback.split(/\s+/).slice(0, 350).join(' ');
  const final = finalizeArticleStrict(title || '', truncated);
  return {
    success: true,
    title: final.title || title,
    content: final.content,
    provider: 'fallback',
    wordCount: final.wordCount
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
    const $ = require("cheerio").load(html);

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

    // Rewrite to Hindi (aggressively cleaned + whole-article rewrite)
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
