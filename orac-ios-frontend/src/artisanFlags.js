// Display-only HR Artisan Vault & Mine Induction Subsystem flag.
// The backend remains the authoritative control; this only prevents
// unconfigured environments from exposing menus before activation.

const env = (name) => (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined
  ? import.meta.env[name]
  : (typeof process !== "undefined" ? process.env?.[name] : undefined));

export const artisanVaultEnabled = () => env("VITE_ORAC_ARTISAN_VAULT_SUBSYSTEM") === "enabled";
