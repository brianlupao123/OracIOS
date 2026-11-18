-- ==============================================================================
-- ORAC Industrial ERP - Subsystem 3: Supply Chain & Procurement Migration
-- File: backend/migrations/002_procurement_subsystem.sql
-- Idempotent DDL Schema for PostgreSQL dual-mode store
-- ==============================================================================

-- 1. Procurement Requests (PR)
CREATE TABLE IF NOT EXISTS procurement_requests (
    id VARCHAR(64) PRIMARY KEY,
    pr_number VARCHAR(32) NOT NULL UNIQUE,
    department VARCHAR(128) NOT NULL,
    priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    justification TEXT NOT NULL,
    required_by_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PO_ISSUED', 'CANCELLED')),
    total_estimated_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    requested_by VARCHAR(64) NOT NULL,
    requested_by_name VARCHAR(128),
    supplier_po_id VARCHAR(64),
    approval_action VARCHAR(16),
    approval_decided_by VARCHAR(64),
    approval_decided_by_name VARCHAR(128),
    approval_decided_at TIMESTAMPTZ,
    approval_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS procurement_request_items (
    id VARCHAR(64) PRIMARY KEY,
    procurement_request_id VARCHAR(64) NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    item_code VARCHAR(64) DEFAULT '',
    category VARCHAR(64) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    unit_of_measure VARCHAR(32) NOT NULL,
    estimated_unit_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_estimated NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    suggested_supplier_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Supplier Purchase Orders (PO)
CREATE TABLE IF NOT EXISTS supplier_pos (
    id VARCHAR(64) PRIMARY KEY,
    po_number VARCHAR(32) NOT NULL UNIQUE,
    procurement_request_id VARCHAR(64) REFERENCES procurement_requests(id) ON DELETE SET NULL,
    supplier_id VARCHAR(64) NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    payment_terms VARCHAR(64) NOT NULL DEFAULT 'Net 30',
    expected_delivery_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED')),
    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_po_items (
    id VARCHAR(64) PRIMARY KEY,
    supplier_po_id VARCHAR(64) NOT NULL REFERENCES supplier_pos(id) ON DELETE CASCADE,
    item_code VARCHAR(64) NOT NULL,
    description VARCHAR(255) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    unit_of_measure VARCHAR(32) NOT NULL,
    tax_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0000,
    total_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Goods Received Notes (GRN)
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id VARCHAR(64) PRIMARY KEY,
    grn_number VARCHAR(32) NOT NULL UNIQUE,
    supplier_po_id VARCHAR(64) NOT NULL REFERENCES supplier_pos(id) ON DELETE RESTRICT,
    po_number VARCHAR(32) NOT NULL,
    supplier_id VARCHAR(64) NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    delivery_note_ref VARCHAR(128) NOT NULL,
    received_date DATE NOT NULL,
    received_by VARCHAR(64) NOT NULL,
    received_by_name VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goods_received_note_items (
    id VARCHAR(64) PRIMARY KEY,
    grn_id VARCHAR(64) NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,
    item_code VARCHAR(64) NOT NULL,
    description VARCHAR(255),
    received_quantity NUMERIC(12, 3) NOT NULL CHECK (received_quantity >= 0),
    rejected_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (rejected_quantity >= 0),
    rejection_reason TEXT,
    stock_item_id VARCHAR(64),
    storage_location VARCHAR(128) DEFAULT 'Depot Central Stores',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Store Issue Vouchers (SIV)
CREATE TABLE IF NOT EXISTS store_issue_vouchers (
    id VARCHAR(64) PRIMARY KEY,
    siv_number VARCHAR(32) NOT NULL UNIQUE,
    dispatch_card_id VARCHAR(64),
    technician_id VARCHAR(64) NOT NULL,
    requested_by VARCHAR(128) NOT NULL,
    purpose TEXT NOT NULL,
    issued_by VARCHAR(64) NOT NULL,
    issued_by_name VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_issue_voucher_items (
    id VARCHAR(64) PRIMARY KEY,
    siv_id VARCHAR(64) NOT NULL REFERENCES store_issue_vouchers(id) ON DELETE CASCADE,
    stock_item_id VARCHAR(64) NOT NULL,
    item_code VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity_issued NUMERIC(12, 3) NOT NULL CHECK (quantity_issued > 0),
    unit_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    line_total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Three-Way Matching Audit Ledger
CREATE TABLE IF NOT EXISTS three_way_matches (
    id VARCHAR(64) PRIMARY KEY,
    supplier_po_id VARCHAR(64) NOT NULL REFERENCES supplier_pos(id) ON DELETE RESTRICT,
    grn_id VARCHAR(64) NOT NULL REFERENCES goods_received_notes(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(64) NOT NULL,
    invoice_total NUMERIC(14, 2) NOT NULL,
    po_subtotal NUMERIC(14, 2) NOT NULL,
    grn_verified_value NUMERIC(14, 2) NOT NULL,
    variance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    is_match BOOLEAN NOT NULL DEFAULT FALSE,
    match_status VARCHAR(32) NOT NULL CHECK (match_status IN ('MATCH_PASSED', 'DISCREPANCY_BLOCKED', 'OVERRIDDEN_BY_ADMIN')),
    discrepancies JSONB DEFAULT '[]'::jsonb,
    line_analysis JSONB DEFAULT '[]'::jsonb,
    audited_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning-fast lookups (<15ms)
CREATE INDEX IF NOT EXISTS idx_pr_status ON procurement_requests(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON supplier_pos(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON supplier_pos(status);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_received_notes(supplier_po_id);
CREATE INDEX IF NOT EXISTS idx_grn_dn_ref ON goods_received_notes(delivery_note_ref);
CREATE INDEX IF NOT EXISTS idx_siv_dispatch ON store_issue_vouchers(dispatch_card_id);
CREATE INDEX IF NOT EXISTS idx_three_way_match_po ON three_way_matches(supplier_po_id);
