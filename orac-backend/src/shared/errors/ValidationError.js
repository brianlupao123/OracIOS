import { AppError } from "./AppError.js";

/**
 * 400 Bad Request — invalid input.
 * Optionally carries field-level error details from Zod or manual validation.
 *
 * @example
 *   throw new ValidationError("Invalid email format", { field: "email" });
 *   throw new ValidationError("Validation failed", { fields: zodIssues });
 */
export class ValidationError extends AppError {
  /**
   * @param {string} message  Description of what failed
   * @param {object} [details]  Field-level error info
   */
  constructor(message = "Validation failed", details = {}) {
    super(message, 400, { code: "VALIDATION_ERROR", details });
  }
}
