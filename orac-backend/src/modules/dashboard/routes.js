/**
 * Dashboard Module Routes
 */
import { Router } from "express";
import { getRoleDashboardSummary } from "../../controllers/dashboardController.js";

const dashboardRouter = Router();

dashboardRouter.get("/dashboard/role-summary", getRoleDashboardSummary);

export default dashboardRouter;
