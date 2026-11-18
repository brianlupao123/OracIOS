/**
 * ORAC Three-Way Matching Engine
 * Compares:
 * 1. Supplier PO (Authorized quantities & agreed unit prices)
 * 2. Goods Received Note / GRN (Physical quantities verified by storekeeper)
 * 3. Supplier Commercial Invoice (Billed quantities & charged unit prices)
 * 
 * Enforces zero-tolerance against overbilling and ghost inventory charges.
 */

export function verifyThreeWayMatch({ supplierPo, grn, supplierInvoice, tolerancePercent = 0.0 }) {
  if (!supplierPo) throw new Error("supplierPo is required for 3-way matching");
  if (!grn) throw new Error("grn is required for 3-way matching");
  if (!supplierInvoice) throw new Error("supplierInvoice is required for 3-way matching");

  const discrepancies = [];
  const lineAnalysis = [];

  // Index PO items by item_code
  const poItemMap = new Map();
  for (const item of (supplierPo.items || [])) {
    poItemMap.set(item.item_code, item);
  }

  // Index GRN items by item_code
  const grnItemMap = new Map();
  for (const item of (grn.items || [])) {
    const existing = grnItemMap.get(item.item_code) || 0;
    grnItemMap.set(item.item_code, existing + (Number(item.received_quantity) || 0));
  }

  let poSubtotal = 0;
  let grnAcceptedValue = 0;
  let invoiceSubtotal = 0;

  for (const invItem of (supplierInvoice.items || [])) {
    const itemCode = invItem.item_code;
    const billedQty = Number(invItem.quantity) || 0;
    const billedPrice = Number(invItem.unit_price) || 0;
    const billedLineTotal = billedQty * billedPrice;
    invoiceSubtotal += billedLineTotal;

    const poItem = poItemMap.get(itemCode);
    const receivedQty = grnItemMap.get(itemCode) || 0;

    const lineReport = {
      item_code: itemCode,
      description: invItem.description || poItem?.description || itemCode,
      po_qty: poItem ? Number(poItem.quantity) : 0,
      po_unit_price: poItem ? Number(poItem.unit_price) : 0,
      grn_received_qty: receivedQty,
      invoice_billed_qty: billedQty,
      invoice_unit_price: billedPrice,
      has_discrepancy: false,
      reasons: []
    };

    if (!poItem) {
      lineReport.has_discrepancy = true;
      lineReport.reasons.push("ITEM_NOT_ON_PO");
      discrepancies.push(`Line item '${itemCode}' was billed on invoice but does not exist on Supplier PO ${supplierPo.id || supplierPo.po_number}`);
    } else {
      poSubtotal += (Number(poItem.quantity) * Number(poItem.unit_price));
      const allowedPriceMax = poItem.unit_price * (1 + (tolerancePercent / 100));

      // 1. Price check
      if (billedPrice > allowedPriceMax) {
        lineReport.has_discrepancy = true;
        lineReport.reasons.push("PRICE_VARIANCE_EXCEEDED");
        discrepancies.push(`Price mismatch on '${itemCode}': Billed $${billedPrice.toFixed(2)} exceeds PO price $${poItem.unit_price.toFixed(2)} (tolerance: ${tolerancePercent}%)`);
      }

      // 2. Quantity check against GRN
      if (billedQty > receivedQty) {
        lineReport.has_discrepancy = true;
        lineReport.reasons.push("BILLED_EXCEEDS_RECEIVED_QUANTITY");
        discrepancies.push(`Quantity mismatch on '${itemCode}': Billed ${billedQty} units, but only ${receivedQty} units were verified on GRN ${grn.id || grn.grn_number}`);
      }

      // 3. Quantity check against PO
      if (receivedQty > poItem.quantity) {
        lineReport.has_discrepancy = true;
        lineReport.reasons.push("RECEIVED_EXCEEDS_PO_AUTHORIZATION");
        discrepancies.push(`Over-delivery on '${itemCode}': Received ${receivedQty} units exceeds authorized PO quantity of ${poItem.quantity}`);
      }
    }

    grnAcceptedValue += (receivedQty * (poItem ? Number(poItem.unit_price) : billedPrice));
    lineAnalysis.push(lineReport);
  }

  // Check for items on PO that were received but omitted from this specific invoice
  for (const [code, poItem] of poItemMap.entries()) {
    const invoiced = supplierInvoice.items?.some(i => i.item_code === code);
    if (!invoiced) {
      const rec = grnItemMap.get(code) || 0;
      if (rec > 0) {
        lineAnalysis.push({
          item_code: code,
          description: poItem.description,
          po_qty: poItem.quantity,
          po_unit_price: poItem.unit_price,
          grn_received_qty: rec,
          invoice_billed_qty: 0,
          invoice_unit_price: 0,
          has_discrepancy: false,
          reasons: ["PARTIAL_INVOICE_OMITTED_ITEM"]
        });
      }
    }
  }

  const invoiceReportedTotal = Number(supplierInvoice.total_amount) || invoiceSubtotal;
  const varianceAmount = Math.abs(invoiceReportedTotal - invoiceSubtotal);
  if (varianceAmount > 0.05) {
    discrepancies.push(`Invoice arithmetic mismatch: Sum of lines ($${invoiceSubtotal.toFixed(2)}) does not match declared invoice total ($${invoiceReportedTotal.toFixed(2)})`);
  }

  const isMatch = discrepancies.length === 0;

  return {
    is_match: isMatch,
    can_proceed_to_payment: isMatch,
    match_status: isMatch ? "MATCH_PASSED" : "DISCREPANCY_BLOCKED",
    discrepancies,
    line_analysis: lineAnalysis,
    summary: {
      po_number: supplierPo.po_number || supplierPo.id,
      grn_number: grn.grn_number || grn.id,
      invoice_number: supplierInvoice.invoice_number,
      po_subtotal: Number(poSubtotal.toFixed(2)),
      grn_verified_value: Number(grnAcceptedValue.toFixed(2)),
      invoice_subtotal: Number(invoiceSubtotal.toFixed(2)),
      invoice_total: Number(invoiceReportedTotal.toFixed(2)),
      variance_amount: Number((invoiceSubtotal - grnAcceptedValue).toFixed(2))
    }
  };
}
