import { AppError } from "./AppError.js";

/**
 * 422 Unprocessable Entity — domain/business rule violated.
 * Input is syntactically valid but violates a business invariant.
 *
 * @example
 *   throw new BusinessRuleError("Odometer reading must be greater than previous");
 *   throw new BusinessRuleError("Cannot dispatch to expired mine site induction",
 *     { technicianId: "t-01", minesite: "Zimplats" });
 */
export class BusinessRuleError extends AppError {
  /**
   * @param {string} message  Explanation of the violated rule
   * @param {object} [details]  Context about the violation
   */
  constructor(message, details = {}) {
    super(message, 422, { code: "BUSINESS_RULE_VIOLATION", details });
  }
}
