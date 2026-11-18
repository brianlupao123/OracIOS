/**
 * Structured Logging Service.
 *
 * Production-grade structured logging for ORAC backend.
 * Zero external dependencies — implements a Winston-compatible logger
 * interface using Node.js built-in capabilities.
 *
 * Features:
 *  - Structured JSON log output (timestamp, level, message, context)
 *  - Log levels: error, warn, info, http, debug, trace
 *  - Request context injection (requestId, userId, method, path)
 *  - Performance timing (request duration)
 *  - Child loggers with bound context
 *  - Log filtering by level
 *  - Express middleware for automatic request logging
 *  - Sensitive field redaction (passwords, tokens, etc.)
 *
 * This replaces console.log/console.error with structured output
 * suitable for log aggregation (ELK, Datadog, CloudWatch, etc.).
 */

// ── Log Levels ──────────────────────────────────────────────────────

const LOG_LEVELS = {
  error: 0,
  warn:  1,
  info:  2,
  http:  3,
  debug: 4,
  trace: 5
};

export const LEVEL_NAMES = Object.keys(LOG_LEVELS);

// ── Sensitive Field Redaction ───────────────────────────────────────

const REDACTED_FIELDS = new Set([
  "password", "new_password", "confirm_password", "token",
  "access_token", "refresh_token", "id_token", "api_key",
  "secret", "bank_account_number", "sort_code", "totp_secret",
  "session_token", "authorization"
]);

function redactObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return obj;
  if (Array.isArray(obj)) return obj.map(item => redactObject(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Logger Class ────────────────────────────────────────────────────

export class StructuredLogger {
  /**
   * @param {Object} options
   * @param {string} [options.level="info"] - Minimum level to output
   * @param {string} [options.service="orac-backend"] - Service name
   * @param {Object} [options.context={}] - Bound context fields
   * @param {Function} [options.transport] - Custom output function (default: console)
   * @param {boolean} [options.redact=true] - Whether to redact sensitive fields
   */
  constructor(options = {}) {
    this.level = options.level || (process.env.LOG_LEVEL || "info");
    this.service = options.service || "orac-backend";
    this.context = options.context || {};
    this.transport = options.transport || null;
    this.redact = options.redact !== false;
    this._levelValue = LOG_LEVELS[this.level] ?? 2;
    this._entries = [];  // For testing: captured entries
  }

  /**
   * Creates a child logger with additional bound context.
   */
  child(additionalContext) {
    return new StructuredLogger({
      level: this.level,
      service: this.service,
      context: { ...this.context, ...additionalContext },
      transport: this.transport,
      redact: this.redact
    });
  }

  /**
   * Core log method.
   */
  _log(level, message, meta = {}) {
    const levelValue = LOG_LEVELS[level];
    if (levelValue == null || levelValue > this._levelValue) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...this.context,
      ...(this.redact ? redactObject(meta) : meta)
    };

    this._entries.push(entry);

    if (this.transport) {
      this.transport(entry);
    } else if (level === "error") {
      process.stderr.write(JSON.stringify(entry) + "\n");
    } else {
      process.stdout.write(JSON.stringify(entry) + "\n");
    }

    return entry;
  }

  error(message, meta)  { return this._log("error", message, meta); }
  warn(message, meta)   { return this._log("warn",  message, meta); }
  info(message, meta)   { return this._log("info",  message, meta); }
  http(message, meta)   { return this._log("http",  message, meta); }
  debug(message, meta)  { return this._log("debug", message, meta); }
  trace(message, meta)  { return this._log("trace", message, meta); }

  /**
   * Returns captured log entries (for testing).
   */
  getEntries() { return this._entries; }
  clearEntries() { this._entries = []; }
}

// ── Express Middleware ───────────────────────────────────────────────

/**
 * Creates an Express middleware that logs each request with:
 *  - method, path, statusCode, duration
 *  - userId (from req.user if authenticated)
 *  - requestId (generated or from X-Request-Id header)
 */
export function requestLogger(logger) {
  return (req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || `req_${Date.now().toString(36)}`;

    // Attach logger and requestId to request
    req.requestId = requestId;
    req.log = logger.child({ requestId });

    // Log on response finish
    const originalEnd = res.end;
    res.end = function (...args) {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 500 ? "error"
                  : res.statusCode >= 400 ? "warn"
                  : "http";

      logger._log(level, `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`, {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        userId: req.user ? req.user.id : null,
        userAgent: req.headers["user-agent"] || null
      });

      originalEnd.apply(res, args);
    };

    next();
  };
}

// ── Default Logger Instance ─────────────────────────────────────────

export const logger = new StructuredLogger();

export { redactObject, LOG_LEVELS };
