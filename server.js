// server.js
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

/* -------------------- Concurrency Queue -------------------- */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_TASKS) || 1;
let running = 0;
const queue = [];

function enqueueTask(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runNext();
  });
}

function runNext() {
  if (running >= MAX_CONCURRENT) return;
  const item = queue.shift();
  if (!item) return;
  running++;
  item
    .fn()
    .then((v) => item.resolve(v))
    .catch((e) => item.reject(e))
    .finally(() => {
      running--;
      setImmediate(runNext);
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
    "uttarakhand",
    "dehradun",
    "nainital",
    "almora",
    "pithoragarh",
    "rudraprayag",
    "chamoli",
    "pauri",
    "champawat",
    "haridwar",
    "rishikesh"
  ];
  if (uttKeywords.some((k) => t.includes(k) || s.includes(k))) return "uttarakhand";
  const indiaKeywords = ["india", "delhi", "mumbai", "kolkata", "chennai", "bengaluru"];
  if (indiaKeywords.some((k) => t.includes(k) || s.includes(k))) return "india";
  return "international";
}

function detectGenreKeyword(text) {
  const t = (text || "").toLowerCase();
  if (/\b(police|murder|accident|crime|arrest|case|court)\b/.test(t)) return "Crime";
  if (/\b(election|minister|congress|bjp|government|mp|mla|politic)\b/.test(t)) return "Politics";
  if (/\b(match|score|tournament|cricket|football|player)\b/.test(t)) return "Sports";
  if (/\b(movie|film|actor|song|celebrity|bollywood|tv)\b/.test(t)) return "Entertainment";
  if (/\b(stock|market|economy|business|company|shares|price)\b/.test(t)) return "Business";
  if (/\b(tech|ai|software|startup|google|microsoft|apple)\b/.test(t)) return "Technology";
  if (/\b(health|covid|hospital|doctor|disease|vaccine)\b/.test(t)) return "Health";
  if (/\b(climate|forest|river|pollution|environment|wildlife)\b/.test(t)) return "Environment";
  if (/\b(school|college|education|exam|university)\b/.test(t)) return "Education";
  if (/\b(food|travel|fashion|lifestyle|culture)\b/.test(t)) return "Lifestyle";
  if (/\b(weather|rain|storm|flood|temperature)\b/.test(t)) return "Weather";
  return "Other";
}

/* -------------------- AI Provider Configuration -------------------- */
// SIMPLIFIED PROMPT - Most important fix
function buildRewritePromptHindi({ sourceTitle, sourceText }) {
  return `You are an expert Hindi news writer. Write a complete Hindi news article based on the following information.

IMPORTANT: Write ONLY the article in Hindi. Do NOT include any English text, instructions, or formatting markers.
Write in proper Hindi (Devanagari script) with short paragraphs.

Include:
1. A catchy headline (in Hindi)
2. The article body (300-400 words in Hindi)
3. Write naturally like a news article

Source information: ${sourceTitle || "No title"}

Content to rewrite: ${sourceText || ""}

Now write the Hindi news article:`;
}

/* -------------------- FIXED AI Provider Functions -------------------- */
// DeepSeek with proper Hindi instructions
async function deepseekRewrite(prompt) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DeepSeek not configured");
  
  // Simplified system message
  const systemMessage = "You are an expert Hindi journalist. Always respond in Hindi using Devanagari script. Write complete news articles.";
  
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.3
    }),
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  
  if (!content || content.trim().length < 50) {
    throw new Error("DeepSeek returned empty or too short content");
  }
  
  return content;
}

// HuggingFace
async function hfRewrite(prompt) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error("HuggingFace not configured");
  
  const model = process.env.HF_GEN_MODEL || "google/flan-t5-xxl";
  const url = `https://api-inference.huggingface.co/models/${model}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({ 
      inputs: prompt,
      parameters: { 
        max_new_tokens: 500,
        temperature: 0.3,
        do_sample: true
      }
    }),
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`HuggingFace API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  } else if (data?.generated_text) {
    return data.generated_text;
  } else if (typeof data === "string") {
    return data;
  }
  
  throw new Error("HuggingFace returned unexpected format");
}

// Puter (Claude)
let puter = null;
try {
  if (process.env.PUTER_AUTH_TOKEN) {
    try {
      puter = require("@heyputer/puter.js");
      if (puter?.init) {
        puter = puter.init(process.env.PUTER_AUTH_TOKEN);
      }
      console.log("Puter initialized:", !!puter);
    } catch (e) {
      console.warn("Puter.js init failed:", e.message);
      puter = null;
    }
  }
} catch (e) {
  puter = null;
}

async function puterRewrite(prompt) {
  if (!puter) throw new Error("Puter not initialized");
  
  const model = process.env.PUTER_MODEL || "claude-3-5-sonnet";
  const options = { 
    model, 
    stream: false, 
    temperature: 0.3,
    system: "You are an expert Hindi journalist. Always write in Hindi using Devanagari script."
  };
  
  try {
    const resp = await puter.ai.chat(prompt, options);
    
    if (typeof resp === "string") {
      return resp;
    } else if (resp?.message?.content) {
      if (Array.isArray(resp.message.content) && resp.message.content[0]?.text) {
        return resp.message.content[0].text;
      } else if (typeof resp.message.content === "string") {
        return resp.message.content;
      }
    } else if (resp?.text) {
      return resp.text;
    }
    
    return String(resp || "");
  } catch (error) {
    throw new Error(`Puter error: ${error.message}`);
  }
}

// Gemini
async function geminiRewrite(prompt) {
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_ENDPOINT) {
    throw new Error("Gemini not configured");
  }
  
  const response = await fetch(process.env.GEMINI_ENDPOINT, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `You are an expert Hindi journalist. Write a complete Hindi news article in Devanagari script.

${prompt}

Write only the Hindi article:`
        }]
      }],
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.3
      }
    }),
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error("Gemini returned no content");
  }
  
  return content;
}

/* -------------------- Provider Registry -------------------- */
const providers = [
  { 
    name: "deepseek", 
    fn: deepseekRewrite, 
    enabled: !!process.env.DEEPSEEK_API_KEY,
    priority: 1
  },
  { 
    name: "puter", 
    fn: puterRewrite, 
    enabled: !!puter,
    priority: 2
  },
  { 
    name: "gemini", 
    fn: geminiRewrite, 
    enabled: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_ENDPOINT),
    priority: 3
  },
  { 
    name: "huggingface", 
    fn: hfRewrite, 
    enabled: !!process.env.HUGGINGFACE_API_KEY,
    priority: 4
  }
].filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);

console.log("Active AI providers:", providers.map(p => p.name));

/* -------------------- Helper Functions -------------------- */
async function fetchArticleBody(url) {
  try {
    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
      },
      timeout: 10000
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
      '.article-container'
    ];

    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) {
        const text = el.text()
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\n+/g, '\n');
        
        if (text.length > 300) return text;
      }
    }

    // Fallback: get all paragraphs
    const paragraphs = [];
    $('p').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.length > 50 && !text.includes('©') && !text.includes('Copyright')) {
        paragraphs.push(text);
      }
    });

    const content = paragraphs.join('\n\n');
    return content.length > 300 ? content : null;
  } catch (e) {
    console.warn(`Failed to fetch article body from ${url}:`, e.message);
    return null;
  }
}

function parseAIResponse(aiOutput) {
  if (!aiOutput) return { title: "", content: "" };
  
  const text = aiOutput.trim();
  
  // Remove any HTML tags
  let cleaned = text.replace(/<[^>]*>/g, '');
  
  // Remove any markdown formatting
  cleaned = cleaned.replace(/[*_~`#]/g, '');
  
  // Remove common AI instruction artifacts
  cleaned = cleaned.replace(/^(headline|title|शीर्षक|लेख):\s*/gi, '')
                   .replace(/article body:/gi, '')
                   .replace(/आर्टिकल:/gi, '')
                   .replace(/न्यूज़ आर्टिकल:/gi, '')
                   .replace(/समाचार:/gi, '')
                   .replace(/^(यह|इस|आज|हमारे)\s+/gi, '')
                   .trim();
  
  // Find the first line as potential title
  const lines = cleaned.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    return { title: "", content: "" };
  }
  
  // First non-empty line is the title
  const title = lines[0].trim();
  
  // Rest is content
  const content = lines.slice(1).join('\n\n').trim();
  
  // If no content, use title as content
  if (!content && title) {
    return { title: title, content: title };
  }
  
  return { title, content };
}

function countWords(text) {
  if (!text) return 0;
  // Count words in Hindi/English
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/* -------------------- Main AI Rewrite Function -------------------- */
async function rewriteWithAI(sourceTitle, sourceText) {
  if (providers.length === 0) {
    throw new Error("No AI providers available");
  }

  const prompt = buildRewritePromptHindi({ sourceTitle, sourceText });
  
  // Try each provider in order
  for (const provider of providers) {
    try {
      console.log(`Trying provider: ${provider.name}`);
      
      const aiOutput = await provider.fn(prompt);
      
      if (!aiOutput || aiOutput.trim().length < 100) {
        console.warn(`Provider ${provider.name} returned empty/short output`);
        continue;
      }
      
      console.log(`Raw AI output from ${provider.name} (first 200 chars):`, aiOutput.substring(0, 200));
      
      const parsed = parseAIResponse(aiOutput);
      
      if (!parsed.content || parsed.content.length < 200) {
        console.warn(`Provider ${provider.name} returned insufficient content`);
        continue;
      }
      
      const wordCount = countWords(parsed.content);
      
      if (wordCount < 100) {
        console.warn(`Provider ${provider.name} returned only ${wordCount} words`);
        continue;
      }
      
      console.log(`Success with ${provider.name}: ${wordCount} words`);
      
      return {
        success: true,
        title: parsed.title || sourceTitle,
        content: parsed.content,
        provider: provider.name,
        wordCount
      };
      
    } catch (error) {
      console.warn(`Provider ${provider.name} failed:`, error.message);
      // Try next provider
      continue;
    }
  }
  
  throw new Error("All AI providers failed");
}

/* -------------------- Process Functions -------------------- */
async function processApiSources(region) {
  const sources = [];
  
  // NewsAPI
  if (process.env.NEWSAPI_KEY) {
    try {
      const lang = region === "international" ? "en" : "hi";
      let query = "";
      
      if (region === "uttarakhand") {
        query = "uttarakhand OR dehradun OR nainital OR haridwar";
      } else if (region === "india") {
        query = "india OR delhi OR mumbai";
      } else {
        query = "world news";
      }
      
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=${lang}&pageSize=5&apiKey=${process.env.NEWSAPI_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.articles) {
        sources.push(...data.articles.map(article => ({
          title: article.title,
          url: article.url,
          description: article.description,
          image: article.urlToImage,
          publishedAt: article.publishedAt,
          source: article.source?.name
        })));
      }
    } catch (error) {
      console.warn("NewsAPI error:", error.message);
    }
  }
  
  // GNews
  if (process.env.GNEWS_KEY) {
    try {
      const lang = region === "international" ? "en" : "hi";
      let query = "";
      
      if (region === "uttarakhand") {
        query = "uttarakhand";
      } else if (region === "india") {
        query = "india";
      } else {
        query = "world";
      }
      
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=${lang}&max=5&token=${process.env.GNEWS_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.articles) {
        sources.push(...data.articles.map(article => ({
          title: article.title,
          url: article.url,
          description: article.description,
          image: article.image,
          publishedAt: article.publishedAt,
          source: article.source?.name
        })));
      }
    } catch (error) {
      console.warn("GNews error:", error.message);
    }
  }
  
  // Process each source
  for (const item of sources.slice(0, 10)) {
    enqueueTask(async () => {
      try {
        if (!item.url) return;
        
        // Check if already exists
        const { data: existing } = await supabase
          .from("ai_news")
          .select("id")
          .eq("source_url", item.url)
          .limit(1)
          .maybeSingle();
          
        if (existing) {
          console.log(`Skipping existing: ${item.url}`);
          return;
        }
        
        console.log(`Processing: ${item.title?.substring(0, 50)}...`);
        
        // Get article content
        let articleText = "";
        try {
          const fetched = await fetchArticleBody(item.url);
          articleText = fetched || item.description || item.title || "";
        } catch (e) {
          articleText = item.description || item.title || "";
        }
        
        if (!articleText || articleText.length < 100) {
          console.warn(`Insufficient content for: ${item.url}`);
          return;
        }
        
        // Get AI rewrite
        const aiResult = await rewriteWithAI(item.title || "Untitled", articleText);
        
        if (!aiResult.success) {
          console.warn(`AI rewrite failed for: ${item.url}`);
          return;
        }
        
        // Detect genre
        let genre = detectGenreKeyword(aiResult.content);
        
        // Detect region
        const sourceHost = new URL(item.url).hostname;
        const regionDetected = detectRegionFromText(`${aiResult.title}\n${aiResult.content}`, sourceHost);
        
        // Create record
        const record = {
          title: aiResult.title,
          slug: makeSlug(aiResult.title),
          source_url: item.url,
          ai_content: aiResult.content,
          short_desc: aiResult.content.substring(0, 200) + "...",
          image_url: item.image,
          published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : new Date().toISOString(),
          region: regionDetected,
          genre: genre,
          meta: {
            original_title: item.title,
            source: item.source,
            ai_provider: aiResult.provider,
            word_count: aiResult.wordCount
          }
        };
        
        // Save to database
        const { error } = await supabase.from("ai_news").insert(record);
        
        if (error) {
          console.warn(`Database insert error:`, error.message);
        } else {
          console.log(`✅ Inserted: ${aiResult.title.substring(0, 60)} via ${aiResult.provider} (${aiResult.wordCount} words)`);
        }
        
      } catch (error) {
        console.warn(`Error processing item:`, error.message);
      }
    });
  }
}

async function processFeeds(feedList, region) {
  for (const feedUrl of feedList) {
    try {
      console.log(`Processing feed: ${feedUrl}`);
      
      const response = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch feed: ${feedUrl}`);
        continue;
      }
      
      let xmlText = await response.text();
      xmlText = sanitizeXml(xmlText);
      
      const feed = await parser.parseString(xmlText);
      
      if (!feed.items || feed.items.length === 0) {
        console.warn(`No items in feed: ${feedUrl}`);
        continue;
      }
      
      for (const item of feed.items.slice(0, 5)) {
        enqueueTask(async () => {
          try {
            const url = item.link || item.guid;
            if (!url) return;
            
            // Check if already exists
            const { data: existing } = await supabase
              .from("ai_news")
              .select("id")
              .eq("source_url", url)
              .limit(1)
              .maybeSingle();
              
            if (existing) {
              console.log(`Skipping existing RSS: ${url}`);
              return;
            }
            
            console.log(`Processing RSS: ${item.title?.substring(0, 50)}...`);
            
            // Get article content
            let articleText = "";
            try {
              const fetched = await fetchArticleBody(url);
              articleText = fetched || item.contentSnippet || item.description || item.title || "";
            } catch (e) {
              articleText = item.contentSnippet || item.description || item.title || "";
            }
            
            if (!articleText || articleText.length < 100) {
              console.warn(`Insufficient content for RSS: ${url}`);
              return;
            }
            
            // Get AI rewrite
            const aiResult = await rewriteWithAI(item.title || "Untitled", articleText);
            
            if (!aiResult.success) {
              console.warn(`AI rewrite failed for RSS: ${url}`);
              return;
            }
            
            // Detect genre
            let genre = detectGenreKeyword(aiResult.content);
            
            // Detect region
            const sourceHost = new URL(url).hostname;
            const regionDetected = detectRegionFromText(`${aiResult.title}\n${aiResult.content}`, sourceHost);
            
            // Get image
            let image = null;
            if (item.enclosure?.url) {
              image = item.enclosure.url;
            } else if (item["media:content"]?.url) {
              image = item["media:content"].url;
            }
            
            // Create record
            const record = {
              title: aiResult.title,
              slug: makeSlug(aiResult.title),
              source_url: url,
              ai_content: aiResult.content,
              short_desc: aiResult.content.substring(0, 200) + "...",
              image_url: image,
              published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
              region: regionDetected,
              genre: genre,
              meta: {
                original_title: item.title,
                source: feed.title,
                ai_provider: aiResult.provider,
                word_count: aiResult.wordCount
              }
            };
            
            // Save to database
            const { error } = await supabase.from("ai_news").insert(record);
            
            if (error) {
              console.warn(`Database insert error for RSS:`, error.message);
            } else {
              console.log(`✅ Inserted RSS: ${aiResult.title.substring(0, 60)} via ${aiResult.provider} (${aiResult.wordCount} words)`);
            }
            
          } catch (error) {
            console.warn(`Error processing RSS item:`, error.message);
          }
        });
      }
      
    } catch (error) {
      console.warn(`Error processing feed ${feedUrl}:`, error.message);
    }
  }
}

/* -------------------- Cleanup -------------------- */
async function cleanupOldArticles(days = 7) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("ai_news")
      .delete()
      .lt("created_at", cutoff);
      
    if (error) {
      console.warn("Cleanup error:", error.message);
    } else {
      console.log(`Cleanup completed for articles older than ${cutoff}`);
    }
  } catch (error) {
    console.warn("Cleanup error:", error.message);
  }
}

/* -------------------- Schedule -------------------- */
// Initial run after 5 seconds
setTimeout(async () => {
  try {
    console.log("🚀 Starting initial run...");
    
    // Run sequentially to avoid overwhelming
    await processApiSources("uttarakhand");
    await sleep(2000);
    
    await processFeeds(UTTRAKHAND_FEEDS, "uttarakhand");
    await sleep(2000);
    
    await processApiSources("india");
    await sleep(2000);
    
    await processFeeds(INDIA_FEEDS, "india");
    await sleep(2000);
    
    await processApiSources("international");
    await sleep(2000);
    
    await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 7);
    
    console.log("✅ Initial run completed");
  } catch (error) {
    console.error("Initial run error:", error.message);
  }
}, 5000);

// Periodic runs
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 30;
setInterval(async () => {
  try {
    console.log(`🔄 Starting periodic run (every ${POLL_MINUTES} minutes)`);
    
    // Run one region at a time to be gentle on APIs
    const regions = ["uttarakhand", "india", "international"];
    
    for (const region of regions) {
      await processApiSources(region);
      await sleep(30000); // Wait 30 seconds between regions
      
      if (region === "uttarakhand") {
        await processFeeds(UTTRAKHAND_FEEDS, region);
        await sleep(10000);
      } else if (region === "india") {
        await processFeeds(INDIA_FEEDS, region);
        await sleep(10000);
      }
    }
    
    console.log("✅ Periodic run completed");
  } catch (error) {
    console.warn("Periodic run error:", error.message);
  }
}, POLL_MINUTES * 60 * 1000);

// Cleanup every 12 hours
const CLEANUP_HOURS = Number(process.env.CLEANUP_INTERVAL_HOURS) || 12;
setInterval(async () => {
  console.log("🧹 Running cleanup...");
  await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 7);
}, CLEANUP_HOURS * 60 * 60 * 1000);

/* -------------------- API Routes -------------------- */
app.get("/api/news", async (req, res) => {
  try {
    const { limit = 30, genre, region, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    let query = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (genre && genre !== "All") query = query.eq("genre", genre);
    if (region && region !== "All") query = query.eq("region", region);

    const { data, error, count } = await query;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({
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
    res.status(500).json({ error: "Server error" });
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
      return res.status(404).json({ error: "Article not found" });
    }

    res.json(data);
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (!q.trim()) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at")
      .or(`title.ilike.%${q}%,ai_content.ilike.%${q}%,short_desc.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ data: data || [] });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "AI News Aggregator",
    providers: providers.map(p => p.name),
    queue: {
      running,
      pending: queue.length,
      maxConcurrent: MAX_CONCURRENT
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "AI News Aggregator API",
    version: "3.0.0",
    endpoints: {
      news: "/api/news",
      article: "/api/news/:slug",
      search: "/api/search",
      health: "/health"
    }
  });
});

/* -------------------- Error Handling -------------------- */
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
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
  console.log("✅ AI News Backend Running");
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 CORS Origins: ${allowAll ? "ALL" : allowedOrigins.length} origins`);
  console.log(`🤖 AI Providers: ${providers.length > 0 ? providers.map(p => p.name).join(", ") : "NONE (check API keys)"}`);
  console.log(`⏰ Poll Interval: ${POLL_MINUTES} minutes`);
  console.log(`🧹 Cleanup: Every ${CLEANUP_HOURS} hours`);
  console.log("🚀 Server ready!");
});