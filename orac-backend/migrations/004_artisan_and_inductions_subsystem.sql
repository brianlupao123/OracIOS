-- Migration 004: HR Artisan Qualifications Vault & Mine Site Induction Safety Gates (Subsystem 6)
-- Enforces Sensitive Control S-10: Statutory Hard Gate blocking technician dispatch if mine site induction is expired or missing.

CREATE TABLE IF NOT EXISTS artisan_qualifications (
    id VARCHAR(64) PRIMARY KEY,
    technician_id VARCHAR(64) NOT NULL,
    technician_name VARCHAR(255) NOT NULL,
    trade_discipline VARCHAR(64) NOT NULL,
    qualification_type VARCHAR(64) NOT NULL,
    certificate_number VARCHAR(128) NOT NULL,
    issuing_authority VARCHAR(255) NOT NULL,
    issue_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    document_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'VALID',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artisan_qual_tech ON artisan_qualifications(technician_id);
CREATE INDEX IF NOT EXISTS idx_artisan_qual_expiry ON artisan_qualifications(expiry_date);
CREATE INDEX IF NOT EXISTS idx_artisan_qual_status ON artisan_qualifications(status);

CREATE TABLE IF NOT EXISTS mine_site_inductions (
    id VARCHAR(64) PRIMARY KEY,
    technician_id VARCHAR(64) NOT NULL,
    technician_name VARCHAR(255) NOT NULL,
    mine_site VARCHAR(64) NOT NULL,
    induction_card_number VARCHAR(128) NOT NULL,
    induction_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    medical_fit_to_work_pass BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(32) NOT NULL DEFAULT 'VALID',
    verified_by_supervisor_id VARCHAR(64),
    verified_by_supervisor_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mine_induct_tech_site ON mine_site_inductions(technician_id, mine_site);
CREATE INDEX IF NOT EXISTS idx_mine_induct_expiry ON mine_site_inductions(expiry_date);
CREATE INDEX IF NOT EXISTS idx_mine_induct_status ON mine_site_inductions(status);

CREATE TABLE IF NOT EXISTS artisan_dispatch_allocations (
    id VARCHAR(64) PRIMARY KEY,
    dispatch_card_id VARCHAR(64) NOT NULL,
    technician_id VARCHAR(64) NOT NULL,
    technician_name VARCHAR(255) NOT NULL,
    mine_site VARCHAR(64) NOT NULL,
    dispatch_date DATE NOT NULL,
    induction_verified BOOLEAN NOT NULL DEFAULT FALSE,
    induction_id VARCHAR(64) REFERENCES mine_site_inductions(id),
    gate_clearance_status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artisan_alloc_dispatch ON artisan_dispatch_allocations(dispatch_card_id);
CREATE INDEX IF NOT EXISTS idx_artisan_alloc_gate ON artisan_dispatch_allocations(gate_clearance_status);
