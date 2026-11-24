// Attendance numbers. Only the PIN length is an owner-fixed rule. Everything marked PROVISIONAL is a
// placeholder in the same spirit as the provisional limits in middleware/rateLimit.js: it is NOT an approved
// policy and each value needs an owner decision before the feature is switched on. One frozen object, so a
// confirmed value changes in exactly one place.
export const ATTENDANCE_POLICY = Object.freeze({
  pin_length: 6,                // FIXED RULE: six-digit PIN
  pin_max_failures: 5,          // PROVISIONAL: consecutive wrong PINs for one technician before a lock
  pin_lock_minutes: 15,         // PROVISIONAL: how long that technician's PIN entry stays locked
  badge_default_valid_days: 180, // PROVISIONAL: badge life when the issuer does not choose one
  badge_max_valid_days: 365,    // PROVISIONAL: longest badge life an issuer may choose
  site_utc_offset_minutes: 120  // PROVISIONAL: Harare (CAT, no daylight saving); used only to label a shift's work date
});
