/**
 * Communications Module Routes — Templates, preview, timeline, evidence, digest
 */
import { Router } from "express";
import { roles } from "../../permissions.js";
import {
  getActor, isQuoteInSalesPortfolio, isInvoiceInSalesPortfolio,
  isDispatchInSalesPortfolio
} from "../../controllers/coreController.js";
import {
  listCommunicationTemplates, getCommunicationTemplate, previewCommunication,
  getTimeline, recordEvidence, recordExternalSendEndpoint, getDigest,
  listQueueMessages, getCommunicationQueueStats, createQueueMessage,
  dispatchQueueMessage, cancelQueueMessage, retryQueueMessage
} from "../../controllers/communicationsController.js";

const communicationsRouter = Router();

const OFFICE_ROLES = new Set([roles.ADMIN, roles.MANAGEMENT, roles.OPERATIONS, roles.FINANCE, roles.SALES]);

function guardCommunication(req, res, next) {
  try {
    const actor = getActor(req);
    if (!OFFICE_ROLES.has(actor.role) || actor.is_active === false) {
      return res.status(403).json({ success: false, message: "Communication access denied." });
    }
    if (actor.role === roles.SALES) {
      const type = req.params.entityType || req.body?.business_record_type || req.body?.entity_type;
      const id = req.params.entityId || req.body?.business_record_id || req.body?.entity_id;
      // Sales may record and inspect communications only for its assigned records.
      // A free-form preview without a record has no source data to reveal.
      if (type || id) {
        const db = req.db || {};
        const allowed = type === "quote"
          ? isQuoteInSalesPortfolio((db.quotes || []).find(q => q.id === id), actor, db)
          : type === "invoice"
            ? isInvoiceInSalesPortfolio((db.invoices || []).find(i => i.id === id), actor, db)
            : type === "dispatch"
              ? isDispatchInSalesPortfolio((db.dispatch_cards || []).find(d => d.id === id), actor, db)
              : false;
        if (!allowed) return res.status(403).json({ success: false, message: "Communication access denied." });
      }
    }
    next();
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

communicationsRouter.get("/communications/templates", listCommunicationTemplates);
communicationsRouter.get("/communications/templates/:name", getCommunicationTemplate);
communicationsRouter.post("/communications/preview", guardCommunication, previewCommunication);
communicationsRouter.get("/communications/timeline/:entityType/:entityId", guardCommunication, getTimeline);
communicationsRouter.post("/communications/evidence", guardCommunication, recordEvidence);
communicationsRouter.post("/communications/record-external-send", guardCommunication, recordExternalSendEndpoint);
communicationsRouter.get("/communications/digest", (req, res, next) => {
  if (req.user?.role !== roles.ADMIN) return res.status(403).json({ success: false, message: "Admin access required." });
  next();
}, getDigest);

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
