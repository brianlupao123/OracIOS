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
import { sendQuotationPdfEmail, confirmQuotationReceipt } from "../../services/quotationEmailService.js";

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
/**
 * Sales may act only on quotes in its own portfolio. guardCommunication keys on
 * entity_type / business_record_type, which these endpoints do not send, so the
 * quote the handler will actually use (quote_id) is checked here, fail-closed.
 * A missing quote and an out-of-portfolio quote get the same answer (no existence oracle).
 */
function assertQuoteInActorScope(actor, quoteId, db) {
  if (actor.role !== roles.SALES) return;
  const quote = (db?.quotes || []).find((q) => q.id === quoteId);
  if (!quote || !isQuoteInSalesPortfolio(quote, actor, db)) {
    throw Object.assign(new Error("Communication access denied."), { status: 403, code: "QUOTE_SCOPE_DENIED" });
  }
}

function sendError(res, err) {
  return res.status(err.status || 500).json({
    success: false,
    message: err.message,
    code: err.code,
    ...(err.data ? { data: err.data } : {})
  });
}

export async function sendQuotationPdfHandler(req, res) {
  try {
    const actor = getActor(req);
    const { quote_id, recipient_email, recipient_name, subject, body, idempotency_key, resend_of, resend_reason } = req.body || {};
    assertQuoteInActorScope(actor, quote_id, req.db);
    const result = await sendQuotationPdfEmail({
      quoteId: quote_id,
      recipientEmail: recipient_email,
      recipientName: recipient_name,
      subject,
      body,
      idempotencyKey: idempotency_key ?? req.headers?.["idempotency-key"] ?? null,
      resendOf: resend_of,
      resendReason: resend_reason,
      actor,
      store: req.store,
      db: req.db
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
}

// Human-recorded recipient receipt: a separate evidence action, never implied by SMTP acceptance.
export function confirmQuotationReceiptHandler(req, res) {
  try {
    const actor = getActor(req);
    const { quote_id, evidence_id, method, note, received_at } = req.body || {};
    assertQuoteInActorScope(actor, quote_id, req.db);
    const result = confirmQuotationReceipt({
      quoteId: quote_id,
      evidenceId: evidence_id,
      method,
      note,
      receivedAt: received_at,
      actor,
      store: req.store,
      db: req.db
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
}

communicationsRouter.post("/communications/send-quotation-pdf", guardCommunication, sendQuotationPdfHandler);
communicationsRouter.post("/communications/quotation-pdf-receipt", guardCommunication, confirmQuotationReceiptHandler);
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
