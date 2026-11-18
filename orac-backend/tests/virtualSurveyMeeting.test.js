// backend/tests/virtualSurveyMeeting.test.js
//
// Subsystem 10: Virtual Technical Surveys & AI Minutes
// Tests remote consultation booking, WebRTC Daily.co room provisioning,
// technical wear assessments, and Dash AI automated quotation scope extraction.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bookSurvey,
  listSurveys,
  getSurveyMeetingAccess,
  completeSurveyWithNotes,
  extractSurveyAiScopeAndDraftQuote,
  getSurveySummary
} from "../src/controllers/surveyController.js";

import {
  provisionDailyRoom,
  generateMeetingToken
} from "../src/services/videoMeetingService.js";

import {
  extractWearScopeFromTranscript,
  generateDraftQuoteFromSurvey
} from "../src/services/meetingAiService.js";

function createMockReqRes({ user, body = {}, params = {}, query = {}, db = {} }) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    user: user || { id: "u-specialist", role: "Operations", name: "Technical Specialist" },
    body,
    params,
    query,
    db: {
      users: [
        { id: "u-specialist", role: "Operations", name: "Technical Specialist" },
        { id: "u-client", role: "Client Viewer", name: "Plant Engineer", client_id: "c-zimplats" }
      ],
      virtual_technical_surveys: [],
      quotes: [],
      quote_lines: [],
      audit_logs: [],
      ...db
    },
    store: {
      id(prefix) {
        return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
      },
      audit(dbObj, actor, entityType, entityId, action, oldV, newV) {
        dbObj.audit_logs = dbObj.audit_logs || [];
        dbObj.audit_logs.push({
          entity_type: entityType,
          entity_id: entityId,
          action,
          actor_id: actor.id,
          created_at: new Date().toISOString()
        });
      }
    }
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatus() {
      return statusCode;
    },
    getData() {
      return responseData;
    }
  };

  return { req, res };
}

test("Virtual Surveys: books appointment and provisions Daily WebRTC room", async () => {
  const { req, res } = createMockReqRes({
    body: {
      client_id: "c-zimplats",
      client_name: "Zimplats SMC",
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      mine_site: "ZIMPLATS_SMC",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      duration_minutes: 60,
      host_specialist_id: "u-specialist",
      host_specialist_name: "Technical Specialist",
      client_engineer_name: "Eng. Chitepo",
      client_engineer_email: "chitepo@zimplats.co.zw"
    }
  });

  await bookSurvey(req, res);

  assert.equal(res.getStatus(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.client_name, "Zimplats SMC");
  assert.match(data.data.meeting_room_url, /https:\/\/orac-systems\.daily\.co\//);
  assert.equal(req.db.virtual_technical_surveys.length, 1);
});

test("Virtual Surveys: generates secure participant access token with host privileges", async () => {
  const { req, res } = createMockReqRes({
    db: {
      virtual_technical_surveys: [
        {
          id: "srv-101",
          survey_number: "VTS-000101",
          client_id: "c-zimplats",
          meeting_room_name: "orac-vts-000101",
          meeting_room_url: "https://orac-systems.daily.co/orac-vts-000101",
          host_specialist_id: "u-specialist"
        }
      ]
    },
    params: { id: "srv-101" }
  });

  await getSurveyMeetingAccess(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.is_host, true);
  assert.ok(data.data.token);
});

test("Virtual Surveys: records technical wear depth and relining assessment notes", () => {
  const { req, res } = createMockReqRes({
    db: {
      virtual_technical_surveys: [
        {
          id: "srv-102",
          survey_number: "VTS-000102",
          client_id: "c-zimplats",
          status: "SCHEDULED"
        }
      ]
    },
    params: { id: "srv-102" },
    body: {
      wear_assessment_notes: "Inspected cyclone slurry distributor shell. High wear on quadrant 3.",
      wear_depth_mm: 7.8,
      recommended_lining_spec: "15mm 40-Shore Natural Rubber Tile Lining"
    }
  });

  completeSurveyWithNotes(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.status, "COMPLETED");
  assert.equal(data.data.wear_depth_mm, 7.8);
  assert.equal(req.db.audit_logs.length, 1);
});

test("AI Scope Extractor: parses industrial transcript into structured quotation items in USD", () => {
  const transcript = `
    Specialist: We reviewed the CAD drawings for Primary Slurry Pump PU-101.
    Engineer: The slurry casing shell is worn down to 5.2mm thickness from the original 12mm.
    Specialist: Understood. We recommend cold vulcanized rubber relining with 15mm 40-Shore wear rubber.
    We will include Chemlok bonding primer kits and 16 hours of certified specialist artisan labour.
  `;

  const scope = extractWearScopeFromTranscript(transcript, {
    equipment_tag_id: "TAG-PU-101",
    equipment_tag_name: "Primary Slurry Pump PU-101"
  });

  assert.equal(scope.measured_wear_depth_mm, 5.2);
  assert.equal(scope.currency, "USD");
  assert.ok(scope.suggested_line_items.length >= 3);
  assert.ok(scope.total_estimated_usd > 0);
  assert.equal(scope.suggested_line_items[0].currency || "USD", "USD");
});

test("AI Scope Extractor: automatically creates a pre-populated Draft Quotation linked to survey", () => {
  const { req, res } = createMockReqRes({
    db: {
      virtual_technical_surveys: [
        {
          id: "srv-103",
          survey_number: "VTS-000103",
          client_id: "c-zimplats",
          client_name: "Zimplats SMC",
          equipment_tag_id: "TAG-PU-101",
          equipment_tag_name: "Primary Slurry Pump PU-101",
          status: "IN_PROGRESS"
        }
      ]
    },
    params: { id: "srv-103" },
    body: {
      transcript_text: "Inspected cyclone chute. Worn down to 4.5mm. Relining with natural wear rubber required.",
      auto_create_quote: true
    }
  });

  extractSurveyAiScopeAndDraftQuote(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.ok(data.data.created_quote);
  assert.equal(data.data.created_quote.status, "Draft");
  assert.equal(data.data.created_quote.currency, "USD"); // S-08 USD invariant
  assert.equal(req.db.quotes.length, 1);
  assert.ok(req.db.quote_lines.length > 0);
  assert.equal(req.db.virtual_technical_surveys[0].linked_quote_id, data.data.created_quote.id);
});
