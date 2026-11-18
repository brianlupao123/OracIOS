/**
 * HR Module Routes — Artisan qualifications, documents, mine inductions, leave management
 */
import { Router } from "express";
import {
  createArtisanQualification, listArtisanQualifications,
  recordMineInduction, listMineInductions,
  verifyArtisanDispatchGate, getArtisanVaultSummary
} from "../../controllers/artisanController.js";
import {
  postRegisterDocument, postVerifyDocument, postRejectDocument,
  getPortfolio, getCompliance, getExpiring
} from "../../controllers/artisanDocumentController.js";
import {
  createLeave, listLeaves, getLeave, submitLeave, approveLeave,
  rejectLeave, cancelLeave, getBalance, getCalendar, getLeaveTypes
} from "../../controllers/leaveController.js";

const hrRouter = Router();

// Artisan Qualifications & Mine Inductions
hrRouter.post("/artisans/qualifications", createArtisanQualification);
hrRouter.get("/artisans/qualifications", listArtisanQualifications);
hrRouter.post("/artisans/inductions", recordMineInduction);
hrRouter.get("/artisans/inductions", listMineInductions);
hrRouter.post("/artisans/verify-dispatch-gate", verifyArtisanDispatchGate);
hrRouter.get("/artisans/summary", getArtisanVaultSummary);

// Artisan Document Storage
hrRouter.post("/artisan/documents", postRegisterDocument);
hrRouter.post("/artisan/documents/:id/verify", postVerifyDocument);
hrRouter.post("/artisan/documents/:id/reject", postRejectDocument);
hrRouter.get("/artisan/:technicianId/portfolio", getPortfolio);
hrRouter.get("/artisan/:technicianId/compliance", getCompliance);
hrRouter.get("/artisan/documents/expiring", getExpiring);

// Leave & Absence Management
hrRouter.get("/leave-types", getLeaveTypes);
hrRouter.post("/leave-requests", createLeave);
hrRouter.get("/leave-requests", listLeaves);
hrRouter.get("/leave-requests/:id", getLeave);
hrRouter.post("/leave-requests/:id/submit", submitLeave);
hrRouter.post("/leave-requests/:id/approve", approveLeave);
hrRouter.post("/leave-requests/:id/reject", rejectLeave);
hrRouter.post("/leave-requests/:id/cancel", cancelLeave);
hrRouter.get("/leave-balance/:userId", getBalance);
hrRouter.get("/leave-calendar", getCalendar);

export default hrRouter;
