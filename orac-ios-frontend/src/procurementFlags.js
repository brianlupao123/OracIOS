// Display-only Procurement Subsystem flag.
// The backend remains the authoritative control; this only prevents
// unfinished controls from appearing on baseline and unconfigured environments.

const env = (name) => (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined
  ? import.meta.env[name]
  : (typeof process !== "undefined" ? process.env?.[name] : undefined));

export const procurementEnabled = () => env("VITE_ORAC_PROCUREMENT_SUBSYSTEM") === "enabled";
