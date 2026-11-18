// Display-only Fleet & HSE Subsystems flag.
// The backend remains the authoritative control; this only prevents
// unconfigured environments from exposing menus before activation.

const env = (name) => (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined
  ? import.meta.env[name]
  : (typeof process !== "undefined" ? process.env?.[name] : undefined));

export const fleetHseEnabled = () => env("VITE_ORAC_FLEET_HSE_SUBSYSTEM") === "enabled";
