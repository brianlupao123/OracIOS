-- Migration 007: Subsystems 12 & 13 (Plant IoT Telemetry, Condition Monitoring & Offline Sync Journal)
-- Idempotent DDL for PostgreSQL / Dual-mode store

CREATE TABLE IF NOT EXISTS iot_sensor_telemetries (
    id VARCHAR(64) PRIMARY KEY,
    sensor_id VARCHAR(64) NOT NULL,
    equipment_tag_id VARCHAR(64) NOT NULL,
    equipment_tag_name VARCHAR(255),
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    mine_site VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    vibration_rms_mms NUMERIC(8, 3) NOT NULL,
    bearing_temp_celsius NUMERIC(6, 2) NOT NULL,
    casing_wear_depth_mm NUMERIC(6, 2) NOT NULL,
    pump_flow_rate_m3h NUMERIC(8, 2),
    status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS iot_threshold_alerts (
    id VARCHAR(64) PRIMARY KEY,
    telemetry_id VARCHAR(64) NOT NULL REFERENCES iot_sensor_telemetries(id),
    equipment_tag_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(64),
    mine_site VARCHAR(64),
    alert_type VARCHAR(64) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    trigger_metric VARCHAR(64) NOT NULL,
    trigger_value NUMERIC(10, 3) NOT NULL,
    threshold_value NUMERIC(10, 3) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    auto_quote_id VARCHAR(64),
    resolution_notes TEXT,
    resolved_by_id VARCHAR(64),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offline_sync_journal (
    id VARCHAR(64) PRIMARY KEY,
    client_mutation_id VARCHAR(64) NOT NULL UNIQUE,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    operation VARCHAR(32) NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(32) NOT NULL DEFAULT 'COMMITTED',
    conflict_details JSONB,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_iot_telemetry_tag ON iot_sensor_telemetries(equipment_tag_id);
CREATE INDEX IF NOT EXISTS idx_iot_alerts_status ON iot_threshold_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sync_journal_entity ON offline_sync_journal(entity_type, entity_id);
