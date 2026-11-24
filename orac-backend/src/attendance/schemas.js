import { z } from "zod";

// PIN fields are validated for FORMAT in the handlers (validatePinFormat), never here, so a rejected PIN is never
// echoed into an error message and the exact-six-digits rule lives in one place (policy.js).
const reason = z.string().trim().min(3, "A reason of at least 3 characters is required").max(200, "Reason cannot exceed 200 characters");

export const IssueAttendanceBadgeSchema = z.object({
  technician_id: z.string().min(1, "Technician is required").max(100),
  valid_days: z.number().int("Valid days must be a whole number").min(1, "Valid days must be at least 1").max(365, "Valid days cannot exceed 365").optional()
});

export const WithdrawAttendanceBadgeSchema = z.object({ reason });

export const SetAttendancePinSchema = z.object({
  pin: z.string().max(32, "Invalid PIN"),
  current_pin: z.string().max(32, "Invalid PIN").optional()
});

export const ClearAttendancePinSchema = z.object({ reason });
