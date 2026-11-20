/**
 * Communications Module Routes — Templates, preview, timeline, evidence, digest
 */
import { Router } from "express";
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
communicationsRouter.get("/communications/queue", listQueueMessages);
communicationsRouter.get("/communications/queue/stats", getCommunicationQueueStats);
communicationsRouter.post("/communications/queue", createQueueMessage);
communicationsRouter.post("/communications/queue/:id/dispatch", dispatchQueueMessage);
communicationsRouter.post("/communications/queue/:id/cancel", cancelQueueMessage);
communicationsRouter.post("/communications/queue/:id/retry", retryQueueMessage);

export default communicationsRouter;
