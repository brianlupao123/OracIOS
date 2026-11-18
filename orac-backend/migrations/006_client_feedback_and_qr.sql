-- Migration 006: Client Feedback, Net Promoter Score (NPS) & Universal QR Code Optical Engine (Subsystems 8 & 11)
-- Tracks customer satisfaction, supervisor triage alerts for low ratings, and optical QR tokens.

CREATE TABLE IF NOT EXISTS client_job_feedbacks (
    id VARCHAR(64) PRIMARY KEY,
    dispatch_card_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    equipment_tag_id VARCHAR(64),
    rating_stars INTEGER NOT NULL CHECK (rating_stars BETWEEN 1 AND 5),
    nps_score INTEGER NOT NULL CHECK (nps_score BETWEEN 0 AND 10),
    nps_category VARCHAR(16) NOT NULL,
    service_quality_score INTEGER CHECK (service_quality_score BETWEEN 1 AND 5),
    safety_compliance_score INTEGER CHECK (safety_compliance_score BETWEEN 1 AND 5),
    timeliness_score INTEGER CHECK (timeliness_score BETWEEN 1 AND 5),
    comments TEXT,
    triage_required BOOLEAN NOT NULL DEFAULT FALSE,
    triage_status VARCHAR(32) NOT NULL DEFAULT 'NONE',
    submitted_by_name VARCHAR(255),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_client ON client_job_feedbacks(client_id);
CREATE INDEX IF NOT EXISTS idx_feedback_dispatch ON client_job_feedbacks(dispatch_card_id);
CREATE INDEX IF NOT EXISTS idx_feedback_triage ON client_job_feedbacks(triage_required, triage_status);
CREATE INDEX IF NOT EXISTS idx_feedback_nps ON client_job_feedbacks(nps_category);

CREATE TABLE IF NOT EXISTS qr_optical_tokens (
    id VARCHAR(64) PRIMARY KEY,
    token_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    payload_signature VARCHAR(128) NOT NULL,
    qr_data_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_target ON qr_optical_tokens(target_id, token_type);
