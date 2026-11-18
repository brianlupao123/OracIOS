-- Migration 005: Virtual Technical Surveys & AI Scope Extraction (Subsystem 10)
-- Links remote WebRTC CAD inspections with automatic USD quotation draft generation.

CREATE TABLE IF NOT EXISTS virtual_technical_surveys (
    id VARCHAR(64) PRIMARY KEY,
    survey_number VARCHAR(128) NOT NULL UNIQUE,
    client_id VARCHAR(64) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    equipment_tag_id VARCHAR(64) NOT NULL,
    equipment_tag_name VARCHAR(255) NOT NULL,
    mine_site VARCHAR(64) NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    meeting_room_name VARCHAR(128),
    meeting_room_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    host_specialist_id VARCHAR(64) NOT NULL,
    host_specialist_name VARCHAR(255) NOT NULL,
    client_engineer_name VARCHAR(255) NOT NULL,
    client_engineer_email VARCHAR(255),
    wear_assessment_notes TEXT,
    wear_depth_mm NUMERIC(8, 2),
    recommended_lining_spec VARCHAR(255),
    ai_minutes_transcript TEXT,
    ai_extracted_scope JSONB,
    linked_quote_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveys_client ON virtual_technical_surveys(client_id);
CREATE INDEX IF NOT EXISTS idx_surveys_equipment ON virtual_technical_surveys(equipment_tag_id);
CREATE INDEX IF NOT EXISTS idx_surveys_status ON virtual_technical_surveys(status);
CREATE INDEX IF NOT EXISTS idx_surveys_scheduled ON virtual_technical_surveys(scheduled_at);
