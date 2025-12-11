// api.js - API endpoints for Hindi News Rewriter

const express = require('express');
const router = express.Router();

// Import from server.js
const { supabase, isProcessing, runScheduledProcessing } = require('./server');

/* -------------------- API Routes -------------------- */
router.get("/api/news", async (req, res) => {
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

    // region param: allow case-insensitive substring matching for robustness
    if (region && region !== "All") {
      const regionParam = String(region || "").trim();
      // Use ILIKE so 'india', 'India', 'भारत', 'उत्तराखंड' etc can match
      query = query.ilike("region", `%${regionParam}%`);
    }

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

router.get("/api/news/:slug", async (req, res) => {
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

/* ---------------------------
   Robust region endpoint
   - case-insensitive handling
   - capitalized attempt
   - ilike fallback (substring), ordered by published_at
   --------------------------- */
router.get("/api/region/:region", async (req, res) => {
  try {
    const rawRegion = (req.params.region || "").toString().trim();
    const regionLower = rawRegion.toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 12, 100);

    if (!rawRegion) {
      return res.status(400).json({ success: false, error: "Region required" });
    }

    console.log(`[region API] requested region: "${rawRegion}" -> normalized: "${regionLower}", limit: ${limit}`);

    // 1) Try exact match on normalized lower-case value
    let { data, error } = await supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
      .eq("region", regionLower)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[region API] supabase error (exact):", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // 2) If empty, try capitalized exact match and ILIKE substring fallback
    if ((!data || data.length === 0)) {
      const capitalized = rawRegion.charAt(0).toUpperCase() + rawRegion.slice(1).toLowerCase();

      // Try capitalized exact match
      const { data: dataCap, error: errCap } = await supabase
        .from("ai_news")
        .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
        .eq("region", capitalized)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (errCap) {
        console.warn("[region API] supabase error (capitalized):", errCap);
      }

      if (dataCap && dataCap.length > 0) {
        console.log(`[region API] matched capitalized region "${capitalized}" -> ${dataCap.length} items`);
        return res.json({ success: true, data: dataCap });
      }

      // Fallback: case-insensitive substring match using ILIKE
      const { data: dataIlike, error: errIlike } = await supabase
        .from("ai_news")
        .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta")
        .ilike("region", `%${regionLower}%`)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (errIlike) {
        console.error("[region API] supabase error (ilike):", errIlike);
        return res.status(500).json({ success: false, error: errIlike.message });
      }

      if (dataIlike && dataIlike.length > 0) {
        console.log(`[region API] ilike matched ${dataIlike.length} items (region contains "${regionLower}")`);
        return res.json({ success: true, data: dataIlike });
      }

      // Last-resort: return empty array
      console.log(`[region API] no items found for region "${rawRegion}" (exact/capitalized/ilike tried)`);
      return res.json({ success: true, data: [] });
    }

    // If exact-match returned results
    console.log(`[region API] exact-match returned ${data.length} items for "${regionLower}"`);
    return res.json({ success: true, data });

  } catch (err) {
    console.error("[region API] unexpected error:", err && (err.message || err));
    res.status(500).json({ success: false, error: (err && err.message) || "Server error" });
  }
});

router.get("/api/search", async (req, res) => {
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

router.get("/api/run-now", async (req, res) => {
  try {
    if (isProcessing) {
      return res.json({
        success: false,
        message: "Processing already in progress"
      });
    }

    res.json({
      success: true,
      message: "Latest Hindi news processing started"
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

router.get("/api/stats", async (req, res) => {
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

      const apiSource = item.meta?.api_source || item.meta?.api || "unknown";
      stats.byApiSource[apiSource] = (stats.byApiSource[apiSource] || 0) + 1;

      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;

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

router.get("/health", (req, res) => {
  const providers = [];
  if (process.env.OPENROUTER_API_KEY) providers.push("OpenRouter");
  if (process.env.GROQ_API_KEY) providers.push("Groq");

  const apiSources = [];
  if (process.env.NEWSAPI_KEY) apiSources.push("NewsAPI");
  if (process.env.GNEWS_API_KEY) apiSources.push("GNews");

  const { POLL_MINUTES, PROCESS_COUNT } = require('./server');

  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Hindi News AI Rewriter - LATEST HINDI NEWS FOCUS",
    version: "7.0",
    features: ["Latest Hindi News Only", "300+ Word Articles", "Video Extraction", "Real-time Updates"],
    ai_providers: providers.length > 0 ? providers : ["Fallback"],
    news_apis: apiSources.length > 0 ? apiSources : ["RSS Fallback Only"],
    config: {
      poll_interval: `${POLL_MINUTES} minutes`,
      focus: "Latest news (last 24 hours) -> rewritten to Hindi",
      cleanup: "2 days retention",
      items_to_process: PROCESS_COUNT
    }
  });
});

router.get("/", (req, res) => {
  const { POLL_MINUTES, PROCESS_COUNT, NEWS_SOURCES } = require('./server');
  
  res.json({
    success: true,
    message: "Hindi News Rewriter API - LATEST HINDI NEWS FOCUS",
    version: "7.0",
    description: "Fetching and rewriting latest live news into Hindi, storing in Supabase, keeping only last 2 days",
    features: [
      "LATEST NEWS (last 24 hours focus) → rewritten to HINDI",
      "300+ word Hindi articles",
      "Twitter/YouTube video extraction",
      "Real-time news fetching",
      "Priority: Uttarakhand → National → International",
      "Frequent updates (every 15 minutes)",
      "Automatic cleanup (2 days retention)"
    ],
    endpoints: {
      news: "/api/news (shows newest first)",
      article: "/api/news/:slug",
      search: "/api/search",
      stats: "/api/stats",
      region: "/api/region/:region",
      health: "/health",
      manual_run: "/api/run-now"
    },
    config: {
      poll_interval: `${POLL_MINUTES} minutes`,
      items_per_cycle: PROCESS_COUNT,
      sources_count: Object.keys(NEWS_SOURCES).length
    }
  });
});

module.exports = router;