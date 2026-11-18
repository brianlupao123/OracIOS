// backend/src/services/iotTelemetryService.js
//
// Condition monitoring, vibration analysis, and ultrasonic wear telemetry engine.
// Evaluates IoT sensor streams and triggers automated pre-emptive quotation drafts.

export const THRESHOLDS = Object.freeze({
  VIBRATION_WARNING: 4.5, // mm/s RMS (ISO 10816-3 Group 1 rigid foundation)
  VIBRATION_CRITICAL: 7.1, // mm/s RMS
  TEMP_WARNING: 75.0, // Celsius
  TEMP_CRITICAL: 90.0, // Celsius
  WEAR_DEPTH_WARNING: 6.0, // mm wear on suction liner
  WEAR_DEPTH_CRITICAL: 8.0 // mm wear (approaching steel casing breach)
});

export function evaluateTelemetryMetrics(metrics) {
  const breaches = [];

  // Vibration analysis
  if (metrics.vibration_rms_mms >= THRESHOLDS.VIBRATION_CRITICAL) {
    breaches.push({
      type: "HIGH_VIBRATION",
      severity: "CRITICAL",
      metric: "vibration_rms_mms",
      value: metrics.vibration_rms_mms,
      threshold: THRESHOLDS.VIBRATION_CRITICAL
    });
  } else if (metrics.vibration_rms_mms >= THRESHOLDS.VIBRATION_WARNING) {
    breaches.push({
      type: "HIGH_VIBRATION",
      severity: "WARNING",
      metric: "vibration_rms_mms",
      value: metrics.vibration_rms_mms,
      threshold: THRESHOLDS.VIBRATION_WARNING
    });
  }

  // Bearing Temperature analysis
  if (metrics.bearing_temp_celsius >= THRESHOLDS.TEMP_CRITICAL) {
    breaches.push({
      type: "HIGH_TEMPERATURE",
      severity: "CRITICAL",
      metric: "bearing_temp_celsius",
      value: metrics.bearing_temp_celsius,
      threshold: THRESHOLDS.TEMP_CRITICAL
    });
  } else if (metrics.bearing_temp_celsius >= THRESHOLDS.TEMP_WARNING) {
    breaches.push({
      type: "HIGH_TEMPERATURE",
      severity: "WARNING",
      metric: "bearing_temp_celsius",
      value: metrics.bearing_temp_celsius,
      threshold: THRESHOLDS.TEMP_WARNING
    });
  }

  // Casing Ultrasonic Wear Depth analysis
  if (metrics.casing_wear_depth_mm >= THRESHOLDS.WEAR_DEPTH_CRITICAL) {
    breaches.push({
      type: "CRITICAL_WEAR_DEPTH",
      severity: "CRITICAL",
      metric: "casing_wear_depth_mm",
      value: metrics.casing_wear_depth_mm,
      threshold: THRESHOLDS.WEAR_DEPTH_CRITICAL
    });
  } else if (metrics.casing_wear_depth_mm >= THRESHOLDS.WEAR_DEPTH_WARNING) {
    breaches.push({
      type: "HIGH_WEAR_DEPTH",
      severity: "WARNING",
      metric: "casing_wear_depth_mm",
      value: metrics.casing_wear_depth_mm,
      threshold: THRESHOLDS.WEAR_DEPTH_WARNING
    });
  }

  const hasCritical = breaches.some((b) => b.severity === "CRITICAL");
  const hasWarning = breaches.some((b) => b.severity === "WARNING");

  return {
    status: hasCritical ? "CRITICAL" : hasWarning ? "WARNING" : "NORMAL",
    breaches
  };
}

export function processTelemetryStream(db, store, actor, payload) {
  db.iot_sensor_telemetries = db.iot_sensor_telemetries || [];
  db.iot_threshold_alerts = db.iot_threshold_alerts || [];
  db.quotes = db.quotes || [];
  db.quote_lines = db.quote_lines || [];

  const evaluation = evaluateTelemetryMetrics(payload.metrics);

  const telemetryRecord = {
    id: store.id("tel"),
    sensor_id: payload.sensor_id,
    equipment_tag_id: payload.equipment_tag_id,
    equipment_tag_name: payload.equipment_tag_name || payload.equipment_tag_id,
    client_id: payload.client_id || "c-zimplats",
    client_name: payload.client_name || "Zimplats SMC",
    mine_site: payload.mine_site || "ZIMPLATS_SMC",
    timestamp: payload.timestamp || new Date().toISOString(),
    vibration_rms_mms: payload.metrics.vibration_rms_mms,
    bearing_temp_celsius: payload.metrics.bearing_temp_celsius,
    casing_wear_depth_mm: payload.metrics.casing_wear_depth_mm,
    pump_flow_rate_m3h: payload.metrics.pump_flow_rate_m3h || null,
    status: evaluation.status,
    created_at: new Date().toISOString()
  };

  db.iot_sensor_telemetries.push(telemetryRecord);

  let createdAlert = null;
  let autoQuote = null;

  if (evaluation.status !== "NORMAL" && evaluation.breaches.length > 0) {
    const primaryBreach = evaluation.breaches.find((b) => b.severity === "CRITICAL") || evaluation.breaches[0];

    createdAlert = {
      id: store.id("alt"),
      telemetry_id: telemetryRecord.id,
      equipment_tag_id: telemetryRecord.equipment_tag_id,
      client_id: telemetryRecord.client_id,
      mine_site: telemetryRecord.mine_site,
      alert_type: primaryBreach.type,
      severity: primaryBreach.severity,
      trigger_metric: primaryBreach.metric,
      trigger_value: primaryBreach.value,
      threshold_value: primaryBreach.threshold,
      status: "ACTIVE",
      auto_quote_id: null,
      resolution_notes: null,
      resolved_by_id: null,
      resolved_at: null,
      created_at: new Date().toISOString()
    };

    // ── Predictive Maintenance Trigger (Auto-Generate Draft Quotation) ──
    if (primaryBreach.severity === "CRITICAL") {
      const quoteId = store.id("quo");
      const line1Id = store.id("ql");
      const line2Id = store.id("ql");
      const line3Id = store.id("ql");

      const lineItems = [
        {
          id: line1Id,
          quote_id: quoteId,
          description: `Cold Vulcanized 15mm 40-Shore Natural Rubber Lining Kit (${telemetryRecord.equipment_tag_name})`,
          quantity: 1,
          unit_price: 2650.00,
          total_price: 2650.00,
          currency: "USD"
        },
        {
          id: line2Id,
          quote_id: quoteId,
          description: "Certified Slurry Specialist Artisan Labor & Mechanical Surface Prep (16 Hours)",
          quantity: 16,
          unit_price: 95.00,
          total_price: 1520.00,
          currency: "USD"
        },
        {
          id: line3Id,
          quote_id: quoteId,
          description: "Chemlok 205/220 Primer & Heavy-Duty Cold Bonding Compound Kit",
          quantity: 1,
          unit_price: 680.00,
          total_price: 680.00,
          currency: "USD"
        }
      ];

      const subtotal = 4850.00;

      autoQuote = {
        id: quoteId,
        quote_number: `Q-IOT-${Date.now().toString().slice(-6)}`,
        client_id: telemetryRecord.client_id,
        client_name: telemetryRecord.client_name,
        mine_site: telemetryRecord.mine_site,
        equipment_tag_id: telemetryRecord.equipment_tag_id,
        equipment_tag_name: telemetryRecord.equipment_tag_name,
        scope_of_work: `Predictive Maintenance: Automated quote triggered by Critical IoT Sensor breach (${primaryBreach.type} at ${primaryBreach.value} on ${telemetryRecord.equipment_tag_name}). Pre-emptive suction liner rubber relining required before steel casing failure.`,
        currency: "USD", // Sensitive Control S-08
        subtotal: subtotal,
        tax_total: 0,
        total_amount: subtotal,
        status: "Draft",
        is_predictive_iot_trigger: true,
        created_from_alert_id: createdAlert.id,
        created_at: new Date().toISOString()
      };

      db.quotes.push(autoQuote);
      db.quote_lines.push(...lineItems);

      createdAlert.auto_quote_id = quoteId;

      store.audit(db, actor, "quotes", autoQuote.id, "PREDICTIVE_MAINTENANCE_QUOTE_GENERATED", null, {
        alert_id: createdAlert.id,
        trigger_metric: primaryBreach.metric,
        trigger_value: primaryBreach.value,
        total_amount: autoQuote.total_amount,
        currency: "USD"
      });
    }

    db.iot_threshold_alerts.push(createdAlert);

    store.audit(db, actor, "iot_threshold_alerts", createdAlert.id, "IOT_THRESHOLD_BREACH_ALERT", null, {
      alert_type: createdAlert.alert_type,
      severity: createdAlert.severity,
      trigger_metric: createdAlert.trigger_metric,
      trigger_value: createdAlert.trigger_value
    });
  }

  return {
    telemetry: telemetryRecord,
    evaluation,
    alert: createdAlert,
    quote: autoQuote
  };
}

export function calculateEquipmentConditionMetrics(telemetryList, tagId) {
  const records = (telemetryList || [])
    .filter((r) => r.equipment_tag_id === tagId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (records.length === 0) {
    return {
      equipment_tag_id: tagId,
      total_readings: 0,
      current_status: "UNKNOWN",
      latest_vibration_rms: 0,
      latest_bearing_temp: 0,
      latest_casing_wear_depth: 0,
      projected_days_to_critical: null,
      history: []
    };
  }

  const latest = records[records.length - 1];

  // Calculate wear velocity (mm per reading)
  let avgWearVelocity = 0.05;
  if (records.length >= 2) {
    const first = records[0];
    const wearDelta = Math.max(0, latest.casing_wear_depth_mm - first.casing_wear_depth_mm);
    const readingDelta = records.length - 1;
    if (readingDelta > 0) avgWearVelocity = wearDelta / readingDelta || 0.05;
  }

  const remainingWearToCritical = Math.max(0, THRESHOLDS.WEAR_DEPTH_CRITICAL - latest.casing_wear_depth_mm);
  const projectedReadingsToCritical = avgWearVelocity > 0 ? Math.ceil(remainingWearToCritical / avgWearVelocity) : 30;

  return {
    equipment_tag_id: tagId,
    equipment_tag_name: latest.equipment_tag_name,
    client_name: latest.client_name,
    mine_site: latest.mine_site,
    total_readings: records.length,
    current_status: latest.status,
    latest_vibration_rms: latest.vibration_rms_mms,
    latest_bearing_temp: latest.bearing_temp_celsius,
    latest_casing_wear_depth: latest.casing_wear_depth_mm,
    projected_readings_to_critical: projectedReadingsToCritical,
    history: records.slice(-30).map((r) => ({
      timestamp: r.timestamp,
      vibration_rms: r.vibration_rms_mms,
      temp: r.bearing_temp_celsius,
      wear_depth: r.casing_wear_depth_mm,
      status: r.status
    }))
  };
}

export function buildTelemetryExecutiveSummary(db) {
  const telemetries = db.iot_sensor_telemetries || [];
  const alerts = db.iot_threshold_alerts || [];
  const quotes = db.quotes || [];

  const activeAlerts = alerts.filter((a) => a.status === "ACTIVE");
  const criticalAlerts = activeAlerts.filter((a) => a.severity === "CRITICAL");
  const warningAlerts = activeAlerts.filter((a) => a.severity === "WARNING");
  const autoQuotes = quotes.filter((q) => q.is_predictive_iot_trigger);

  const uniqueTags = new Set(telemetries.map((t) => t.equipment_tag_id));

  return {
    total_telemetry_records: telemetries.length,
    monitored_equipment_count: uniqueTags.size,
    active_alerts_total: activeAlerts.length,
    critical_alerts_count: criticalAlerts.length,
    warning_alerts_count: warningAlerts.length,
    auto_predictive_quotes_generated: autoQuotes.length,
    fleet_health_index: criticalAlerts.length === 0 ? "OPTIMAL" : criticalAlerts.length <= 2 ? "ATTENTION_REQUIRED" : "CRITICAL_ACTION_REQUIRED"
  };
}
