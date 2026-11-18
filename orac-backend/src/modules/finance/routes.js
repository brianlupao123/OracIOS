/**
 * Finance Module Routes — Maker-checker bank approval, sales portfolio, invoice settlement
 */
import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { idempotencyKeyMiddleware } from "../../idempotency.js";
import {
  RecordInvoicePaymentSchema, VoidInvoicePaymentSchema,
  CreateInvoiceCreditNoteSchema, IssueInvoiceCreditNoteSchema,
  CreateLegacyInvoiceDraftSchema, IssueLegacyInvoiceDraftSchema
} from "../../schemas.js";
import {
  createProposal, listProposals, getProposal, approveProposal, rejectProposal
} from "../../controllers/makerCheckerController.js";
import {
  getSalesPortfolioDispatches, getSalesDispatchProgress, getSalesApprovedWorkSummary,
  getSalesMaterialsSummary, getSalesPortfolioInvoices, getSalesPortfolioPurchaseOrders
} from "../../controllers/salesPortfolioController.js";
import {
  getInvoiceSettlement, recordInvoicePayment, voidInvoicePayment,
  createInvoiceCreditNote, issueInvoiceCreditNote
} from "../../controllers/invoiceSettlementController.js";
import {
  createLegacyInvoiceDraft, issueLegacyInvoiceDraft, listLegacyInvoiceDrafts
} from "../../controllers/legacyInvoiceDraftController.js";
import { voidInvoice } from "../../controllers/coreController.js";

const financeRouter = Router();

// Maker-Checker Bank Approval (S-02)
financeRouter.post("/bank-change-proposals", createProposal);
financeRouter.get("/bank-change-proposals", listProposals);
financeRouter.get("/bank-change-proposals/:id", getProposal);
financeRouter.post("/bank-change-proposals/:id/approve", approveProposal);
financeRouter.post("/bank-change-proposals/:id/reject", rejectProposal);

// Invoice Settlement
financeRouter.post("/invoices/:id/void", voidInvoice);
financeRouter.get("/invoices/:id/settlement", getInvoiceSettlement);
financeRouter.post("/invoices/:id/payments", idempotencyKeyMiddleware, validate(RecordInvoicePaymentSchema), recordInvoicePayment);
financeRouter.post("/invoices/:id/payments/:paymentId/void", validate(VoidInvoicePaymentSchema), voidInvoicePayment);
financeRouter.post("/invoices/:id/credit-notes", idempotencyKeyMiddleware, validate(CreateInvoiceCreditNoteSchema), createInvoiceCreditNote);
financeRouter.post("/credit-notes/:creditNoteId/issue", validate(IssueInvoiceCreditNoteSchema), issueInvoiceCreditNote);

// Legacy Invoice Drafts (on dispatch cards)
financeRouter.get("/dispatch_cards/:id/legacy-invoice-drafts", listLegacyInvoiceDrafts);
financeRouter.post("/dispatch_cards/:id/legacy-invoice-drafts", validate(CreateLegacyInvoiceDraftSchema), createLegacyInvoiceDraft);
financeRouter.post("/legacy-invoice-drafts/:id/issue", validate(IssueLegacyInvoiceDraftSchema), issueLegacyInvoiceDraft);

// Sales Portfolio
financeRouter.get("/sales/portfolio/dispatches", getSalesPortfolioDispatches);
financeRouter.get("/sales-portfolio/dispatches", getSalesPortfolioDispatches);
financeRouter.get("/sales/portfolio/dispatches/:id/progress", getSalesDispatchProgress);
financeRouter.get("/sales-portfolio/dispatches/:id/progress", getSalesDispatchProgress);
financeRouter.get("/sales/portfolio/dispatches/:id/approved-work", getSalesApprovedWorkSummary);
financeRouter.get("/sales-portfolio/dispatches/:id/approved-work", getSalesApprovedWorkSummary);
financeRouter.get("/sales/portfolio/dispatches/:id/materials", getSalesMaterialsSummary);
financeRouter.get("/sales-portfolio/dispatches/:id/materials", getSalesMaterialsSummary);
financeRouter.get("/sales/portfolio/invoices", getSalesPortfolioInvoices);
financeRouter.get("/sales-portfolio/invoices", getSalesPortfolioInvoices);
financeRouter.get("/sales/portfolio/purchase_orders", getSalesPortfolioPurchaseOrders);
financeRouter.get("/sales-portfolio/purchase_orders", getSalesPortfolioPurchaseOrders);

export default financeRouter;
