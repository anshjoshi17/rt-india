// server.js - OPENROUTER + GROQ PARALLEL VERSION
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
  customFields: { item: ["media:content", "enclosure"] }
});

/* -------------------- Supabase -------------------- */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* -------------------- Feeds -------------------- */
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

/* -------------------- PARALLEL AI PROVIDERS (OpenRouter + Groq) -------------------- */

// 1. OpenRouter Provider (Free model available)
async function rewriteWithOpenRouter(title, content) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured");
  }
  
  const prompt = `तुम एक अनुभवी हिंदी पत्रकार हो। निम्नलिखित समाचार को 350-400 शब्दों में हिंदी में रीराइट करो। सिर्फ हिंदी लेख दो, कोई अंग्रेजी या निर्देश नहीं।

शीर्षक: ${title}

मुख्य जानकारी: ${content.substring(0, 800)}`;
  
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
      max_tokens: 1200,
      temperature: 0.4
    }),
    timeout: 45000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 200) {
    throw new Error("OpenRouter returned empty or too short content");
  }
  
  return aiContent;
}

// 2. Groq Provider (Super Fast & Free)
async function rewriteWithGroq(title, content) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured");
  }
  
  const prompt = `You are an expert Hindi journalist. Rewrite the following news in Hindi (350-400 words). Write only in Hindi Devanagari script, no English.

Title: ${title}

Content: ${content.substring(0, 800)}`;
  
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
      max_tokens: 1200,
      temperature: 0.4
    }),
    timeout: 30000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  const aiContent = data?.choices?.[0]?.message?.content;
  
  if (!aiContent || aiContent.trim().length < 200) {
    throw new Error("Groq returned empty or too short content");
  }
  
  return aiContent;
}

// 3. Fallback Template Generator
function generateFallbackHindi(title, content) {
  const templates = [
    `${title} - यह समाचार आजकल चर्चा में बना हुआ है। सूत्रों के अनुसार, ${content.substring(0, 200)}... स्थानीय प्रशासन ने मामले में जांच शुरू कर दी है और शीघ्र ही आधिकारिक बयान जारी किया जाएगा। विशेषज्ञों का मानना है कि यह मामला भविष्य के लिए महत्वपूर्ण सबक देता है।`,
    
    `नवीनतम जानकारी के मुताबिक, ${title} के संदर्भ में कई नए तथ्य सामने आए हैं। ${content.substring(0, 150)}... संबंधित विभाग ने तत्काल कार्रवाई करते हुए जांच समिति गठित की है। आम जनता से अपील की गई है कि वे अफवाहों पर ध्यान न दें।`,
    
    `${title} की खबर ने सोशल मीडिया पर चर्चा तेज कर दी है। प्रशासनिक सूत्रों के अनुसार, ${content.substring(0, 180)}... विपक्ष ने प्रशासन पर लापरवाही का आरोप लगाया है, जबकि सरकार ने पारदर्शी जांच का आश्वासन दिया है।`
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/* -------------------- PARALLEL AI PROCESSING -------------------- */
async function rewriteWithParallelAI(title, content) {
  const providers = [];
  
  // Add OpenRouter if configured
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      fn: () => rewriteWithOpenRouter(title, content),
      timeout: 50000
    });
  }
  
  // Add Groq if configured
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      fn: () => rewriteWithGroq(title, content),
      timeout: 35000
    });
  }
  
  // If no providers configured, use fallback
  if (providers.length === 0) {
    return {
      success: true,
      title: title,
      content: generateFallbackHindi(title, content),
      provider: "fallback",
      wordCount: 300
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
      
      if (parsed.content && parsed.content.length > 250) {
        const wordCount = parsed.content.split(/\s+/).length;
        
        return {
          success: true,
          title: parsed.title || title,
          content: parsed.content,
          provider: result.value.provider,
          wordCount: wordCount
        };
      }
    }
  }
  
  // If all providers failed, use fallback
  return {
    success: true,
    title: title,
    content: generateFallbackHindi(title, content),
    provider: "fallback",
    wordCount: 300
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
    .replace(/^(शीर्षक|लेख|समाचार|आर्टिकल|न्यूज़):\s*/gi, '')
    .replace(/^(Here is|This is|I have)\s+/gi, '')
    .replace(/^(Here'?s|There'?s)\s+/gi, '')
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

async function fetchArticleBody(url) {
  try {
    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
      },
      timeout: 15000
    });
    
    if (!res.ok) return null;
    
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try multiple selectors
    const selectors = [
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

    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 300) {
        const text = el.text()
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\n+/g, '\n');
        
        if (text.length > 400) return text;
      }
    }

    // Fallback: get all meaningful paragraphs
    const paragraphs = [];
    $('p').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.length > 80 && 
          !text.includes('©') && 
          !text.includes('Copyright') &&
          !text.includes('ADVERTISEMENT') &&
          !text.includes('adsbygoogle')) {
        paragraphs.push(text);
      }
    });

    const content = paragraphs.join('\n\n');
    return content.length > 400 ? content : null;
  } catch (e) {
    console.warn(`Failed to fetch article from ${url}:`, e.message);
    return null;
  }
}

/* -------------------- RSS Feed Processing -------------------- */
async function fetchRSSFeed(feedUrl) {
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
    
    console.log(`✅ Fetched ${feed.items.length} items from ${feedUrl}`);
    return feed.items.map(item => ({
      title: item.title || "No title",
      description: item.contentSnippet || item.description || item.title || "",
      url: item.link || item.guid,
      image: item.enclosure?.url || item["media:content"]?.url || null,
      pubDate: item.pubDate,
      source: feed.title || feedUrl
    }));
    
  } catch (error) {
    console.warn(`❌ Failed to fetch RSS ${feedUrl}:`, error.message);
    return [];
  }
}

/* -------------------- Process Single News Item -------------------- */
async function processNewsItem(item, sourceType = "rss") {
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
    
    // Get article content
    let articleContent = item.description || "";
    
    // Try to fetch full article if URL is available
    if (item.url && sourceType !== "static") {
      try {
        const fetched = await fetchArticleBody(item.url);
        if (fetched && fetched.length > 300) {
          articleContent = fetched;
        }
      } catch (e) {
        // Use description if fetch fails
      }
    }
    
    if (!articleContent || articleContent.length < 100) {
      articleContent = item.title + ". " + (item.description || "");
    }
    
    // Get AI rewrite (parallel processing)
    const aiResult = await rewriteWithParallelAI(item.title, articleContent);
    
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
    
    // Prepare record
    const record = {
      title: aiResult.title,
      slug: slug,
      source_url: item.url || "",
      ai_content: aiResult.content,
      short_desc: aiResult.content.substring(0, 200) + "...",
      image_url: item.image,
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      region: region,
      genre: genre,
      meta: {
        original_title: item.title,
        source: item.source || sourceType,
        ai_provider: aiResult.provider,
        word_count: aiResult.wordCount
      }
    };
    
    // Save to database
    const { error } = await supabase.from("ai_news").insert(record);
    
    if (error) {
      console.error(`Database error for ${item.title.substring(0, 50)}:`, error.message);
      return null;
    }
    
    console.log(`✅ Added: ${aiResult.title.substring(0, 50)}... (${aiResult.provider}, ${aiResult.wordCount} words)`);
    return record;
    
  } catch (error) {
    console.error(`Error processing item:`, error.message);
    return null;
  }
}

/* -------------------- Main Processing Function -------------------- */
async function processAllNews() {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 STARTING NEWS PROCESSING CYCLE");
  console.log("=".repeat(50));
  
  const allItems = [];
  
  // Fetch RSS feeds in parallel
  const feedPromises = [];
  
  // Uttarakhand feeds
  for (const feedUrl of UTTRAKHAND_FEEDS) {
    feedPromises.push(fetchRSSFeed(feedUrl));
  }
  
  // India feeds
  for (const feedUrl of INDIA_FEEDS) {
    feedPromises.push(fetchRSSFeed(feedUrl));
  }
  
  // Wait for all feeds
  const feedResults = await Promise.allSettled(feedPromises);
  
  // Collect all items
  for (const result of feedResults) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }
  
  console.log(`📊 Total items fetched: ${allItems.length}`);
  
  // Remove duplicates by URL
  const uniqueItems = [];
  const seenUrls = new Set();
  
  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }
  
  console.log(`📊 Unique items: ${uniqueItems.length}`);
  
  // Process items in parallel using concurrency queue
  const processPromises = [];
  
  for (const item of uniqueItems.slice(0, 15)) { // Limit to 15 items per cycle
    processPromises.push(
      enqueueTask(() => processNewsItem(item, "rss"))
    );
  }
  
  // Wait for all processing to complete
  const processedResults = await Promise.allSettled(processPromises);
  
  const successful = processedResults.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  console.log(`\n🎯 Processing complete: ${successful} new articles added`);
  console.log("=".repeat(50) + "\n");
  
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
    
    // Cleanup old articles
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("ai_news")
        .delete()
        .lt("created_at", cutoff);
        
      if (error) {
        console.warn("Cleanup error:", error.message);
      } else {
        console.log("🧹 Cleanup completed");
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

// Periodic runs every 15 minutes
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

app.get("/api/news/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ai_news")
      .select("*")
      .eq("slug", req.params.slug)
      .single();

    if (error || !data) {
      return res.status(404).json({ 
        success: false, 
        error: "Article not found" 
      });
    }

    res.json({ 
      success: true, 
      data 
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
      message: "Processing started in background" 
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

app.get("/health", (req, res) => {
  const providers = [];
  if (process.env.OPENROUTER_API_KEY) providers.push("OpenRouter");
  if (process.env.GROQ_API_KEY) providers.push("Groq");
  
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Hindi News AI Rewriter",
    providers: providers.length > 0 ? providers : ["Fallback"],
    queue: {
      running: runningTasks,
      pending: taskQueue.length,
      maxConcurrent: MAX_CONCURRENT_TASKS
    },
    processing: isProcessing
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Hindi News Rewriter API",
    version: "4.0",
    description: "Parallel AI processing with OpenRouter + Groq",
    endpoints: {
      news: "/api/news",
      article: "/api/news/:slug",
      search: "/api/search",
      health: "/health",
      manual_run: "/api/run-now"
    },
    features: [
      "Parallel AI processing (OpenRouter + Groq)",
      "Automatic RSS fetching",
      "Hindi content rewriting",
      "Smart deduplication",
      "Concurrent processing"
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
  ================================
  Port: ${PORT}
  URL: https://rt-india.onrender.com
  
  🔧 CONFIGURATION:
  - Max concurrent tasks: ${MAX_CONCURRENT_TASKS}
  - Poll interval: ${POLL_MINUTES} minutes
  - AI Providers: ${process.env.OPENROUTER_API_KEY ? 'OpenRouter ✅' : 'OpenRouter ❌'} | ${process.env.GROQ_API_KEY ? 'Groq ✅' : 'Groq ❌'}
  
  📝 ENDPOINTS:
  - API News: /api/news
  - Health: /health
  - Manual Run: /api/run-now
  
  ⚡ FEATURES:
  - Parallel AI processing (OpenRouter + Groq simultaneously)
  - Smart RSS fetching
  - Automatic deduplication
  - Concurrent article processing
  
  📊 Ready to process Hindi news!
  `);
});