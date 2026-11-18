// Display-only Plant IoT Telemetry & Offline Sync Subsystem flag.
// The backend remains the authoritative control; this only prevents
// unconfigured environments from exposing menus before activation.

const env = (name) => (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined
  ? import.meta.env[name]
  : (typeof process !== "undefined" ? process.env?.[name] : undefined));

export const iotAndSyncEnabled = () => env("VITE_ORAC_IOT_SYNC_SUBSYSTEM") === "enabled";
