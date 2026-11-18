import { AppError } from "./AppError.js";

/**
 * 403 Forbidden — wrong role, self-approval blocked, or missing permission.
 *
 * @example
 *   throw new ForbiddenError("Admin cannot approve own quote");
 *   throw new ForbiddenError("Role Technician cannot perform exportPastel");
 */
export class ForbiddenError extends AppError {
  /**
   * @param {string} [message]
   * @param {object} [details]  e.g. { permission: "exportPastel", role: "Technician" }
   */
  constructor(message = "Forbidden", details = {}) {
    super(message, 403, { code: "FORBIDDEN", details });
  }
}
