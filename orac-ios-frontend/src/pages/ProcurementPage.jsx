import React, { useEffect, useState } from "react";
import { procurement, inventory } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & Metrics" },
  { id: "prs", label: "Procurement Requests" },
  { id: "pos", label: "Supplier Purchase Orders" },
  { id: "grns", label: "Goods Received (GRN)" },
  { id: "sivs", label: "Store Issue (SIV)" },
  { id: "matching", label: "3-Way Match Audit" }
];

function formatCurrency(val) {
  const num = Number(val) || 0;
  return `USD $${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ProcurementPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Data sets
  const [summary, setSummary] = useState(null);
  const [prs, setPrs] = useState([]);
  const [pos, setPos] = useState([]);
  const [grns, setGrns] = useState([]);
  const [sivs, setSivs] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [stockItems, setStockItems] = useState([]);

  // Modals state
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [grnModalOpen, setGrnModalOpen] = useState(false);
  const [sivModalOpen, setSivModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms state
  const [prForm, setPrForm] = useState({
    department: "Plant Maintenance",
    priority: "MEDIUM",
    justification: "",
    required_by_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    items: [{ item_name: "", category: "Raw Materials", quantity: 1, unit_of_measure: "rolls", estimated_unit_cost: 0 }]
  });

  const [poForm, setPoForm] = useState({
    procurement_request_id: "",
    supplier_id: "",
    expected_delivery_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    payment_terms: "Net 30",
    items: [{ item_code: "", description: "", quantity: 1, unit_price: 0, unit_of_measure: "rolls", tax_rate: 0 }]
  });

  const [grnForm, setGrnForm] = useState({
    supplier_po_id: "",
    delivery_note_ref: "",
    received_date: new Date().toISOString().slice(0, 10),
    items: []
  });

  const [sivForm, setSivForm] = useState({
    dispatch_card_id: "",
    technician_id: user?.id || "u-tech",
    requested_by: user?.name || "Operations Team",
    purpose: "Conveyor Belt Cold Splicing & Rubber Lining",
    items: [{ stock_item_id: "", quantity: 1 }]
  });

  const [matchForm, setMatchForm] = useState({
    supplier_po_id: "",
    grn_id: "",
    invoice_number: "",
    invoice_amount: 0,
    invoice_date: new Date().toISOString().slice(0, 10),
    tolerance_percent: 0.0
  });

  const [matchResult, setMatchResult] = useState(null);

  const canApprove = ["Admin", "Management", "Finance"].includes(user?.role);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [sumRes, prsRes, posRes, grnsRes, sivsRes, supsRes, stocksRes] = await Promise.all([
        procurement.getSummary().catch(() => null),
        procurement.listRequests().catch(() => []),
        procurement.listSupplierPos().catch(() => []),
        procurement.listGrns().catch(() => []),
        procurement.listStoreIssueVouchers().catch(() => []),
        inventory.listSuppliers().catch(() => []),
        inventory.listStockItems().catch(() => [])
      ]);

      setSummary(sumRes);
      setPrs(prsRes || []);
      setPos(posRes || []);
      setGrns(grnsRes || []);
      setSivs(sivsRes || []);
      setSuppliers(supsRes || []);
      setStockItems(stocksRes || []);
    } catch (err) {
      setError(err.message || "Failed to load procurement data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Handlers for PR
  async function handleCreatePr(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await procurement.createRequest(prForm);
      setSuccessMsg("Procurement Request raised successfully.");
      setPrModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprovePr(id, action) {
    const comments = prompt(`Enter comments for ${action}:`) || "";
    setError("");
    try {
      await procurement.approveRequest(id, action, comments);
      setSuccessMsg(`PR has been ${action}D.`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // Handlers for PO
  async function handleCreatePo(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await procurement.createSupplierPo({
        ...poForm,
        procurement_request_id: poForm.procurement_request_id || undefined
      });
      setSuccessMsg("Supplier Purchase Order created and issued.");
      setPoModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Handlers for GRN
  function openGrnModalForPo(selectedPoId) {
    const po = pos.find((p) => p.id === selectedPoId);
    if (!po) return;
    setGrnForm({
      supplier_po_id: po.id,
      delivery_note_ref: `DN-${Date.now().toString().slice(-5)}`,
      received_date: new Date().toISOString().slice(0, 10),
      items: po.items.map((it) => ({
        item_code: it.item_code,
        received_quantity: it.quantity,
        rejected_quantity: 0,
        rejection_reason: "",
        storage_location: "Central Stores"
      }))
    });
    setGrnModalOpen(true);
  }

  async function handleReceiveGrn(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await procurement.receiveGrn(grnForm);
      setSuccessMsg("Goods Received Note logged and inventory stock balance updated.");
      setGrnModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Handlers for SIV
  async function handleIssueSiv(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await procurement.issueStoreVoucher(sivForm);
      setSuccessMsg("Store Issue Voucher issued and stock deducted from stores ledger.");
      setSivModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Handlers for 3-Way Match
  async function handleRunMatch(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMatchResult(null);
    try {
      const selectedPo = pos.find((p) => p.id === matchForm.supplier_po_id);
      const res = await procurement.threeWayMatch({
        supplier_po_id: matchForm.supplier_po_id,
        grn_id: matchForm.grn_id,
        tolerance_percent: Number(matchForm.tolerance_percent) || 0.0,
        invoice: {
          invoice_number: matchForm.invoice_number,
          invoice_amount: Number(matchForm.invoice_amount),
          invoice_date: matchForm.invoice_date,
          currency: "USD",
          items: selectedPo ? selectedPo.items.map((it) => ({
            item_code: it.item_code,
            billed_quantity: it.quantity,
            billed_unit_price: it.unit_price,
            total: Number((it.quantity * it.unit_price).toFixed(2))
          })) : []
        }
      });
      setMatchResult(res);
      setSuccessMsg("3-Way matching verification executed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <PageHeaderBanner
        title="Supply Chain & Procurement Subsystem"
        subtitle="Manage the complete heavy industrial procurement lifecycle: PR intake, Supplier POs, Goods Received Notes (GRN), Store Issue Vouchers (SIV), and automated 3-Way Matching audits."
      />

      {error && <ErrorBanner message={error} />}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex justify-between items-center">
          <span>{successMsg}</span>
          <Button size="sm" variant="ghost" onClick={() => setSuccessMsg("")}>Dismiss</Button>
        </div>
      )}

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-6">
        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Pending PRs</span>
                <p className="text-2xl font-bold text-amber-600 mt-1">{summary?.pending_prs ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Approved PRs</span>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{summary?.approved_prs ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Active Supplier POs</span>
                <p className="text-2xl font-bold text-orac-blue mt-1">{summary?.active_pos ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">GRNs Logged</span>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary?.total_grns ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Store Issues (SIV)</span>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary?.total_sivs ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">PO Committed Spend</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(summary?.po_committed_usd ?? 0)}</p>
              </div>
            </div>

            <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4">
              <SectionTitle title="Procurement Workflow Actions" />
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setPrModalOpen(true)}>+ Raise Procurement Request</Button>
                <Button variant="secondary" onClick={() => setPoModalOpen(true)}>+ Issue Supplier Purchase Order</Button>
                <Button variant="secondary" onClick={() => setSivModalOpen(true)}>+ Issue Store Voucher (SIV)</Button>
                <Button variant="outline" onClick={() => setActiveTab("matching")}>Run 3-Way Match Audit</Button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PROCUREMENT REQUESTS (PR) */}
        {activeTab === "prs" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Procurement Requests" />
              <Button onClick={() => setPrModalOpen(true)}>+ Raise New PR</Button>
            </div>

            <DataTable
              data={prs}
              keyField="id"
              columns={[
                { key: "pr_number", title: "PR Number" },
                { key: "department", title: "Department" },
                { key: "priority", title: "Priority", render: (r) => <Badge variant={r.priority === "URGENT" ? "danger" : "warning"}>{r.priority}</Badge> },
                { key: "status", title: "Status", render: (r) => (
                  <Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : "default"}>
                    {r.status}
                  </Badge>
                )},
                { key: "total_estimated_amount", title: "Est. Total", render: (r) => formatCurrency(r.total_estimated_amount) },
                { key: "requested_by_name", title: "Requester" },
                { key: "required_by_date", title: "Required By" },
                { key: "actions", title: "Actions", render: (r) => (
                  r.status === "PENDING_APPROVAL" && canApprove ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => handleApprovePr(r.id, "APPROVE")}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleApprovePr(r.id, "REJECT")}>Reject</Button>
                    </div>
                  ) : <span className="text-xs text-gray-400">Locked</span>
                )}
              ]}
            />
          </div>
        )}

        {/* TAB 3: SUPPLIER PURCHASE ORDERS (PO) */}
        {activeTab === "pos" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Supplier Purchase Orders" />
              <Button onClick={() => setPoModalOpen(true)}>+ Create Supplier PO</Button>
            </div>

            <DataTable
              data={pos}
              keyField="id"
              columns={[
                { key: "po_number", title: "PO Number" },
                { key: "supplier_name", title: "Supplier" },
                { key: "payment_terms", title: "Terms" },
                { key: "status", title: "Status", render: (r) => <Badge variant={r.status === "RECEIVED" ? "success" : "default"}>{r.status}</Badge> },
                { key: "total_amount", title: "Total Amount", render: (r) => formatCurrency(r.total_amount) },
                { key: "expected_delivery_date", title: "Expected Delivery" },
                { key: "actions", title: "Actions", render: (r) => (
                  r.status !== "RECEIVED" ? (
                    <Button size="sm" variant="outline" onClick={() => openGrnModalForPo(r.id)}>Receive GRN</Button>
                  ) : <span className="text-xs text-emerald-600 font-medium">Fulfilled</span>
                )}
              ]}
            />
          </div>
        )}

        {/* TAB 4: GOODS RECEIVED NOTES (GRN) */}
        {activeTab === "grns" && (
          <div className="space-y-4">
            <SectionTitle title="Goods Received Notes (GRN)" />
            <DataTable
              data={grns}
              keyField="id"
              columns={[
                { key: "grn_number", title: "GRN Number" },
                { key: "po_number", title: "Supplier PO" },
                { key: "supplier_name", title: "Supplier" },
                { key: "delivery_note_ref", title: "Delivery Ref" },
                { key: "received_date", title: "Received Date" },
                { key: "received_by_name", title: "Inspected By" },
                { key: "items_count", title: "Line Items", render: (r) => `${r.items?.length || 0} lines` }
              ]}
            />
          </div>
        )}

        {/* TAB 5: STORE ISSUE VOUCHERS (SIV) */}
        {activeTab === "sivs" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Store Issue Vouchers (SIV)" />
              <Button onClick={() => setSivModalOpen(true)}>+ Issue Store Voucher</Button>
            </div>

            <DataTable
              data={sivs}
              keyField="id"
              columns={[
                { key: "siv_number", title: "SIV Number" },
                { key: "purpose", title: "Purpose / Job Reference" },
                { key: "requested_by", title: "Requested By" },
                { key: "issued_by_name", title: "Storekeeper" },
                { key: "created_at", title: "Issue Date", render: (r) => r.created_at?.slice(0, 10) },
                { key: "items_summary", title: "Items Issued", render: (r) => (
                  <span className="text-xs text-gray-700">
                    {r.items?.map((it) => `${it.item_code} (${it.quantity_issued})`).join(", ")}
                  </span>
                )}
              ]}
            />
          </div>
        )}

        {/* TAB 6: 3-WAY MATCHING AUDIT */}
        {activeTab === "matching" && (
          <div className="space-y-6">
            <SectionTitle title="Three-Way Matching Fraud Prevention Audit" />
            <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4">
              <p className="text-sm text-gray-600">
                Cross-verifies Supplier Purchase Order rates, Goods Received Note delivery inspection quantities, and the Commercial Supplier Invoice before payment approval is authorized.
              </p>

              <form onSubmit={handleRunMatch} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Select Supplier PO</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    value={matchForm.supplier_po_id}
                    onChange={(e) => setMatchForm({ ...matchForm, supplier_po_id: e.target.value })}
                    required
                  >
                    <option value="">-- Choose Supplier PO --</option>
                    {pos.map((p) => (
                      <option key={p.id} value={p.id}>{p.po_number} — {p.supplier_name} ({formatCurrency(p.total_amount)})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Select GRN</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    value={matchForm.grn_id}
                    onChange={(e) => setMatchForm({ ...matchForm, grn_id: e.target.value })}
                    required
                  >
                    <option value="">-- Choose GRN --</option>
                    {grns.map((g) => (
                      <option key={g.id} value={g.id}>{g.grn_number} — {g.supplier_name} ({g.delivery_note_ref})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Supplier Invoice Number</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    placeholder="e.g. INV-DUNLOP-8821"
                    value={matchForm.invoice_number}
                    onChange={(e) => setMatchForm({ ...matchForm, invoice_number: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Supplier Invoiced Amount (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    value={matchForm.invoice_amount}
                    onChange={(e) => setMatchForm({ ...matchForm, invoice_amount: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Allowed Variance Tolerance (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    value={matchForm.tolerance_percent}
                    onChange={(e) => setMatchForm({ ...matchForm, tolerance_percent: e.target.value })}
                  />
                </div>

                <div className="flex items-end">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Verifying..." : "Execute 3-Way Match Verification"}
                  </Button>
                </div>
              </form>
            </div>

            {matchResult && (
              <div className={`p-6 border rounded-lg shadow-sm space-y-4 ${matchResult.is_match ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-300"}`}>
                <div className="flex justify-between items-center">
                  <h3 className={`text-lg font-bold ${matchResult.is_match ? "text-emerald-900" : "text-red-900"}`}>
                    {matchResult.is_match ? "3-WAY MATCH PASSED — PAYMENT AUTHORIZED" : "3-WAY MATCH FAILED — PAYMENT BLOCKED"}
                  </h3>
                  <Badge variant={matchResult.is_match ? "success" : "danger"}>
                    {matchResult.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-gray-500">PO Amount</span>
                    <p className="font-semibold">{formatCurrency(matchResult.po_amount)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Invoiced Amount</span>
                    <p className="font-semibold">{formatCurrency(matchResult.invoice_amount)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Variance Amount</span>
                    <p className="font-semibold">{formatCurrency(matchResult.variance_amount)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Variance %</span>
                    <p className="font-semibold">{(matchResult.variance_percent || 0).toFixed(2)}%</p>
                  </div>
                </div>

                {matchResult.discrepancies?.length > 0 && (
                  <div className="mt-4 p-4 bg-white border border-red-200 rounded-lg">
                    <h4 className="text-sm font-semibold text-red-800 mb-2">Audit Discrepancies Detected:</h4>
                    <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                      {matchResult.discrepancies.map((d, i) => (
                        <li key={i}>{typeof d === "string" ? d : JSON.stringify(d)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL: RAISE PR */}
      <Modal isOpen={prModalOpen} onClose={() => setPrModalOpen(false)} title="Raise Procurement Request (PR)">
        <form onSubmit={handleCreatePr} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Department</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={prForm.department}
              onChange={(e) => setPrForm({ ...prForm, department: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Priority</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={prForm.priority}
              onChange={(e) => setPrForm({ ...prForm, priority: e.target.value })}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="URGENT">URGENT</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Justification</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              rows={2}
              value={prForm.justification}
              onChange={(e) => setPrForm({ ...prForm, justification: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Required By Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={prForm.required_by_date}
              onChange={(e) => setPrForm({ ...prForm, required_by_date: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Item Details</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Item name"
                className="border border-gray-300 rounded-lg p-2 text-sm col-span-2"
                value={prForm.items[0].item_name}
                onChange={(e) => {
                  const items = [...prForm.items];
                  items[0].item_name = e.target.value;
                  setPrForm({ ...prForm, items });
                }}
                required
              />
              <input
                type="number"
                placeholder="Qty"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={prForm.items[0].quantity}
                onChange={(e) => {
                  const items = [...prForm.items];
                  items[0].quantity = Number(e.target.value);
                  setPrForm({ ...prForm, items });
                }}
                required
              />
              <input
                type="number"
                step="0.01"
                placeholder="Est. Unit Cost (USD)"
                className="border border-gray-300 rounded-lg p-2 text-sm col-span-2"
                value={prForm.items[0].estimated_unit_cost}
                onChange={(e) => {
                  const items = [...prForm.items];
                  items[0].estimated_unit_cost = Number(e.target.value);
                  setPrForm({ ...prForm, items });
                }}
                required
              />
              <input
                type="text"
                placeholder="Unit (e.g. rolls)"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={prForm.items[0].unit_of_measure}
                onChange={(e) => {
                  const items = [...prForm.items];
                  items[0].unit_of_measure = e.target.value;
                  setPrForm({ ...prForm, items });
                }}
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPrModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Submit PR</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE PO */}
      <Modal isOpen={poModalOpen} onClose={() => setPoModalOpen(false)} title="Issue Supplier Purchase Order">
        <form onSubmit={handleCreatePo} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Supplier</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={poForm.supplier_id}
              onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}
              required
            >
              <option value="">-- Choose Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Link to Approved PR (Optional)</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={poForm.procurement_request_id}
              onChange={(e) => setPoForm({ ...poForm, procurement_request_id: e.target.value })}
            >
              <option value="">-- None (Standalone PO) --</option>
              {prs.filter((p) => p.status === "APPROVED").map((p) => (
                <option key={p.id} value={p.id}>{p.pr_number} — {p.department} ({formatCurrency(p.total_estimated_amount)})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Terms</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.payment_terms}
                onChange={(e) => setPoForm({ ...poForm, payment_terms: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Expected Delivery</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.expected_delivery_date}
                onChange={(e) => setPoForm({ ...poForm, expected_delivery_date: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Line Item</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Item Code (e.g. RL-60)"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.items[0].item_code}
                onChange={(e) => {
                  const items = [...poForm.items];
                  items[0].item_code = e.target.value;
                  setPoForm({ ...poForm, items });
                }}
                required
              />
              <input
                type="text"
                placeholder="Description"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.items[0].description}
                onChange={(e) => {
                  const items = [...poForm.items];
                  items[0].description = e.target.value;
                  setPoForm({ ...poForm, items });
                }}
                required
              />
              <input
                type="number"
                placeholder="Quantity"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.items[0].quantity}
                onChange={(e) => {
                  const items = [...poForm.items];
                  items[0].quantity = Number(e.target.value);
                  setPoForm({ ...poForm, items });
                }}
                required
              />
              <input
                type="number"
                step="0.01"
                placeholder="Unit Price USD"
                className="border border-gray-300 rounded-lg p-2 text-sm"
                value={poForm.items[0].unit_price}
                onChange={(e) => {
                  const items = [...poForm.items];
                  items[0].unit_price = Number(e.target.value);
                  setPoForm({ ...poForm, items });
                }}
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPoModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Issue PO</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: RECEIVE GRN */}
      <Modal isOpen={grnModalOpen} onClose={() => setGrnModalOpen(false)} title="Receive Goods Note (GRN)">
        <form onSubmit={handleReceiveGrn} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Delivery Document Reference</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={grnForm.delivery_note_ref}
              onChange={(e) => setGrnForm({ ...grnForm, delivery_note_ref: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Received Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={grnForm.received_date}
              onChange={(e) => setGrnForm({ ...grnForm, received_date: e.target.value })}
              required
            />
          </div>

          {grnForm.items.map((it, idx) => (
            <div key={idx} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
              <span className="text-xs font-bold text-gray-800">Item: {it.item_code}</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600">Accepted Qty</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded p-1 text-sm"
                    value={it.received_quantity}
                    onChange={(e) => {
                      const items = [...grnForm.items];
                      items[idx].received_quantity = Number(e.target.value);
                      setGrnForm({ ...grnForm, items });
                    }}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600">Rejected Qty</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded p-1 text-sm"
                    value={it.rejected_quantity}
                    onChange={(e) => {
                      const items = [...grnForm.items];
                      items[idx].rejected_quantity = Number(e.target.value);
                      setGrnForm({ ...grnForm, items });
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setGrnModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Accept & Update Inventory</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ISSUE SIV */}
      <Modal isOpen={sivModalOpen} onClose={() => setSivModalOpen(false)} title="Issue Store Voucher (SIV)">
        <form onSubmit={handleIssueSiv} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Purpose / Service Job</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={sivForm.purpose}
              onChange={(e) => setSivForm({ ...sivForm, purpose: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Requested By</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={sivForm.requested_by}
              onChange={(e) => setSivForm({ ...sivForm, requested_by: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Stock Item to Issue</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={sivForm.items[0].stock_item_id}
              onChange={(e) => {
                const items = [...sivForm.items];
                items[0].stock_item_id = e.target.value;
                setSivForm({ ...sivForm, items });
              }}
              required
            >
              <option value="">-- Choose Stock Item --</option>
              {stockItems.map((si) => (
                <option key={si.id} value={si.id}>
                  {si.item_name} ({si.item_code}) — On Hand: {si.quantity_on_hand} {si.unit_of_measure}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Quantity to Issue</label>
            <input
              type="number"
              min="1"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={sivForm.items[0].quantity}
              onChange={(e) => {
                const items = [...sivForm.items];
                items[0].quantity = Number(e.target.value);
                setSivForm({ ...sivForm, items });
              }}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSivModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Issue from Stores</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
