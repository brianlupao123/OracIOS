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

// Clock action body. No time, sequence, hash, channel, hours or location field exists: zod strips anything extra.
// The PIN is format-checked in the handler (never echoed). client_event_id is the retry-safe UUID v4 the event store uses.
export const ClockActionSchema = z.object({
  badge_token: z.string().min(1, "Badge is required").max(128, "Badge not accepted"),
  pin: z.string().max(32, "Invalid PIN"),
  client_event_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "client_event_id must be a UUID version 4"),
  dispatch_card_id: z.string().trim().min(1).max(100).optional()
});
