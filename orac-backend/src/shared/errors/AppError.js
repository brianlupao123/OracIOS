/**
 * Base application error class.
 * All custom errors extend this. Express error handler checks `instanceof AppError`
 * to decide whether the error is "operational" (safe to show to client) or a
 * programmer bug (500, generic message).
 *
 * @example
 *   throw new AppError("Something went wrong", 500);
 */
export class AppError extends Error {
  /**
   * @param {string} message  Human-readable error description
   * @param {number} statusCode  HTTP status code (default 500)
   * @param {object} [options]
   * @param {string} [options.code]  Machine-readable error code e.g. "NOT_FOUND"
   * @param {boolean} [options.isOperational]  true = expected error, false = bug
   * @param {object} [options.details]  Arbitrary context (field errors, IDs, etc.)
   */
  constructor(message, statusCode = 500, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = options.code || this._defaultCode();
    this.isOperational = options.isOperational !== undefined ? options.isOperational : true;
    this.details = options.details || {};
    this.timestamp = new Date().toISOString();

    // Capture stack trace (omit constructor from trace)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** @returns {string} Default machine-readable code derived from class name */
  _defaultCode() {
    // AppError → "APP_ERROR", NotFoundError → "NOT_FOUND_ERROR"
    return this.name
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toUpperCase();
  }

  /**
   * Serialise to the RFC 7807-inspired response body.
   * @returns {{ code: string, message: string, details: object, timestamp: string }}
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}
