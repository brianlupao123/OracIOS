// Re-export from fleet module — do not add logic here.
export {
  postOdometerReading,
  getOdometer,
  getStats,
  getScanCompliance,
  getExpiryAlerts,
  postMaintenanceRequest,
  postMaintenanceTransition
} from "../modules/fleet/controllers/fleetComplianceController.js";
