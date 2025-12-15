// main.js - Entry point that combines server, API routes and admin routes
require('dotenv').config();

const { app, supabase, isProcessing, runScheduledProcessing, NEWS_SOURCES, POLL_MINUTES, PROCESS_COUNT } = require('./server');
const apiRouter = require('./api');
const adminRoutesFactory = require('./routes/adminRoutes');

/* -------------------- Mount API routes -------------------- */
app.use('/', apiRouter);

/* -------------------- Mount Admin routes (Supabase service role on server only) -------------------- */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Only mount admin routes if supabase client and SUPABASE_URL exist
if (!process.env.SUPABASE_URL) {
  console.warn('⚠️ SUPABASE_URL is not set. Admin routes will NOT be mounted.');
} else if (!supabase) {
  console.warn('⚠️ Supabase client not available. Admin routes will NOT be mounted.');
} else {
  try {
    app.use('/admin', adminRoutesFactory({
      SUPABASE_URL: process.env.SUPABASE_URL,
      supabaseAdmin: supabase,
      ADMIN_EMAILS
    }));
    console.log('🔐 Admin routes mounted at /admin');
  } catch (e) {
    console.error('Failed to mount admin routes:', e && e.message ? e.message : e);
  }
}

/* -------------------- Health & utility endpoints -------------------- */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV || 'development',
    processing: !!isProcessing,
    poll_minutes: POLL_MINUTES,
    process_count: PROCESS_COUNT,
    sources: Object.keys(NEWS_SOURCES || {}).length
  });
});

app.get('/ping', (req, res) => res.send('pong'));

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
    message: process.env.NODE_ENV === "production" ? "Something went wrong" : (err && err.message) || String(err)
  });
});

/* -------------------- Start Server (graceful shutdown) -------------------- */
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `https://rt-india.onrender.com`;

const server = app.listen(PORT, () => {
  console.log(`
  🚀 SERVER STARTED SUCCESSFULLY!
  ============================================
  Port: ${PORT}
  URL: ${BASE_URL}

  🔥 LATEST HINDI NEWS CONFIGURATION:
  - Poll interval: ${POLL_MINUTES} minutes
  - Focus: LATEST NEWS (last 24 hours) -> rewritten to HINDI
  - Priority: Uttarakhand → National → International
  - Retention: 2 days cleanup
  - Features: 300+ words, video extraction
  - Items processed per cycle: ${PROCESS_COUNT}

  📰 NEWS SOURCES (count): ${Object.keys(NEWS_SOURCES || {}).length}

  ⚡ SYSTEM FEATURES:
  - Region-first (Uttarakhand) fetching + region fallback queries
  - Always fetches NEWEST articles first
  - Date sorting on all sources
  - Time-limited queries (last 24 hours)
  - Frequent updates every ${POLL_MINUTES} minutes
  - Real-time news processing
  - Cleanup of content older than 2 days

  🚀 Ready to deliver LATEST Hindi news!
  `);
});

/* Graceful shutdown */
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  // stop accepting new connections
  server.close((err) => {
    if (err) {
      console.error('Error during server close:', err);
      process.exit(1);
    }
    // optional: run any cleanup tasks
    try {
      // if you want to trigger a final run or cleanup, be careful with async here
      // runScheduledProcessing(); // <-- avoid long-running tasks on shutdown
    } catch (e) {
      // ignore
    }
    console.log('Shutdown complete.');
    process.exit(0);
  });

  // if still not closed after timeout, force exit
  setTimeout(() => {
    console.warn('Forcing shutdown after timeout.');
    process.exit(1);
  }, 30 * 1000).unref();
}

process.on("SIGTERM", () => shutdown('SIGTERM'));
process.on("SIGINT", () => shutdown('SIGINT'));
