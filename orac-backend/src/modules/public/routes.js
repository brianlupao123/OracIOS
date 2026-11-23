// Public website routes — no login required for /public/* endpoints.
// Staff booking management uses the standard auth middleware.
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { idempotencyKeyMiddleware } from "../../idempotency.js";
import { getPublicGoogleProfile } from "./controllers/googleProfileController.js";
import {
  getPublicSlots,
  createWebsiteEnquiry,
  getBookingSettings,
  updateBookingSettings,
  listBookings,
  updateBookingStatus,
} from "./controllers/websiteController.js";

const router = Router();

// ── Public (no auth) ──
router.get("/public/slots", getPublicSlots);
router.post("/public/enquiries", idempotencyKeyMiddleware, createWebsiteEnquiry);
router.post("/public/google-profile", getPublicGoogleProfile);

// ── Staff booking management (auth required) ──
router.get("/bookings/settings", authMiddleware, getBookingSettings);
router.put("/bookings/settings", authMiddleware, updateBookingSettings);
router.get("/bookings", authMiddleware, listBookings);
router.patch("/bookings/:id/status", authMiddleware, updateBookingStatus);

export default router;
