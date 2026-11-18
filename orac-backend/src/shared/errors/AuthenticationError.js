import { AppError } from "./AppError.js";

/**
 * 401 Unauthorized — not logged in or token expired.
 *
 * @example
 *   throw new AuthenticationError("Token expired");
 *   throw new AuthenticationError(); // uses default message
 */
export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, { code: "AUTHENTICATION_ERROR" });
  }
}
