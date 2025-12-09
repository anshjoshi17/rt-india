// server.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const RSSParser = require("rss-parser");
const slugify = require("slugify");
const cheerio = require("cheerio");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const parser = new RSSParser({
  customFields: { item: ["media:content", "enclosure"] }
});

// -------------------- SUPABASE --------------------
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// -------------------- FEEDS --------------------
const UTTRAKHAND_FEEDS = [
  "https://www.amarujala.com/rss/uttarakhand.xml",
  "https://zeenews.india.com/hindi/rss/state/uttarakhand.xml"
];

const INDIA_FEEDS = [
  "https://feeds.feedburner.com/ndtvkhabar",
  "https://aajtak.intoday.in/rssfeeds/?id=home"
];

// -------------------- UTILS --------------------
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

// -------------------- CONCURRENCY QUEUE --------------------
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_TASKS) || 4;
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

// -------------------- DETECTION HELPERS --------------------
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
  const indiaKeywords = ["india", "delhi", "mumbai", "kolkata", "chennai", "bengaluru", "bangalore"];
  if (indiaKeywords.some((k) => t.includes(k) || s.includes(k))) return "india";
  return "international";
}
function detectGenreKeyword(text) {
  const t = (text || "").toLowerCase();
  if (/\b(police|murder|accident|crime|arrest|case|court|rape)\b/.test(t)) return "Crime";
  if (/\b(election|minister|congress|bjp|government|mp|mla|politic)\b/.test(t)) return "Politics";
  if (/\b(match|score|tournament|cricket|football|player|t20|world cup)\b/.test(t)) return "Sports";
  if (/\b(movie|film|actor|song|celebrity|bollywood|tv|festival)\b/.test(t)) return "Entertainment";
  if (/\b(stock|market|economy|business|company|shares|price|ipo)\b/.test(t)) return "Business";
  if (/\b(tech|ai|software|startup|google|microsoft|apple|technology)\b/.test(t)) return "Technology";
  if (/\b(health|covid|hospital|doctor|disease|vaccine)\b/.test(t)) return "Health";
  if (/\b(climate|forest|river|pollution|environment|wildlife|conservation)\b/.test(t)) return "Environment";
  if (/\b(school|college|education|exam|university|result)\b/.test(t)) return "Education";
  if (/\b(food|travel|fashion|lifestyle|culture|festival)\b/.test(t)) return "Lifestyle";
  if (/\b(weather|rain|storm|flood|temperature|forecast)\b/.test(t)) return "Weather";
  return "Other";
}

// -------------------- PUTER (NODE) INIT - Claude-ready --------------------
let puter = null;
try {
  try {
    // try package default
    const pkg = require("@heyputer/puter.js");
    if (pkg?.init) {
      puter = pkg.init ? pkg.init(process.env.PUTER_AUTH_TOKEN || null) : pkg;
    } else if (pkg?.default?.init) {
      puter = pkg.default.init ? pkg.default.init(process.env.PUTER_AUTH_TOKEN || null) : pkg.default;
    } else {
      puter = pkg;
    }
  } catch (e) {
    // older packaging path
    const pInit = require("@heyputer/puter.js/src/init.cjs");
    puter = pInit.init ? pInit.init(process.env.PUTER_AUTH_TOKEN || null) : null;
  }
  console.log("Puter initialized:", !!puter);
} catch (e) {
  puter = null;
  console.warn("Puter.js not available or failed to init:", e?.message || e);
}

// -------------------- AI PROVIDERS (wrappers) --------------------
// Each wrapper returns rewritten text or throws.
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
    })
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

// --------- Puter provider wrapper (supports Claude models) ----------
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

// -------------------- PROVIDER REGISTRY --------------------
const providers = [
  { name: "puter", fn: puterRewrite, enabled: !!puter },
  { name: "huggingface", fn: hfRewrite, enabled: !!process.env.HUGGINGFACE_API_KEY },
  { name: "deepseek", fn: deepseekRewrite, enabled: !!process.env.DEEPSEEK_API_KEY },
  { name: "local_llama", fn: localLlamaRewrite, enabled: !!process.env.LOCAL_LLAMA_URL },
  { name: "gemini", fn: geminiRewrite, enabled: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_ENDPOINT) }
].filter((p) => p.enabled);

console.log("Enabled providers:", providers.map((p) => p.name));

// -------------------- PARALLEL ORCHESTRATION --------------------
function withTimeout(promise, ms, name) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms (${name})`)), ms));
  return Promise.race([promise, timeout]);
}

async function rewriteWithParallel(text) {
  if (!providers.length) {
    return { text, provider: null, timed_out: false };
  }
  const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 20000;
  const attempts = providers.map((p) =>
    withTimeout(
      (async () => {
        await sleep(Math.floor(Math.random() * 80));
        const out = await p.fn(text);
        if (!out || String(out).trim().length < 10) throw new Error("empty output");
        return { text: String(out).trim(), provider: p.name };
      })(),
      TIMEOUT_MS,
      p.name
    )
  );

  try {
    const result = await Promise.any(attempts);
    return { text: result.text, provider: result.provider, timed_out: false };
  } catch (agg) {
    return { text, provider: null, timed_out: true, error: agg };
  }
}

// -------------------- RSS discovery --------------------
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

// -------------------- NEWS API FETCHERS --------------------
async function fetchFromNewsAPI(q = "uttarakhand OR dehradun", pageSize = 15) {
  if (!process.env.NEWSAPI_KEY) return [];
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${process.env.NEWSAPI_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.articles) return [];
  return j.articles.map((a) => ({ title: a.title, link: a.url, pubDate: a.publishedAt, description: a.description || "", image: a.urlToImage || null, source: a.source?.name || null }));
}
async function fetchFromGNews(q = "uttarakhand", max = 15) {
  if (!process.env.GNEWS_KEY) return [];
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&token=${process.env.GNEWS_KEY}&lang=en&max=${max}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.articles) return [];
  return j.articles.map((a) => ({ title: a.title, link: a.url, pubDate: a.publishedAt, description: a.description || "", image: a.image || null, source: a.source?.name || null }));
}

// -------------------- PROCESS API SOURCES --------------------
async function processApiSources(region) {
  const q = region === "uttarakhand" ? "uttarakhand OR dehradun OR nainital OR champawat OR haridwar" : region === "india" ? "india OR delhi OR mumbai" : "international";
  const all = [];
  if (process.env.NEWSAPI_KEY) {
    try {
      all.push(...(await fetchFromNewsAPI(q, 20)));
    } catch (e) {
      console.warn("NewsAPI fail", e.message || e);
    }
  }
  if (process.env.GNEWS_KEY) {
    try {
      all.push(...(await fetchFromGNews(q, 20)));
    } catch (e) {
      console.warn("GNews fail", e.message || e);
    }
  }

  for (const item of all.slice(0, 80)) {
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

// -------------------- PROCESS RSS FEEDS --------------------
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

      for (const item of rss.items.slice(0, 12)) {
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

// -------------------- CLEANUP --------------------
async function cleanupOldArticles(days = 4) {
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

// -------------------- BOOTSTRAP & SCHEDULE --------------------
(async function bootstrap() {
  try {
    console.log("Initial run: API sources + RSS");
    await processApiSources("uttarakhand");
    await processFeeds(UTTRAKHAND_FEEDS, "uttarakhand");
    await processApiSources("india");
    await processFeeds(INDIA_FEEDS, "india");
    await processApiSources("international");
    await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 4);
  } catch (e) {
    console.error("Bootstrap error:", e.message || e);
  }
})();

const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 5;
setInterval(async () => {
  try {
    await processApiSources("uttarakhand");
    await processFeeds(UTTRAKHAND_FEEDS, "uttarakhand");
    await processApiSources("india");
    await processFeeds(INDIA_FEEDS, "india");
    await processApiSources("international");
  } catch (e) {
    console.warn("Periodic run error:", e.message || e);
  }
}, POLL_MINUTES * 60 * 1000);

const CLEANUP_HOURS = Number(process.env.CLEANUP_INTERVAL_HOURS) || 6;
setInterval(async () => {
  await cleanupOldArticles(Number(process.env.CLEANUP_DAYS) || 4);
}, CLEANUP_HOURS * 60 * 60 * 1000);

// -------------------- HTTP API --------------------

// health
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString(), providers: providers.map((p) => p.name) }));

// list - supports filtering & limit
app.get("/api/news", async (req, res) => {
  try {
    const { limit = 50, genre, region } = req.query;
    let qb = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,source,region,genre,published_at,created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(limit) || 50, 200));
    if (genre) qb = qb.eq("genre", genre);
    if (region) qb = qb.eq("region", region);
    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// region route - returns fields useful for hero (limit param accepted)
app.get("/api/news/region/:region", async (req, res) => {
  try {
    const region = req.params.region;
    const limit = Math.min(Number(req.query.limit || 6), 50);
    const { data, error } = await supabase
      .from("ai_news")
      .select("title,slug,short_desc,image_url,source,published_at,region,genre")
      .eq("region", region)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    console.error("region route error:", e);
    return res.status(500).json({ error: String(e) });
  }
});

// single article
app.get("/api/news/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase.from("ai_news").select("*").eq("slug", req.params.slug).single();
    if (error) return res.status(404).json({ error: "Not found" });
    res.json(data || {});
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// search (title)
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (!q) return res.json([]);
    const { data, error } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at")
      .ilike("title", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// -------------------- START --------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ AI News Backend Running on port", PORT));
