import { AppError } from "../errors/AppError.js";

/**
 * Base controller providing standardised async wrapping, response formatting,
 * and pagination helpers.
 *
 * Extend this in every domain controller to eliminate manual try/catch blocks
 * and ensure consistent response envelopes.
 *
 * @example
 *   class FleetController extends BaseController {
 *     listVehicles = this.wrapAsync(async (req, res) => {
 *       const result = await vehicleService.findAll(req.query);
 *       this.sendPaginated(res, result.items, result.meta);
 *     });
 *   }
 */
export class BaseController {
  /**
   * Wraps an async handler so errors are forwarded to Express error middleware.
   * @param {Function} fn  Async (req, res, next) handler
   * @returns {Function}  Express middleware
   */
  wrapAsync(fn) {
    return (req, res, next) => {
      Promise.resolve(fn.call(this, req, res, next)).catch(next);
    };
  }

  /**
   * 200 OK — standard success response.
   * @param {import("express").Response} res
   * @param {*} data
   * @param {object} [meta]  Extra metadata (e.g. counts, timings)
   */
  sendSuccess(res, data, meta = {}) {
    res.status(200).json({ ok: true, data, meta });
  }

  /**
   * 201 Created — resource successfully created.
   * @param {import("express").Response} res
   * @param {*} data
   */
  sendCreated(res, data) {
    res.status(201).json({ ok: true, data, meta: {} });
  }

  /**
   * 204 No Content — action succeeded with no body (e.g. soft-delete).
   * @param {import("express").Response} res
   */
  sendNoContent(res) {
    res.status(204).end();
  }

  /**
   * Paginated list response.
   * @param {import("express").Response} res
   * @param {Array} items  Current page items
   * @param {{ page: number, limit: number, total: number }} meta  Pagination info
   */
  sendPaginated(res, items, meta) {
    res.status(200).json({
      ok: true,
      data: items,
      meta: {
        page: meta.page,
        limit: meta.limit,
        total: meta.total,
        totalPages: Math.ceil(meta.total / meta.limit),
        hasMore: meta.page * meta.limit < meta.total,
      },
    });
  }

  /**
   * Error response (manual usage — normally the global error handler does this).
   * @param {import("express").Response} res
   * @param {number} statusCode
   * @param {string} message
   * @param {object} [details]
   */
  sendError(res, statusCode, message, details = {}) {
    res.status(statusCode).json({
      ok: false,
      error: { code: "ERROR", message, details },
      meta: {},
    });
  }

  /**
   * Parse page & limit from query string with sane defaults and ceiling.
   * @param {object} query  req.query
   * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
   * @returns {{ page: number, limit: number, offset: number }}
   */
  parsePagination(query, opts = {}) {
    const defaultLimit = opts.defaultLimit || 25;
    const maxLimit = opts.maxLimit || 100;
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
    return { page, limit, offset: (page - 1) * limit };
  }
}
