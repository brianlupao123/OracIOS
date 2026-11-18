import {
  CreateVehicleSchema,
  DispatchVehicleSchema,
  ReturnVehicleSchema,
  LogFuelSchema
} from "../../../schemas.js";

function getActor(req) {
  if (!req.db || !req.db.users) return { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
  const u = req.db.users.find((user) => user.id === req.user?.id);
  return u || { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor"]) {
  if (!actor || !allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

export const createVehicle = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations"]);

    const parseResult = CreateVehicleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid vehicle data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.vehicles = req.db.vehicles || [];

    const existing = req.db.vehicles.find((v) => v.plate_number.toUpperCase() === val.plate_number.toUpperCase());
    if (existing) {
      return res.status(409).json({ success: false, message: `Vehicle with plate '${val.plate_number}' already registered` });
    }

    const vehicleId = req.store.id("veh");
    const vehicle = {
      id: vehicleId,
      plate_number: val.plate_number.toUpperCase(),
      make: val.make,
      model: val.model,
      year: val.year,
      vehicle_type: val.vehicle_type,
      current_odometer_km: Number(val.current_odometer_km) || 0.0,
      vid_certificate_number: val.vid_certificate_number,
      vid_expiry_date: val.vid_expiry_date,
      insurance_expiry_date: val.insurance_expiry_date,
      status: "AVAILABLE",
      created_at: new Date().toISOString()
    };

    req.db.vehicles.push(vehicle);
    req.store.audit(req.db, actor, "vehicle", vehicle.id, "VEHICLE_REGISTERED", null, vehicle);

    return res.status(201).json({ success: true, data: vehicle });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listVehicles = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Finance", "Technician"]);
    req.db.vehicles = req.db.vehicles || [];
    return res.json({ success: true, data: req.db.vehicles });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── S-12 Sensitive Control: Vehicle VID Roadworthiness Expiry Gate ────────────

export const dispatchVehicle = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const parseResult = DispatchVehicleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid dispatch data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.vehicles = req.db.vehicles || [];
    req.db.vehicle_dispatches = req.db.vehicle_dispatches || [];

    const vehicle = req.db.vehicles.find((v) => v.id === val.vehicle_id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    // S-12 Hard Stop: Check VID Roadworthiness Certificate Expiry
    const today = new Date().toISOString().slice(0, 10);
    if (vehicle.vid_expiry_date < today) {
      return res.status(403).json({
        success: false,
        code: "VID_EXPIRED_LOCK",
        message: `Vehicle dispatch blocked: VID roadworthiness certificate expired on ${vehicle.vid_expiry_date}. Vehicle is grounded until re-inspected by VID.`
      });
    }

    // Check Insurance Expiry
    if (vehicle.insurance_expiry_date < today) {
      return res.status(403).json({
        success: false,
        code: "INSURANCE_EXPIRED_LOCK",
        message: `Vehicle dispatch blocked: Insurance policy expired on ${vehicle.insurance_expiry_date}.`
      });
    }

    if (vehicle.status !== "AVAILABLE") {
      return res.status(409).json({
        success: false,
        message: `Cannot dispatch vehicle in status '${vehicle.status}'`
      });
    }

    const tripId = req.store.id("trip");
    const tripNumber = `TRIP-${Date.now().toString().slice(-6)}`;

    const dispatch = {
      id: tripId,
      trip_number: tripNumber,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      dispatch_card_id: val.dispatch_card_id || null,
      driver_id: val.driver_id,
      driver_name: val.driver_name,
      destination: val.destination,
      purpose: val.purpose,
      departure_odometer_km: Number(val.departure_odometer_km),
      return_odometer_km: null,
      status: "ACTIVE",
      departed_at: new Date().toISOString(),
      returned_at: null
    };

    vehicle.status = "DISPATCHED";
    vehicle.current_odometer_km = Number(val.departure_odometer_km);

    req.db.vehicle_dispatches.push(dispatch);
    req.store.audit(req.db, actor, "vehicle_dispatch", dispatch.id, "VEHICLE_DISPATCHED", null, dispatch);

    return res.status(201).json({ success: true, data: dispatch });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const returnVehicle = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const { id } = req.params; // dispatch trip ID
    const parseResult = ReturnVehicleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid return data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.vehicle_dispatches = req.db.vehicle_dispatches || [];
    req.db.vehicles = req.db.vehicles || [];

    const trip = req.db.vehicle_dispatches.find((t) => t.id === id);
    if (!trip) {
      return res.status(404).json({ success: false, message: "Vehicle trip record not found" });
    }

    if (trip.status !== "ACTIVE") {
      return res.status(409).json({ success: false, message: `Trip is already in status '${trip.status}'` });
    }

    if (val.return_odometer_km < trip.departure_odometer_km) {
      return res.status(400).json({
        success: false,
        message: `Return odometer (${val.return_odometer_km} km) cannot be less than departure odometer (${trip.departure_odometer_km} km)`
      });
    }

    const vehicle = req.db.vehicles.find((v) => v.id === trip.vehicle_id);
    if (vehicle) {
      vehicle.status = "AVAILABLE";
      vehicle.current_odometer_km = Number(val.return_odometer_km);
    }

    trip.status = "COMPLETED";
    trip.return_odometer_km = Number(val.return_odometer_km);
    trip.return_notes = val.return_notes || null;
    trip.distance_travelled_km = Number((val.return_odometer_km - trip.departure_odometer_km).toFixed(1));
    trip.returned_at = new Date().toISOString();

    req.store.audit(req.db, actor, "vehicle_dispatch", trip.id, "VEHICLE_RETURNED", null, trip);

    return res.json({ success: true, data: trip });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const logFuel = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Finance"]);

    const parseResult = LogFuelSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid fuel log data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.vehicles = req.db.vehicles || [];
    req.db.vehicle_fuel_logs = req.db.vehicle_fuel_logs || [];

    const vehicle = req.db.vehicles.find((v) => v.id === val.vehicle_id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    const logId = req.store.id("fuel");
    const fuelLog = {
      id: logId,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      voucher_number: val.voucher_number,
      litres: Number(val.litres),
      cost_usd: Number(val.cost_usd),
      currency: "USD",
      odometer_km: Number(val.odometer_km),
      logged_by: actor.id,
      logged_by_name: actor.name,
      logged_at: new Date().toISOString()
    };

    req.db.vehicle_fuel_logs.push(fuelLog);
    req.store.audit(req.db, actor, "vehicle_fuel_log", fuelLog.id, "FUEL_LOGGED", null, fuelLog);

    return res.status(201).json({ success: true, data: fuelLog });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getFleetSummary = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Finance"]);

    const vehicles = req.db.vehicles || [];
    const trips = req.db.vehicle_dispatches || [];
    const fuelLogs = req.db.vehicle_fuel_logs || [];

    const summary = {
      total_vehicles: vehicles.length,
      available_vehicles: vehicles.filter((v) => v.status === "AVAILABLE").length,
      dispatched_vehicles: vehicles.filter((v) => v.status === "DISPATCHED").length,
      maintenance_vehicles: vehicles.filter((v) => v.status === "MAINTENANCE" || v.status === "GROUNDED").length,
      active_trips: trips.filter((t) => t.status === "ACTIVE").length,
      completed_trips: trips.filter((t) => t.status === "COMPLETED").length,
      total_fuel_usd: Number(fuelLogs.reduce((sum, f) => sum + (f.cost_usd || 0), 0).toFixed(2))
    };

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
