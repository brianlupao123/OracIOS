/**
 * Fleet & Logistics module routes.
 *
 * Mounts all fleet endpoints — core vehicle CRUD, dispatch/return,
 * fuel logging, compliance scanning, odometer readings, and
 * maintenance requests.
 *
 * All routes are behind authMiddleware (applied in the main router
 * before this module is mounted).
 */
import { Router } from "express";

import {
  createVehicle,
  listVehicles,
  dispatchVehicle,
  returnVehicle,
  logFuel,
  getFleetSummary
} from "./controllers/fleetController.js";

import {
  postOdometerReading,
  getOdometer,
  getStats as getFleetStats,
  getScanCompliance,
  getExpiryAlerts,
  postMaintenanceRequest,
  postMaintenanceTransition
} from "./controllers/fleetComplianceController.js";

const fleetRouter = Router();

// ── Core Fleet ───────────────────────────────────────────────────────
fleetRouter.get("/fleet/vehicles", listVehicles);
fleetRouter.post("/fleet/vehicles", createVehicle);
fleetRouter.post("/fleet/dispatches", dispatchVehicle);
fleetRouter.post("/fleet/dispatches/:id/return", returnVehicle);
fleetRouter.post("/fleet/fuel-logs", logFuel);
fleetRouter.get("/fleet/summary", getFleetSummary);

// ── Fleet Compliance ─────────────────────────────────────────────────
fleetRouter.post("/fleet/odometer", postOdometerReading);
fleetRouter.get("/fleet/odometer/:vehicleId", getOdometer);
fleetRouter.get("/fleet/odometer/:vehicleId/stats", getFleetStats);
fleetRouter.get("/fleet/compliance", getScanCompliance);
fleetRouter.get("/fleet/compliance/alerts", getExpiryAlerts);
fleetRouter.post("/fleet/maintenance", postMaintenanceRequest);
fleetRouter.post("/fleet/maintenance/:id/transition", postMaintenanceTransition);

export default fleetRouter;
