import { config } from "../../../config.js";
import { verifyPublicGoogleProfile } from "../../../services/googleOAuthService.js";

export async function getPublicGoogleProfile(req, res) {
  res.set("Cache-Control", "no-store");
  const clientId = process.env.PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const origins = (process.env.PUBLIC_GOOGLE_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!clientId || clientId === config.googleClientId || !origins.length) {
    return res.status(503).json({ success: false, message: "Public Google sign-in is unavailable." });
  }
  if (!origins.includes(req.get("Origin"))) {
    return res.status(403).json({ success: false, message: "This website cannot use public Google sign-in." });
  }
  const credential = req.body?.credential;
  if (!req.is("application/json") || typeof credential !== "string"
    || credential.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(credential)) {
    return res.status(400).json({ success: false, message: "A Google credential is required." });
  }

  try {
    const data = await verifyPublicGoogleProfile(credential, clientId);
    return res.json({ success: true, data });
  } catch {
    return res.status(401).json({ success: false, message: "Google sign-in could not be verified." });
  }
}
