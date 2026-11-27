// backend/src/controllers/surveyController.js
//
// Controller for Subsystem 10: Virtual Technical Surveys & AI Scope Extraction.
// Integrates MediVital WebRTC video rooms and Dash AI transcript analysis.

import {
  BookVirtualSurveySchema,
  ConvertBookingToSurveySchema,
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

export function checkSpecialistConflict(surveys = [], specialistId, startsAtMs, durationMinutes = 60, excludeSurveyId = null) {
  if (!specialistId || !Number.isFinite(startsAtMs)) return null;
  const candidateEnd = startsAtMs + (durationMinutes || 60) * 60_000;
  for (const s of surveys) {
    if (excludeSurveyId && s.id === excludeSurveyId) continue;
    if (s.host_specialist_id !== specialistId) continue;
    if (s.status === "CANCELLED") continue;
    const existingStart = surveyStartMs(s.scheduled_at);
    if (!Number.isFinite(existingStart)) continue;
    const existingEnd = existingStart + (s.duration_minutes || 60) * 60_000;
    if (startsAtMs < existingEnd && candidateEnd > existingStart) {
      return s;
    }
  }
  return null;
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

    const conflict = checkSpecialistConflict(req.db.virtual_technical_surveys, val.host_specialist_id, startsAt, val.duration_minutes);
    if (conflict) {
      return res.status(409).json({
        success: false,
        code: "SPECIALIST_SCHEDULE_CONFLICT",
        message: "Assigned specialist already has a consultation scheduled during this time.",
        conflicting_survey_id: conflict.id
      });
    }

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

export const convertBookingToSurvey = async (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Sales"]);

    const parseResult = ConvertBookingToSurveySchema.safeParse({
      ...req.body,
      booking_id: req.params?.id || req.body?.booking_id
    });
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid booking conversion data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    const bookingId = val.booking_id;
    if (!bookingId) {
      return res.status(400).json({ success: false, message: "Booking ID is required." });
    }

    req.db.survey_bookings = req.db.survey_bookings || [];
    req.db.virtual_technical_surveys = req.db.virtual_technical_surveys || [];
    req.db.leads = req.db.leads || [];
    req.db.clients = req.db.clients || [];

    const booking = req.db.survey_bookings.find((b) => b.id === bookingId || b.reference === bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    }

    if (booking.slot_status === "cancelled") {
      return res.status(409).json({ success: false, code: "BOOKING_CANCELLED", message: "Cannot convert a cancelled booking." });
    }

    const client = req.db.clients.find((c) => c.id === val.client_id);
    if (!client) {
      return res.status(404).json({ success: false, code: "CLIENT_NOT_FOUND", message: "Client not found." });
    }

    // Idempotent retry: if booking was already converted, safely return existing consultation
    const existing = req.db.virtual_technical_surveys.find((s) => s.booking_id === booking.id || s.id === booking.survey_id);
    if (existing) {
      return res.status(200).json({
        success: true,
        data: existing,
        already_converted: true,
        message: "Booking was already converted to a consultation."
      });
    }

    const slotStr = `${booking.slot_date}T${booking.slot_time}`;
    const startsAt = surveyStartMs(slotStr);
    if (!Number.isFinite(startsAt)) {
      return res.status(400).json({ success: false, message: "Booking has an invalid slot date or time." });
    }
    const scheduledAt = new Date(startsAt).toISOString();
    const durationMinutes = val.duration_minutes || 60;

    const conflict = checkSpecialistConflict(req.db.virtual_technical_surveys, val.host_specialist_id, startsAt, durationMinutes);
    if (conflict) {
      return res.status(409).json({
        success: false,
        code: "SPECIALIST_SCHEDULE_CONFLICT",
        message: "Assigned specialist already has a consultation scheduled during this time.",
        conflicting_survey_id: conflict.id
      });
    }

    const surveyId = req.store.id("srv");
    const surveyNumber = `VTS-${Date.now().toString().slice(-6)}`;
    const room = await provisionDailyRoom(surveyId, `orac-${surveyId}`, durationMinutes, scheduledAt);

    const lead = req.db.leads.find((l) => l.id === booking.lead_id || (l.booking_reference && l.booking_reference === booking.reference));
    const specialistUser = (req.db.users || []).find((u) => u.id === val.host_specialist_id);
    const hostSpecialistName = val.host_specialist_name || specialistUser?.name || "Lead Rubber Lining Specialist";

    const survey = {
      id: surveyId,
      survey_number: surveyNumber,
      client_id: val.client_id,
      client_name: val.client_name || client.name || client.company_name || booking.company_name || "Client",
      equipment_tag_id: val.equipment_tag_id || "TAG-GENERAL",
      equipment_tag_name: val.equipment_tag_name || booking.survey_type || "Technical Survey Equipment",
      mine_site: val.mine_site || booking.site_location || client.mine_site || "Main Site",
      scheduled_at: scheduledAt,
      duration_minutes: durationMinutes,
      meeting_room_name: room.room_name,
      meeting_room_url: room.room_url,
      meeting_is_mock: room.is_mock,
      status: "SCHEDULED",
      host_specialist_id: val.host_specialist_id,
      host_specialist_name: hostSpecialistName,
      client_engineer_name: val.client_engineer_name || booking.contact_name || "",
      client_engineer_email: val.client_engineer_email || booking.email || null,
      booking_id: booking.id,
      booking_reference: booking.reference,
      lead_id: lead ? lead.id : null,
      source: "public_booking_conversion",
      wear_assessment_notes: null,
      wear_depth_mm: null,
      recommended_lining_spec: null,
      ai_minutes_transcript: null,
      ai_extracted_scope: null,
      linked_quote_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    req.db.virtual_technical_surveys.push(survey);

    const prevBookingStatus = booking.slot_status;
    booking.survey_id = survey.id;
    if (booking.slot_status === "requested") {
      booking.slot_status = "confirmed";
    }
    booking.updated_at = new Date().toISOString();

    if (lead) {
      lead.survey_id = survey.id;
      if (lead.status === "New") {
        lead.status = "In Progress";
      }
      lead.updated_at = new Date().toISOString();
    }

    req.store.audit(req.db, actor, "virtual_technical_survey", survey.id, "SURVEY_CONVERTED_FROM_BOOKING", null, {
      booking_id: booking.id,
      lead_id: lead?.id,
      survey_number: survey.survey_number
    });
    req.store.audit(req.db, actor, "survey_booking", booking.id, "SURVEY_SLOT_CONVERTED", { slot_status: prevBookingStatus }, {
      slot_status: booking.slot_status,
      survey_id: survey.id
    });

    return res.status(201).json({ success: true, data: survey });
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
