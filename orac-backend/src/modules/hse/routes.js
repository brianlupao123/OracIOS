/**
 * Phase 4 Module Extraction - HSE Module Routes
 *
 * Mounts all HSE endpoints — PPE checklists, toolbox talks, incidents,
 * JSA (Job Safety Analysis), and site inspections.
 */
import { Router } from "express";

import {
  recordPreDispatchPpe,
  listPpeChecklists,
  createToolboxTalk,
  listToolboxTalks,
  reportIncident,
  listIncidents,
  getHseSummary
} from "../../controllers/hseController.js";

import {
  postCreateJsa, postSubmitJsa, postApproveJsa, postRejectJsa, getJsaCheck,
  postCreateInspection, postRecordResults, postSubmitInspection, postSignOff
} from "../../controllers/hseQualityController.js";

const hseRouter = Router();

// Core HSE
hseRouter.post("/hse/ppe-checklists", recordPreDispatchPpe);
hseRouter.get("/hse/ppe-checklists", listPpeChecklists);
hseRouter.post("/hse/toolbox-talks", createToolboxTalk);
hseRouter.get("/hse/toolbox-talks", listToolboxTalks);
hseRouter.post("/hse/incidents", reportIncident);
hseRouter.get("/hse/incidents", listIncidents);
hseRouter.get("/hse/summary", getHseSummary);

// HSE Quality (JSA + Inspections)
hseRouter.post("/hse/jsa", postCreateJsa);
hseRouter.post("/hse/jsa/:id/submit", postSubmitJsa);
hseRouter.post("/hse/jsa/:id/approve", postApproveJsa);
hseRouter.post("/hse/jsa/:id/reject", postRejectJsa);
hseRouter.get("/hse/jsa/:dispatchId/check", getJsaCheck);
hseRouter.post("/hse/inspections", postCreateInspection);
hseRouter.post("/hse/inspections/:id/results", postRecordResults);
hseRouter.post("/hse/inspections/:id/submit", postSubmitInspection);
hseRouter.post("/hse/inspections/:id/sign-off", postSignOff);

export default hseRouter;
