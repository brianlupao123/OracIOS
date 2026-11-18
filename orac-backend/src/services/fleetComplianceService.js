// Re-export from fleet module — do not add logic here.
export {
  logOdometerReading,
  getOdometerHistory,
  getMileageStats,
  scanFleetCompliance,
  getFleetExpiryAlerts,
  createMaintenanceRequest,
  transitionMaintenanceRequest,
  listMaintenanceRequests,
  MAINTENANCE_STATES
} from "../modules/fleet/services/fleetComplianceService.js";
