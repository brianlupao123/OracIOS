/**
 * ORAC Enterprise Router — Modular Architecture
 *
 * Public (unauthenticated) routes are registered first, then authMiddleware,
 * then all authenticated module routes. Each module owns its own routes.
 */
import express from "express";
import { LoginSchema, CreateLeadSchema } from "./schemas.js";
import { authMiddleware } from "./middleware/auth.js";
import { validate } from "./middleware/validate.js";
import { idempotencyKeyMiddleware } from "./idempotency.js";

// Auth controllers (public endpoints only)
import { loginDemoUser, requestPasswordReset, resetPassword, loginWithGoogle } from "./controllers/authController.js";
import { verifyTotpLogin, beginTotpEnrollment, confirmTotpEnrollment } from "./controllers/totpController.js";
import { createAccessRequest } from "./controllers/accessRequestsController.js";
import { createLead } from "./controllers/coreController.js";

// Module routes
import publicRoutes from "./modules/public/routes.js";
import fleetRoutes from "./modules/fleet/routes.js";
import hseRoutes from "./modules/hse/routes.js";
import hrRoutes from "./modules/hr/routes.js";
import procurementRoutes from "./modules/procurement/routes.js";
import commercialRoutes from "./modules/commercial/routes.js";
import financeRoutes from "./modules/finance/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import authRoutes from "./modules/auth/routes.js";
import documentsRoutes from "./modules/documents/routes.js";
import surveysRoutes from "./modules/surveys/routes.js";
import feedbackRoutes from "./modules/feedback/routes.js";
import iotRoutes from "./modules/iot/routes.js";
import syncRoutes from "./modules/sync/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import notificationsRoutes from "./modules/notifications/routes.js";
import aiRoutes from "./modules/ai/routes.js";
import communicationsRoutes from "./modules/communications/routes.js";
import serviceRequestsRoutes from "./modules/service-requests/routes.js";
import uploadsRoutes from "./modules/uploads/routes.js";
import ganttRoutes from "./modules/operations/ganttRoutes.js";
import attendanceRoutes from "./attendance/routes.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ROUTES — No authentication required
// ═══════════════════════════════════════════════════════════════════
router.post("/auth/login", validate(LoginSchema), loginDemoUser);
router.post("/auth/google", loginWithGoogle);
router.post("/auth/totp/verify", verifyTotpLogin);
router.post("/auth/totp/enrollment/start", beginTotpEnrollment);
router.post("/auth/totp/enrollment/confirm", confirmTotpEnrollment);
router.post("/leads", idempotencyKeyMiddleware, validate(CreateLeadSchema), createLead);
router.post("/auth/request-password-reset", requestPasswordReset);
router.post("/auth/reset-password", resetPassword);
router.post("/access-requests", createAccessRequest);

// Public website module (enquiry forms, booking, schedule)
router.use(publicRoutes);

// ═══════════════════════════════════════════════════════════════════
// AUTH WALL — Everything below requires authentication
// ═══════════════════════════════════════════════════════════════════
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED MODULE ROUTES
// ═══════════════════════════════════════════════════════════════════
router.use(authRoutes);
router.use(adminRoutes);
router.use(commercialRoutes);
router.use(documentsRoutes);
router.use(financeRoutes);
router.use(fleetRoutes);
router.use(hseRoutes);
router.use(hrRoutes);
router.use(procurementRoutes);
router.use(surveysRoutes);
router.use(feedbackRoutes);
router.use(iotRoutes);
router.use(syncRoutes);
router.use(dashboardRoutes);
router.use(notificationsRoutes);
router.use(aiRoutes);
router.use(communicationsRoutes);
router.use(serviceRequestsRoutes);
router.use(uploadsRoutes);
router.use(ganttRoutes);
router.use(attendanceRoutes);

export default router;
