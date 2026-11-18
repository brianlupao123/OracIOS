import { AppError } from "./AppError.js";

/**
 * 404 Not Found — entity not found.
 * Accepts entity type and ID for structured error responses.
 *
 * @example
 *   throw new NotFoundError("Vehicle", "v-123");
 *   throw new NotFoundError("Quote");
 */
export class NotFoundError extends AppError {
  /**
   * @param {string} entityType  e.g. "Vehicle", "Quote", "User"
   * @param {string} [entityId]  The ID that was looked up
   */
  constructor(entityType, entityId) {
    const message = entityId
      ? `${entityType} '${entityId}' not found`
      : `${entityType} not found`;
    super(message, 404, {
      code: "NOT_FOUND",
      details: { entityType, entityId: entityId || null },
    });
  }
}
