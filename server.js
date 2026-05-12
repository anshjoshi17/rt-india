// server.js - NO AI REWRITING: fetch articles (RSS + NewsAPI + GNews), scrape full content, save raw text
require("dotenv").config();

const express = require("express");
const slugify = require("slugify");
const { createClient } = require("@supabase/supabase-js");

// Import modules
const { fetchRSSFeed, RSS_SOURCES } = require("./rss-fetcher");
const { fetchFromNewsAPI, fetchFromGNewsAPI, API_SOURCES } = require("./api-fetchers");
const { configureCors } = require("./cors-config");

// Scorer (kept) and distributor (kept stub)
const { filterAndRankItems } = require("./scorer");
const { distributeArticle } = require("./distributor");

const app = express();

/* -------------------- CORS & Security -------------------- */
configureCors(app);
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

/* -------------------- Combined Sources -------------------- */
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

/* -------------------- Concurrency Queue -------------------- */
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

/* -------------------- Default Images (unchanged) -------------------- */
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

/* -------------------- Detection Helpers (unchanged) -------------------- */
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

/* -------------------- Normalization (unchanged) -------------------- */
function normalizeArticle(apiArticle, sourceConfig) {
  if (sourceConfig.type === "NEWSAPI") {
    return {
      title: apiArticle.title || 'No Title',
      description: apiArticle.description || apiArticle.content || '',
      url: apiArticle.url,
      image: apiArticle.urlToImage,
      pubDate: apiArticle.publishedAt,
      source: apiArticle.source?.name || sourceConfig.name,
      meta: { api: "NEWSAPI", sourceName: sourceConfig.name, isLatest: true }
    };
  } else if (sourceConfig.type === "GNEWS") {
    return {
      title: apiArticle.title || 'No Title',
      description: apiArticle.description || apiArticle.content || '',
      url: apiArticle.url,
      image: apiArticle.image,
      pubDate: apiArticle.publishedAt,
      source: apiArticle.source?.name || sourceConfig.name,
      meta: { api: "GNEWS", sourceName: sourceConfig.name, isLatest: true }
    };
  } else {
    return {
      title: apiArticle.title || 'No Title',
      description: apiArticle.description || '',
      url: apiArticle.url,
      image: apiArticle.image,
      pubDate: apiArticle.pubDate,
      source: apiArticle.source || sourceConfig.name,
      meta: { api: "RSS", sourceName: sourceConfig.name, isLatest: true }
    };
  }
}

/* -------------------- CONTENT SCRAPING (kept unchanged) -------------------- */
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
      'article', '.article-body', '.story-body', '.story-content',
      '.entry-content', '.post-content', '.td-post-content', '.news-detail',
      '.wp-block-post-content', '#content', '.ArticleBody', '.cn__content',
      '.story-section', '.article-container', 'main', '.content-area'
    ];
    let mainContent = '';
    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text.split(/\s+/).length > 200) {
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
        if (text.length > 50 && !text.includes('©') && !text.includes('Copyright') && !text.includes('ADVERTISEMENT')) {
          paragraphs.push(text);
        }
      });
      mainContent = paragraphs.join('\n\n');
    }
    mainContent = mainContent.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
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
      'meta[property="og:image"]', 'meta[name="twitter:image"]',
      '.article-img img', '.story-img img', '.featured-image img', '.wp-post-image'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors.slice(0, 2)) {
      const meta = $(selector);
      if (meta.length) {
        const content = meta.attr('content');
        if (content && content.startsWith('http')) { imageUrl = content; break; }
      }
    }
    if (!imageUrl) {
      for (const selector of imageSelectors.slice(2)) {
        const img = $(selector).first();
        if (img.length) {
          const src = img.attr('src') || img.attr('data-src');
          if (src && src.startsWith('http')) { imageUrl = src; break; }
        }
      }
    }
    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        imageUrl = new URL(imageUrl, urlObj.origin).href;
      } catch (e) { imageUrl = null; }
    }
    return imageUrl;
  } catch (error) {
    console.warn(`❌ Failed to fetch image from ${url}:`, error.message);
    return null;
  }
}

/* -------------------- Simple content cleaning (no AI, just basic strip) -------------------- */
function cleanContentForSave(text) {
  if (!text) return '';
  let cleaned = text;
  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');
  // Remove URLs
  cleaned = cleaned.replace(/\bhttps?:\/\/\S+/gi, ' ');
  cleaned = cleaned.replace(/\bwww\.\S+/gi, ' ');
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/* -------------------- Fetch Region-First Items (unchanged) -------------------- */
async function fetchRegionFirst(regionKey, maxItems = 20) {
  const keywords = REGION_KEYWORDS[regionKey] || [regionKey];
  const q = keywords.join(" OR ");
  const regionItems = [];
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
  const unique = [];
  const seen = new Set();
  regionItems
    .sort((a, b) => new Date(b.pubDate || b.publishedAt || 0) - new Date(a.pubDate || a.publishedAt || 0))
    .slice(0, maxItems)
    .forEach(it => {
      if (it.url && !seen.has(it.url)) { seen.add(it.url); unique.push(it); }
    });
  console.log(`   ✅ Region-first fetched ${unique.length} items for ${regionKey}`);
  return unique;
}

/* -------------------- Process Single News Item (NO AI REWRITE) -------------------- */
async function processNewsItem(item, sourceType = "api") {
  try {
    const { data: existing } = await supabase
      .from("ai_news")
      .select("id")
      .eq("source_url", item.url)
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

    // Clean the content (no AI, just basic removal of HTML/links)
    const cleanedContent = cleanContentForSave(articleContent);
    const finalContent = cleanedContent || articleContent;

    const slug = makeSlug(item.title);
    const fullText = item.title + " " + (finalContent || "");
    const genre = detectGenreKeyword(fullText);
    const sourceHost = item.url ? (() => { try { return new URL(item.url).hostname } catch(e){ return "" } })() : "";
    const region = detectRegionFromText(fullText, sourceHost);

    const recordMeta = {
      original_title: item.title,
      source: item.source || sourceType,
      image_source: articleImage ? 'scraped' : 'default',
      api_source: item.meta?.api || item.meta?.api_source || "unknown",
      source_name: item.meta?.sourceName || item.source || "unknown",
      has_videos: videos.length > 0,
      videos: videos.length > 0 ? videos : null,
      is_latest: true,
      region_priority: !!item.meta?.region_priority,
    };

    const record = {
      title: item.title,
      slug: slug,
      source_url: item.url || "",
      ai_content: finalContent,   // raw scraped content (or description)
      short_desc: finalContent.substring(0, 250) + (finalContent.length > 250 ? "..." : ""),
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

    console.log(`✅ Added: ${record.title.substring(0, 50)}...`);
    console.log(`   📷 Image: ${record.image_url ? 'Yes' : 'No'}`);
    console.log(`   🎥 Videos: ${videos.length}`);
    console.log(`   📅 Published: ${new Date(record.published_at).toLocaleTimeString('hi-IN')}`);

    // Fire-and-forget distribution (stub)
    distributeArticle(record, supabase).catch(err =>
      console.warn("⚠️  Distribution error (non-fatal):", err.message)
    );

    return record;
  } catch (error) {
    console.error(`❌ Error processing item:`, error.message);
    return null;
  }
}

/* -------------------- MAIN PROCESSING FUNCTION (unchanged except removed AI category) -------------------- */
const PROCESS_COUNT = Number(process.env.ITEMS_TO_PROCESS) || 18;

async function processAllNews() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 STARTING LATEST NEWS PROCESSING CYCLE (NO AI REWRITE)");
  console.log("=".repeat(60));

  const allItems = [];
  const sourceStats = {};

  const sourcesByPriority = Object.entries(NEWS_SOURCES)
    .map(([key, config]) => ({ key, ...config }))
    .sort((a, b) => a.priority - b.priority);

  console.log(`📊 Processing ${sourcesByPriority.length} sources...\n`);

  let newestArticleTime = new Date(0);

  // Region-first: Uttarakhand
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

  // Process remaining sources
  for (const source of sourcesByPriority) {
    if ((source.name || "").toLowerCase().includes("uttarakhand")) {
      console.log(`   ⏭️ Skipping (already covered by region-first): ${source.name}`);
      continue;
    }
    try {
      console.log(`🔍 [Priority ${source.priority}] Fetching ${source.name}...`);
      let rawArticles = [];
      switch (source.type) {
        case "NEWSAPI": rawArticles = await fetchFromNewsAPI(source.config); break;
        case "GNEWS":   rawArticles = await fetchFromGNewsAPI(source.config); break;
        case "RSS":     rawArticles = await fetchRSSFeed(source.config.url, source.config.maxItems); break;
      }
      rawArticles.sort((a, b) => new Date(b.publishedAt || b.pubDate || 0) - new Date(a.publishedAt || a.pubDate || 0));
      const normalizedArticles = rawArticles.map(article => normalizeArticle(article, source));
      if (normalizedArticles.length > 0) {
        const articleTime = new Date(normalizedArticles[0].pubDate || normalizedArticles[0].published_at || 0);
        if (articleTime > newestArticleTime) newestArticleTime = articleTime;
      }
      allItems.push(...normalizedArticles);
      sourceStats[source.name] = normalizedArticles.length;
      console.log(`   ✅ Added ${normalizedArticles.length} articles from ${source.name}`);
      await sleep(1000);
    } catch (error) {
      console.log(`   ❌ Failed to fetch ${source.name}:`, error.message);
      sourceStats[source.name] = 0;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📈 NEWS STATISTICS:");
  Object.entries(sourceStats).forEach(([name, count]) => console.log(`   ${name}: ${count} articles`));
  console.log(`📊 TOTAL ITEMS FETCHED: ${allItems.length}`);
  if (newestArticleTime > new Date(0)) {
    console.log(`📅 NEWEST ARTICLE TIME: ${newestArticleTime.toLocaleString('hi-IN')}`);
  }

  // Deduplicate by URL
  const uniqueItems = [];
  const seenUrls = new Set();
  for (const item of allItems) {
    if (item.url && !seenUrls.has(item.url)) { seenUrls.add(item.url); uniqueItems.push(item); }
  }
  console.log(`📊 UNIQUE ITEMS: ${uniqueItems.length}`);

  const sortedItems = uniqueItems.sort((a, b) =>
    new Date(b.pubDate || b.published_at || 0) - new Date(a.pubDate || a.published_at || 0)
  );

  // Use scorer to filter and rank items (no AI rewrite, just selection)
  const scoredItems = filterAndRankItems(sortedItems, PROCESS_COUNT);
  const itemsToProcess = scoredItems.length > 0 ? scoredItems : sortedItems.slice(0, PROCESS_COUNT);
  console.log(`🎯 Scorer: ${scoredItems.length} approved from ${sortedItems.length} total`);
  if (scoredItems[0]) {
    console.log(`   Top item score: ${scoredItems[0]?.meta?.uk_score ?? "n/a"} — ${scoredItems[0]?.title?.slice(0, 50) ?? ""}`);
  }

  console.log(`🔄 Processing ${itemsToProcess.length} articles (ranked by score + date)...\n`);
  itemsToProcess.forEach((item, index) => {
    const date = new Date(item.pubDate || item.published_at || Date.now());
    console.log(`   ${index + 1}. [${item.meta?.uk_score ?? "--"}] ${item.title.substring(0, 55)}... (${date.toLocaleTimeString('hi-IN')})`);
  });

  const processPromises = itemsToProcess.map(item =>
    enqueueTask(() => processNewsItem(item, "api"))
  );
  const processedResults = await Promise.allSettled(processPromises);

  const successful = processedResults.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  const failed = processedResults.filter(r => r.status === 'rejected').length;

  console.log("\n" + "=".repeat(60));
  console.log(`🎯 PROCESSING COMPLETE:`);
  console.log(`   ✅ ${successful} new articles added`);
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
  } catch (error) {
    console.error("Scheduled processing failed:", error.message);
  } finally {
    isProcessing = false;
  }
}

setTimeout(runScheduledProcessing, 5000);
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 5;
setInterval(runScheduledProcessing, POLL_MINUTES * 60 * 1000);

/* -------------------- Export -------------------- */
module.exports = {
  app,
  supabase,
  isProcessing,
  runScheduledProcessing,
  NEWS_SOURCES,
  POLL_MINUTES,
  PROCESS_COUNT
};