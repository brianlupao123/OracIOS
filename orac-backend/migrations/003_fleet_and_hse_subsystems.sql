-- ============================================================================
-- ORAC ERP Migration 003: Subsystems 4 & 5 (Fleet Logistics & HSE Compliance)
-- Idempotent DDL conforming to Heavy Industrial Service Management Invariants
-- ============================================================================

-- ── Subsystem 4: Fleet & Logistics ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR(64) PRIMARY KEY,
  plate_number VARCHAR(32) NOT NULL UNIQUE,
  make VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  year INTEGER,
  vehicle_type VARCHAR(64) NOT NULL, -- e.g. 4X4_FIELD_BAKKIE, HEAVY_HAULAGE_15T, MOBILE_CRANE, LIGHT_VEHICLE
  current_odometer_km NUMERIC(10, 1) DEFAULT 0.0,
  vid_certificate_number VARCHAR(64) NOT NULL,
  vid_expiry_date DATE NOT NULL, -- S-12 Sensitive Control: VID Roadworthiness Expiry Gate
  insurance_expiry_date DATE NOT NULL,
  status VARCHAR(32) DEFAULT 'AVAILABLE', -- AVAILABLE, DISPATCHED, MAINTENANCE, GROUNDED
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_vid_expiry ON vehicles(vid_expiry_date);

CREATE TABLE IF NOT EXISTS vehicle_dispatches (
  id VARCHAR(64) PRIMARY KEY,
  trip_number VARCHAR(32) NOT NULL UNIQUE,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id),
  dispatch_card_id VARCHAR(64), -- Links directly to ORAC service job card
  driver_id VARCHAR(64) NOT NULL,
  driver_name VARCHAR(128) NOT NULL,
  destination VARCHAR(255) NOT NULL, -- e.g. Zimplats SMC Selous, Mimosa Concentrator, Unki Mine
  purpose VARCHAR(255) NOT NULL,
  departure_odometer_km NUMERIC(10, 1) NOT NULL,
  return_odometer_km NUMERIC(10, 1),
  status VARCHAR(32) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, ABORTED
  departed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  returned_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_vdispatches_vehicle ON vehicle_dispatches(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vdispatches_card ON vehicle_dispatches(dispatch_card_id);
CREATE INDEX IF NOT EXISTS idx_vdispatches_status ON vehicle_dispatches(status);

CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
  id VARCHAR(64) PRIMARY KEY,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id),
  voucher_number VARCHAR(64) NOT NULL,
  litres NUMERIC(8, 2) NOT NULL,
  cost_usd NUMERIC(10, 2) NOT NULL, -- Enforces USD currency guard S-08
  odometer_km NUMERIC(10, 1) NOT NULL,
  logged_by VARCHAR(64) NOT NULL,
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vfuel_vehicle ON vehicle_fuel_logs(vehicle_id);

-- ── Subsystem 5: Health, Safety & Environment (HSE) ─────────────────────────

CREATE TABLE IF NOT EXISTS pre_dispatch_ppe_checklists (
  id VARCHAR(64) PRIMARY KEY,
  checklist_number VARCHAR(32) NOT NULL UNIQUE,
  dispatch_card_id VARCHAR(64) NOT NULL,
  technician_id VARCHAR(64) NOT NULL,
  technician_name VARCHAR(128) NOT NULL,
  supervisor_id VARCHAR(64) NOT NULL,
  supervisor_name VARCHAR(128) NOT NULL,
  site_location VARCHAR(128) NOT NULL,
  hard_hat_pass BOOLEAN NOT NULL DEFAULT FALSE,
  metatarsal_boots_pass BOOLEAN NOT NULL DEFAULT FALSE,
  heavy_chemical_gloves_pass BOOLEAN NOT NULL DEFAULT FALSE,
  safety_glasses_pass BOOLEAN NOT NULL DEFAULT FALSE,
  high_vis_vest_pass BOOLEAN NOT NULL DEFAULT FALSE,
  respirator_mask_pass BOOLEAN NOT NULL DEFAULT FALSE,
  ear_protection_pass BOOLEAN NOT NULL DEFAULT FALSE,
  fall_arrest_harness_pass BOOLEAN NOT NULL DEFAULT FALSE,
  all_items_passed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL, -- PASSED, FAILED_BLOCKED (S-11 Pre-dispatch gate)
  inspected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppe_dispatch_card ON pre_dispatch_ppe_checklists(dispatch_card_id);
CREATE INDEX IF NOT EXISTS idx_ppe_technician ON pre_dispatch_ppe_checklists(technician_id);
CREATE INDEX IF NOT EXISTS idx_ppe_status ON pre_dispatch_ppe_checklists(status);

CREATE TABLE IF NOT EXISTS toolbox_talks (
  id VARCHAR(64) PRIMARY KEY,
  talk_number VARCHAR(32) NOT NULL UNIQUE,
  talk_date DATE NOT NULL,
  topic VARCHAR(255) NOT NULL, -- e.g. LOTO Lockout-Tagout, Cold Splicing Solvent Fumes, Working at Heights
  supervisor_id VARCHAR(64) NOT NULL,
  supervisor_name VARCHAR(128) NOT NULL,
  site_location VARCHAR(128) NOT NULL,
  attendees JSONB NOT NULL DEFAULT '[]', -- Array of { technician_id, name, signature_present }
  hazards_identified TEXT NOT NULL,
  control_measures TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toolbox_date ON toolbox_talks(talk_date);
CREATE INDEX IF NOT EXISTS idx_toolbox_supervisor ON toolbox_talks(supervisor_id);

CREATE TABLE IF NOT EXISTS hse_incident_reports (
  id VARCHAR(64) PRIMARY KEY,
  incident_number VARCHAR(32) NOT NULL UNIQUE,
  incident_date TIMESTAMP WITH TIME ZONE NOT NULL,
  site_location VARCHAR(128) NOT NULL,
  severity VARCHAR(32) NOT NULL, -- NEAR_MISS, FIRST_AID, LOST_TIME_INJURY, FATALITY
  description TEXT NOT NULL,
  immediate_action_taken TEXT NOT NULL,
  root_cause TEXT,
  corrective_preventative_action TEXT,
  investigated_by VARCHAR(64),
  status VARCHAR(32) DEFAULT 'OPEN', -- OPEN, UNDER_INVESTIGATION, CLOSED
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_severity ON hse_incident_reports(severity);
CREATE INDEX IF NOT EXISTS idx_incident_status ON hse_incident_reports(status);
