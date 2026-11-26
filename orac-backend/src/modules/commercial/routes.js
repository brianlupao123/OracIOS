/**
 * Commercial Module Routes — Quotes, dispatches, worksheets, timesheets,
 * V5 billing, kiosk, technician profiles, and all commercial operations.
 *
 * This is the largest module — the core business engine.
 */
import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { idempotencyKeyMiddleware } from "../../idempotency.js";
import {
  CreateQuoteSchema, UpdateQuoteSchema, CreateQuoteRevisionSchema,
  RecordAmendedPoEvidenceSchema, ApproveV5AmendmentSchema, TransitionQuoteSchema,
  VerifyPoSchema, ClientSubmitPoSchema, RejectPoSchema,
  AddTimesheetSchema, KioskTimesheetBatchSchema, AddMaterialSchema,
  V5MaterialAllocationSchema, V5AmendmentDispatchLinkSchema, V5AmendmentEvidenceAllocationSchema,
  CreateV5InvoiceDraftSchema, IssueV5InvoiceDraftSchema, V5LineCompletionSchema,
  V5AmendmentSupersessionSchema, V5AllocationRemapSchema,
  CreateWorksheetSchema, AssignRosterSchema, ReviewWorksheetSchema,
  AssignDispatchSupervisorSchema, ApproveAmendmentSchema,
  UpdateWorksheetSchema, ReviewKioskTimesheetSchema,
  ClientAcknowledgeWorksheetSchema, ClientReturnWorksheetSchema, ReviseWorksheetSchema,
  CreateDailyTimesheetSchema, UpdateDailyTimesheetSchema, ReviewDailyTimesheetSchema,
  CreateContractorLogSchema, UpdateContractorLogSchema, ReviewContractorLogSchema
} from "../../schemas.js";
import { CreateTimesheetSchemaV2, UpdateTimesheetSchemaV2 } from "../../timesheetSchemasV2.js";
import {
  PreviewWorksheetRegisterSchema, CreateWorksheetRegisterSchema, UpdateWorksheetRegisterSchema,
  AcknowledgeRegisterExceptionsSchema, ReviewWorksheetRegisterSchema,
  CancelWorksheetRegisterSchema, ReconcileWorksheetRegisterSchema
} from "../../worksheetRegisterSchemas.js";
import { V5ClientSupervisorContactSchema, V5PaperSignatureSchema, V5SupervisorConfirmationSchema } from "../../v5SignatureSchemas.js";

import { createQuote, createQuoteRevision, recordAmendedPoEvidence, approveV5Amendment, transition, capturePo, submitClientPo, rejectPo, updateQuote, cancelQuote } from "../../controllers/quoteController.js";
import {
  addTimesheet, addMaterialUsage, createWorksheet,
  submitWorksheet, reviewWorksheet, approveAmendment, updateWorksheet,
  getDispatchMaterialStatus, assignRosterTechnician, getDispatchRoster, assignDispatchSupervisor, getDispatchJobCard, getDispatchInvoiceReadiness
} from "../../controllers/dispatchController.js";
import { allocateV5MaterialUsage } from "../../controllers/v5MaterialAllocationController.js";
import { linkV5AmendmentToDispatch } from "../../controllers/v5AmendmentLinkController.js";
import { allocateV5AmendmentEvidence } from "../../controllers/v5AmendmentEvidenceAllocationController.js";
import { getV5InvoicePreview } from "../../controllers/v5InvoicePreviewController.js";
import { createV5InvoiceDraft, getV5InvoiceDraft, getV5InvoiceDraftWorkspace, issueV5InvoiceDraft, listDispatchV5InvoiceDrafts, recordV5LineCompletion, supersedeV5Amendment, remapV5Allocation, getV5Invoice, listDispatchV5Invoices, getV5InvoiceBillingState } from "../../controllers/v5InvoiceWriterController.js";
import { getKioskRoster, submitKioskTimesheets } from "../../controllers/kioskController.js";
import { listDailyTimesheetReviewQueue, reopenDailyTimesheet, createDailyTimesheet, updateDailyTimesheet, submitDailyTimesheet, reviewDailyTimesheet, getDailyTimesheetDocument } from "../../controllers/dailyTimesheetController.js";
import { listTechnicianProfiles } from "../../controllers/technicianProfilesController.js";
import { accessTechnicianSettlementDetails } from "../../controllers/technicianSettlementController.js";
import { createContractorLog, updateContractorLog, submitContractorLog, reviewContractorLog, getContractorLogDocument } from "../../controllers/contractorLogController.js";
import {
  listWorksheetRegisters, getWorksheetRegister, getWorksheetRegisterDocument, previewWorksheetRegister,
  createWorksheetRegister, updateWorksheetRegister, buildWorksheetRegister, acknowledgeRegisterExceptions,
  submitWorksheetRegister, reviewWorksheetRegister, cancelWorksheetRegister,
  reconcileWorksheetRegister, listLegacyTimesheets
} from "../../controllers/worksheetRegisterController.js";
import { listDispatchTimesheets, listKioskReviewQueue, reviewKioskTimesheet } from "../../controllers/timesheetReviewController.js";
import {
  listOwnClientTimesheets, acknowledgeWorksheet, returnWorksheetByClient, reviseWorksheet,
  getTimesheetPeriodPack, getTimesheetPeriodPackPdf, getTimesheetPeriodSummary
} from "../../controllers/timesheetAcknowledgementController.js";
import {
  getTimesheetPolicy, updateTimesheetPolicy, listTimesheetAuthorities, createTimesheetAuthority, revokeTimesheetAuthority,
  setClientCutover, listTimesheetsRateFree, capturePaperTimesheet, logPaperCustody, batchConfirmTimesheets,
  runTimesheetReminders, getPaperSampling, getInvoiceVariance, requestVarianceOverride, approveVarianceOverride, resolvePostInvoiceRevision,
  getRegisterPoVariance, getDispatchPoVariance, attachPoScopeEvidence,
  getV5BillingReadiness
} from "../../controllers/timesheetWorkflowController.js";
import {
  createV5ClientSupervisorContact, listV5ClientSupervisorContacts, withdrawV5ClientSupervisorContact,
  getV5SignatureState, recordV5PaperSignature, confirmV5Timesheet
} from "../../controllers/v5SignatureController.js";
import { getQuoteTrail } from "../../controllers/trailController.js";
import { clientViewerDispatchGate, grantedDispatchJobCard, createGrant, listGrants, revokeGrant } from "../../controllers/dispatchCardGrantController.js";

const commercialRouter = Router();

// Legacy form creation gate
const legacyFormCreationGate = (req, res, next) => {
  if (process.env.LEGACY_TIMESHEET_FORM_CREATION === "enabled") return next();
  return res.status(409).json({ success: false, code: "LEGACY_FORM_READ_ONLY", message: "Daily Time Sheets and Contractor Logs are now read-only history. Record the work on a Timesheet." });
};

// ── Quotes ──────────────────────────────────────────────────────────
commercialRouter.post("/quotes", validate(CreateQuoteSchema), createQuote);
commercialRouter.patch("/quotes/:id", validate(UpdateQuoteSchema), updateQuote);
commercialRouter.post("/quotes/:id/revisions", validate(CreateQuoteRevisionSchema), createQuoteRevision);
commercialRouter.post("/quotes/:id/amended-po-evidence", validate(RecordAmendedPoEvidenceSchema), recordAmendedPoEvidence);
commercialRouter.post("/quotes/:id/approve-amendment", validate(ApproveV5AmendmentSchema), approveV5Amendment);
commercialRouter.post("/quotes/:id/cancel", cancelQuote);
commercialRouter.post("/quotes/:id/transition", validate(TransitionQuoteSchema), transition);
commercialRouter.post("/quotes/:id/po", validate(VerifyPoSchema), capturePo);
commercialRouter.post("/quotes/:id/client-po", validate(ClientSubmitPoSchema), submitClientPo);
commercialRouter.post("/quotes/:id/record-po", validate(ClientSubmitPoSchema), submitClientPo);
commercialRouter.post("/quotes/:id/reject-po", validate(RejectPoSchema), rejectPo);
commercialRouter.get("/trail/quotes/:id", getQuoteTrail);
commercialRouter.post("/quotes/:id/po-scope-evidence", attachPoScopeEvidence);

// ── Purchase Orders ─────────────────────────────────────────────────
commercialRouter.post("/purchase_orders/:id/amendments", validate(ApproveAmendmentSchema), approveAmendment);

// ── Dispatches & Worksheets ─────────────────────────────────────────
commercialRouter.get("/dispatch_cards/:id/job-card", clientViewerDispatchGate, grantedDispatchJobCard(getDispatchJobCard));
commercialRouter.get("/dispatch_cards/:id/invoice-readiness", getDispatchInvoiceReadiness);
commercialRouter.post("/dispatch_cards/:id/timesheets", validate(AddTimesheetSchema), addTimesheet);
commercialRouter.get("/dispatch_cards/:id/timesheets", listDispatchTimesheets);
commercialRouter.get("/timesheets/kiosk-review", listKioskReviewQueue);
commercialRouter.post("/timesheets/:id/review", validate(ReviewKioskTimesheetSchema), reviewKioskTimesheet);
commercialRouter.get("/kiosk/dispatch_cards/:id/roster", getKioskRoster);
commercialRouter.post("/kiosk/dispatch_cards/:id/timesheets", validate(KioskTimesheetBatchSchema), submitKioskTimesheets);
commercialRouter.post("/dispatch_cards/:id/materials", validate(AddMaterialSchema), addMaterialUsage);
commercialRouter.get("/dispatch_cards/:id/materials/status", getDispatchMaterialStatus);
commercialRouter.post("/dispatch_cards/:id/v5-material-allocations", validate(V5MaterialAllocationSchema), allocateV5MaterialUsage);
commercialRouter.post("/dispatch_cards/:id/v5-amendment-links", validate(V5AmendmentDispatchLinkSchema), linkV5AmendmentToDispatch);
commercialRouter.post("/dispatch_cards/:id/v5-amendment-evidence-allocations", validate(V5AmendmentEvidenceAllocationSchema), allocateV5AmendmentEvidence);
commercialRouter.post("/dispatch_cards/:id/worksheets", validate(CreateTimesheetSchemaV2), createWorksheet);
commercialRouter.get("/dispatch_cards/:id/roster", getDispatchRoster);
commercialRouter.post("/dispatch_cards/:id/roster", validate(AssignRosterSchema), assignRosterTechnician);
commercialRouter.post("/dispatch_cards/:id/supervisor", validate(AssignDispatchSupervisorSchema), assignDispatchSupervisor);
commercialRouter.post("/field_worksheets/:id/submit", submitWorksheet);
commercialRouter.patch("/field_worksheets/:id", validate(UpdateTimesheetSchemaV2), updateWorksheet);
commercialRouter.post("/field_worksheets/:id/review", validate(ReviewWorksheetSchema), reviewWorksheet);

// ── Technicians ─────────────────────────────────────────────────────
commercialRouter.get("/technician-profiles", listTechnicianProfiles);
commercialRouter.post("/technicians/:id/settlement-details/access", accessTechnicianSettlementDetails);

// ── Legacy Daily Timesheets ─────────────────────────────────────────
commercialRouter.post("/daily_timesheets", legacyFormCreationGate, validate(CreateDailyTimesheetSchema), createDailyTimesheet);
commercialRouter.patch("/daily_timesheets/:id", validate(UpdateDailyTimesheetSchema), updateDailyTimesheet);
commercialRouter.post("/daily_timesheets/:id/submit", submitDailyTimesheet);
commercialRouter.get("/daily-timesheet-review-queue", listDailyTimesheetReviewQueue);
commercialRouter.post("/daily_timesheets/:id/reopen", reopenDailyTimesheet);
commercialRouter.post("/daily_timesheets/:id/review", validate(ReviewDailyTimesheetSchema), reviewDailyTimesheet);

// ── Legacy Contractor Logs ──────────────────────────────────────────
commercialRouter.post("/contractor_log_sheets", legacyFormCreationGate, validate(CreateContractorLogSchema), createContractorLog);
commercialRouter.patch("/contractor_log_sheets/:id", validate(UpdateContractorLogSchema), updateContractorLog);
commercialRouter.post("/contractor_log_sheets/:id/submit", submitContractorLog);
commercialRouter.post("/contractor_log_sheets/:id/review", validate(ReviewContractorLogSchema), reviewContractorLog);

// ── Worksheet Registers ─────────────────────────────────────────────
commercialRouter.get("/legacy_timesheets", listLegacyTimesheets);
commercialRouter.get("/worksheet_registers", listWorksheetRegisters);
commercialRouter.post("/worksheet_registers/preview", validate(PreviewWorksheetRegisterSchema), previewWorksheetRegister);
commercialRouter.post("/worksheet_registers", validate(CreateWorksheetRegisterSchema), createWorksheetRegister);
commercialRouter.get("/worksheet_registers/:id", getWorksheetRegister);
commercialRouter.patch("/worksheet_registers/:id", validate(UpdateWorksheetRegisterSchema), updateWorksheetRegister);
commercialRouter.post("/worksheet_registers/:id/build", buildWorksheetRegister);
commercialRouter.post("/worksheet_registers/:id/acknowledge", validate(AcknowledgeRegisterExceptionsSchema), acknowledgeRegisterExceptions);
commercialRouter.post("/worksheet_registers/:id/submit", submitWorksheetRegister);
commercialRouter.post("/worksheet_registers/:id/review", validate(ReviewWorksheetRegisterSchema), reviewWorksheetRegister);
commercialRouter.post("/worksheet_registers/:id/cancel", validate(CancelWorksheetRegisterSchema), cancelWorksheetRegister);
commercialRouter.post("/worksheet_registers/:id/reconcile", validate(ReconcileWorksheetRegisterSchema), reconcileWorksheetRegister);

// ── Client Worksheet Acknowledgement ────────────────────────────────
commercialRouter.get("/field_worksheets/mine/client", listOwnClientTimesheets);
commercialRouter.post("/field_worksheets/:id/client-acknowledge", validate(ClientAcknowledgeWorksheetSchema), acknowledgeWorksheet);
commercialRouter.post("/field_worksheets/:id/client-return", validate(ClientReturnWorksheetSchema), returnWorksheetByClient);

// ── Timesheet Policy & Workflow ─────────────────────────────────────
commercialRouter.get("/timesheet-policy", getTimesheetPolicy);
commercialRouter.patch("/timesheet-policy", updateTimesheetPolicy);
commercialRouter.get("/timesheet-authorities", listTimesheetAuthorities);
commercialRouter.post("/timesheet-authorities", createTimesheetAuthority);
commercialRouter.post("/timesheet-authorities/:id/revoke", revokeTimesheetAuthority);

// ── Dispatch Card Grants (Batch C Commit 2) ─────────────────────────
commercialRouter.post("/dispatch-card-grants", createGrant);
commercialRouter.get("/dispatch-card-grants", listGrants);
commercialRouter.post("/dispatch-card-grants/:id/revoke", revokeGrant);

commercialRouter.patch("/clients/:id/timesheet-cutover", setClientCutover);
commercialRouter.get("/timesheets/rate-free", listTimesheetsRateFree);

// ── V5 Billing ──────────────────────────────────────────────────────
commercialRouter.get("/dispatch_cards/:id/v5-billing-readiness", getV5BillingReadiness);
commercialRouter.get("/dispatch_cards/:id/v5-invoice-preview", getV5InvoicePreview);
commercialRouter.get("/dispatch_cards/:id/v5-invoice-draft-workspace", getV5InvoiceDraftWorkspace);
commercialRouter.get("/dispatch_cards/:id/v5-invoice-drafts", listDispatchV5InvoiceDrafts);
commercialRouter.post("/dispatch_cards/:id/v5-invoice-drafts", validate(CreateV5InvoiceDraftSchema), createV5InvoiceDraft);
commercialRouter.get("/v5-invoice-drafts/:id", getV5InvoiceDraft);
commercialRouter.post("/v5-invoice-drafts/:id/issue", validate(IssueV5InvoiceDraftSchema), issueV5InvoiceDraft);
commercialRouter.post("/dispatch_cards/:id/v5-line-completions", validate(V5LineCompletionSchema), recordV5LineCompletion);
commercialRouter.post("/dispatch_cards/:id/v5-amendment-supersessions", validate(V5AmendmentSupersessionSchema), supersedeV5Amendment);
commercialRouter.post("/dispatch_cards/:id/v5-allocation-remaps", validate(V5AllocationRemapSchema), remapV5Allocation);
commercialRouter.get("/v5-invoices/:id", getV5Invoice);
commercialRouter.get("/dispatch_cards/:id/v5-invoices", listDispatchV5Invoices);
commercialRouter.get("/dispatch_cards/:id/v5-invoice-billing-state", getV5InvoiceBillingState);

// ── V5 Client Supervisor Contacts & Signatures ──────────────────────
commercialRouter.get("/dispatch_cards/:id/v5-client-supervisor-contacts", listV5ClientSupervisorContacts);
commercialRouter.post("/dispatch_cards/:id/v5-client-supervisor-contacts", validate(V5ClientSupervisorContactSchema), createV5ClientSupervisorContact);
commercialRouter.post("/v5-client-supervisor-contacts/:id/withdraw", withdrawV5ClientSupervisorContact);
commercialRouter.get("/field_worksheets/:id/v5-signature-state", getV5SignatureState);
commercialRouter.post("/field_worksheets/:id/v5-paper-signature", validate(V5PaperSignatureSchema), recordV5PaperSignature);
commercialRouter.post("/field_worksheets/:id/v5-supervisor-confirmation", validate(V5SupervisorConfirmationSchema), confirmV5Timesheet);
commercialRouter.post("/field_worksheets/paper-capture", capturePaperTimesheet);
commercialRouter.post("/timesheet-paper-custody", logPaperCustody);
commercialRouter.post("/field_worksheets/batch-confirm", batchConfirmTimesheets);
commercialRouter.post("/timesheets/reminders/run", runTimesheetReminders);
commercialRouter.get("/timesheets/paper-sampling", getPaperSampling);

// ── Variance & Post-Invoice ─────────────────────────────────────────
commercialRouter.get("/dispatch_cards/:id/invoice-variance", getInvoiceVariance);
commercialRouter.get("/dispatch_cards/:id/po-variance", getDispatchPoVariance);
commercialRouter.get("/worksheet_registers/:id/po-variance", getRegisterPoVariance);
commercialRouter.post("/dispatch_cards/:id/variance-override", requestVarianceOverride);
commercialRouter.post("/variance-overrides/:id/approve", approveVarianceOverride);
commercialRouter.post("/field_worksheets/:id/resolve-post-invoice", resolvePostInvoiceRevision);
commercialRouter.post("/field_worksheets/:id/revise", validate(ReviseWorksheetSchema), reviseWorksheet);

// ── Timesheet Period Reports ────────────────────────────────────────
commercialRouter.get("/reports/timesheets/period-pack", getTimesheetPeriodPack);
commercialRouter.get("/documents/timesheets/period-pack.pdf", getTimesheetPeriodPackPdf);
commercialRouter.get("/reports/timesheets/period-summary", getTimesheetPeriodSummary);

export default commercialRouter;
