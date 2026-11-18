// backend/tests/clientFeedbackAndQr.test.js
//
// Subsystems 8 & 11: Client Feedback, NPS & Universal QR Code Optical Engine
// Tests client satisfaction feedback, supervisor triage alerts,
// Net Promoter Score (NPS) calculations, and HMAC-signed optical QR token generation.

import test from "node:test";
import assert from "node:assert/strict";

import {
  submitFeedback,
  listFeedbacks,
  resolveFeedbackTriage,
  getFeedbackSummary,
  generateQrToken,
  getQbrReportDeck
} from "../src/controllers/feedbackController.js";

import {
  calculateNps,
  compileQbrExecutiveMetrics,
  buildQbrSlideDeckData
} from "../src/services/qbrReportService.js";

import {
  signQrPayload,
  verifyQrSignature,
  generateQrBundle
} from "../src/services/qrCodeService.js";

function createMockReqRes({ user, body = {}, params = {}, query = {}, db = {} }) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    user: user || { id: "u-client", role: "Client Viewer", name: "Plant Engineer", client_id: "c-zimplats" },
    body,
    params,
    query,
    db: {
      users: [
        { id: "u-admin", role: "Admin", name: "Admin Lead" },
        { id: "u-supervisor", role: "Supervisor", name: "Operations Supervisor" },
        { id: "u-client", role: "Client Viewer", name: "Plant Engineer", client_id: "c-zimplats" }
      ],
      client_job_feedbacks: [],
      qr_optical_tokens: [],
      dispatch_cards: [],
      pre_dispatch_ppe_checklists: [],
      vehicles: [],
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

test("Client Feedback: submits 5-star rating with NPS Promoter score (10)", () => {
  const { req, res } = createMockReqRes({
    body: {
      dispatch_card_id: "DC-FIELD-801",
      client_id: "c-zimplats",
      client_name: "Zimplats SMC",
      equipment_tag_id: "TAG-PU-101",
      rating_stars: 5,
      nps_score: 10,
      service_quality_score: 5,
      safety_compliance_score: 5,
      timeliness_score: 5,
      comments: "Exceptional rubber lining quality and zero-harm execution on our slurry feed pump.",
      submitted_by_name: "Eng. Chitepo"
    }
  });

  submitFeedback(req, res);

  assert.equal(res.getStatus(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.nps_category, "PROMOTER");
  assert.equal(data.data.triage_required, false);
  assert.equal(req.db.client_job_feedbacks.length, 1);
});

test("Client Feedback: rating <= 3 stars triggers SUPERVISOR_TRIAGE_REQUIRED alert", () => {
  const { req, res } = createMockReqRes({
    body: {
      dispatch_card_id: "DC-FIELD-802",
      client_id: "c-unki",
      client_name: "Unki Concentrator",
      rating_stars: 2,
      nps_score: 4,
      comments: "Artisan crew arrived 2 hours late. Rubber vulcanization took longer than planned.",
      submitted_by_name: "Plant Supervisor"
    }
  });

  submitFeedback(req, res);

  assert.equal(res.getStatus(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.nps_category, "DETRACTOR");
  assert.equal(data.data.triage_required, true);
  assert.equal(data.data.triage_status, "PENDING_REVIEW");
  assert.ok(req.db.audit_logs.some((l) => l.action === "SUPERVISOR_TRIAGE_REQUIRED"));
});

test("Client Feedback: supervisor resolves low-rating triage alert with corrective notes", () => {
  const { req, res } = createMockReqRes({
    user: { id: "u-supervisor", role: "Supervisor", name: "Operations Supervisor" },
    db: {
      client_job_feedbacks: [
        {
          id: "fb-101",
          dispatch_card_id: "DC-FIELD-802",
          rating_stars: 2,
          triage_required: true,
          triage_status: "PENDING_REVIEW"
        }
      ]
    },
    params: { id: "fb-101" },
    body: {
      triage_status: "RESOLVED",
      triage_notes: "Contacted plant engineer. Re-calibrated travel buffer and dispatched lead technician for inspection."
    }
  });

  resolveFeedbackTriage(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.triage_status, "RESOLVED");
  assert.equal(data.data.resolved_by_name, "Operations Supervisor");
});

test("NPS Evaluation Engine: calculates Net Promoter Score (% Promoters - % Detractors)", () => {
  const feedbacks = [
    { rating_stars: 5, nps_score: 10, service_quality_score: 5, safety_compliance_score: 5, timeliness_score: 5 }, // Promoter
    { rating_stars: 5, nps_score: 9, service_quality_score: 5, safety_compliance_score: 5, timeliness_score: 5 },  // Promoter
    { rating_stars: 4, nps_score: 8, service_quality_score: 4, safety_compliance_score: 4, timeliness_score: 4 },  // Passive
    { rating_stars: 2, nps_score: 4, service_quality_score: 2, safety_compliance_score: 3, timeliness_score: 2 }   // Detractor
  ];

  const nps = calculateNps(feedbacks);

  assert.equal(nps.total_reviews, 4);
  assert.equal(nps.promoters_count, 2);
  assert.equal(nps.passives_count, 1);
  assert.equal(nps.detractors_count, 1);
  assert.equal(nps.promoter_percentage, 50); // 2/4 = 50%
  assert.equal(nps.detractor_percentage, 25); // 1/4 = 25%
  assert.equal(nps.nps_score, 25); // 50 - 25 = +25 NPS
  assert.equal(nps.average_rating_stars, 4.0);
});

test("Universal QR Optical Engine: generates tamper-proof signed QR tokens", () => {
  const { req, res } = createMockReqRes({
    user: { id: "u-admin", role: "Admin", name: "Admin Lead" },
    body: {
      token_type: "EQUIPMENT_TAG",
      target_id: "TAG-PU-101",
      metadata: { mine_site: "ZIMPLATS_SMC", equipment: "Primary Slurry Pump" }
    }
  });

  generateQrToken(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.token_type, "EQUIPMENT_TAG");
  assert.ok(data.data.payload_uri.startsWith("orac://equipment/TAG-PU-101"));
  assert.ok(data.data.signature);
  assert.ok(data.data.data_url.startsWith("data:image/svg+xml;utf8,"));

  // Verify HMAC signature
  const isValid = verifyQrSignature(
    "EQUIPMENT_TAG",
    "TAG-PU-101",
    { mine_site: "ZIMPLATS_SMC", equipment: "Primary Slurry Pump" },
    data.data.signature
  );
  assert.equal(isValid, true);
});

test("Executive QBR Deck Service: compiles executive operational review metrics", () => {
  const mockDb = {
    client_job_feedbacks: [
      { rating_stars: 5, nps_score: 10, service_quality_score: 5, safety_compliance_score: 5, timeliness_score: 5 },
      { rating_stars: 5, nps_score: 9, service_quality_score: 5, safety_compliance_score: 5, timeliness_score: 5 }
    ],
    dispatch_cards: [
      { id: "dc-1", destination: "Zimplats Selous" },
      { id: "dc-2", destination: "Unki Concentrator" },
      { id: "dc-3", destination: "Mimosa Mine" }
    ],
    pre_dispatch_ppe_checklists: [{ id: "ppe-1", status: "PASSED" }],
    vehicles: [{ id: "veh-1", plate_number: "AFK-4891" }]
  };

  const metrics = compileQbrExecutiveMetrics(mockDb);
  assert.equal(metrics.total_jobs_dispatched, 3);
  assert.equal(metrics.site_distribution.ZIMPLATS, 1);
  assert.equal(metrics.site_distribution.UNKI, 1);
  assert.equal(metrics.site_distribution.MIMOSA, 1);
  assert.equal(metrics.satisfaction.nps_score, 100);

  const deck = buildQbrSlideDeckData(metrics);
  assert.equal(deck.slides.length, 3);
  assert.match(deck.slides[0].title, /Executive Summary/);
  assert.match(deck.slides[1].title, /Zero-Harm Safety/);
  assert.match(deck.slides[2].title, /Client Satisfaction/);
});
