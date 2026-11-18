/**
 * Procurement Module Routes — Supply chain, inventory, stock, reorder alerts
 */
import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  CreateSupplierSchema, UpdateSupplierSchema,
  CreateStockItemSchema, UpdateStockItemSchema,
  StockMovementSchema, DirectSaleStockIssueSchema
} from "../../schemas.js";
import {
  createProcurementRequest, approveProcurementRequest,
  createSupplierPo, receiveGrn, issueStoreVoucher, performThreeWayMatch,
  listProcurementRequests, listSupplierPos, listGrns, listStoreIssueVouchers,
  getProcurementSummary
} from "../../controllers/procurementController.js";
import {
  getSuppliers, createSupplier, updateSupplier,
  getStockItems, createStockItem, updateStockItem,
  recordStockMovement, issueDirectSaleStock,
  getStockMovements, getStockItemMovements,
  getLowStockReport, getInventoryReconciliation
} from "../../controllers/inventoryController.js";
import {
  postScanAlerts, getAlerts, getSummary as getAlertSummary, postAcknowledge, postDismiss
} from "../../controllers/reorderAlertController.js";

const procurementRouter = Router();

// Supply Chain & Procurement
procurementRouter.get("/procurement/requests", listProcurementRequests);
procurementRouter.post("/procurement/requests", createProcurementRequest);
procurementRouter.post("/procurement/requests/:id/approve", approveProcurementRequest);
procurementRouter.get("/procurement/supplier-pos", listSupplierPos);
procurementRouter.post("/procurement/supplier-pos", createSupplierPo);
procurementRouter.get("/procurement/grns", listGrns);
procurementRouter.post("/procurement/grns", receiveGrn);
procurementRouter.get("/procurement/store-issue-vouchers", listStoreIssueVouchers);
procurementRouter.post("/procurement/store-issue-vouchers", issueStoreVoucher);
procurementRouter.post("/procurement/three-way-match", performThreeWayMatch);
procurementRouter.get("/procurement/summary", getProcurementSummary);

// Inventory & Stock
procurementRouter.get("/inventory/suppliers", getSuppliers);
procurementRouter.post("/inventory/suppliers", validate(CreateSupplierSchema), createSupplier);
procurementRouter.patch("/inventory/suppliers/:id", validate(UpdateSupplierSchema), updateSupplier);
procurementRouter.get("/inventory/stock_items", getStockItems);
procurementRouter.post("/inventory/stock_items", validate(CreateStockItemSchema), createStockItem);
procurementRouter.patch("/inventory/stock_items/:id", validate(UpdateStockItemSchema), updateStockItem);
procurementRouter.post("/inventory/movements", validate(StockMovementSchema), recordStockMovement);
procurementRouter.post("/inventory/movements/direct-sale", validate(DirectSaleStockIssueSchema), issueDirectSaleStock);
procurementRouter.get("/inventory/movements", getStockMovements);
procurementRouter.get("/inventory/stock_items/:id/movements", getStockItemMovements);
procurementRouter.get("/inventory/reports/low-stock", getLowStockReport);
procurementRouter.get("/inventory/reconciliation", getInventoryReconciliation);

// Reorder Alerts
procurementRouter.post("/inventory/reorder-alerts/scan", postScanAlerts);
procurementRouter.get("/inventory/reorder-alerts", getAlerts);
procurementRouter.get("/inventory/reorder-alerts/summary", getAlertSummary);
procurementRouter.post("/inventory/reorder-alerts/:id/acknowledge", postAcknowledge);
procurementRouter.post("/inventory/reorder-alerts/:id/dismiss", postDismiss);

export default procurementRouter;
