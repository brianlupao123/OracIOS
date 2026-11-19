/**
 * Communications Module Routes — Templates, preview, timeline, evidence, digest
 */
import { Router } from "express";
import {
  listCommunicationTemplates, getCommunicationTemplate, previewCommunication,
  getTimeline, recordEvidence, recordExternalSendEndpoint, getDigest
} from "../../controllers/communicationsController.js";

const communicationsRouter = Router();

communicationsRouter.get("/communications/templates", listCommunicationTemplates);
communicationsRouter.get("/communications/templates/:name", getCommunicationTemplate);
communicationsRouter.post("/communications/preview", previewCommunication);
communicationsRouter.get("/communications/timeline/:entityType/:entityId", getTimeline);
communicationsRouter.post("/communications/evidence", recordEvidence);
communicationsRouter.post("/communications/record-external-send", recordExternalSendEndpoint);
communicationsRouter.get("/communications/digest", getDigest);

export default communicationsRouter;
