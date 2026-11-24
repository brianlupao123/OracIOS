/**
 * Attendance module routes (QR badge + six-digit PIN). Mounted after authMiddleware in router.js, so every route
 * needs a signed-in user. Every handler is DARK: it refuses with 409 FEATURE_DISABLED unless
 * ORAC_ATTENDANCE_ENABLED=enabled. Evidence only: nothing here touches payroll, certified or billable hours,
 * invoices, Pastel, variance or job actuals.
 */
import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { IssueAttendanceBadgeSchema, WithdrawAttendanceBadgeSchema, SetAttendancePinSchema, ClearAttendancePinSchema, ClockActionSchema } from "./schemas.js";
import {
  getAttendanceStatus, issueAttendanceBadge, listAttendanceBadges, withdrawAttendanceBadge,
  getOwnPinStatus, setOwnAttendancePin, clearAttendancePin
} from "./credentialController.js";
import { clockIn, clockOut } from "./clockController.js";

const attendanceRouter = Router();

attendanceRouter.get("/attendance/status", getAttendanceStatus);
attendanceRouter.post("/attendance/badges", validate(IssueAttendanceBadgeSchema), issueAttendanceBadge);
attendanceRouter.get("/attendance/badges", listAttendanceBadges);
attendanceRouter.post("/attendance/badges/:id/withdraw", validate(WithdrawAttendanceBadgeSchema), withdrawAttendanceBadge);
attendanceRouter.get("/attendance/pin/status", getOwnPinStatus);
attendanceRouter.post("/attendance/pin", validate(SetAttendancePinSchema), setOwnAttendancePin);
attendanceRouter.post("/attendance/technicians/:id/pin/clear", validate(ClearAttendancePinSchema), clearAttendancePin);
attendanceRouter.post("/attendance/clock-in", validate(ClockActionSchema), clockIn);
attendanceRouter.post("/attendance/clock-out", validate(ClockActionSchema), clockOut);

export default attendanceRouter;
