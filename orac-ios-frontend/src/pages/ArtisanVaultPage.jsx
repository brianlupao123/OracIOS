import React, { useEffect, useState } from "react";
import { artisans } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & Expiry Alerts" },
  { id: "qualifications", label: "Artisan Credentials Vault" },
  { id: "inductions", label: "Mine Site Inductions" },
  { id: "gate_audit", label: "Sensitive Gate S-10 Verification" }
];

export default function ArtisanVaultPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [quals, setQuals] = useState([]);
  const [inductions, setInductions] = useState([]);

  // Modals
  const [qualModalOpen, setQualModalOpen] = useState(false);
  const [indModalOpen, setIndModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [qualForm, setQualForm] = useState({
    technician_id: user?.role === "Technician" ? (user?.id || "") : "",
    technician_name: user?.role === "Technician" ? (user?.name || "") : "",
    trade_discipline: "RUBBER_LINING",
    qualification_type: "RED_SEAL",
    certificate_number: "",
    issuing_authority: "",
    issue_date: "",
    expiry_date: "",
    document_url: ""
  });

  const [indForm, setIndForm] = useState({
    technician_id: user?.role === "Technician" ? (user?.id || "") : "",
    technician_name: user?.role === "Technician" ? (user?.name || "") : "",
    mine_site: "ZIMPLATS_SMC",
    induction_card_number: "",
    induction_date: "",
    expiry_date: "",
    medical_fit_to_work_pass: false
  });

  // Gate verification interactive test state
  const [gateTest, setGateTest] = useState({
    dispatch_card_id: "",
    technician_id: user?.role === "Technician" ? (user?.id || "") : "",
    mine_site: "ZIMPLATS_SMC"
  });
  const [gateResult, setGateResult] = useState(null);
  const [verifyingGate, setVerifyingGate] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [sumRes, qualsRes, indsRes] = await Promise.all([
        artisans.getSummary().catch(() => null),
        artisans.listQualifications().catch(() => []),
        artisans.listInductions().catch(() => [])
      ]);
      setSummary(sumRes);
      setQuals(qualsRes || []);
      setInductions(indsRes || []);
    } catch (err) {
      setError(err.message || "Failed to load artisan vault records");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateQual(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await artisans.createQualification(qualForm);
      setSuccessMsg("Artisan qualification verified and registered in vault.");
      setQualModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordInd(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await artisans.recordInduction(indForm);
      setSuccessMsg("Mine site induction certified and saved in safety gate registry.");
      setIndModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyGate(e) {
    e.preventDefault();
    setVerifyingGate(true);
    setGateResult(null);
    setError("");
    try {
      const res = await artisans.verifyDispatchGate(gateTest);
      setGateResult({
        success: true,
        cleared: true,
        message: res.message || "Statutory clearance passed: Technician authorized for mine site entry."
      });
    } catch (err) {
      setGateResult({
        success: false,
        cleared: false,
        code: err.code || "MINE_INDUCTION_REFUSED",
        message: err.message
      });
    } finally {
      setVerifyingGate(false);
    }
  }

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <PageHeaderBanner
        title="Artisan Qualification Vault & Mine Inductions"
        subtitle="Manage trade credentials (Red Seal, Journeyman), 30/60/90-day expiry alert watcher, and Sensitive Control S-10: Statutory Hard Gate blocking technician allocation to mines with expired inductions."
      />

      {error && <ErrorBanner message={error} />}
      {successMsg && (
        <div className="p-4 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
          {successMsg}
        </div>
      )}

      <TabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div role="tabpanel" aria-labelledby="tab-overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Qualifications</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary?.total_qualifications || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Valid & Current</div>
              <div className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{summary?.valid_qualifications || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Expiring in 90d</div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-300">{summary?.expiring_soon_90 || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Expiring in 60d</div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-300">{summary?.expiring_soon_60 || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-red-600 dark:text-red-400">Urgent Alert (30d)</div>
              <div className="mt-2 text-2xl font-bold text-red-700 dark:text-red-300">{summary?.expiring_urgent_30 || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-red-600 dark:text-red-400">Expired (Blocked)</div>
              <div className="mt-2 text-2xl font-bold text-red-700 dark:text-red-300">{summary?.expired_qualifications || 0}</div>
            </div>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <SectionTitle title="Sensitive Control S-10: Statutory Mine Site Safety Inductions" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Major clients like <strong>Zimplats</strong>, <strong>Unki</strong>, and <strong>Mimosa</strong> enforce zero-tolerance statutory site safety gates.
              Before any field technician or rubber lining artisan can be dispatched to an operational plant, their site-specific induction card must be verified as active.
              If an induction certificate is expired or missing, dispatch allocation is strictly refused by the core operational gateway with code <code>MINE_INDUCTION_EXPIRED</code>.
            </p>
          </div>

          {summary?.alerts && summary.alerts.length > 0 && (
            <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
                Active Expiry Alerts ({summary.alerts.length} Credentials Requiring Attention)
              </div>
              <div className="space-y-2">
                {summary.alerts.map((alert, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm text-amber-900 dark:text-amber-100 bg-white dark:bg-gray-900 p-2 rounded border border-amber-200 dark:border-amber-800">
                    <div>
                      <span className="font-semibold">{alert.technician_name}</span> &mdash; {alert.trade_discipline || alert.mine_site} ({alert.certificate_number || alert.induction_card_number})
                    </div>
                    <div>
                      <Badge variant={alert.category === "EXPIRED" ? "danger" : "warning"}>
                        {alert.statusLabel} ({alert.daysRemaining} days)
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "qualifications" && (
        <div role="tabpanel" aria-labelledby="tab-qualifications" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="Artisan Trade Credentials Registry" />
            <Button variant="primary" onClick={() => setQualModalOpen(true)}>
              Register Qualification
            </Button>
          </div>

          <DataTable
            data={quals}
            keyField="id"
            columns={[
              { key: "technician_name", label: "Artisan / Technician" },
              { key: "trade_discipline", label: "Trade Discipline" },
              { key: "qualification_type", label: "Qualification Level" },
              { key: "certificate_number", label: "Certificate #" },
              { key: "issuing_authority", label: "Issuing Authority" },
              { key: "expiry_date", label: "Expiry Date" },
              {
                key: "status",
                label: "Vault Status",
                render: (val) => (
                  <Badge variant={val === "VALID" ? "success" : val.includes("EXPIRING") ? "warning" : "danger"}>
                    {val}
                  </Badge>
                )
              }
            ]}
          />
        </div>
      )}

      {activeTab === "inductions" && (
        <div role="tabpanel" aria-labelledby="tab-inductions" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="Mine Site Safety Inductions Vault" />
            <Button variant="primary" onClick={() => setIndModalOpen(true)}>
              Record Mine Induction
            </Button>
          </div>

          <DataTable
            data={inductions}
            keyField="id"
            columns={[
              { key: "technician_name", label: "Artisan / Technician" },
              { key: "mine_site", label: "Mining Site" },
              { key: "induction_card_number", label: "Induction Card #" },
              { key: "induction_date", label: "Certified Date" },
              { key: "expiry_date", label: "Valid Through" },
              {
                key: "medical_fit_to_work_pass",
                label: "Medical Clearance",
                render: (val) => (
                  <Badge variant={val ? "success" : "danger"}>
                    {val ? "PASSED" : "FAILED"}
                  </Badge>
                )
              },
              {
                key: "status",
                label: "Induction Status",
                render: (val) => (
                  <Badge variant={val === "VALID" ? "success" : "danger"}>
                    {val}
                  </Badge>
                )
              }
            ]}
          />
        </div>
      )}

      {activeTab === "gate_audit" && (
        <div role="tabpanel" aria-labelledby="tab-gate_audit" className="space-y-6">
          <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <SectionTitle title="Sensitive Control S-10: Statutory Pre-Dispatch Gate Verification" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Verify whether an artisan meets the statutory mine induction requirements before adding them to a dispatch job card.
              The backend gate verifies both mine site induction validity and medical fitness-to-work clearance.
            </p>

            <form onSubmit={handleVerifyGate} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Dispatch Card ID</label>
                  <input
                    type="text"
                    required
                    value={gateTest.dispatch_card_id}
                    onChange={(e) => setGateTest({ ...gateTest, dispatch_card_id: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician ID</label>
                  <input
                    type="text"
                    required
                    value={gateTest.technician_id}
                    onChange={(e) => setGateTest({ ...gateTest, technician_id: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Target Mining Site</label>
                  <select
                    value={gateTest.mine_site}
                    onChange={(e) => setGateTest({ ...gateTest, mine_site: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  >
                    <option value="ZIMPLATS_NGEZI">ZIMPLATS_NGEZI</option>
                    <option value="ZIMPLATS_SMC">ZIMPLATS_SMC</option>
                    <option value="UNKI_CONCENTRATOR">UNKI_CONCENTRATOR</option>
                    <option value="MIMOSA_FLOTATION">MIMOSA_FLOTATION</option>
                    <option value="FREDA_REBECCA">FREDA_REBECCA</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="primary" type="submit" disabled={verifyingGate}>
                  {verifyingGate ? "Checking Safety Gate..." : "Verify Statutory Induction Gate"}
                </Button>
              </div>
            </form>

            {gateResult && (
              <div className="mt-6">
                {gateResult.cleared ? (
                  <div className="p-4 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
                    <div className="font-bold">Gate Status: CLEARED</div>
                    <div className="mt-1">{gateResult.message}</div>
                  </div>
                ) : (
                  <div className="p-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-sm">
                    <div className="font-bold">Sensitive Control S-10 Triggered: {gateResult.code}</div>
                    <div className="mt-1">{gateResult.message}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Register Qualification Modal */}
      {qualModalOpen && (
        <Modal title="Register Artisan Qualification in Vault" onClose={() => setQualModalOpen(false)}>
          <form onSubmit={handleCreateQual} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician ID</label>
                <input
                  type="text"
                  required
                  value={qualForm.technician_id}
                  onChange={(e) => setQualForm({ ...qualForm, technician_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician Name</label>
                <input
                  type="text"
                  required
                  value={qualForm.technician_name}
                  onChange={(e) => setQualForm({ ...qualForm, technician_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trade Discipline</label>
                <select
                  value={qualForm.trade_discipline}
                  onChange={(e) => setQualForm({ ...qualForm, trade_discipline: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                >
                  <option value="RUBBER_LINING">RUBBER_LINING</option>
                  <option value="CONVEYOR_SPLICING">CONVEYOR_SPLICING</option>
                  <option value="SLURRY_PUMP_FITTER">SLURRY_PUMP_FITTER</option>
                  <option value="RIGGER">RIGGER</option>
                  <option value="BOILERMAKER">BOILERMAKER</option>
                  <option value="INSTRUMENTATION_FITTER">INSTRUMENTATION_FITTER</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Qualification Type</label>
                <select
                  value={qualForm.qualification_type}
                  onChange={(e) => setQualForm({ ...qualForm, qualification_type: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                >
                  <option value="RED_SEAL">RED_SEAL</option>
                  <option value="JOURNEYMAN_CLASS_1">JOURNEYMAN_CLASS_1</option>
                  <option value="SAFETY_PASSPORT">SAFETY_PASSPORT</option>
                  <option value="WORKING_AT_HEIGHTS">WORKING_AT_HEIGHTS</option>
                  <option value="CONFINED_SPACE">CONFINED_SPACE</option>
                  <option value="FIRST_AID">FIRST_AID</option>
                  <option value="GAS_TESTING">GAS_TESTING</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Certificate Number</label>
                <input
                  type="text"
                  required
                  value={qualForm.certificate_number}
                  onChange={(e) => setQualForm({ ...qualForm, certificate_number: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Issuing Authority</label>
                <input
                  type="text"
                  required
                  value={qualForm.issuing_authority}
                  onChange={(e) => setQualForm({ ...qualForm, issuing_authority: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Issue Date</label>
                <input
                  type="date"
                  required
                  value={qualForm.issue_date}
                  onChange={(e) => setQualForm({ ...qualForm, issue_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Expiry Date</label>
                <input
                  type="date"
                  required
                  value={qualForm.expiry_date}
                  onChange={(e) => setQualForm({ ...qualForm, expiry_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setQualModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Register Qualification"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Record Mine Induction Modal */}
      {indModalOpen && (
        <Modal title="Record Mine Site Induction" onClose={() => setIndModalOpen(false)}>
          <form onSubmit={handleRecordInd} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician ID</label>
                <input
                  type="text"
                  required
                  value={indForm.technician_id}
                  onChange={(e) => setIndForm({ ...indForm, technician_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician Name</label>
                <input
                  type="text"
                  required
                  value={indForm.technician_name}
                  onChange={(e) => setIndForm({ ...indForm, technician_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mining Site</label>
                <select
                  value={indForm.mine_site}
                  onChange={(e) => setIndForm({ ...indForm, mine_site: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                >
                  <option value="ZIMPLATS_NGEZI">ZIMPLATS_NGEZI</option>
                  <option value="ZIMPLATS_SMC">ZIMPLATS_SMC</option>
                  <option value="UNKI_CONCENTRATOR">UNKI_CONCENTRATOR</option>
                  <option value="MIMOSA_FLOTATION">MIMOSA_FLOTATION</option>
                  <option value="FREDA_REBECCA">FREDA_REBECCA</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Induction Card Number</label>
                <input
                  type="text"
                  required
                  value={indForm.induction_card_number}
                  onChange={(e) => setIndForm({ ...indForm, induction_card_number: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Induction Date</label>
                <input
                  type="date"
                  required
                  value={indForm.induction_date}
                  onChange={(e) => setIndForm({ ...indForm, induction_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Expiry Date</label>
                <input
                  type="date"
                  required
                  value={indForm.expiry_date}
                  onChange={(e) => setIndForm({ ...indForm, expiry_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={indForm.medical_fit_to_work_pass}
                  onChange={(e) => setIndForm({ ...indForm, medical_fit_to_work_pass: e.target.checked })}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                />
                <span>Certified Medical Fitness-to-Work Clearance Passed</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setIndModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Recording..." : "Record Induction"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
