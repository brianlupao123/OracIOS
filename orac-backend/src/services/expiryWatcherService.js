// backend/src/services/expiryWatcherService.js
//
// Pure service for evaluating artisan trade qualifications, safety certifications,
// and Mine Site Induction hard gates (Sensitive Control S-10).
// Sourced from AU Careers document verification & expiry engine patterns.

/**
 * Calculates remaining days and categorization for any expiring certificate or induction.
 * @param {string|Date} expiryDateStr 
 * @param {string|Date} referenceDateStr 
 * @returns {{ category: string, daysRemaining: number, statusLabel: string, urgency: string }}
 */
export function calculateExpiryCategory(expiryDateStr, referenceDateStr = new Date().toISOString()) {
  const exp = new Date(expiryDateStr);
  const ref = new Date(referenceDateStr);
  const diffMs = exp.getTime() - ref.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return {
      category: "EXPIRED",
      daysRemaining: diffDays,
      statusLabel: "Expired",
      urgency: "CRITICAL"
    };
  }
  if (diffDays <= 30) {
    return {
      category: "EXPIRING_URGENT_30",
      daysRemaining: diffDays,
      statusLabel: "Expires within 30 days",
      urgency: "HIGH"
    };
  }
  if (diffDays <= 60) {
    return {
      category: "EXPIRING_SOON_60",
      daysRemaining: diffDays,
      statusLabel: "Expires within 60 days",
      urgency: "MEDIUM"
    };
  }
  if (diffDays <= 90) {
    return {
      category: "EXPIRING_SOON_90",
      daysRemaining: diffDays,
      statusLabel: "Expires within 90 days",
      urgency: "LOW"
    };
  }
  return {
    category: "VALID",
    daysRemaining: diffDays,
    statusLabel: "Valid & Current",
    urgency: "NONE"
  };
}

/**
 * S-10 Sensitive Control: Verifies whether an artisan has a valid, unexpired mine induction
 * for the target operational plant (e.g. Zimplats SMC, Unki Concentrator, Mimosa Flotation).
 * 
 * @param {Array} inductions List of all recorded mine site inductions
 * @param {string} technicianId ID of technician being allocated
 * @param {string} mineSite Target mining installation
 * @param {string} dispatchDateStr Intended departure date
 * @returns {{ allowed: boolean, code: string, reason: string, induction: object|null }}
 */
export function checkMineInductionGate(inductions = [], technicianId, mineSite, dispatchDateStr = new Date().toISOString()) {
  const cleanSite = (mineSite || "").toUpperCase().trim();
  const matching = (inductions || []).filter((ind) => {
    return (
      ind.technician_id === technicianId &&
      (ind.mine_site || "").toUpperCase().trim() === cleanSite
    );
  });

  if (matching.length === 0) {
    return {
      allowed: false,
      code: "MINE_INDUCTION_MISSING",
      reason: `Statutory safety gate blocked: Technician '${technicianId}' has no induction record on file for mine site '${mineSite}'. Allocation is strictly prohibited.`,
      induction: null
    };
  }

  // Sort descending by expiry date to test newest valid induction
  const sorted = [...matching].sort((a, b) => new Date(b.expiry_date).getTime() - new Date(a.expiry_date).getTime());
  const latest = sorted[0];

  if (!latest.medical_fit_to_work_pass) {
    return {
      allowed: false,
      code: "MEDICAL_FITNESS_FAILED",
      reason: `Statutory safety gate blocked: Technician '${technicianId}' has not passed medical fitness-to-work clearance for mine site '${mineSite}'.`,
      induction: latest
    };
  }

  const dispatchDate = new Date(dispatchDateStr);
  const expiryDate = new Date(latest.expiry_date);

  if (expiryDate < dispatchDate) {
    return {
      allowed: false,
      code: "MINE_INDUCTION_EXPIRED",
      reason: `Sensitive Control S-10 Hard Stop: Induction certificate (${latest.induction_card_number}) for technician '${technicianId}' at '${mineSite}' expired on ${latest.expiry_date}. Allocation strictly blocked.`,
      induction: latest
    };
  }

  return {
    allowed: true,
    code: "MINE_INDUCTION_CLEARED",
    reason: `Induction certificate (${latest.induction_card_number}) is valid and certified for '${mineSite}' through ${latest.expiry_date}.`,
    induction: latest
  };
}

/**
 * Aggregates all credentials and generates compliance summary metrics.
 */
export function evaluateArtisanVault(qualifications = [], inductions = [], referenceDateStr = new Date().toISOString()) {
  let validQuals = 0;
  let expiring30Quals = 0;
  let expiring60Quals = 0;
  let expiring90Quals = 0;
  let expiredQuals = 0;

  const qualAlerts = [];
  for (const q of qualifications) {
    const meta = calculateExpiryCategory(q.expiry_date, referenceDateStr);
    if (meta.category === "VALID") validQuals++;
    else if (meta.category === "EXPIRING_URGENT_30") { expiring30Quals++; qualAlerts.push({ ...q, ...meta }); }
    else if (meta.category === "EXPIRING_SOON_60") { expiring60Quals++; qualAlerts.push({ ...q, ...meta }); }
    else if (meta.category === "EXPIRING_SOON_90") { expiring90Quals++; qualAlerts.push({ ...q, ...meta }); }
    else if (meta.category === "EXPIRED") { expiredQuals++; qualAlerts.push({ ...q, ...meta }); }
  }

  let validInductions = 0;
  let expiredInductions = 0;
  const inductionAlerts = [];
  for (const ind of inductions) {
    const meta = calculateExpiryCategory(ind.expiry_date, referenceDateStr);
    if (meta.category === "VALID") validInductions++;
    else {
      expiredInductions++;
      inductionAlerts.push({ ...ind, ...meta });
    }
  }

  return {
    total_qualifications: qualifications.length,
    valid_qualifications: validQuals,
    expiring_soon_90: expiring90Quals,
    expiring_soon_60: expiring60Quals,
    expiring_urgent_30: expiring30Quals,
    expired_qualifications: expiredQuals,
    total_inductions: inductions.length,
    valid_inductions: validInductions,
    expired_inductions: expiredInductions,
    alerts: [...qualAlerts, ...inductionAlerts]
  };
}
