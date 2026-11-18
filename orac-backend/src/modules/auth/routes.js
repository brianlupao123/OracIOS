/**
 * Auth Module Routes — Login, TOTP, password reset (authenticated endpoints only)
 * Note: Public auth routes (login, enrollment, access-requests) remain in router.js
 */
import { Router } from "express";
import { getMe } from "../../controllers/authController.js";
import {
  issueTotpEnrollmentTicket, resetTotpFactor,
  requestTotpFactorReset, approveTotpFactorReset
} from "../../controllers/totpController.js";

const authRouter = Router();

authRouter.get("/auth/me", getMe);
authRouter.post("/auth/totp/enrollment/tickets", issueTotpEnrollmentTicket);
authRouter.post("/auth/totp/factor/reset", resetTotpFactor);
authRouter.post("/auth/totp/factor/reset/request", requestTotpFactorReset);
authRouter.post("/auth/totp/factor/reset/approve", approveTotpFactorReset);

export default authRouter;
