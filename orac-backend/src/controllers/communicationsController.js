import {
  listTemplates, getTemplate, renderPreview,
  buildQuoteContext, buildInvoiceContext, buildDispatchContext
} from "../services/communicationTemplateService.js";
import {
  getEntityCommunicationTimeline, getEntityCommunicationStats,
  recordCommunicationEvidence, buildChaseDigest
} from "../services/communicationAuditService.js";

/**
 * Communication Preview Controller — Batch 1 of 4.
 *
 * Zero sending risk: renders template previews only.
 * No mail packages, no SMTP, no transport code.
 * Route path: /communications/preview (does NOT match the email guard pattern).
 */

// GET /api/communications/templates — list available templates
export function listCommunicationTemplates(req, res) {
  return res.json({ success: true, templates: listTemplates() });
}

// GET /api/communications/templates/:name — get template definition
export function getCommunicationTemplate(req, res) {
  const template = getTemplate(req.params.name);
  if (!template) return res.status(404).json({ success: false, message: `Template '${req.params.name}' not found.` });
  return res.json({ success: true, template_name: req.params.name, subject: template.subject, body: template.body });
}

// POST /api/communications/preview — render a preview (no queueing, no sending)
export function previewCommunication(req, res) {
  try {
    const { template_name, entity_type, entity_id } = req.body;
    if (!template_name) return res.status(400).json({ success: false, message: "template_name is required." });

    // Build context from the entity if available
    let context = req.body.context || {};

    if (entity_type && entity_id) {
      const companyProfile = req.db.company_profile || {};
      const sender = req.db.users?.find(u => u.id === req.user.id) || {};

      if (entity_type === "quote") {
        const quote = req.db.quotes?.find(q => q.id === entity_id);
        if (!quote) return res.status(404).json({ success: false, message: "Quote not found." });
        // Enrich with client name
        const client = req.db.clients?.find(c => c.id === quote.client_id);
        quote.client_name = client?.name || quote.client_name || "";
        context = { ...buildQuoteContext(quote, companyProfile, sender), ...context };
      } else if (entity_type === "invoice") {
        const invoice = req.db.invoices?.find(i => i.id === entity_id);
        if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found." });
        const client = req.db.clients?.find(c => c.id === invoice.client_id);
        invoice.client_name = client?.name || invoice.client_name || "";
        context = { ...buildInvoiceContext(invoice, companyProfile, sender), ...context };
      } else if (entity_type === "dispatch") {
        const dispatch = req.db.dispatch_cards?.find(d => d.id === entity_id);
        if (!dispatch) return res.status(404).json({ success: false, message: "Dispatch not found." });
        const client = req.db.clients?.find(c => c.id === dispatch.client_id);
        dispatch.client_name = client?.name || dispatch.client_name || "";
        context = { ...buildDispatchContext(dispatch, companyProfile, sender), ...context };
      }
    }

    const preview = renderPreview(template_name, context);
    if (preview.error) return res.status(400).json({ success: false, message: preview.error });

    return res.json({ success: true, preview });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}


// ── Batch 4: Communication Audit History & Digest ────────────────────

// GET /api/communications/timeline/:entityType/:entityId
export function getTimeline(req, res) {
  try {
    const { entityType, entityId } = req.params;
    if (!entityType || !entityId) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required." });
    }
    const timeline = getEntityCommunicationTimeline({ entityType, entityId, db: req.db });
    const stats = getEntityCommunicationStats({ entityType, entityId, db: req.db });
    return res.json({ success: true, stats, timeline });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /api/communications/evidence
export function recordEvidence(req, res) {
  try {
    const {
      entity_type, entity_id, channel, recipient_email,
      recipient_name, subject, notes, sent_at
    } = req.body;

    const evidence = recordCommunicationEvidence({
      entityType: entity_type,
      entityId: entity_id,
      channel,
      recipientEmail: recipient_email,
      recipientName: recipient_name,
      subject,
      notes,
      sentAt: sent_at,
      recordedBy: req.user.id,
      store: req.store,
      db: req.db
    });

    return res.status(201).json({ success: true, evidence });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /api/communications/digest
export function getDigest(req, res) {
  try {
    const staleDays = req.query.stale_days ? Number(req.query.stale_days) : undefined;
    const draftDays = req.query.draft_days ? Number(req.query.draft_days) : undefined;
    const digest = buildChaseDigest({ db: req.db, staleDays, draftDays });
    return res.json({ success: true, digest });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}
