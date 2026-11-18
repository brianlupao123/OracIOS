import { AppError } from "./AppError.js";

/**
 * 409 Conflict — duplicate entry, state conflict, or concurrent modification.
 *
 * @example
 *   throw new ConflictError("User with email 'a@b.com' already exists");
 *   throw new ConflictError("Invoice already voided", { invoiceId: "inv-001" });
 */
export class ConflictError extends AppError {
  /**
   * @param {string} [message]
   * @param {object} [details]
   */
  constructor(message = "Resource conflict", details = {}) {
    super(message, 409, { code: "CONFLICT", details });
  }
}
