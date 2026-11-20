/**
 * Communications Module Routes — Templates, preview, timeline, evidence, digest
 */
import { Router } from "express";
import { roles } from "../../permissions.js";
import {
  listCommunicationTemplates, getCommunicationTemplate, previewCommunication,
  getTimeline, recordEvidence, recordExternalSendEndpoint, getDigest,
  listQueueMessages, getCommunicationQueueStats, createQueueMessage,
  dispatchQueueMessage, cancelQueueMessage, retryQueueMessage
} from "../../controllers/communicationsController.js";

const communicationsRouter = Router();

communicationsRouter.get("/communications/templates", listCommunicationTemplates);
communicationsRouter.get("/communications/templates/:name", getCommunicationTemplate);
communicationsRouter.post("/communications/preview", previewCommunication);
communicationsRouter.get("/communications/timeline/:entityType/:entityId", getTimeline);
communicationsRouter.post("/communications/evidence", recordEvidence);
communicationsRouter.post("/communications/record-external-send", recordExternalSendEndpoint);
communicationsRouter.get("/communications/digest", getDigest);

// Queue endpoints
// Controlled pilot only: these endpoints expose recipients and message bodies.
// A role-scoped quote dispatch contract is required before Sales or Operations
// can use them directly.
communicationsRouter.use("/communications/queue", (req, res, next) => {
  if (req.user?.role !== roles.ADMIN) {
    return res.status(403).json({ success: false, message: "Admin access required for the communication queue." });
  }
  next();
});
communicationsRouter.get("/communications/queue", listQueueMessages);
communicationsRouter.get("/communications/queue/stats", getCommunicationQueueStats);
communicationsRouter.post("/communications/queue", createQueueMessage);
communicationsRouter.post("/communications/queue/:id/dispatch", dispatchQueueMessage);
communicationsRouter.post("/communications/queue/:id/cancel", cancelQueueMessage);
communicationsRouter.post("/communications/queue/:id/retry", retryQueueMessage);

export default communicationsRouter;
