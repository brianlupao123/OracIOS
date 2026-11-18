/**
 * IoT / Telemetry Module Routes — Plant condition monitoring
 */
import { Router } from "express";
import {
  ingestTelemetry, getEquipmentTelemetry,
  listAlerts, resolveAlert, getTelemetrySummary
} from "../../controllers/telemetryController.js";

const iotRouter = Router();

iotRouter.post("/telemetry/ingest", ingestTelemetry);
iotRouter.get("/telemetry/equipment/:tagId", getEquipmentTelemetry);
iotRouter.get("/telemetry/alerts", listAlerts);
iotRouter.post("/telemetry/alerts/:id/resolve", resolveAlert);
iotRouter.get("/telemetry/summary", getTelemetrySummary);

export default iotRouter;
