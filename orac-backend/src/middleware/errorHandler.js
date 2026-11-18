import { AppError } from "../shared/errors/index.js";
import { config } from "../config.js";

/**
 * Express global error-handling middleware.
 *
 * Maps ORAC AppError subclasses to structured JSON responses.
 * Unknown errors become 500 with a generic message in production.
 *
 * Must be mounted AFTER all routes:
 *   app.use(errorHandler);
 */
export function errorHandler(err, req, res, _next) {
  // AppError subclass — operational, structured
  if (err instanceof AppError) {
    if (err.statusCode >= 500) console.error(err);
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      details: err.details,
      timestamp: err.timestamp,
    });
  }

  // Legacy `err.status` pattern used by some controllers (e.g. requirePermission)
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);

  const message =
    config.isProduction && status >= 500
      ? "Internal server error."
      : err.message || "Internal server error.";

  res.status(status).json({ success: false, message });
}
