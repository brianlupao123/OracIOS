// Display-only Virtual Technical Surveys & AI Minutes Subsystem flag.
// The backend remains the authoritative control; this only prevents
// unconfigured environments from exposing menus before activation.

const env = (name) => (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined
  ? import.meta.env[name]
  : (typeof process !== "undefined" ? process.env?.[name] : undefined));

export const surveysEnabled = () => env("VITE_ORAC_VIRTUAL_SURVEYS_SUBSYSTEM") === "enabled";
