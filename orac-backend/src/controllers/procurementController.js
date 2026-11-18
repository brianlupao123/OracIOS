import {
  CreateProcurementRequestSchema,
  CreateSupplierPoSchema,
  CreateGrnSchema,
  CreateStoreIssueVoucherSchema
} from "../schemas.js";
import { verifyThreeWayMatch } from "../services/threeWayMatchingService.js";
import { applyStockChange } from "../inventoryLedger.js";

function getActor(req) {
  if (!req.db || !req.db.users) return { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
  const u = req.db.users.find((user) => user.id === req.user?.id);
  return u || { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Finance"]) {
  if (!actor || !allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

// ── 1. Procurement Requests (PR) ─────────────────────────────────────────────

export const createProcurementRequest = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Finance", "Supervisor"]);

    const parseResult = CreateProcurementRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid procurement request data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    const prId = req.store.id("pr");
    const totalEst = val.items.reduce((sum, item) => sum + (item.quantity * item.estimated_unit_cost), 0);

    const pr = {
      id: prId,
      pr_number: `PR-${Date.now().toString().slice(-6)}`,
      department: val.department,
      priority: val.priority,
      justification: val.justification,
      required_by_date: val.required_by_date,
      status: "PENDING_APPROVAL",
      total_estimated_amount: Number(totalEst.toFixed(2)),
      currency: "USD",
      requested_by: actor.id,
      requested_by_name: actor.name,
      items: val.items.map((it, idx) => ({
        id: `${prId}-it-${idx + 1}`,
        ...it,
        total_estimated: Number((it.quantity * it.estimated_unit_cost).toFixed(2))
      })),
      approval: null,
      created_at: new Date().toISOString()
    };

    req.db.procurement_requests = req.db.procurement_requests || [];
    req.db.procurement_requests.push(pr);

    req.store.audit(req.db, actor, "procurement_request", pr.id, "PR_CREATED", null, pr);
    return res.status(201).json({ success: true, data: pr });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const approveProcurementRequest = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Finance"]);

    const { id } = req.params;
    const { action, comments } = req.body; // action: "APPROVE" | "REJECT"

    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be APPROVE or REJECT" });
    }

    req.db.procurement_requests = req.db.procurement_requests || [];
    const pr = req.db.procurement_requests.find((p) => p.id === id);
    if (!pr) {
      return res.status(404).json({ success: false, message: "Procurement request not found" });
    }

    if (pr.status !== "PENDING_APPROVAL") {
      return res.status(409).json({ success: false, message: `Cannot ${action.toLowerCase()} PR in status '${pr.status}'` });
    }

    const before = JSON.parse(JSON.stringify(pr));
    const isApproved = action === "APPROVE";

    pr.status = isApproved ? "APPROVED" : "REJECTED";
    pr.approval = {
      action,
      decided_by: actor.id,
      decided_by_name: actor.name,
      decided_at: new Date().toISOString(),
      comments: comments || null
    };

    req.store.audit(req.db, actor, "procurement_request", pr.id, `PR_${action}D`, before, pr);
    return res.json({ success: true, data: pr });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── 2. Supplier Purchase Orders (PO) ─────────────────────────────────────────

export const createSupplierPo = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Finance", "Operations"]);

    const parseResult = CreateSupplierPoSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid supplier PO data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;

    // Verify supplier exists
    req.db.suppliers = req.db.suppliers || [];
    const supplier = req.db.suppliers.find((s) => s.id === val.supplier_id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: `Supplier '${val.supplier_id}' not found` });
    }

    // If linked to a PR, verify PR is approved
    let linkedPr = null;
    if (val.procurement_request_id) {
      req.db.procurement_requests = req.db.procurement_requests || [];
      linkedPr = req.db.procurement_requests.find((p) => p.id === val.procurement_request_id);
      if (!linkedPr) {
        return res.status(404).json({ success: false, message: "Linked procurement request not found" });
      }
      if (linkedPr.status !== "APPROVED") {
        return res.status(400).json({
          success: false,
          message: `Cannot issue PO against PR with status '${linkedPr.status}'. PR must be APPROVED first.`
        });
      }
    }

    const poId = req.store.id("po");
    const subtotal = val.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const taxTotal = val.items.reduce((sum, item) => sum + (item.quantity * item.unit_price * (item.tax_rate || 0)), 0);
    const totalAmount = subtotal + taxTotal;

    const po = {
      id: poId,
      po_number: `PO-${Date.now().toString().slice(-6)}`,
      procurement_request_id: val.procurement_request_id || null,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      currency: "USD",
      payment_terms: val.payment_terms,
      expected_delivery_date: val.expected_delivery_date,
      status: "ISSUED",
      subtotal: Number(subtotal.toFixed(2)),
      tax_total: Number(taxTotal.toFixed(2)),
      total_amount: Number(totalAmount.toFixed(2)),
      created_by: actor.id,
      items: val.items.map((it, idx) => ({
        id: `${poId}-it-${idx + 1}`,
        ...it,
        total_price: Number((it.quantity * it.unit_price).toFixed(2))
      })),
      created_at: new Date().toISOString()
    };

    req.db.supplier_pos = req.db.supplier_pos || [];
    req.db.supplier_pos.push(po);

    if (linkedPr) {
      linkedPr.status = "PO_ISSUED";
      linkedPr.supplier_po_id = po.id;
    }

    req.store.audit(req.db, actor, "supplier_po", po.id, "PO_ISSUED", null, po);
    return res.status(201).json({ success: true, data: po });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── 3. Goods Received Note (GRN) ─────────────────────────────────────────────

export const receiveGrn = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Operations", "Finance", "Management"]);

    const parseResult = CreateGrnSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid GRN data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;

    req.db.supplier_pos = req.db.supplier_pos || [];
    const po = req.db.supplier_pos.find((p) => p.id === val.supplier_po_id);
    if (!po) {
      return res.status(404).json({ success: false, message: "Referenced Supplier PO not found" });
    }

    const grnId = req.store.id("grn");
    const grnNumber = `GRN-${Date.now().toString().slice(-6)}`;

    req.db.stock_items = req.db.stock_items || [];
    req.db.stock_movements = req.db.stock_movements || [];

    const processedItems = [];

    for (const item of val.items) {
      const poLine = po.items.find((it) => it.item_code === item.item_code);
      if (!poLine) {
        return res.status(400).json({
          success: false,
          message: `Item code '${item.item_code}' is not part of Supplier PO ${po.po_number}`
        });
      }

      // Update or find stock item in inventory
      let stockItem = req.db.stock_items.find((si) => si.item_code === item.item_code);
      const qtyReceived = Number(item.received_quantity) || 0;

      if (!stockItem) {
        stockItem = {
          id: req.store.id("si"),
          item_code: item.item_code,
          item_name: poLine.description || item.item_code,
          unit_of_measure: poLine.unit_of_measure || "each",
          quantity_on_hand: 0,
          reorder_level: 5,
          unit_cost: poLine.unit_price || 0,
          storage_location: item.storage_location || "Central Stores"
        };
        req.db.stock_items.push(stockItem);
      } else if (poLine.unit_price) {
        stockItem.unit_cost = poLine.unit_price;
      }

      const qtyBefore = stockItem.quantity_on_hand;

      if (qtyReceived > 0) {
        applyStockChange({
          store: req.store,
          db: req.db,
          stockItem,
          movementType: "in",
          requestedQuantity: qtyReceived,
          reason: `GRN delivery receipt — ${po.supplier_name}`,
          referenceType: "supplier",
          referenceId: po.supplier_id,
          sourceDocumentRef: val.delivery_note_ref,
          actor
        });
      }

      processedItems.push({
        item_code: item.item_code,
        description: poLine.description,
        received_quantity: qtyReceived,
        rejected_quantity: Number(item.rejected_quantity) || 0,
        rejection_reason: item.rejection_reason || null,
        stock_item_id: stockItem.id,
        quantity_before: qtyBefore,
        quantity_after: stockItem.quantity_on_hand
      });
    }

    const grn = {
      id: grnId,
      grn_number: grnNumber,
      supplier_po_id: po.id,
      po_number: po.po_number,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      delivery_note_ref: val.delivery_note_ref,
      received_date: val.received_date,
      received_by: actor.id,
      received_by_name: actor.name,
      items: processedItems,
      created_at: new Date().toISOString()
    };

    req.db.goods_received_notes = req.db.goods_received_notes || [];
    req.db.goods_received_notes.push(grn);

    // Update PO fulfillment state
    po.status = "RECEIVED";

    req.store.audit(req.db, actor, "grn", grn.id, "GRN_RECEIVED", null, grn);
    return res.status(201).json({ success: true, data: grn });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── 4. Store Issue Voucher (SIV) ─────────────────────────────────────────────

export const issueStoreVoucher = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Operations", "Finance", "Supervisor"]);

    const parseResult = CreateStoreIssueVoucherSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid store issue voucher data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.stock_items = req.db.stock_items || [];
    req.db.stock_movements = req.db.stock_movements || [];

    // Pre-flight check: verify all stock items exist and have sufficient stock (Positive-balance guard)
    for (const it of val.items) {
      const stockItem = req.db.stock_items.find((si) => si.id === it.stock_item_id);
      if (!stockItem) {
        return res.status(404).json({ success: false, message: `Stock item '${it.stock_item_id}' not found` });
      }
      if (stockItem.quantity_on_hand < it.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for '${stockItem.item_name}' (${stockItem.item_code}): Requested ${it.quantity}, available ${stockItem.quantity_on_hand}`
        });
      }
    }

    const sivId = req.store.id("siv");
    const sivNumber = `SIV-${Date.now().toString().slice(-6)}`;
    const issuedLines = [];

    for (const it of val.items) {
      const stockItem = req.db.stock_items.find((si) => si.id === it.stock_item_id);
      const qtyBefore = stockItem.quantity_on_hand;

      applyStockChange({
        store: req.store,
        db: req.db,
        stockItem,
        movementType: "out",
        requestedQuantity: it.quantity,
        reason: `Store Issue Voucher: ${sivNumber} for ${val.purpose}`,
        referenceType: "dispatch_card",
        referenceId: val.dispatch_card_id || null,
        sourceDocumentRef: sivNumber,
        actor
      });

      issuedLines.push({
        stock_item_id: stockItem.id,
        item_code: stockItem.item_code,
        item_name: stockItem.item_name,
        quantity_issued: it.quantity,
        unit_cost: stockItem.unit_cost,
        line_total_cost: Number((it.quantity * stockItem.unit_cost).toFixed(2)),
        quantity_before: qtyBefore,
        quantity_after: stockItem.quantity_on_hand
      });
    }

    const siv = {
      id: sivId,
      siv_number: sivNumber,
      dispatch_card_id: val.dispatch_card_id || null,
      technician_id: val.technician_id,
      requested_by: val.requested_by,
      purpose: val.purpose,
      issued_by: actor.id,
      issued_by_name: actor.name,
      items: issuedLines,
      created_at: new Date().toISOString()
    };

    req.db.store_issue_vouchers = req.db.store_issue_vouchers || [];
    req.db.store_issue_vouchers.push(siv);

    req.store.audit(req.db, actor, "store_issue_voucher", siv.id, "SIV_ISSUED", null, siv);
    return res.status(201).json({ success: true, data: siv });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── 5. Three-Way Matching Verification ───────────────────────────────────────

export const performThreeWayMatch = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Finance", "Management"]);

    const { supplier_po_id, grn_id, invoice, tolerance_percent = 0.0 } = req.body;

    if (!supplier_po_id || !grn_id || !invoice) {
      return res.status(400).json({
        success: false,
        message: "supplier_po_id, grn_id, and invoice object are required for 3-way matching"
      });
    }

    req.db.supplier_pos = req.db.supplier_pos || [];
    req.db.goods_received_notes = req.db.goods_received_notes || [];

    const po = req.db.supplier_pos.find((p) => p.id === supplier_po_id);
    if (!po) return res.status(404).json({ success: false, message: "Supplier PO not found" });

    const grn = req.db.goods_received_notes.find((g) => g.id === grn_id);
    if (!grn) return res.status(404).json({ success: false, message: "GRN not found" });

    const matchResult = verifyThreeWayMatch({
      supplierPo: po,
      grn,
      supplierInvoice: invoice,
      tolerancePercent: tolerance_percent
    });

    req.store.audit(
      req.db,
      actor,
      "three_way_match",
      po.id,
      matchResult.is_match ? "3WAY_MATCH_PASSED" : "3WAY_MATCH_DISCREPANCY_BLOCKED",
      null,
      matchResult
    );

    return res.json({ success: true, data: matchResult });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};


// ── 6. Query & Reporting Endpoints ──────────────────────────────────────────

export const listProcurementRequests = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ['Admin', 'Management', 'Operations', 'Finance', 'Supervisor']);
    req.db.procurement_requests = req.db.procurement_requests || [];
    return res.json({ success: true, data: req.db.procurement_requests });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listSupplierPos = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ['Admin', 'Management', 'Operations', 'Finance']);
    req.db.supplier_pos = req.db.supplier_pos || [];
    return res.json({ success: true, data: req.db.supplier_pos });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listGrns = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ['Admin', 'Management', 'Operations', 'Finance']);
    req.db.goods_received_notes = req.db.goods_received_notes || [];
    return res.json({ success: true, data: req.db.goods_received_notes });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listStoreIssueVouchers = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ['Admin', 'Management', 'Operations', 'Finance', 'Supervisor']);
    req.db.store_issue_vouchers = req.db.store_issue_vouchers || [];
    return res.json({ success: true, data: req.db.store_issue_vouchers });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getProcurementSummary = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ['Admin', 'Management', 'Operations', 'Finance', 'Supervisor']);
    const prs = req.db.procurement_requests || [];
    const pos = req.db.supplier_pos || [];
    const grns = req.db.goods_received_notes || [];
    const sivs = req.db.store_issue_vouchers || [];

    const summary = {
      pending_prs: prs.filter(p => p.status === 'PENDING_APPROVAL').length,
      approved_prs: prs.filter(p => p.status === 'APPROVED').length,
      active_pos: pos.filter(p => p.status === 'ISSUED').length,
      total_grns: grns.length,
      total_sivs: sivs.length,
      po_committed_usd: Number(pos.reduce((sum, p) => sum + (p.total_amount || 0), 0).toFixed(2))
    };
    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
