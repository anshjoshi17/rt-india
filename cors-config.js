// cors-config.js
// Centralized CORS configuration for the RT-India server.
// Exports: configureCors(app) to attach middleware, and corsOptions for any advanced usage.

const cors = require("cors");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://rt-india.com",
  "https://www.rt-india.com",
  "https://rt-india.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173"
];

function buildAllowedOrigins() {
  const extraOrigins = (process.env.ADDITIONAL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(new Set(DEFAULT_ALLOWED_ORIGINS.concat(extraOrigins)));
}

function buildCorsOptions() {
  const allowedOrigins = buildAllowedOrigins();
  const allowAll = String(process.env.CORS_ALLOW_ALL || "false").toLowerCase() === "true";
  const allowCredentials = String(process.env.CORS_ALLOW_CREDENTIALS || "false").toLowerCase() === "true";

  const corsOptions = {
    origin: function (origin, callback) {
      // allow server-to-server or tools with no origin
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
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  // return options for inspection if needed
  return corsOptions;
}

module.exports = {
  configureCors,
  buildCorsOptions
};
