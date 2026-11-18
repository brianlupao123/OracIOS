/**
 * Test helper: returns the concatenated source of router.js + all module route files.
 * Guard tests that scan for route strings work unchanged — they search the
 * combined source instead of just router.js.
 *
 * The authAt index still works because router.js is first in the concatenation,
 * and all module routes are appended AFTER (simulating they appear after authMiddleware).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "..", "src");

function collectRouteFiles(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(collectRouteFiles(full));
    } else if (entry === "routes.js" || entry.endsWith("Routes.js")) {
      files.push(full);
    }
  }
  return files;
}

const routerSrc = readFileSync(join(srcDir, "router.js"), "utf8").replace(/\r/g, "");

// Collect all module route files
const moduleDir = join(srcDir, "modules");
const moduleRouteFiles = collectRouteFiles(moduleDir);
const moduleSrc = moduleRouteFiles
  .map(f => readFileSync(f, "utf8").replace(/\r/g, ""))
  .join("\n");

/**
 * Combined source: router.js followed by all module route files.
 * Route pattern checks (e.g. `src.includes('router.post("/foo"')`) work because
 * module files use the same `<name>Router.post("/foo"` pattern — we normalize
 * the variable names to `router` so existing assertions match.
 */
export const routerSource = routerSrc + "\n" + moduleSrc.replace(/\b\w+Router\./g, "router.");

/** Just the router.js content (for auth wall checks) */
export const routerOnlySource = routerSrc;

/** Index of authMiddleware in router.js (line position in combined source) */
export const authAt = routerSrc.indexOf("router.use(authMiddleware);");
