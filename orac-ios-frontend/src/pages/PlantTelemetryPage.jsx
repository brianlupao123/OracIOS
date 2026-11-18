import React, { useEffect, useState } from "react";
import { telemetry, sync } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & Plant Fleet Health" },
  { id: "ingest", label: "Live Sensor Ingestion & Vibration Stream" },
  { id: "alerts", label: "Condition Alerts & Predictive USD Quotes" },
  { id: "sync", label: "Offline Mobile Sync Journal" }
];

export default function PlantTelemetryPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [alertsList, setAlertsList] = useState([]);
  const [syncJournal, setSyncJournal] = useState([]);
  const [selectedTagTelemetry, setSelectedTagTelemetry] = useState(null);

  // Modals & submittals
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Ingestion form
  const [sensorForm, setSensorForm] = useState({
    sensor_id: "SENS-VIB-PU101",
    equipment_tag_id: "TAG-PU-101",
    equipment_tag_name: "Primary Slurry Feed Pump PU-101",
    client_id: "c-zimplats",
    client_name: "Zimplats SMC",
    mine_site: "ZIMPLATS_SMC",
    vibration_rms_mms: 5.2,
    bearing_temp_celsius: 72.0,
    casing_wear_depth_mm: 7.2,
    pump_flow_rate_m3h: 410.0
  });

  // Alert resolution form
  const [resolveForm, setResolveForm] = useState({
    resolution_notes: "Artisans dispatched to replace suction liner wear gasket before shutdown.",
    action_taken: "SCHEDULE_RELINING"
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [sumRes, altRes, synRes, tagRes] = await Promise.all([
        telemetry.getSummary().catch(() => ({ data: null })),
        telemetry.listAlerts().catch(() => ({ data: [] })),
        sync.getJournal().catch(() => ({ data: [] })),
        telemetry.getEquipmentTelemetry("TAG-PU-101").catch(() => ({ data: null }))
      ]);

      setSummary(sumRes?.data || null);
      setAlertsList(altRes?.data || []);
      setSyncJournal(synRes?.data || []);
      setSelectedTagTelemetry(tagRes?.data || null);
    } catch (err) {
      setError(err.message || "Failed to load telemetry data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleIngestSensor = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await telemetry.ingest({
        sensor_id: sensorForm.sensor_id,
        equipment_tag_id: sensorForm.equipment_tag_id,
        equipment_tag_name: sensorForm.equipment_tag_name,
        client_id: sensorForm.client_id,
        client_name: sensorForm.client_name,
        mine_site: sensorForm.mine_site,
        metrics: {
          vibration_rms_mms: Number(sensorForm.vibration_rms_mms),
          bearing_temp_celsius: Number(sensorForm.bearing_temp_celsius),
          casing_wear_depth_mm: Number(sensorForm.casing_wear_depth_mm),
          pump_flow_rate_m3h: Number(sensorForm.pump_flow_rate_m3h)
        }
      });

      const { telemetry: tel, alert, quote } = res.data;
      let msg = `Sensor reading logged: Status ${tel.status}.`;
      if (alert) {
        msg += ` Threshold alert triggered (${alert.alert_type} - ${alert.severity}).`;
      }
      if (quote) {
        msg += ` Predictive USD quote ${quote.quote_number} automatically generated!`;
      }
      setSuccessMsg(msg);
      setIngestModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to ingest telemetry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveAlert = async (e) => {
    e.preventDefault();
    if (!selectedAlert) return;
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await telemetry.resolveAlert(selectedAlert.id, resolveForm);
      setSuccessMsg(`Condition alert ${selectedAlert.id} resolved successfully.`);
      setResolveModalOpen(false);
      setSelectedAlert(null);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to resolve alert");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeaderBanner
        badge="Subsystems 12 & 13"
        description="Plant IoT Condition Monitoring, Slurry Pump Vibration Analysis, Predictive Maintenance USD Quotations, and Offline Mobile Synchronization."
        title="Plant Telemetry & Sync Engine"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3">
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} />
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setError("");
              setSuccessMsg("");
              setIngestModalOpen(true);
            }}
            variant="primary"
          >
            + Ingest Sensor Telemetry
          </Button>
          <Button onClick={loadData} variant="secondary">
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError("")} />}

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4 text-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <span>✓</span>
            <span>{successMsg}</span>
          </div>
        </div>
      )}

      {loading ? (
        <PageLoadingSkeleton />
      ) : (
        <div role="tabpanel">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Plant Telemetry KPI Ribbon */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    MONITORED PUMPS & ASSETS
                  </div>
                  <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                    {summary?.monitored_equipment_count || 1}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Telemetry gateways connected</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">ACTIVE CRITICAL ALERTS</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-red-600 dark:text-red-400">
                      {summary?.critical_alerts_count || 0}
                    </span>
                    <span className="text-xs text-gray-400">Requires relining</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Vibration &gt; 7.1 mm/s or Wear &gt; 8mm</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">PREDICTIVE USD QUOTES (S-08)</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                      {summary?.auto_predictive_quotes_generated || 0}
                    </span>
                    <span className="text-xs text-gray-400">Drafted automatically</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Pre-emptive lining quote generation</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">PLANT FLEET HEALTH</div>
                  <div className="mt-2">
                    <Badge tone={summary?.critical_alerts_count > 0 ? "danger" : "success"}>
                      {summary?.fleet_health_index || "OPTIMAL"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Zimplats, Unki, Mimosa overall</div>
                </div>
              </div>

              {/* Slurry Pump Condition Analysis */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
                <SectionTitle title="Primary Slurry Pump Condition Profile (TAG-PU-101)" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Vibration RMS (ISO 10816-3)</div>
                    <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                      {selectedTagTelemetry?.latest_vibration_rms || 2.1} mm/s
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Normal &le; 4.5 | Critical &gt; 7.1</div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Bearing Temperature</div>
                    <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                      {selectedTagTelemetry?.latest_bearing_temp || 52.0} °C
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Normal &le; 75.0 | Critical &gt; 90.0</div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Ultrasonic Wear Depth</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {selectedTagTelemetry?.latest_casing_wear_depth || 3.2} mm
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Warning &gt; 6.0 | Critical &gt; 8.0</div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 text-xs text-gray-700 dark:text-gray-300">
                  <strong>Predictive Maintenance Policy:</strong> When casing ultrasonic wear reaches 8.0 mm or bearing vibration exceeds 7.1 mm/s RMS, the ORAC AI engine auto-generates a commercial quote for replacement cold-vulcanized rubber lining kits, allocating certified specialist artisan labor in strict USD.
                </div>
              </div>
            </div>
          )}

          {activeTab === "ingest" && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <SectionTitle title="Industrial IoT Sensor Webhook Ingestion" />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Simulates or ingests live hardware sensor packets from vibration accelerometers and ultrasonic wear transducers.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                POST /api/telemetry/ingest
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => setIngestModalOpen(true)} variant="primary">
                  Transmit Telemetry Packet
                </Button>
              </div>
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle title="Plant Condition Alerts & Predictive Quotations Register" />
                <span className="text-xs text-gray-500 dark:text-gray-400">{alertsList.length} total alerts recorded</span>
              </div>

              {alertsList.length === 0 ? (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-gray-500 dark:text-gray-400">
                  <div className="text-2xl text-emerald-600 dark:text-emerald-400">✓</div>
                  <div className="mt-2 font-medium text-gray-900 dark:text-white">Zero Active Threshold Alerts</div>
                  <div className="mt-1 text-xs">All monitored equipment operating within ISO vibration and wear tolerances.</div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                  <DataTable
                    columns={[
                      {
                        header: "Alert Type",
                        accessor: "alert_type",
                        cell: (row) => (
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">{row.alert_type}</div>
                            <div className="text-xs font-mono text-gray-500 dark:text-gray-400">{row.equipment_tag_id}</div>
                          </div>
                        )
                      },
                      {
                        header: "Severity",
                        accessor: "severity",
                        cell: (row) => (
                          <Badge tone={row.severity === "CRITICAL" ? "danger" : "warning"}>
                            {row.severity}
                          </Badge>
                        )
                      },
                      {
                        header: "Metric Value",
                        accessor: "trigger_value",
                        cell: (row) => (
                          <div className="text-xs">
                            <span className="font-bold text-red-600 dark:text-red-400">{row.trigger_value}</span>
                            <span className="text-gray-400"> (Limit: {row.threshold_value})</span>
                          </div>
                        )
                      },
                      {
                        header: "Status",
                        accessor: "status",
                        cell: (row) => (
                          <Badge tone={row.status === "ACTIVE" ? "danger" : "success"}>
                            {row.status}
                          </Badge>
                        )
                      },
                      {
                        header: "Auto-Quote (USD S-08)",
                        accessor: "auto_quote_id",
                        cell: (row) => row.auto_quote_id ? (
                          <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                            {row.auto_quote_id}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">None</span>
                        )
                      },
                      {
                        header: "Action",
                        accessor: "id",
                        cell: (row) => row.status === "ACTIVE" ? (
                          <Button
                            onClick={() => {
                              setSelectedAlert(row);
                              setResolveModalOpen(true);
                            }}
                            size="sm"
                            variant="secondary"
                          >
                            Resolve Alert
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-500">Resolved</span>
                        )
                      }
                    ]}
                    data={alertsList}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === "sync" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <SectionTitle title="Mobile Companion Offline Sync Journal" />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Replays field worksheet hours and equipment inspections captured underground without cellular signal.
                  </p>
                </div>
                <Badge tone="success">Non-Destructive Merge Active</Badge>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <DataTable
                  columns={[
                    {
                      header: "Mutation ID",
                      accessor: "client_mutation_id",
                      cell: (row) => (
                        <div className="font-mono text-xs text-gray-700 dark:text-gray-300">
                          {row.client_mutation_id}
                        </div>
                      )
                    },
                    {
                      header: "Entity & Target",
                      accessor: "entity_type",
                      cell: (row) => (
                        <div className="text-xs">
                          <span className="font-semibold text-gray-900 dark:text-white">{row.entity_type}</span>
                          <span className="text-gray-500 dark:text-gray-400"> ({row.entity_id})</span>
                        </div>
                      )
                    },
                    {
                      header: "Operation",
                      accessor: "operation",
                      cell: (row) => (
                        <Badge tone={row.operation === "INSERT" ? "success" : "info"}>
                          {row.operation}
                        </Badge>
                      )
                    },
                    {
                      header: "Sync Status",
                      accessor: "sync_status",
                      cell: (row) => (
                        <Badge tone={row.sync_status === "COMMITTED" ? "success" : "warning"}>
                          {row.sync_status}
                        </Badge>
                      )
                    },
                    {
                      header: "Synced At",
                      accessor: "server_timestamp",
                      cell: (row) => (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(row.server_timestamp).toLocaleString()}
                        </div>
                      )
                    }
                  ]}
                  data={syncJournal}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Ingest Telemetry */}
      <Modal
        isOpen={ingestModalOpen}
        onClose={() => setIngestModalOpen(false)}
        title="Ingest Plant IoT Telemetry Packet"
      >
        <form className="space-y-4" onSubmit={handleIngestSensor}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Sensor ID</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setSensorForm({ ...sensorForm, sensor_id: e.target.value })}
                required
                value={sensorForm.sensor_id}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Equipment Tag ID</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs font-mono text-gray-900 dark:text-white"
                onChange={(e) => setSensorForm({ ...sensorForm, equipment_tag_id: e.target.value })}
                required
                value={sensorForm.equipment_tag_id}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-gray-200 dark:border-gray-800 pt-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Vibration RMS (mm/s)</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setSensorForm({ ...sensorForm, vibration_rms_mms: Number(e.target.value) })}
                step="0.1"
                type="number"
                value={sensorForm.vibration_rms_mms}
              />
              <span className="text-xs text-gray-400">Limit: 7.1 mm/s</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Bearing Temp (°C)</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setSensorForm({ ...sensorForm, bearing_temp_celsius: Number(e.target.value) })}
                step="1"
                type="number"
                value={sensorForm.bearing_temp_celsius}
              />
              <span className="text-xs text-gray-400">Limit: 90 °C</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Casing Wear (mm)</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setSensorForm({ ...sensorForm, casing_wear_depth_mm: Number(e.target.value) })}
                step="0.1"
                type="number"
                value={sensorForm.casing_wear_depth_mm}
              />
              <span className="text-xs text-gray-400">Limit: 8.0 mm</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-800 pt-3">
            <Button onClick={() => setIngestModalOpen(false)} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={submitting} type="submit" variant="primary">
              {submitting ? "Ingesting..." : "Send Sensor Packet"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Resolve Alert */}
      <Modal
        isOpen={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        title="Resolve Equipment Condition Alert"
      >
        <form className="space-y-4" onSubmit={handleResolveAlert}>
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-xs">
            <div className="font-semibold text-red-600 dark:text-red-400">Breach Notice:</div>
            <div className="mt-1 text-gray-700 dark:text-gray-300">
              {selectedAlert?.alert_type} on {selectedAlert?.equipment_tag_id}: Value {selectedAlert?.trigger_value} exceeded threshold {selectedAlert?.threshold_value}.
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Action Taken</label>
            <select
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setResolveForm({ ...resolveForm, action_taken: e.target.value })}
              value={resolveForm.action_taken}
            >
              <option value="SCHEDULE_RELINING">Schedule Relining (Plant Shutdown)</option>
              <option value="DISPATCH_INSPECTION">Dispatch Field Technician Inspection</option>
              <option value="MAINTENANCE_LOGGED">Maintenance Logged on SAP/ORAC</option>
              <option value="FALSE_POSITIVE">Sensor Recalibration (False Positive)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Resolution Notes</label>
            <textarea
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })}
              required
              rows={3}
              value={resolveForm.resolution_notes}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-800 pt-3">
            <Button onClick={() => setResolveModalOpen(false)} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={submitting} type="submit" variant="primary">
              {submitting ? "Resolving..." : "Confirm Resolution"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
