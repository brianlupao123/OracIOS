export function canReceiveSupplierOrder(role, order) {
  // Match the current receiveGrn controller contract, including legacy office roles.
  return ["Admin", "Operations", "Finance", "Management", "Procurement & Stores"].includes(role) &&
    ["ISSUED", "PARTIALLY_RECEIVED"].includes(order?.status);
}

export function openReceiptLines(order, receipts) {
  const accepted = new Map();
  for (const receipt of receipts) {
    if (receipt.supplier_po_id !== order.id) continue;
    for (const item of receipt.items || []) {
      accepted.set(item.item_code, (accepted.get(item.item_code) || 0) + (Number(item.received_quantity) || 0));
    }
  }
  return (order.items || []).map(item => {
    const remaining = Math.max(0, Number(item.quantity) - (accepted.get(item.item_code) || 0));
    return { item_code: item.item_code, remaining, received_quantity: 0, rejected_quantity: 0,
      rejection_reason: "", storage_location: "Central Stores" };
  }).filter(item => item.remaining > 0);
}

export function buildReceiptPayload(form) {
  const reference = form.delivery_note_ref.trim();
  if (!reference) throw new Error("Enter the reference from the supplier delivery document.");
  const items = form.items.filter(item => item.received_quantity > 0 || item.rejected_quantity > 0);
  if (!items.length) throw new Error("Enter the quantities actually delivered before recording the receipt.");
  if (form.items.some(item => !Number.isFinite(item.received_quantity) || item.received_quantity < 0 ||
      item.received_quantity > item.remaining || !Number.isFinite(item.rejected_quantity) || item.rejected_quantity < 0)) {
    throw new Error("Enter nonnegative quantities. Accepted quantity cannot exceed the outstanding order balance.");
  }
  return { ...form, delivery_note_ref: reference,
    items: items.map(({ remaining, ...item }) => item) };
}
