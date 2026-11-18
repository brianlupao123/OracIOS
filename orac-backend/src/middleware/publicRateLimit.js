// Small in-memory rate limiter. IMPORTANT: mount it in server.js BEFORE persistenceMiddleware.
// persistenceMiddleware takes the global database lock and reads the whole data object for every request,
// so a limiter placed in the router (after it) would still let a flood hammer the database.
// Behind Render/Nginx also set `app.set("trust proxy", 1)`, or every visitor shares one bucket.
export function createRateLimiter({ max, windowMs, message = "Too many requests. Please try again later.", now = Date.now, key = (req) => req.ip || "unknown" }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const cutoff = now() - windowMs;
    for (const [k, list] of hits) if (list.every((t) => t < cutoff)) hits.delete(k);
  }, Math.max(windowMs, 60000));
  sweep.unref?.();

  return function rateLimit(req, res, next) {
    const k = key(req);
    const t = now();
    const recent = (hits.get(k) || []).filter((x) => t - x < windowMs);
    recent.push(t);
    hits.set(k, recent);
    if (recent.length > max) {
      res.set?.("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ success: false, message });
    }
    next();
  };
}
