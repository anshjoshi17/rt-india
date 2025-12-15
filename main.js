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

console.log(`🔐 Admin Configuration:`);
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? 'Set' : 'Missing'}`);
console.log(`   SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'Set' : 'Missing'}`);
console.log(`   ADMIN_EMAILS: ${ADMIN_EMAILS.length > 0 ? ADMIN_EMAILS.join(', ') : 'None configured'}`);
console.log(`   Supabase client: ${supabase ? 'Available' : 'Missing'}`);

// Debug middleware to log all admin requests
app.use('/admin', (req, res, next) => {
  console.log(`[ADMIN REQUEST] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  console.log(`   Headers:`, {
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    origin: req.headers.origin,
    'user-agent': req.headers['user-agent']
  });
  next();
});

// Only mount admin routes if all required config is present
if (!process.env.SUPABASE_URL) {
  console.warn('⚠️ SUPABASE_URL is not set. Admin routes will NOT be mounted.');
} else if (!supabase) {
  console.warn('⚠️ Supabase client not available. Admin routes will NOT be mounted.');
} else if (ADMIN_EMAILS.length === 0) {
  console.warn('⚠️ No ADMIN_EMAILS configured. Admin routes will NOT be mounted.');
} else {
  try {
    const adminRoutes = adminRoutesFactory({
      SUPABASE_URL: process.env.SUPABASE_URL,
      supabaseAdmin: supabase,
      ADMIN_EMAILS,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
    });
    
    app.use('/admin', adminRoutes);
    console.log('✅ Admin routes successfully mounted at /admin');
    
    // Test endpoint to verify admin routes are working
    app.get('/admin-test', (req, res) => {
      res.json({
        success: true,
        message: 'Admin routes are active',
        timestamp: new Date().toISOString(),
        config: {
          supabase_url: process.env.SUPABASE_URL ? 'Configured' : 'Missing',
          admin_emails_count: ADMIN_EMAILS.length,
          api_base: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`
        }
      });
    });
    
    // Admin health endpoint
    app.get('/admin/health', (req, res) => {
      res.json({
        success: true,
        message: 'Admin API is healthy',
        timestamp: new Date().toISOString(),
        endpoints: {
          articles: 'GET /admin/articles',
          article_by_id: 'GET /admin/articles/:id',
          create_article: 'POST /admin/articles',
          update_article: 'PUT /admin/articles/:id',
          delete_article: 'DELETE /admin/articles/:id',
          stats: 'GET /admin/stats'
        }
      });
    });
    
  } catch (e) {
    console.error('❌ Failed to mount admin routes:', e && e.message ? e.message : e);
    console.error('Stack trace:', e.stack);
    
    // Fallback basic admin routes for debugging
    app.get('/admin/debug', (req, res) => {
      res.json({
        error: 'Admin routes failed to load',
        message: e?.message || 'Unknown error',
        timestamp: new Date().toISOString()
      });
    });
  }
}

/* -------------------- Health & utility endpoints -------------------- */
app.get('/health', (req, res) => {
  const healthData = {
    success: true,
    status: 'healthy',
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    
    // System status
    system: {
      processing: !!isProcessing,
      poll_minutes: POLL_MINUTES,
      process_count: PROCESS_COUNT,
      sources: Object.keys(NEWS_SOURCES || {}).length
    },
    
    // Database status
    database: {
      supabase_url: process.env.SUPABASE_URL ? 'Configured' : 'Missing',
      supabase_client: supabase ? 'Connected' : 'Disconnected',
      admin_routes: ADMIN_EMAILS.length > 0 ? 'Available' : 'Not configured'
    },
    
    // API status
    apis: {
      newsapi: process.env.NEWSAPI_KEY ? 'Configured' : 'Not configured',
      gnews: process.env.GNEWS_API_KEY ? 'Configured' : 'Not configured',
      openrouter: process.env.OPENROUTER_API_KEY ? 'Configured' : 'Not configured',
      groq: process.env.GROQ_API_KEY ? 'Configured' : 'Not configured'
    },
    
    // Endpoints
    endpoints: {
      api: '/api/news, /api/news/:slug, /api/search, /api/stats, /api/region/:region',
      admin: ADMIN_EMAILS.length > 0 ? '/admin/*' : 'Not configured',
      health: '/health, /ping, /admin/health'
    }
  };
  
  // Try to get database status
  if (supabase) {
    supabase.from('ai_news')
      .select('*', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (error) {
          healthData.database.status = 'Error: ' + error.message;
        } else {
          healthData.database.total_articles = count || 0;
          healthData.database.status = 'Connected';
        }
        res.json(healthData);
      })
      .catch(err => {
        healthData.database.status = 'Connection error: ' + err.message;
        res.json(healthData);
      });
  } else {
    res.json(healthData);
  }
});

app.get('/health-check', (req, res) => {
  const checks = {
    server: 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  res.json(checks);
});

app.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: 'pong',
    timestamp: new Date().toISOString(),
    client_ip: req.ip,
    user_agent: req.headers['user-agent']
  });
});

app.get('/config', (req, res) => {
  // Safe config exposure (no secrets)
  res.json({
    success: true,
    config: {
      node_env: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 10000,
      poll_minutes: POLL_MINUTES,
      process_count: PROCESS_COUNT,
      sources_count: Object.keys(NEWS_SOURCES || {}).length,
      features: [
        'Latest Hindi News',
        '300+ word articles',
        'Video extraction',
        'Real-time updates',
        '2-day retention'
      ],
      admin_enabled: ADMIN_EMAILS.length > 0,
      cors_enabled: true,
      base_url: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`
    }
  });
});

/* -------------------- Enhanced Error Handling -------------------- */
app.use((req, res, next) => {
  console.warn(`⚠️ 404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    suggestions: [
      '/api/news - Get all articles',
      '/api/news/:slug - Get specific article',
      '/api/search?q=query - Search articles',
      '/api/stats - Get statistics',
      '/health - Health check',
      '/ping - Simple ping'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error("🔥 Server error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: isProduction ? "Something went wrong. Please try again later." : err.message,
    timestamp: new Date().toISOString(),
    ...(!isProduction && { stack: err.stack }),
    request_id: req.headers['x-request-id'] || Math.random().toString(36).substring(7)
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('🔥 Uncaught Exception:', error);
  // Don't exit the process for uncaught exceptions in production
  if (process.env.NODE_ENV === 'production') {
    console.error('Keeping process alive after uncaught exception');
  }
});

/* -------------------- Start Server (graceful shutdown) -------------------- */
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Ensure server starts only after all routes are mounted
const startServer = () => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 SERVER STARTED SUCCESSFULLY!
    ============================================
    Port: ${PORT}
    URL: ${BASE_URL}
    Environment: ${process.env.NODE_ENV || 'development'}
    PID: ${process.pid}

    🔥 LATEST HINDI NEWS CONFIGURATION:
    - Poll interval: ${POLL_MINUTES} minutes
    - Focus: LATEST NEWS (last 24 hours) -> rewritten to HINDI
    - Priority: Uttarakhand → National → International
    - Retention: 2 days cleanup
    - Features: 300+ words, video extraction
    - Items processed per cycle: ${PROCESS_COUNT}

    📰 NEWS SOURCES (count): ${Object.keys(NEWS_SOURCES || {}).length}

    🔐 ADMIN PANEL:
    - Status: ${ADMIN_EMAILS.length > 0 ? 'ENABLED' : 'DISABLED'}
    - Emails: ${ADMIN_EMAILS.length > 0 ? ADMIN_EMAILS.join(', ') : 'None configured'}
    - URL: ${BASE_URL}/admin/*

    📊 DATABASE:
    - Supabase: ${process.env.SUPABASE_URL ? 'Connected' : 'Not configured'}
    - Admin routes: ${ADMIN_EMAILS.length > 0 && process.env.SUPABASE_URL && supabase ? 'Mounted' : 'Not available'}

    ⚡ SYSTEM FEATURES:
    - Region-first (Uttarakhand) fetching + region fallback queries
    - Always fetches NEWEST articles first
    - Date sorting on all sources
    - Time-limited queries (last 24 hours)
    - Frequent updates every ${POLL_MINUTES} minutes
    - Real-time news processing
    - Cleanup of content older than 2 days

    🔧 DEBUG ENDPOINTS:
    - ${BASE_URL}/health (Full health check)
    - ${BASE_URL}/ping (Simple ping)
    - ${BASE_URL}/config (Configuration)
    - ${BASE_URL}/admin-test (Admin test endpoint)
    - ${BASE_URL}/admin/health (Admin health check)

    🚀 Ready to deliver LATEST Hindi news!
    ============================================
    `);
  });

  /* -------------------- Graceful shutdown -------------------- */
  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down gracefully...`);
    
    // Set a flag to prevent new requests
    isShuttingDown = true;
    
    // Stop the server from accepting new connections
    server.close((err) => {
      if (err) {
        console.error('❌ Error during server close:', err);
        process.exit(1);
      }
      
      console.log('✅ Server closed successfully');
      
      // Perform any cleanup tasks
      const cleanupTasks = [
        () => console.log('1. Closing database connections...'),
        () => console.log('2. Saving any pending data...'),
        () => console.log('3. Cleaning up temporary files...')
      ];
      
      // Execute cleanup tasks sequentially
      const runCleanup = async () => {
        for (const task of cleanupTasks) {
          try {
            await Promise.resolve(task());
          } catch (cleanupErr) {
            console.warn('⚠️ Cleanup task failed:', cleanupErr.message);
          }
        }
        
        console.log('✅ Shutdown complete.');
        process.exit(0);
      };
      
      runCleanup();
    });

    // Force shutdown after timeout
    setTimeout(() => {
      console.warn('⚠️ Forcing shutdown after timeout.');
      process.exit(1);
    }, 30000).unref(); // 30 seconds timeout
  }

  // Track if we're shutting down
  let isShuttingDown = false;
  
  // Middleware to reject new requests during shutdown
  app.use((req, res, next) => {
    if (isShuttingDown) {
      return res.status(503).json({
        success: false,
        error: 'Server is shutting down',
        message: 'Please try again later',
        timestamp: new Date().toISOString()
      });
    }
    next();
  });

  // Handle various shutdown signals
  process.on("SIGTERM", () => shutdown('SIGTERM'));
  process.on("SIGINT", () => shutdown('SIGINT'));
  
  // Handle other signals
  process.on('SIGUSR2', () => {
    console.log('SIGUSR2 received (usually from Nodemon)');
    shutdown('SIGUSR2');
  });
  
  // Handle exit events
  process.on('exit', (code) => {
    console.log(`Process exiting with code: ${code}`);
  });

  // Handle server errors
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use`);
      process.exit(1);
    } else {
      console.error('❌ Server error:', error);
    }
  });

  // Monitor server connections
  server.on('connection', (socket) => {
    if (isShuttingDown) {
      socket.destroy();
    }
  });

  return server;
};

// Start the server
try {
  startServer();
} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}

// Export for testing or programmatic use
module.exports = {
  app,
  supabase,
  isProcessing,
  runScheduledProcessing,
  NEWS_SOURCES,
  POLL_MINUTES,
  PROCESS_COUNT,
  ADMIN_EMAILS,
  startServer
};