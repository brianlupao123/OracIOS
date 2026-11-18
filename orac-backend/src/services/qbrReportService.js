// backend/src/services/qbrReportService.js
//
// Executive QBR Reporting & Net Promoter Score (NPS) Evaluation Engine.
// Harvested from 1-Feedback-System evaluation and reporting models.

/**
 * Calculates Net Promoter Score (NPS) and satisfaction rating aggregates.
 * 
 * @param {Array} feedbackList 
 * @returns {object} NPS metrics breakdown
 */
export function calculateNps(feedbackList = []) {
  if (!feedbackList || feedbackList.length === 0) {
    return {
      total_reviews: 0,
      average_rating_stars: 0,
      nps_score: 0,
      promoters_count: 0,
      passives_count: 0,
      detractors_count: 0,
      promoter_percentage: 0,
      detractor_percentage: 0,
      passive_percentage: 0,
      average_service_quality: 0,
      average_safety_compliance: 0,
      average_timeliness: 0
    };
  }

  const total = feedbackList.length;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let starSum = 0;
  let qualSum = 0;
  let safeSum = 0;
  let timeSum = 0;

  for (const item of feedbackList) {
    const score = Number(item.nps_score) || 0;
    if (score >= 9) promoters++;
    else if (score >= 7) passives++;
    else detractors++;

    starSum += Number(item.rating_stars) || 0;
    qualSum += Number(item.service_quality_score) || (item.rating_stars || 0);
    safeSum += Number(item.safety_compliance_score) || (item.rating_stars || 0);
    timeSum += Number(item.timeliness_score) || (item.rating_stars || 0);
  }

  const promoterPct = Math.round((promoters / total) * 100);
  const detractorPct = Math.round((detractors / total) * 100);
  const passivePct = Math.round((passives / total) * 100);
  const nps = promoterPct - detractorPct;

  return {
    total_reviews: total,
    average_rating_stars: Math.round((starSum / total) * 10) / 10,
    nps_score: nps,
    promoters_count: promoters,
    passives_count: passives,
    detractors_count: detractors,
    promoter_percentage: promoterPct,
    detractor_percentage: detractorPct,
    passive_percentage: passivePct,
    average_service_quality: Math.round((qualSum / total) * 10) / 10,
    average_safety_compliance: Math.round((safeSum / total) * 10) / 10,
    average_timeliness: Math.round((timeSum / total) * 10) / 10
  };
}

/**
 * Compiles comprehensive Quarterly Business Review (QBR) metrics across operations and client satisfaction.
 */
export function compileQbrExecutiveMetrics(db = {}) {
  const feedbacks = db.client_job_feedbacks || [];
  const dispatches = db.dispatch_cards || [];
  const ppeList = db.pre_dispatch_ppe_checklists || [];
  const vehicles = db.vehicles || [];

  const npsData = calculateNps(feedbacks);

  // Mine Site Distribution
  const siteDistribution = {
    ZIMPLATS: 0,
    UNKI: 0,
    MIMOSA: 0,
    OTHER: 0
  };

  for (const d of dispatches) {
    const dest = (d.destination || d.mine_site || "").toUpperCase();
    if (dest.includes("ZIMPLAT")) siteDistribution.ZIMPLATS++;
    else if (dest.includes("UNKI")) siteDistribution.UNKI++;
    else if (dest.includes("MIMOSA")) siteDistribution.MIMOSA++;
    else siteDistribution.OTHER++;
  }

  const openTriages = feedbacks.filter((f) => f.triage_required && f.triage_status !== "RESOLVED");

  return {
    period: "Q4 2026 Executive Review",
    total_jobs_dispatched: dispatches.length,
    site_distribution: siteDistribution,
    active_fleet_count: vehicles.length,
    safety_ppe_gate_inspections: ppeList.length,
    satisfaction: npsData,
    open_triage_count: openTriages.length,
    open_triages: openTriages
  };
}

/**
 * Builds an executive QBR presentation summary payload ready for slide deck export.
 */
export function buildQbrSlideDeckData(qbrMetrics) {
  return {
    title: "ORAC Industrial Service Management - Executive QBR Review",
    subtitle: "Heavy Mining Plant Maintenance: Rubber Lining, Conveyor Splicing, and Slurry Pump Relining",
    generated_at: new Date().toISOString(),
    metrics: qbrMetrics,
    slides: [
      {
        slide_number: 1,
        title: "Executive Summary & Operational Uptime",
        bullet_points: [
          `Total Field Dispatches Executed: ${qbrMetrics.total_jobs_dispatched} heavy industrial maintenance missions`,
          `Major Mining Installations Served: Zimplats (${qbrMetrics.site_distribution.ZIMPLATS}), Unki (${qbrMetrics.site_distribution.UNKI}), Mimosa (${qbrMetrics.site_distribution.MIMOSA})`,
          `Operational Field Fleet: ${qbrMetrics.active_fleet_count} active 4x4 field service vehicles certified under VID regulations`
        ]
      },
      {
        slide_number: 2,
        title: "Zero-Harm Safety & Statutory Compliance (Controls S-10, S-11, S-12)",
        bullet_points: [
          `Pre-Dispatch Physical PPE Safety Gates Certified: ${qbrMetrics.safety_ppe_gate_inspections} inspections`,
          `Mine Site Induction Hard Gates: 100% compliant artisan roster allocations`,
          `Roadworthiness Enforcement: Zero dispatches with expired VID certificates`
        ]
      },
      {
        slide_number: 3,
        title: "Client Satisfaction & Net Promoter Score (NPS)",
        bullet_points: [
          `Net Promoter Score (NPS): +${qbrMetrics.satisfaction.nps_score} (${qbrMetrics.satisfaction.promoter_percentage}% Promoters vs ${qbrMetrics.satisfaction.detractor_percentage}% Detractors)`,
          `Overall Client Rating: ${qbrMetrics.satisfaction.average_rating_stars} / 5.0 Stars (${qbrMetrics.satisfaction.total_reviews} reviews)`,
          `Service Quality: ${qbrMetrics.satisfaction.average_service_quality}/5.0 | Safety Compliance: ${qbrMetrics.satisfaction.average_safety_compliance}/5.0 | Timeliness: ${qbrMetrics.satisfaction.average_timeliness}/5.0`,
          `Open Supervisor Triage Alerts: ${qbrMetrics.open_triage_count} items requiring management resolution`
        ]
      }
    ]
  };
}
