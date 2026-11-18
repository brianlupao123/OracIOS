import React, { useEffect, useState } from "react";
import { fleet } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & Telemetry" },
  { id: "vehicles", label: "Vehicles Registry" },
  { id: "dispatches", label: "Trips & Dispatches" },
  { id: "fuel", label: "Fuel & Odometer Logs" }
];

function formatCurrency(val) {
  const num = Number(val) || 0;
  return `USD $${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FleetManagementPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [vehicles, setVehicles] = useState([]);

  // Modals state
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [fuelModalOpen, setFuelModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [vehicleForm, setVehicleForm] = useState({
    plate_number: "",
    make: "Toyota",
    model: "Hilux GD-6 4x4",
    year: 2023,
    vehicle_type: "4X4_FIELD_BAKKIE",
    current_odometer_km: 0,
    vid_certificate_number: "",
    vid_expiry_date: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
    insurance_expiry_date: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)
  });

  const [dispatchForm, setDispatchForm] = useState({
    vehicle_id: "",
    dispatch_card_id: "",
    driver_id: user?.id || "u-tech",
    driver_name: user?.name || "Technician",
    destination: "Zimplats SMC Selous",
    purpose: "Conveyor belt cold splicing callout",
    departure_odometer_km: 0
  });

  const [returnForm, setReturnForm] = useState({
    dispatch_id: "",
    return_odometer_km: 0,
    return_notes: "Trip completed safely. No vehicle issues."
  });

  const [fuelForm, setFuelForm] = useState({
    vehicle_id: "",
    voucher_number: "",
    litres: 50,
    cost_usd: 80,
    odometer_km: 0
  });

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [sumRes, vehsRes] = await Promise.all([
        fleet.getSummary().catch(() => null),
        fleet.listVehicles().catch(() => [])
      ]);
      setSummary(sumRes);
      setVehicles(vehsRes || []);
    } catch (err) {
      setError(err.message || "Failed to load fleet data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateVehicle(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await fleet.createVehicle(vehicleForm);
      setSuccessMsg("Vehicle registered in fleet registry.");
      setVehicleModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDispatchVehicle(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await fleet.dispatchVehicle(dispatchForm);
      setSuccessMsg("Vehicle dispatched for operational trip.");
      setDispatchModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnVehicle(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await fleet.returnVehicle(returnForm.dispatch_id, {
        return_odometer_km: Number(returnForm.return_odometer_km),
        return_notes: returnForm.return_notes
      });
      setSuccessMsg("Vehicle returned and odometer log updated.");
      setReturnModalOpen(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogFuel(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await fleet.logFuel({
        ...fuelForm,
        litres: Number(fuelForm.litres),
        cost_usd: Number(fuelForm.cost_usd),
        odometer_km: Number(fuelForm.odometer_km)
      });
      setSuccessMsg("Fuel voucher and odometer logged successfully.");
      setFuelModalOpen(false);
      await loadAll();
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
        title="Fleet Logistics & Mining Dispatch Subsystem"
        subtitle="Manage mining site service vehicles, driver assignments, fuel consumption vouchers, and VID Roadworthiness Expiry Locks (Sensitive Control S-12)."
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
                <span className="text-xs font-semibold text-gray-500">Total Fleet Vehicles</span>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary?.total_vehicles ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Available Vehicles</span>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{summary?.available_vehicles ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Currently Dispatched</span>
                <p className="text-2xl font-bold text-orac-blue mt-1">{summary?.dispatched_vehicles ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Grounded / Maintenance</span>
                <p className="text-2xl font-bold text-red-600 mt-1">{summary?.maintenance_vehicles ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Active Field Trips</span>
                <p className="text-2xl font-bold text-amber-600 mt-1">{summary?.active_trips ?? 0}</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <span className="text-xs font-semibold text-gray-500">Fuel Spend (USD)</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(summary?.total_fuel_usd ?? 0)}</p>
              </div>
            </div>

            <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4">
              <SectionTitle title="Fleet Quick Actions" />
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setVehicleModalOpen(true)}>+ Register New Vehicle</Button>
                <Button variant="secondary" onClick={() => setDispatchModalOpen(true)}>+ Dispatch Vehicle for Job</Button>
                <Button variant="secondary" onClick={() => setFuelModalOpen(true)}>+ Log Fuel Voucher</Button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: VEHICLES REGISTRY */}
        {activeTab === "vehicles" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Vehicle Fleet Registry" />
              <Button onClick={() => setVehicleModalOpen(true)}>+ Register Vehicle</Button>
            </div>

            <DataTable
              data={vehicles}
              keyField="id"
              columns={[
                { key: "plate_number", title: "Plate Number" },
                { key: "vehicle", title: "Make & Model", render: (r) => `${r.make} ${r.model} (${r.year})` },
                { key: "vehicle_type", title: "Type", render: (r) => r.vehicle_type?.replace(/_/g, " ") },
                { key: "current_odometer_km", title: "Odometer", render: (r) => `${Number(r.current_odometer_km || 0).toLocaleString()} km` },
                { key: "status", title: "Status", render: (r) => (
                  <Badge variant={r.status === "AVAILABLE" ? "success" : r.status === "DISPATCHED" ? "warning" : "danger"}>
                    {r.status}
                  </Badge>
                )},
                { key: "vid_expiry_date", title: "VID Certificate Expiry", render: (r) => {
                  const isExpired = r.vid_expiry_date < new Date().toISOString().slice(0, 10);
                  return (
                    <span className={isExpired ? "text-red-700 font-bold" : "text-gray-700"}>
                      {r.vid_expiry_date} {isExpired ? "(EXPIRED - LOCKED)" : ""}
                    </span>
                  );
                }},
                { key: "insurance_expiry_date", title: "Insurance Expiry" }
              ]}
            />
          </div>
        )}

        {/* TAB 3: DISPATCHES */}
        {activeTab === "dispatches" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Vehicle Job Dispatches & Trips" />
              <Button onClick={() => setDispatchModalOpen(true)}>+ Dispatch Vehicle</Button>
            </div>
            <p className="text-sm text-gray-600">
              Trip logs link physical vehicles to ORAC dispatch cards, tracking departure and return odometer readings and driver accountability.
            </p>
          </div>
        )}

        {/* TAB 4: FUEL LOGS */}
        {activeTab === "fuel" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <SectionTitle title="Fuel Consumption Vouchers" />
              <Button onClick={() => setFuelModalOpen(true)}>+ Log Fuel Voucher</Button>
            </div>
            <p className="text-sm text-gray-600">
              Fuel vouchers are denominated strictly in USD with litrage and odometer checks to calculate fleet fuel efficiency (km/L).
            </p>
          </div>
        )}
      </div>

      {/* MODAL: REGISTER VEHICLE */}
      <Modal isOpen={vehicleModalOpen} onClose={() => setVehicleModalOpen(false)} title="Register Fleet Vehicle">
        <form onSubmit={handleCreateVehicle} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Plate Number</label>
            <input
              type="text"
              placeholder="e.g. AFG-4421"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={vehicleForm.plate_number}
              onChange={(e) => setVehicleForm({ ...vehicleForm, plate_number: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Make</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.make}
                onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Model</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.model}
                onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Vehicle Type</label>
              <select
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.vehicle_type}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value })}
              >
                <option value="4X4_FIELD_BAKKIE">4x4 Field Bakkie</option>
                <option value="HEAVY_HAULAGE_15T">Heavy Haulage 15T</option>
                <option value="MOBILE_CRANE">Mobile Splicing Crane</option>
                <option value="LIGHT_VEHICLE">Light Vehicle</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Current Odometer (km)</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.current_odometer_km}
                onChange={(e) => setVehicleForm({ ...vehicleForm, current_odometer_km: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">VID Certificate Number</label>
              <input
                type="text"
                placeholder="VID-2026-XXXX"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.vid_certificate_number}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vid_certificate_number: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">VID Certificate Expiry Date</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={vehicleForm.vid_expiry_date}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vid_expiry_date: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Insurance Policy Expiry Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={vehicleForm.insurance_expiry_date}
              onChange={(e) => setVehicleForm({ ...vehicleForm, insurance_expiry_date: e.target.value })}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setVehicleModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Register Vehicle</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: DISPATCH VEHICLE */}
      <Modal isOpen={dispatchModalOpen} onClose={() => setDispatchModalOpen(false)} title="Dispatch Vehicle for Site Job">
        <form onSubmit={handleDispatchVehicle} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Available Vehicle</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={dispatchForm.vehicle_id}
              onChange={(e) => {
                const v = vehicles.find((item) => item.id === e.target.value);
                setDispatchForm({
                  ...dispatchForm,
                  vehicle_id: e.target.value,
                  departure_odometer_km: v?.current_odometer_km || 0
                });
              }}
              required
            >
              <option value="">-- Choose Vehicle --</option>
              {vehicles.filter((v) => v.status === "AVAILABLE").map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate_number} — {v.make} {v.model} (VID exp: {v.vid_expiry_date})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Driver Name</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={dispatchForm.driver_name}
                onChange={(e) => setDispatchForm({ ...dispatchForm, driver_name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Departure Odometer (km)</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={dispatchForm.departure_odometer_km}
                onChange={(e) => setDispatchForm({ ...dispatchForm, departure_odometer_km: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Destination Mine / Plant</label>
            <input
              type="text"
              placeholder="e.g. Zimplats SMC Selous Concentrator"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={dispatchForm.destination}
              onChange={(e) => setDispatchForm({ ...dispatchForm, destination: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Operational Purpose</label>
            <input
              type="text"
              placeholder="e.g. Emergency Conveyor Splice CV-04"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={dispatchForm.purpose}
              onChange={(e) => setDispatchForm({ ...dispatchForm, purpose: e.target.value })}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDispatchModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Dispatch Vehicle</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: LOG FUEL */}
      <Modal isOpen={fuelModalOpen} onClose={() => setFuelModalOpen(false)} title="Log Fuel Voucher">
        <form onSubmit={handleLogFuel} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Vehicle</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={fuelForm.vehicle_id}
              onChange={(e) => {
                const v = vehicles.find((item) => item.id === e.target.value);
                setFuelForm({
                  ...fuelForm,
                  vehicle_id: e.target.value,
                  odometer_km: v?.current_odometer_km || 0
                });
              }}
              required
            >
              <option value="">-- Choose Vehicle --</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plate_number} — {v.make} {v.model}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Voucher Number</label>
            <input
              type="text"
              placeholder="e.g. PUMA-HRE-9901"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={fuelForm.voucher_number}
              onChange={(e) => setFuelForm({ ...fuelForm, voucher_number: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Litres</label>
              <input
                type="number"
                step="0.1"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={fuelForm.litres}
                onChange={(e) => setFuelForm({ ...fuelForm, litres: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Total Cost (USD)</label>
              <input
                type="number"
                step="0.01"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                value={fuelForm.cost_usd}
                onChange={(e) => setFuelForm({ ...fuelForm, cost_usd: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Current Odometer (km)</label>
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              value={fuelForm.odometer_km}
              onChange={(e) => setFuelForm({ ...fuelForm, odometer_km: Number(e.target.value) })}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setFuelModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Save Fuel Log</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
