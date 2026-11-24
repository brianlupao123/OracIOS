// Technician attendance (QR badge + six-digit PIN) ships DARK.
//
// ORAC_ATTENDANCE_ENABLED must be exactly "enabled" (same convention as the TIMESHEET_* flags in
// timesheetWorkflow.js). Unset, empty, "true", "1" or any other value means OFF. Every attendance handler
// checks the caller's permission FIRST and then refuses with 409 FEATURE_DISABLED while the flag is off,
// exactly like timesheetWorkflowController.js, so a role without the permission learns nothing about the flag.
export const ATTENDANCE_FLAG = "ORAC_ATTENDANCE_ENABLED";

export function attendanceEnabled(env = process.env) {
  return env[ATTENDANCE_FLAG] === "enabled";
}

export function featureDisabled(res) {
  return res.status(409).json({ success: false, code: "FEATURE_DISABLED", message: "Attendance is not enabled yet." });
}
