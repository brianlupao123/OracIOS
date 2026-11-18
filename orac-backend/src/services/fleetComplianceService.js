/**
 * Fleet Mileage & Compliance Service.
 *
 * Extends the existing fleet controller with:
 *  1. Standalone odometer/mileage logging (not tied to dispatch trips).
 *  2. Proactive expiry alerts for VID/roadworthiness, insurance, and
 *     licence renewal dates across the entire fleet.
 *  3. Vehicle utilisation report (km/month, service intervals).
 *
 * The existing fleetController already enforces S-12 (dispatch gate
 * for expired VID/insurance). This service adds the PROACTIVE side:
 * scanning the fleet and generating warnings BEFORE expiry.
 *
 * Zero-dependency. Works with the in-memory db.
 */

import crypto from "node:crypto";

// ── Mileage / Odometer Logging ──────────────────────────────────────

/**
 * Records a standalone odometer reading (e.g. weekly check, service).
 * Not tied to a dispatch trip — this is for periodic readings.
 */
export function logOdometerReading({ vehicleId, readingKm, readingDate, source, notes, userId, store, db }) {
  if (!vehicleId) throw Object.assign(new Error("vehicleId is required"), { status: 400 });
  if (readingKm == null || isNaN(Number(readingKm))) {
    throw Object.assign(new Error("readingKm must be a number"), { status: 400 });
  }

  const vehicle = (db.vehicles || []).find(v => v.id === vehicleId);
  if (!vehicle) throw Object.assign(new Error("Vehicle not found"), { status: 404 });

  const km = Number(readingKm);
  if (km < 0) throw Object.assign(new Error("readingKm cannot be negative"), { status: 400 });

  // Validate that new reading is not less than current odometer
  const currentKm = vehicle.current_odometer_km || 0;
  if (km < currentKm) {
    throw Object.assign(
      new Error(`Reading ${km} km is less than current odometer ${currentKm} km. Odometers don't go backwards.`),
      { status: 400 }
    );
  }

  if (!db.odometer_readings) db.odometer_readings = [];

  const reading = {
    id: `odom_${crypto.randomBytes(8).toString("hex")}`,
    vehicle_id: vehicleId,
    reading_km: km,
    reading_date: readingDate || new Date().toISOString().split("T")[0],
    source: source || "manual",   // manual, trip_return, service, inspection
    notes: notes || null,
    recorded_by: userId || null,
    created_at: new Date().toISOString()
  };

  db.odometer_readings.push(reading);

  // Update vehicle's current odometer
  const before = { current_odometer_km: vehicle.current_odometer_km };
  vehicle.current_odometer_km = km;

  if (store && store.audit) {
    store.audit(db, { id: userId || "system" }, "odometer_readings", reading.id,
      "ODOMETER_LOGGED", before, { current_odometer_km: km, source: reading.source });
  }

  return reading;
}

/**
 * Returns odometer history for a vehicle, newest first.
 */
export function getOdometerHistory({ vehicleId, db }) {
  return (db.odometer_readings || [])
    .filter(r => r.vehicle_id === vehicleId)
    .sort((a, b) => b.reading_km - a.reading_km);
}

/**
 * Calculates mileage statistics for a vehicle.
 */
export function getMileageStats({ vehicleId, db }) {
  const readings = (db.odometer_readings || [])
    .filter(r => r.vehicle_id === vehicleId)
    .sort((a, b) => (a.reading_date || "").localeCompare(b.reading_date || ""));

  const vehicle = (db.vehicles || []).find(v => v.id === vehicleId);
  if (!vehicle) throw Object.assign(new Error("Vehicle not found"), { status: 404 });

  if (readings.length < 2) {
    return {
      vehicleId,
      registration: vehicle.registration_number || null,
      currentKm: vehicle.current_odometer_km || 0,
      totalReadings: readings.length,
      avgDailyKm: null,
      avgMonthlyKm: null,
      lastServiceKm: vehicle.last_service_km || null,
      kmSinceLastService: vehicle.last_service_km
        ? (vehicle.current_odometer_km || 0) - vehicle.last_service_km
        : null
    };
  }

  const first = readings[0];
  const last  = readings[readings.length - 1];
  const totalKm = last.reading_km - first.reading_km;
  const totalDays = Math.max(1, Math.ceil(
    (new Date(last.reading_date) - new Date(first.reading_date)) / (1000 * 60 * 60 * 24)
  ));

  return {
    vehicleId,
    registration: vehicle.registration_number || null,
    currentKm: vehicle.current_odometer_km || 0,
    totalReadings: readings.length,
    totalKm,
    totalDays,
    avgDailyKm: Math.round(totalKm / totalDays),
    avgMonthlyKm: Math.round((totalKm / totalDays) * 30),
    lastServiceKm: vehicle.last_service_km || null,
    kmSinceLastService: vehicle.last_service_km
      ? (vehicle.current_odometer_km || 0) - vehicle.last_service_km
      : null
  };
}

// ── Expiry Alerts / Compliance Scanning ─────────────────────────────

const EXPIRY_FIELDS = [
  { field: "vid_expiry_date",       label: "VID Roadworthiness Certificate", category: "roadworthiness" },
  { field: "insurance_expiry_date", label: "Insurance Policy",              category: "insurance" },
  { field: "licence_expiry_date",   label: "Vehicle Licence",               category: "licence" },
  { field: "cof_expiry_date",       label: "Certificate of Fitness (CoF)",  category: "fitness" }
];

/**
 * Scans the fleet and returns compliance status for each vehicle.
 * Classifies each document as: expired, expiring_soon (within days),
 * valid, or not_set.
 *
 * @param {number} [warningDays=30] - Days before expiry to flag as "expiring_soon"
 */
export function scanFleetCompliance({ warningDays = 30, db }) {
  const vehicles = db.vehicles || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const warningDate = new Date(today);
  warningDate.setDate(warningDate.getDate() + warningDays);

  const results = [];

  for (const v of vehicles) {
    const checks = [];
    let worstStatus = "valid";

    for (const { field, label, category } of EXPIRY_FIELDS) {
      const dateStr = v[field];
      if (!dateStr) {
        checks.push({ category, label, status: "not_set", expiryDate: null, daysUntilExpiry: null });
        continue;
      }

      const expiry = new Date(dateStr);
      expiry.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

      let status;
      if (daysUntil < 0) {
        status = "expired";
        if (worstStatus !== "expired") worstStatus = "expired";
      } else if (daysUntil <= warningDays) {
        status = "expiring_soon";
        if (worstStatus === "valid") worstStatus = "expiring_soon";
      } else {
        status = "valid";
      }

      checks.push({ category, label, status, expiryDate: dateStr, daysUntilExpiry: daysUntil });
    }

    results.push({
      vehicleId: v.id,
      registration: v.registration_number || null,
      make: v.make || null,
      model: v.model || null,
      overallStatus: worstStatus,
      checks
    });
  }

  // Sort: expired first, then expiring_soon, then valid
  const statusOrder = { expired: 0, expiring_soon: 1, valid: 2 };
  results.sort((a, b) => (statusOrder[a.overallStatus] ?? 3) - (statusOrder[b.overallStatus] ?? 3));

  return results;
}

/**
 * Returns only vehicles with expired or soon-to-expire documents.
 * Dashboard summary for fleet manager.
 */
export function getFleetExpiryAlerts({ warningDays = 30, db }) {
  const all = scanFleetCompliance({ warningDays, db });
  const flagged = all.filter(v => v.overallStatus !== "valid");

  return {
    total: flagged.length,
    expired: flagged.filter(v => v.overallStatus === "expired").length,
    expiringSoon: flagged.filter(v => v.overallStatus === "expiring_soon").length,
    vehicles: flagged
  };
}

// ── Facilities Maintenance Requests ─────────────────────────────────

const MAINTENANCE_STATES = ["Requested", "Approved", "In_Progress", "Completed", "Rejected"];

const MAINTENANCE_TRANSITIONS = {
  Requested:   ["Approved", "Rejected"],
  Approved:    ["In_Progress", "Rejected"],
  In_Progress: ["Completed"],
  Completed:   [],
  Rejected:    []
};

/**
 * Creates a facilities maintenance request.
 */
export function createMaintenanceRequest({
  vehicleId, requestType, description, priority, requestedBy, store, db
}) {
  if (!vehicleId)   throw Object.assign(new Error("vehicleId is required"),   { status: 400 });
  if (!requestType) throw Object.assign(new Error("requestType is required"), { status: 400 });
  if (!description) throw Object.assign(new Error("description is required"), { status: 400 });

  const vehicle = (db.vehicles || []).find(v => v.id === vehicleId);
  if (!vehicle) throw Object.assign(new Error("Vehicle not found"), { status: 404 });

  if (!db.maintenance_requests) db.maintenance_requests = [];

  const request = {
    id: `maint_${crypto.randomBytes(8).toString("hex")}`,
    vehicle_id: vehicleId,
    registration: vehicle.registration_number || null,
    request_type: requestType,  // scheduled_service, repair, tyre, body, electrical, other
    description,
    priority: priority || "normal",   // low, normal, high, critical
    status: "Requested",
    requested_by: requestedBy || null,
    approved_by: null,
    completed_by: null,
    completion_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.maintenance_requests.push(request);

  if (store && store.audit) {
    store.audit(db, { id: requestedBy || "system" }, "maintenance_requests", request.id,
      "MAINTENANCE_REQUESTED", null, { request_type: requestType, priority: request.priority });
  }

  return request;
}

/**
 * Transitions a maintenance request to a new state.
 */
export function transitionMaintenanceRequest({ requestId, newStatus, userId, notes, store, db }) {
  const req = (db.maintenance_requests || []).find(r => r.id === requestId);
  if (!req) throw Object.assign(new Error("Maintenance request not found"), { status: 404 });

  const allowed = MAINTENANCE_TRANSITIONS[req.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Invalid transition: ${req.status} → ${newStatus}`),
      { status: 409 }
    );
  }

  const before = { status: req.status };
  req.status = newStatus;
  req.updated_at = new Date().toISOString();

  if (newStatus === "Approved")     req.approved_by = userId;
  if (newStatus === "Completed") {
    req.completed_by = userId;
    req.completion_notes = notes || null;
  }

  if (store && store.audit) {
    store.audit(db, { id: userId || "system" }, "maintenance_requests", req.id,
      `MAINTENANCE_${newStatus.toUpperCase()}`, before, { status: newStatus });
  }

  return req;
}

/**
 * Lists maintenance requests with optional filters.
 */
export function listMaintenanceRequests({ vehicleId, status, db }) {
  let requests = db.maintenance_requests || [];
  if (vehicleId) requests = requests.filter(r => r.vehicle_id === vehicleId);
  if (status)    requests = requests.filter(r => r.status === status);
  return requests.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

export { MAINTENANCE_STATES };
