import React, { useEffect, useState } from "react";
import { hse } from "../api/client.js";
import RegisterTable from "../components/RegisterTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";
import Field from "../components/ui/Field.jsx";
import Input from "../components/ui/Input.jsx";

const emptyAttendee = () => ({ technician_id: "", name: "", signature_present: false });

const TABS = [
  { id: "overview", label: "Overview & Safety Metrics" },
  { id: "ppe", label: "Pre-Dispatch PPE Gate (S-11)" },
  { id: "toolbox", label: "Daily Toolbox Talks" },
  { id: "incidents", label: "Incidents & Near-Misses" }
];

export default function HseCompliancePage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [ppeList, setPpeList] = useState([]);
  const [talks, setTalks] = useState([]);
  const [incidents, setIncidents] = useState([]);

  // Modals
  const [ppeModalOpen, setPpeModalOpen] = useState(false);
  const [toolboxModalOpen, setToolboxModalOpen] = useState(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [ppeForm, setPpeForm] = useState({
    dispatch_card_id: "",
    technician_id: user?.id || "",
    technician_name: user?.name || "",
    site_location: "",
    hard_hat_pass: false,
    metatarsal_boots_pass: false,
    heavy_chemical_gloves_pass: false,
    safety_glasses_pass: false,
    high_vis_vest_pass: false,
    respirator_mask_pass: false,
    ear_protection_pass: false,
    fall_arrest_harness_pass: false
  });

  const [toolboxForm, setToolboxForm] = useState({
    talk_date: new Date().toISOString().slice(0, 10),
    topic: "",
    site_location: "",
    attendees: [emptyAttendee()],
    hazards_identified: "",
    control_measures: ""
  });

  const [incidentForm, setIncidentForm] = useState({
    incident_date: new Date().toISOString().slice(0, 10),
    site_location: "",
    severity: "NEAR_MISS",
    description: "",
    immediate_action_taken: "",
    root_cause: "",
    corrective_preventative_action: ""
  });

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [sumRes, ppeRes, talksRes, incRes] = await Promise.all([
        hse.getSummary().catch(() => null),
        hse.listPpeChecklists().catch(() => []),
        hse.listToolboxTalks().catch(() => []),
        hse.listIncidents().catch(() => [])
      ]);
      setSummary(sumRes);
      setPpeList(ppeRes || []);
      setTalks(talksRes || []);
      setIncidents(incRes || []);
    } catch (err) {
      setError(err.message || "Failed to load HSE compliance data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleRecordPpe(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await hse.recordPreDispatchPpe(ppeForm);
      setSuccessMsg("Pre-dispatch PPE inspection verified and recorded against dispatch card.");
      setPpeModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateToolbox(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      const attendees = toolboxForm.attendees.map(attendee => ({
        technician_id: attendee.technician_id.trim(),
        name: attendee.name.trim(),
        signature_present: attendee.signature_present
      }));
      if (attendees.some(attendee => !attendee.technician_id || !attendee.name)) {
        throw new Error("Enter a technician ID and name for each attendee.");
      }
      if (new Set(attendees.map(attendee => attendee.technician_id)).size !== attendees.length) {
        throw new Error("Record each technician only once for this talk.");
      }

      await hse.createToolboxTalk({
        talk_date: toolboxForm.talk_date,
        topic: toolboxForm.topic,
        site_location: toolboxForm.site_location,
        attendees,
        hazards_identified: toolboxForm.hazards_identified,
        control_measures: toolboxForm.control_measures
      });
      setSuccessMsg("Daily Toolbox Talk recorded in safety compliance audit vault.");
      setToolboxModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateToolboxAttendee(index, change) {
    setToolboxForm(form => ({
      ...form, attendees: form.attendees.map((attendee, i) => i === index ? { ...attendee, ...change } : attendee)
    }));
  }

  async function handleReportIncident(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await hse.reportIncident(incidentForm);
      setSuccessMsg("HSE Incident / Near-Miss report registered in safety compliance audit vault.");
      setIncidentModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoadingSkeleton />;

  const allPpeChecked = Boolean(
    ppeForm.hard_hat_pass &&
    ppeForm.metatarsal_boots_pass &&
    ppeForm.heavy_chemical_gloves_pass &&
    ppeForm.safety_glasses_pass &&
    ppeForm.high_vis_vest_pass &&
    ppeForm.respirator_mask_pass &&
    ppeForm.ear_protection_pass &&
    ppeForm.fall_arrest_harness_pass
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeaderBanner
        title="HSE Compliance & Safety Gate Subsystem"
        subtitle="Manage mining safety standards, 8-point pre-dispatch PPE inspection gates (Sensitive Control S-11), daily toolbox talks, and incident reports for zero-harm mining compliance."
      />

      {error && <ErrorBanner message={error} />}
      {successMsg && (
        <div className="p-4 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
          {successMsg}
        </div>
      )}

      <TabNav tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div role="tabpanel" aria-labelledby="tab-overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total PPE Inspections</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary?.total_ppe_inspections || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Passed Inspections</div>
              <div className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{summary?.passed_ppe_inspections || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-red-600 dark:text-red-400">Blocked Gates (S-11)</div>
              <div className="mt-2 text-2xl font-bold text-red-700 dark:text-red-300">{summary?.blocked_ppe_inspections || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Toolbox Talks</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary?.total_toolbox_talks || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Incidents</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary?.total_incidents || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Open Incidents</div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-300">{summary?.open_incidents || 0}</div>
            </div>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <SectionTitle title="Sensitive Control S-11: Mandatory Mining Site Safety Gates" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Heavy industrial maintenance operations at <strong>Zimplats</strong>, <strong>Unki</strong>, and <strong>Mimosa</strong> enforce a strict Zero-Harm policy.
              Before any field technician or rubber liner can be dispatched to an operational plant, all 8 specialized PPE checkpoints must be validated and certified.
              Any failed item instantly locks dispatch authorization, preventing uncertified personnel from entering high-hazard zones.
            </p>
          </div>
        </div>
      )}

      {activeTab === "ppe" && (
        <div role="tabpanel" aria-labelledby="tab-ppe" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="Pre-Dispatch PPE Checklists (8-Point Safety Gate)" />
            <Button variant="primary" onClick={() => setPpeModalOpen(true)}>
              Conduct Pre-Dispatch Inspection
            </Button>
          </div>

          <RegisterTable
            data={ppeList}
            keyField="id"
            columns={[
              { key: "checklist_number", label: "Checklist #" },
              {
                key: "inspected_at",
                label: "Inspected At",
                render: (val) => val ? new Date(val).toLocaleString() : "-"
              },
              { key: "technician_name", label: "Artisan / Technician" },
              { key: "site_location", label: "Mining Site" },
              { key: "supervisor_name", label: "Supervisor" },
              {
                key: "status",
                label: "Safety Status",
                render: (val) => (
                  <Badge variant={val === "PASSED" ? "success" : "danger"}>
                    {val}
                  </Badge>
                )
              }
            ]}
          />
        </div>
      )}

      {activeTab === "toolbox" && (
        <div role="tabpanel" aria-labelledby="tab-toolbox" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="Daily Toolbox Safety Talks Register" />
            <Button variant="primary" onClick={() => setToolboxModalOpen(true)}>
              Log Daily Toolbox Talk
            </Button>
          </div>

          <RegisterTable
            data={talks}
            keyField="id"
            columns={[
              { key: "talk_number", label: "Talk #" },
              { key: "talk_date", label: "Date" },
              { key: "site_location", label: "Mining Site" },
              { key: "topic", label: "Safety Topic" },
              { key: "supervisor_name", label: "Lead Supervisor" },
              {
                key: "attendees",
                label: "Attendees",
                render: (val) => Array.isArray(val) ? `${val.length} crew members` : "-"
              }
            ]}
          />
        </div>
      )}

      {activeTab === "incidents" && (
        <div role="tabpanel" aria-labelledby="tab-incidents" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="HSE Incidents & Near-Misses Audit Log" />
            <Button variant="primary" onClick={() => setIncidentModalOpen(true)}>
              Report Incident / Near-Miss
            </Button>
          </div>

          <RegisterTable
            data={incidents}
            keyField="id"
            columns={[
              { key: "incident_number", label: "Incident #" },
              { key: "incident_date", label: "Date" },
              { key: "site_location", label: "Site Location" },
              {
                key: "severity",
                label: "Severity",
                render: (val) => (
                  <Badge variant={val === "NEAR_MISS" ? "warning" : val === "FIRST_AID" ? "info" : "danger"}>
                    {val}
                  </Badge>
                )
              },
              { key: "description", label: "Incident Details" },
              { key: "status", label: "Status" },
              { key: "reported_by_name", label: "Reported By" }
            ]}
          />
        </div>
      )}

      {/* PPE Inspection Modal */}
      {ppeModalOpen && (
        <Modal isOpen={ppeModalOpen} title="Pre-Dispatch 8-Point PPE Inspection Gate (S-11)" onClose={() => setPpeModalOpen(false)}>
          <form onSubmit={handleRecordPpe} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician ID</label>
                <input
                  type="text"
                  required
                  value={ppeForm.technician_id}
                  onChange={(e) => setPpeForm({ ...ppeForm, technician_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician Name</label>
                <input
                  type="text"
                  required
                  value={ppeForm.technician_name}
                  onChange={(e) => setPpeForm({ ...ppeForm, technician_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Dispatch Card ID</label>
                <input
                  type="text"
                  required
                  value={ppeForm.dispatch_card_id}
                  onChange={(e) => setPpeForm({ ...ppeForm, dispatch_card_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Site Location</label>
                <input
                  type="text"
                  required
                  value={ppeForm.site_location}
                  onChange={(e) => setPpeForm({ ...ppeForm, site_location: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="pt-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Mandatory 8-Point Physical PPE Checklist
              </div>
              <div className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-gray-50 dark:bg-gray-800/50">
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.hard_hat_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, hard_hat_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>1. Hard Hat & Chin Strap (High-impact mining approved)</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.metatarsal_boots_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, metatarsal_boots_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>2. Metatarsal Guard Steel-Toe Safety Boots (Heavy slurry zone)</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.heavy_chemical_gloves_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, heavy_chemical_gloves_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>3. Heavy Chemical Nitrile Gloves (Cold vulcanizing adhesive & solvent safe)</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.safety_glasses_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, safety_glasses_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>4. Impact & Anti-Fog UV Safety Glasses</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.high_vis_vest_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, high_vis_vest_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>5. High-Visibility Reflective Vest / Overall (Mine standard class 3)</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.respirator_mask_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, respirator_mask_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>6. Half-Mask Respirator with Organic Vapor/Dust Dual Cartridge</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.ear_protection_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, ear_protection_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>7. Hearing Protection (NRR 25dB+ Earmuffs / Canal Plugs)</span>
                </label>
                <label className="flex items-center space-x-3 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={ppeForm.fall_arrest_harness_pass}
                    onChange={(e) => setPpeForm({ ...ppeForm, fall_arrest_harness_pass: e.target.checked })}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-orac-blue"
                  />
                  <span>8. Full-Body Double-Lanyard Fall Arrest Harness (Conveyor gantry safe)</span>
                </label>
              </div>
            </div>

            {!allPpeChecked && (
              <div className="p-3 rounded bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-sm">
                Sensitive Control S-11 Active: If any check is missing, backend blocks dispatch with PPE_INSPECTION_FAILED.
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setPpeModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Verifying..." : "Certify & Record Safety Gate"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Toolbox Talk Modal */}
      {toolboxModalOpen && (
        <Modal isOpen={toolboxModalOpen} title="Log Daily Toolbox Safety Talk" onClose={() => setToolboxModalOpen(false)}>
          <form onSubmit={handleCreateToolbox} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Talk Date</label>
                <input
                  type="date"
                  required
                  value={toolboxForm.talk_date}
                  onChange={(e) => setToolboxForm({ ...toolboxForm, talk_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Site Location</label>
                <input
                  type="text"
                  required
                  value={toolboxForm.site_location}
                  onChange={(e) => setToolboxForm({ ...toolboxForm, site_location: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Safety Topic</label>
              <input
                type="text"
                required
                value={toolboxForm.topic}
                onChange={(e) => setToolboxForm({ ...toolboxForm, topic: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-ux-label">Attendees</legend>
              {toolboxForm.attendees.map((attendee, index) => (
                <div key={index} className="space-y-2 rounded-md border border-orac-border-default p-3">
                  <Field id={`toolbox-attendee-id-${index}`} label="Attendee technician ID" required>
                    <Input id={`toolbox-attendee-id-${index}`} required value={attendee.technician_id}
                      onChange={event => updateToolboxAttendee(index, { technician_id: event.target.value })} />
                  </Field>
                  <Field id={`toolbox-attendee-name-${index}`} label="Attendee name" required>
                    <Input id={`toolbox-attendee-name-${index}`} required value={attendee.name}
                      onChange={event => updateToolboxAttendee(index, { name: event.target.value })} />
                  </Field>
                  <label className="inline-flex items-center gap-2">
                    <Input type="checkbox" className="!w-auto" checked={attendee.signature_present}
                      onChange={event => updateToolboxAttendee(index, { signature_present: event.target.checked })} />
                    Signature on file
                  </label>
                  {toolboxForm.attendees.length > 1 && (
                    <Button type="button" variant="ghost" onClick={() => setToolboxForm(form => ({
                      ...form, attendees: form.attendees.filter((_, i) => i !== index)
                    }))}>Remove attendee</Button>
                  )}
                </div>
              ))}
              <Button type="button" onClick={() => setToolboxForm(form => ({
                ...form, attendees: [...form.attendees, emptyAttendee()]
              }))}>Add attendee</Button>
            </fieldset>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Hazards Identified</label>
              <textarea
                required
                rows={2}
                value={toolboxForm.hazards_identified}
                onChange={(e) => setToolboxForm({ ...toolboxForm, hazards_identified: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Control Measures Implemented</label>
              <textarea
                required
                rows={2}
                value={toolboxForm.control_measures}
                onChange={(e) => setToolboxForm({ ...toolboxForm, control_measures: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setToolboxModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Record Toolbox Talk"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Incident Report Modal */}
      {incidentModalOpen && (
        <Modal isOpen={incidentModalOpen} title="Log HSE Incident / Near-Miss Report" onClose={() => setIncidentModalOpen(false)}>
          <form onSubmit={handleReportIncident} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Incident Date</label>
                <input
                  type="date"
                  required
                  value={incidentForm.incident_date}
                  onChange={(e) => setIncidentForm({ ...incidentForm, incident_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Site Location</label>
                <input
                  type="text"
                  required
                  value={incidentForm.site_location}
                  onChange={(e) => setIncidentForm({ ...incidentForm, site_location: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Severity</label>
                <select
                  value={incidentForm.severity}
                  onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                >
                  <option value="NEAR_MISS">NEAR_MISS</option>
                  <option value="FIRST_AID">FIRST_AID</option>
                  <option value="MEDICAL_TREATMENT">MEDICAL_TREATMENT</option>
                  <option value="LOST_TIME_INJURY">LOST_TIME_INJURY</option>
                  <option value="FATALITY">FATALITY</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Incident Description</label>
              <textarea
                required
                rows={2}
                value={incidentForm.description}
                onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Immediate Action Taken</label>
              <textarea
                required
                rows={2}
                value={incidentForm.immediate_action_taken}
                onChange={(e) => setIncidentForm({ ...incidentForm, immediate_action_taken: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Root Cause (Optional)</label>
                <input
                  type="text"
                  value={incidentForm.root_cause}
                  onChange={(e) => setIncidentForm({ ...incidentForm, root_cause: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Corrective Action (Optional)</label>
                <input
                  type="text"
                  value={incidentForm.corrective_preventative_action}
                  onChange={(e) => setIncidentForm({ ...incidentForm, corrective_preventative_action: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setIncidentModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Filing..." : "Register Incident"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
