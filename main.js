// main.js - Entry point that combines server and API routes

const { app } = require('./server');
const apiRouter = require('./api');

// Use API routes
app.use('/', apiRouter);

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
  const { POLL_MINUTES, PROCESS_COUNT, NEWS_SOURCES } = require('./server');
  
  console.log(`
  🚀 SERVER STARTED SUCCESSFULLY!
  ============================================
  Port: ${PORT}
  URL: https://rt-india.onrender.com

  🔥 LATEST HINDI NEWS CONFIGURATION:
  - Poll interval: ${POLL_MINUTES} minutes
  - Focus: LATEST NEWS (last 24 hours) -> rewritten to HINDI
  - Priority: Uttarakhand → National → International
  - Retention: 2 days cleanup
  - Features: 300+ words, video extraction
  - Items processed per cycle: ${PROCESS_COUNT}

  📰 NEWS SOURCES (LATEST FIRST):
  1. News18 Uttarakhand (RSS - Latest)
  2. Amar Ujala Uttarakhand (RSS - Latest)
  3. AajTak India (RSS - Hindi)
  4. GNews India (Hindi)
  5. International (GNews & NewsAPI, rewritten to Hindi)

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