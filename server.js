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

/**
 * --------------------
 * CORS: robust, applied EARLY
 * --------------------
 *
 * Controls:
 *  - CORS_ALLOW_ALL=true -> allows any origin (use with caution)
 *  - CORS_ALLOW_CREDENTIALS=true -> allows credentials (cookies) and will echo origin (never use '*' with credentials)
 *  - ADDITIONAL_ALLOWED_ORIGINS -> comma-separated extra origins
 */
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
    // allow server-to-server or tools where origin is undefined
    if (!origin) return callback(null, true);

    if (allowAll) {
      // if credentials are allowed, we must echo the origin (cors package does that)
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

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
  maxAge: 86400 // 24 hours
};

// Apply CORS as the very first middleware (before routes, before body parsers)
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight handler for all routes

// Basic security headers (do not override CORS headers set by cors())
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("X-XSS-Protection", "1; mode=block");
  next();
});

// Body parsing (after CORS so preflight isn't messed up)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------- RSS parser -------------------- */
const parser = new RSSParser({
  customFields: { item: ["media:content", "enclosure"] }
});

/* -------------------- SUPABASE -------------------- */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* -------------------- FEEDS -------------------- */
const UTTRAKHAND_FEEDS = [
  "https://www.amarujala.com/rss/uttarakhand.xml",
  "https://zeenews.india.com/hindi/rss/state/uttarakhand.xml"
];

const INDIA_FEEDS = [
  "https://feeds.feedburner.com/ndtvkhabar",
  "https://aajtak.intoday.in/rssfeeds/?id=home"
];

/* -------------------- UTILS -------------------- */
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

/* -------------------- CONCURRENCY QUEUE -------------------- */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_TASKS) || 2; // tuned for Render
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

/* -------------------- DETECTION HELPERS -------------------- */
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

/* -------------------- PUTER (NODE) INIT - Claude-ready -------------------- */
let puter = null;
try {
  try {
    puter = require("@heyputer/puter.js");
    if (puter?.init) {
      puter = puter.init ? puter.init(process.env.PUTER_AUTH_TOKEN || null) : puter;
    } else if (puter?.default?.init) {
      puter = puter.default.init ? puter.default.init(process.env.PUTER_AUTH_TOKEN || null) : puter.default;
    }
  } catch (e) {
    const pInit = require("@heyputer/puter.js/src/init.cjs");
    puter = pInit.init ? pInit.init(process.env.PUTER_AUTH_TOKEN || null) : null;
  }
  console.log("Puter initialized:", !!puter);
} catch (e) {
  puter = null;
  console.warn("Puter.js not available or failed to init:", e?.message || e);
}

/* -------------------- AI PROVIDER WRAPPERS -------------------- */
// (Kept mostly unchanged from your original — adjust / secure keys in env)
async function deepseekRewrite(text) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DeepSeek not configured");
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "Rewrite news into a professional long-form article (neutral & factual)." },
        { role: "user", content: text }
      ],
      max_tokens: 1200,
      temperature: 0.0
    }),
    timeout: 30000
  });
  const j = await r.json();
  const out = j?.choices?.[0]?.message?.content;
  if (!out || String(out).trim().length < 10) throw new Error("DeepSeek empty");
  return out;
}

async function hfRewrite(text) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error("HuggingFace not configured");
  const model = process.env.HF_GEN_MODEL || "google/flan-t5-large";
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: text, parameters: { max_new_tokens: 512 } })
  });
  const j = await r.json();
  if (typeof j === "string") return j;
  if (Array.isArray(j) && j[0]?.generated_text) return j[0].generated_text;
  if (j?.generated_text) return j.generated_text;
  throw new Error("HF unexpected response");
}

async function localLlamaRewrite(text) {
  if (!process.env.LOCAL_LLAMA_URL) throw new Error("Local Llama not configured");
  const r = await fetch(process.env.LOCAL_LLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text, max_tokens: 800 })
  });
  const j = await r.json();
  if (j?.generated_text) return j.generated_text;
  if (j?.choices?.[0]?.text) return j.choices[0].text;
  if (j?.result) return j.result;
  throw new Error("Local Llama unexpected");
}

async function geminiRewrite(text) {
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_ENDPOINT) throw new Error("Gemini not configured");
  const r = await fetch(process.env.GEMINI_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text, max_output_tokens: 800 })
  });
  const j = await r.json();
  const cand = j?.candidates?.[0]?.content || j?.choices?.[0]?.message?.content || null;
  if (!cand) throw new Error("Gemini unexpected");
  return cand;
}

async function puterRewrite(text) {
  if (!puter) throw new Error("Puter not initialized");
  const model = process.env.PUTER_MODEL || "claude-sonnet-4-5";
  const options = { model, stream: false, temperature: Number(process.env.PUTER_TEMPERATURE || 0.0) };
  const resp = await puter.ai.chat(text, options);
  if (typeof resp === "string") return resp;
  if (resp?.message?.content && Array.isArray(resp.message.content) && resp.message.content[0]?.text) {
    return resp.message.content[0].text;
  }
  if (resp?.message?.content && typeof resp.message.content === "string") {
    return resp.message.content;
  }
  if (resp?.text) return resp.text;
  return String(resp);
}

/* -------------------- PROVIDER REGISTRY -------------------- */
const providers = [
  { name: "puter", fn: puterRewrite, enabled: !!puter },
  { name: "huggingface", fn: hfRewrite, enabled: !!process.env.HUGGINGFACE_API_KEY },
  { name: "deepseek", fn: deepseekRewrite, enabled: !!process.env.DEEPSEEK_API_KEY },
  { name: "local_llama", fn: localLlamaRewrite, enabled: !!process.env.LOCAL_LLAMA_URL },
  { name: "gemini", fn: geminiRewrite, enabled: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_ENDPOINT) }
].filter((p) => p.enabled);

/* -------------------- ORCHESTRATION & HELPERS -------------------- */

// Build a clear rewrite prompt: paraphrase and expand to ~300-400 words.
// Keep same language as input. Preserve facts. Do not invent new facts or quotes.
// Output plain text only (no HTML/markdown), short paragraphs.
function buildRewritePrompt(sourceText) {
  const targetMin = Number(process.env.MIN_AI_WORDS) || 300;
  const targetMax = Number(process.env.MAX_AI_WORDS) || 400;
  return (
    "You are a professional news editor.\n\n" +
    "Task: Rewrite and expand the following source content into an original, neutral, factual news article of approximately " +
    `${targetMin}-${targetMax} words. ` +
    "Use different wording (paraphrase) and elaborate where appropriate to make it readable for web audiences. " +
    "Preserve all factual information (names, dates, locations, direct quotes). DO NOT INVENT new facts, statistics, or quotes. If information is missing, do not guess.\n\n" +
    "Formatting instructions: Output **plain text only** (no HTML, no Markdown). Use clear short paragraphs (2-5 sentences each). Keep the same language as the input.\n\n" +
    "Source content:\n\n" +
    String(sourceText || "").trim()
  );
}

function withTimeout(promise, ms, name) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms (${name})`)), ms));
  return Promise.race([promise, timeout]);
}

function countWords(s) {
  if (!s) return 0;
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

// Attempt a single round of parallel provider calls using Promise.any
async function attemptRewriteOnce(prompt, timeoutMs) {
  if (!providers.length) throw new Error("No providers configured");
  const attempts = providers.map((p) =>
    withTimeout(
      (async () => {
        await sleep(Math.floor(Math.random() * 80));
        const out = await p.fn(prompt);
        if (!out || String(out).trim().length < 10) throw new Error("empty output");
        return { text: String(out).trim(), provider: p.name };
      })(),
      timeoutMs,
      p.name
    )
  );
  // Promise.any will throw AggregateError if all reject
  const result = await Promise.any(attempts);
  return result;
}

// rewriteWithParallel: try providers in parallel, enforce word count (300-400 by default)
// retries up to PROVIDER_RETRY_COUNT (default 2) with a slightly stronger directive if results are out-of-range.
async function rewriteWithParallel(text) {
  if (!providers.length) return { text, provider: null, timed_out: false };

  const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 20000;
  const RETRIES = Number(process.env.PROVIDER_RETRY_COUNT) || 2;
  const MIN_WORDS = Number(process.env.MIN_AI_WORDS) || 300;
  const MAX_WORDS = Number(process.env.MAX_AI_WORDS) || 400;

  let basePrompt = buildRewritePrompt(text);
  let lastError = null;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // on retry attempts > 0, append a stricter length note to encourage adherence
      const promptToSend = attempt === 0 ? basePrompt : basePrompt + `\n\nReminder: The article must be approximately ${MIN_WORDS}-${MAX_WORDS} words. Please expand or shorten accordingly.`;

      const result = await attemptRewriteOnce(promptToSend, TIMEOUT_MS);
      const out = result?.text || "";
      const wc = countWords(out);

      // If within desired range, return
      if (wc >= MIN_WORDS && wc <= MAX_WORDS) {
        return { text: out, provider: result.provider, timed_out: false, words: wc, attempts: attempt + 1 };
      }

      // If not in range but reasonably long (> 200 words), accept on last attempt
      if (attempt === RETRIES) {
        return { text: out, provider: result.provider, timed_out: false, words: wc, attempts: attempt + 1, note: "final-accept" };
      }

      // Otherwise, try again (log and continue)
      lastError = new Error(`provider ${result.provider} returned ${wc} words (out of ${MIN_WORDS}-${MAX_WORDS}), retrying`);
      console.warn(lastError.message);
      // small sleep before retry
      await sleep(200 + Math.floor(Math.random() * 300));
    } catch (err) {
      lastError = err;
      console.warn("Rewrite attempt failed:", err && err.message ? err.message : err);
      // if all providers timed out / failed on this attempt, immediately try again until retries exhausted
      await sleep(200 + Math.floor(Math.random() * 300));
    }
  }

  // If we reach here, fall back to returning original text (so pipeline continues)
  return { text, provider: null, timed_out: true, error: lastError };
}

/* -------------------- RSS DISCOVERY & FETCHERS -------------------- */
async function discoverRSS(html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    const link = $('link[type="application/rss+xml"]').attr("href");
    if (link) return new URL(link, baseUrl).href;
    return null;
  } catch {
    return null;
  }
}

async function fetchFromNewsAPI(q = "uttarakhand OR dehradun", pageSize = 10) {
  if (!process.env.NEWSAPI_KEY) return [];
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${process.env.NEWSAPI_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.articles) return [];
  return j.articles.map((a) => ({
    title: a.title,
    link: a.url,
    pubDate: a.publishedAt,
    description: a.description || "",
    image: a.urlToImage || null,
    source: a.source?.name || null
  }));
}

async function fetchFromGNews(q = "uttarakhand", max = 10) {
  if (!process.env.GNEWS_KEY) return [];
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&token=${process.env.GNEWS_KEY}&lang=en&max=${max}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.articles) return [];
  return j.articles.map((a) => ({
    title: a.title,
    link: a.url,
    pubDate: a.publishedAt,
    description: a.description || "",
    image: a.image || null,
    source: a.source?.name || null
  }));
}

/* -------------------- PROCESS API SOURCES -------------------- */
async function processApiSources(region) {
  const q =
    region === "uttarakhand"
      ? "uttarakhand OR dehradun OR nainital OR champawat OR haridwar"
      : region === "india"
      ? "india OR delhi OR mumbai"
      : "international";
  const all = [];
  if (process.env.NEWSAPI_KEY) {
    try {
      all.push(...(await fetchFromNewsAPI(q, 10)));
    } catch (e) {
      console.warn("NewsAPI fail", e.message || e);
    }
  }
  if (process.env.GNEWS_KEY) {
    try {
      all.push(...(await fetchFromGNews(q, 10)));
    } catch (e) {
      console.warn("GNews fail", e.message || e);
    }
  }

  for (const item of all.slice(0, 20)) {
    enqueueTask(async () => {
      try {
        const url = item.link;
        if (!url) return;
        const { data: existing } = await supabase.from("ai_news").select("id").eq("source_url", url).limit(1).maybeSingle();
        if (existing) return;

        const title = item.title || "No title";
        const snippet = `${title}\n\n${item.description || ""}\n\nSource: ${url}`;

        const aiResult = await rewriteWithParallel(snippet);
        const aiOut = aiResult.text;
        const providerUsed = aiResult.provider;

        let genre = "Other";
        if (process.env.HUGGINGFACE_API_KEY) {
          try {
            const cModel = process.env.HF_CLASS_MODEL || "facebook/bart-large-mnli";
            const cUrl = `https://api-inference.huggingface.co/models/${cModel}`;
            const cr = await fetch(cUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ inputs: aiOut, parameters: { candidate_labels: GENRE_CANDIDATES.slice(0, 10), multi_label: false } })
            });
            const cj = await cr.json();
            if (cj?.labels && cj.labels.length) genre = cj.labels[0];
          } catch (e) {
            genre = detectGenreKeyword(aiOut);
          }
        } else genre = detectGenreKeyword(aiOut);

        const sourceHost = (url && new URL(url).hostname) || "";
        const regionDetected = detectRegionFromText(`${title}\n${aiOut}`, sourceHost);

        const record = {
          title,
          slug: makeSlug(title),
          source_url: url,
          ai_content: aiOut,
          short_desc: (aiOut || "").slice(0, 220) + "...",
          image_url: item.image || null,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          region: regionDetected,
          genre,
          meta: { raw: item, ai_provider: providerUsed }
        };

        const { error } = await supabase.from("ai_news").insert(record);
        if (error) console.warn("Insert error (API):", error.message || error);
        else console.log("✅ Inserted (API):", title, "via", providerUsed);
      } catch (err) {
        console.warn("API item processing error:", err.message || err);
      }
    });
  }
}

/* -------------------- PROCESS RSS FEEDS -------------------- */
async function processFeeds(feedList, region) {
  for (const feed of feedList) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0" } });
      let text = await res.text();
      if (text.includes("<html")) {
        const realFeed = await discoverRSS(text, feed);
        if (!realFeed) continue;
        const realRes = await fetch(realFeed);
        text = await realRes.text();
      }
      text = sanitizeXml(text);
      const rss = await parser.parseString(text);
      if (!rss.items) continue;

      for (const item of rss.items.slice(0, 8)) {
        enqueueTask(async () => {
          try {
            const url = item.link || item.guid;
            if (!url) return;
            const { data: existing } = await supabase.from("ai_news").select("id").eq("source_url", url).limit(1).maybeSingle();
            if (existing) return;

            let image = item.enclosure?.url || item["media:content"]?.url || null;
            const title = item.title || "No title";
            const rawForAI = `${title}\n\n${item.contentSnippet || item.content || item.description || ""}\n\nSource URL: ${url}`;

            const aiResult = await rewriteWithParallel(rawForAI);
            const aiText = aiResult.text;
            const providerUsed = aiResult.provider;

            let genre = "Other";
            if (process.env.HUGGINGFACE_API_KEY) {
              try {
                const cModel = process.env.HF_CLASS_MODEL || "facebook/bart-large-mnli";
                const cUrl = `https://api-inference.huggingface.co/models/${cModel}`;
                const cr = await fetch(cUrl, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ inputs: aiText, parameters: { candidate_labels: GENRE_CANDIDATES.slice(0, 10), multi_label: false } })
                });
                const cj = await cr.json();
                if (cj?.labels && cj.labels.length) genre = cj.labels[0];
              } catch (e) {
                genre = detectGenreKeyword(aiText);
              }
            } else genre = detectGenreKeyword(aiText);

            const sourceHost = (url && new URL(url).hostname) || "";
            const regionDetected = detectRegionFromText(`${title}\n${aiText}`, sourceHost);

            const record = {
              title,
              slug: makeSlug(title),
              source_url: url,
              ai_content: aiText,
              short_desc: (aiText || "").slice(0, 220) + "...",
              image_url: image,
              published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
              region: regionDetected,
              genre,
              meta: { raw: item, ai_provider: providerUsed }
            };

            const { error } = await supabase.from("ai_news").insert(record);
            if (error) console.warn("Insert error (RSS):", error.message || error);
            else console.log("✅ Inserted (RSS):", title, "via", providerUsed);
          } catch (e) {
            console.warn("RSS item error:", e.message || e);
          }
        });
      }
    } catch (e) {
      console.warn(`Feed error (${region}):`, e.message || e);
    }
  }
}

/* -------------------- CLEANUP -------------------- */
async function cleanupOldArticles(days = 7) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Skipping cleanup: SUPABASE_SERVICE_ROLE_KEY required.");
    return;
  }
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("ai_news").delete().lt("created_at", cutoff);
    if (error) console.warn("Cleanup delete error:", error.message || error);
    else console.log(`Cleanup done. Deleted ${data ? data.length : 0} rows older than ${cutoff}`);
  } catch (e) {
    console.warn("Cleanup error:", e.message || e);
  }
}

/* -------------------- BOOTSTRAP & SCHEDULE -------------------- */
setTimeout(async () => {
  try {
    console.log("🚀 Initial run starting on Render...");
    await processApiSources("uttarakhand");
    await processFeeds(UTTRAKHAND_FEEDS, "uttarakhand");
    await processApiSources("india");
    await processFeeds(INDIA_FEEDS, "india");
    await processApiSources("international");
    await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 7);
    console.log("✅ Initial run completed on Render");
  } catch (e) {
    console.error("Bootstrap error:", e.message || e);
  }
}, 10000);

const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 15;
setInterval(async () => {
  try {
    console.log(`🔄 Periodic run started on Render (every ${POLL_MINUTES} minutes)`);
    await processApiSources("uttarakhand");
    await processFeeds(UTTRAKHAND_FEEDS, "uttarakhand");
    await processApiSources("india");
    await processFeeds(INDIA_FEEDS, "india");
    await processApiSources("international");
    console.log("✅ Periodic run completed on Render");
  } catch (e) {
    console.warn("Periodic run error:", e.message || e);
  }
}, POLL_MINUTES * 60 * 1000);

const CLEANUP_HOURS = Number(process.env.CLEANUP_INTERVAL_HOURS) || 12;
setInterval(async () => {
  console.log("🧹 Running cleanup on Render...");
  await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 7);
}, CLEANUP_HOURS * 60 * 60 * 1000);

/* -------------------- HTTP API -------------------- */
app.get("/api/news", async (req, res) => {
  try {
    const { limit = 30, genre, region, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    let qb = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (genre) qb = qb.eq("genre", genre);
    if (region) qb = qb.eq("region", region);

    const { data, error, count } = await qb;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error", message: error.message });
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
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.get("/api/news/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase.from("ai_news").select("*").eq("slug", req.params.slug).single();
    if (error || !data) return res.status(404).json({ error: "Article not found" });
    res.json(data);
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
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
      return res.status(500).json({ error: "Database error", message: error.message });
    }

    res.json({ data: data || [] });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

/* -------------------- HEALTH & ROOT -------------------- */
app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "AI News Aggregator",
    deployment: "Render",
    url: process.env.PUBLIC_URL || "https://rt-india.onrender.com",
    providers: providers.map((p) => p.name),
    queue: {
      running,
      pending: queue.length,
      maxConcurrent: MAX_CONCURRENT
    },
    environment: process.env.NODE_ENV || "development"
  };
  res.status(200).json(health);
});

app.get("/", (req, res) => {
  res.json({
    message: "AI News Aggregator API",
    version: "1.0.0",
    deployment: "Render",
    endpoints: {
      news: "/api/news",
      singleArticle: "/api/news/:slug",
      search: "/api/search",
      health: "/health"
    },
    status: "operational",
    documentation: "See /health for system status"
  });
});

/* -------------------- ERROR HANDLING -------------------- */
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  if (err && err.message && err.message.includes("CORS")) {
    return res.status(403).json({
      error: "CORS Error",
      message: err.message,
      allowedOrigins,
      allowAll,
      allowCredentials
    });
  }
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message,
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

/* -------------------- START & GRACEFUL SHUTDOWN -------------------- */
const PORT = process.env.PORT || 10000;

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  process.exit(0);
});

app.listen(PORT, () => {
  console.log("✅ AI News Backend Running on Render");
  console.log(`📍 URL: ${process.env.PUBLIC_URL || "https://rt-india.onrender.com"}`);
  console.log(`🚪 Port: ${PORT}`);
  console.log(`🌍 CORS: allowAll=${allowAll} | allowCredentials=${allowCredentials}`);
  console.log(`🔒 Allowed origins: ${allowAll ? "ALL" : allowedOrigins.join(", ")}`);
  console.log(`⏰ Poll Interval: ${POLL_MINUTES} minutes`);
  console.log(`🧹 Cleanup Interval: ${CLEANUP_HOURS} hours`);
  console.log(`🤖 Providers: ${providers.map((p) => p.name).join(", ")}`);
});
