// backend/src/controllers/surveyController.js
//
// Controller for Subsystem 10: Virtual Technical Surveys & AI Scope Extraction.
// Integrates MediVital WebRTC video rooms and Dash AI transcript analysis.

import {
  BookVirtualSurveySchema,
  CompleteSurveyWithNotesSchema,
  ExtractSurveyAiScopeSchema
} from "../schemas.js";

import {
  provisionDailyRoom,
  generateMeetingToken,
  meetingEndMs,
  surveyStartMs
} from "../services/videoMeetingService.js";

import {
  extractWearScopeFromTranscript,
  generateDraftQuoteFromSurvey
} from "../services/meetingAiService.js";

function resolveActor(req) {
  if (!req.user?.id) return null;
  return (req.db?.users || []).find((user) => user.id === req.user.id) || null;
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor", "Sales"]) {
  if (!actor) {
    const err = new Error("Unauthorized. Authentication required.");
    err.statusCode = 401;
    throw err;
  }
  if (actor.is_active === false || !allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

function checkSurveyClient(actor, clientId = actor.client_id) {
  if (actor.role === "Client Viewer" && (!actor.client_id || clientId !== actor.client_id)) {
    const err = new Error("Forbidden: Survey access requires matching client ownership.");
    err.statusCode = 403;
    throw err;
  }
}


export const bookSurvey = async (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Client Viewer"]);

    const parseResult = BookVirtualSurveySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid survey booking data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    checkSurveyClient(actor, val.client_id);
    const startsAt = surveyStartMs(val.scheduled_at);
    if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
      return res.status(400).json({ success: false, message: "Enter a future survey date and time." });
    }
    const scheduledAt = new Date(startsAt).toISOString();
    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];

    const surveyId = req.store.id("srv");
    const surveyNumber = `VTS-${Date.now().toString().slice(-6)}`;

    // Provision Daily.co WebRTC video room
    const room = await provisionDailyRoom(surveyId, `orac-${surveyId}`, val.duration_minutes, scheduledAt);

    const record = {
      id: surveyId,
      survey_number: surveyNumber,
      client_id: val.client_id,
      client_name: val.client_name,
      equipment_tag_id: val.equipment_tag_id,
      equipment_tag_name: val.equipment_tag_name,
      mine_site: val.mine_site,
      scheduled_at: scheduledAt,
      duration_minutes: val.duration_minutes,
      meeting_room_name: room.room_name,
      meeting_room_url: room.room_url,
      meeting_is_mock: room.is_mock,
      status: "SCHEDULED",
      host_specialist_id: val.host_specialist_id,
      host_specialist_name: val.host_specialist_name,
      client_engineer_name: val.client_engineer_name,
      client_engineer_email: val.client_engineer_email || null,
      wear_assessment_notes: null,
      wear_depth_mm: null,
      recommended_lining_spec: null,
      ai_minutes_transcript: null,
      ai_extracted_scope: null,
      linked_quote_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    req.db.virtual_technical_surveys.push(record);
    req.store.audit(req.db, actor, "virtual_technical_survey", record.id, "SURVEY_BOOKED", null, record);

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listSurveys = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Client Viewer"]);

    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    let list = [...req.db.virtual_technical_surveys];

    // Scoping for Client Viewer
    checkSurveyClient(actor);
    if (actor.role === "Client Viewer") {
      list = list.filter((s) => s.client_id === actor.client_id);
    } else if (req.query.client_id) {
      list = list.filter((s) => s.client_id === req.query.client_id);
    }

    if (req.query.status) {
      list = list.filter((s) => s.status === req.query.status);
    }

    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getSurveyMeetingAccess = async (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Client Viewer"]);

    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    const survey = req.db.virtual_technical_surveys.find((s) => s.id === req.params.id);

    if (!survey) {
      return res.status(404).json({ success: false, message: "Survey not found" });
    }

    checkSurveyClient(actor, survey.client_id ?? "");
    const endsAt = meetingEndMs(survey.scheduled_at, survey.duration_minutes);
    if (survey.meeting_is_mock || (survey.status && survey.status !== "SCHEDULED")
        || (Number.isFinite(endsAt) && endsAt <= Date.now())) {
      return res.status(409).json({ success: false, message: "This survey has no active video room." });
    }

    const isHost = actor.role !== "Client Viewer"
      && (actor.id === survey.host_specialist_id || ["Admin", "Management"].includes(actor.role));
    const tokenInfo = await generateMeetingToken(
      survey.meeting_room_name, actor.name, isHost, Number.isFinite(endsAt) ? endsAt : undefined
    );
    res.setHeader?.("Cache-Control", "no-store");

    return res.json({
      success: true,
      data: {
        survey_id: survey.id,
        survey_number: survey.survey_number,
        room_url: survey.meeting_room_url,
        token: tokenInfo.token,
        is_mock: tokenInfo.is_mock,
        is_host: isHost
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const completeSurveyWithNotes = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales"]);

    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    const survey = req.db.virtual_technical_surveys.find((s) => s.id === req.params.id);

    if (!survey) {
      return res.status(404).json({ success: false, message: "Survey not found" });
    }

    const parseResult = CompleteSurveyWithNotesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid survey notes",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    survey.wear_assessment_notes = val.wear_assessment_notes;
    survey.wear_depth_mm = val.wear_depth_mm;
    survey.recommended_lining_spec = val.recommended_lining_spec;
    survey.status = "COMPLETED";
    survey.updated_at = new Date().toISOString();

    req.store.audit(req.db, actor, "virtual_technical_survey", survey.id, "SURVEY_COMPLETED_WITH_NOTES", null, {
      wear_depth_mm: survey.wear_depth_mm,
      spec: survey.recommended_lining_spec
    });

    return res.json({ success: true, data: survey });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const extractSurveyAiScopeAndDraftQuote = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales"]);

    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    const survey = req.db.virtual_technical_surveys.find((s) => s.id === req.params.id);

    if (!survey) {
      return res.status(404).json({ success: false, message: "Survey not found" });
    }

    const parseResult = ExtractSurveyAiScopeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid transcript data",
        errors: parseResult.error.issues
      });
    }

    const { transcript_text, auto_create_quote } = parseResult.data;
    survey.ai_minutes_transcript = transcript_text;

    // Run AI Scope Extractor
    const extractedScope = extractWearScopeFromTranscript(transcript_text, {
      equipment_tag_id: survey.equipment_tag_id,
      equipment_tag_name: survey.equipment_tag_name
    });

    survey.ai_extracted_scope = extractedScope;
    survey.wear_depth_mm = extractedScope.measured_wear_depth_mm;
    survey.recommended_lining_spec = extractedScope.recommended_lining_spec;
    survey.status = "COMPLETED";
    survey.updated_at = new Date().toISOString();

    let quoteResult = null;
    if (auto_create_quote) {
      quoteResult = generateDraftQuoteFromSurvey(survey, extractedScope, req.db, req.store, actor);
    }

    return res.json({
      success: true,
      data: {
        survey,
        extracted_scope: extractedScope,
        created_quote: quoteResult ? quoteResult.quote : null
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getSurveySummary = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales"]);

    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    const list = req.db.virtual_technical_surveys;

    const summary = {
      total_surveys: list.length,
      scheduled_surveys: list.filter((s) => s.status === "SCHEDULED").length,
      completed_surveys: list.filter((s) => s.status === "COMPLETED").length,
      quotes_drafted_from_ai: list.filter((s) => Boolean(s.linked_quote_id)).length
    };

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
