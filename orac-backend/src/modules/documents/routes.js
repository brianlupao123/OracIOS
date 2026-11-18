/**
 * Documents & Reports Module Routes — Document data, PDFs, reports, job tracker
 */
import { Router } from "express";
import { getQuoteDocument, getDispatchDocument, getWorksheetDocument, getInvoiceDocument, getPoDocument, getQuotePdf, getJobCardPdf, getWorksheetPdf, getInvoicePdf, getPoDocumentPdf } from "../../controllers/documentController.js";
import { getDailyTaskReport, getInvoiceReadySummary, getClientCompletionRecord } from "../../controllers/operationalDocumentsController.js";
import { getPipelineReport, getPoComplianceReport, getDispatchReport, getWorksheetReport, getInvoiceReadyReport, getVarianceReport, getTechnicianPayrollReport, exportTechnicianPayrollPastel } from "../../controllers/reportsController.js";
import { getJobTracker } from "../../controllers/jobTrackerController.js";
import { getDailyTimesheetDocument } from "../../controllers/dailyTimesheetController.js";
import { getContractorLogDocument } from "../../controllers/contractorLogController.js";
import { getWorksheetRegisterDocument } from "../../controllers/worksheetRegisterController.js";

const documentsRouter = Router();

// Document Data endpoints
documentsRouter.get("/document-data/quotes/:id", getQuoteDocument);
documentsRouter.get("/document-data/dispatch_cards/:id", getDispatchDocument);
documentsRouter.get("/document-data/field_worksheets/:id", getWorksheetDocument);
documentsRouter.get("/document-data/invoices/:id", getInvoiceDocument);
documentsRouter.get("/document-data/purchase_orders/:id", getPoDocument);
documentsRouter.get("/document-data/daily-task-report", getDailyTaskReport);
documentsRouter.get("/document-data/invoice-ready-summary", getInvoiceReadySummary);
documentsRouter.get("/document-data/client-completion/:id", getClientCompletionRecord);
documentsRouter.get("/document-data/daily_timesheets/:id", getDailyTimesheetDocument);
documentsRouter.get("/document-data/contractor_log_sheets/:id", getContractorLogDocument);
documentsRouter.get("/document-data/worksheet_registers/:id", getWorksheetRegisterDocument);

// PDF Documents
documentsRouter.get("/documents/quotes/:id.pdf", getQuotePdf);
documentsRouter.get("/documents/job-cards/:id.pdf", getJobCardPdf);
documentsRouter.get("/documents/worksheets/:id.pdf", getWorksheetPdf);
documentsRouter.get("/documents/invoices/:id.pdf", getInvoicePdf);
documentsRouter.get("/documents/purchase-orders/:id.pdf", getPoDocumentPdf);

// Reports
documentsRouter.get("/job-tracker", getJobTracker);
documentsRouter.get("/reports/pipeline", getPipelineReport);
documentsRouter.get("/reports/po-compliance", getPoComplianceReport);
documentsRouter.get("/reports/dispatch", getDispatchReport);
documentsRouter.get("/reports/worksheets", getWorksheetReport);
documentsRouter.get("/reports/invoice-ready", getInvoiceReadyReport);
documentsRouter.get("/reports/variance", getVarianceReport);
documentsRouter.get("/reports/technician-payroll", getTechnicianPayrollReport);
documentsRouter.get("/exports/pastel-payroll.csv", exportTechnicianPayrollPastel);

export default documentsRouter;
