// cors-config.js
// Centralized CORS configuration for the RT-India server.
// Enhanced to handle admin panel preflight requests properly

const cors = require("cors");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://rt-india.com",
  "https://www.rt-india.com",
  "https://rt-india.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "null" // Allow file:// URLs for local testing
];

function buildAllowedOrigins() {
  const extraOrigins = (process.env.ADDITIONAL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origins = Array.from(new Set(DEFAULT_ALLOWED_ORIGINS.concat(extraOrigins)));
  console.log(`🔧 CORS allowed origins: ${origins.length} origins configured`);
  if (origins.length > 0) {
    console.log(`   ${origins.join(', ')}`);
  }
  return origins;
}

function buildCorsOptions() {
  const allowedOrigins = buildAllowedOrigins();
  const allowAll = String(process.env.CORS_ALLOW_ALL || "true").toLowerCase() === "true"; // Changed to true for debugging
  const allowCredentials = String(process.env.CORS_ALLOW_CREDENTIALS || "true").toLowerCase() === "true"; // Changed to true

  console.log(`🔧 CORS Configuration:`);
  console.log(`   Allow All: ${allowAll}`);
  console.log(`   Allow Credentials: ${allowCredentials}`);
  console.log(`   Allowed Origins Count: ${allowedOrigins.length}`);

  const corsOptions = {
    origin: function (origin, callback) {
      // Log all origins for debugging
      console.log(`🌐 CORS origin check: ${origin || 'No origin (server-to-server)'}`);
      
      // allow server-to-server or tools with no origin
      if (!origin) {
        console.log('   Allowing: No origin');
        return callback(null, true);
      }

      if (allowAll) {
        console.log(`   Allowing: All origins enabled`);
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        console.log(`   Allowing: Origin in allowed list`);
        return callback(null, true);
      }

      console.warn(`   Blocking: Origin not allowed`);
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
      "X-CSRF-Token",
      "X-Request-ID",
      "User-Agent",
      "Referer",
      "apikey" // For Supabase API
    ],
    exposedHeaders: [
      "Content-Range", 
      "X-Content-Range",
      "Content-Length",
      "ETag",
      "X-Total-Count"
    ],
    credentials: allowCredentials,
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204
  };

  return { corsOptions, allowedOrigins, allowAll, allowCredentials };
}

/**
 * Attach CORS middleware to an Express app instance.
 * This will call app.use(cors(corsOptions)) and app.options('*', cors(corsOptions))
 * so preflight requests are handled consistently.
 *
 * @param {import('express').Express} app
 */
function configureCors(app) {
  const { corsOptions } = buildCorsOptions();
  
  // Apply CORS middleware
  app.use(cors(corsOptions));
  
  // Handle OPTIONS preflight requests for all routes
  app.options("*", cors(corsOptions));
  
  // Add additional CORS headers for all responses
  app.use((req, res, next) => {
    // Get the origin from the request
    const origin = req.headers.origin;
    
    // If origin is in allowed list or allowAll is true, set CORS headers
    if (origin) {
      const { allowedOrigins, allowAll } = buildCorsOptions();
      if (allowAll || allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With, Origin");
        res.header("Access-Control-Expose-Headers", "Content-Range, X-Content-Range, X-Total-Count");
        
        // Log CORS headers for debugging
        if (req.method === 'OPTIONS') {
          console.log(`🔧 OPTIONS preflight for: ${req.path}`);
          console.log(`   Origin: ${origin}`);
          console.log(`   Headers: ${req.headers['access-control-request-headers'] || 'None'}`);
        }
      }
    }
    
    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    next();
  });
  
  console.log('✅ CORS middleware configured');
  return corsOptions;
}

module.exports = {
  configureCors,
  buildCorsOptions
};