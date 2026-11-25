/**
 * Read-only mode (SPARKDASH_MODE_READONLY) in one place: the mode flag, the path
 * allowlist and the middleware that enforces it.
 *
 * Paths are compared segment by segment, never as regular expressions:
 *   - a segment starting with ":" accepts exactly one non-empty segment (a route
 *     parameter, such as an id);
 *   - every other segment must match the request segment, ignoring case like
 *     Express does;
 *   - one trailing slash is ignored.
 * A path is URL-decoded before comparison; "%2F", "%2E%2E", an empty segment
 * ("//") or a NUL byte never matches, so an encoded path cannot slip past a
 * gate that Express would route elsewhere.
 *
 * Fail closed. In read-only mode only GET/HEAD/OPTIONS are considered, and
 * under /api and /metrics only the paths below are served. Static frontend
 * files and the SPA fallback live outside those prefixes and always load.
 *
 * When you add a route, classify it:
 *   - reads state, including a read-only probe over SSH or HTTP (status checks,
 *     listings, discovery, cached reads): add the path.
 *   - changes state: writes a file, dispatches or cancels a job, applies a
 *     setting, deletes, or fills a local cache: leave it out. It stays refused.
 */

/** SPARKDASH_MODE_READONLY: 1 or true refuses everything that is not on the allowlist. */
export function readOnlyMode() {
  return ["1", "true"].includes(String(process.env.SPARKDASH_MODE_READONLY || "").toLowerCase());
}

/**
 * Every GET route in the server was checked against the rule above. These read
 * state; some run a read-only probe over SSH or HTTP. Keep sorted.
 */
export const READ_ONLY_GET_PATHS = Object.freeze([
  "/api/alerts",
  "/api/alerts/config",
  "/api/apikeys/keys",
  "/api/apikeys/keys/:id",
  "/api/apikeys/status",
  "/api/auth/status",
  "/api/events",
  "/api/fleet-energy",
  "/api/fleet-energy/history",
  "/api/fleet-energy/monthly",
  "/api/health",
  "/api/inference/activity",
  "/api/llm-token-totals",
  "/api/llm-token-totals/history",
  "/api/model-launcher/discover",
  "/api/occupancy/health",
  "/api/occupancy/helpers",
  "/api/power-meters",
  "/api/quality-bench/runs",
  "/api/restart",
  "/api/settings",
  "/api/sparks",
  "/api/sparks/:id/attic/install",
  "/api/sparks/:id/attic/status",
  "/api/sparks/:id/gpu-clock",
  "/api/sparks/:id/gpu-clock/command",
  "/api/sparks/:id/gpu-history",
  "/api/sparks/:id/gpu-power",
  "/api/sparks/:id/history",
  "/api/sparks/:id/llm-launchers/jobs/:jobId",
  "/api/sparks/:id/llm/bench",
  "/api/sparks/:id/llm/bench/:benchId",
  "/api/sparks/:id/llm/daily",
  "/api/sparks/:id/llm/prefill-bench",
  "/api/sparks/:id/llm/prefill-bench/:benchId",
  "/api/sparks/:id/llm/quality-bench",
  "/api/sparks/:id/llm/quality-bench/:benchId",
  "/api/sparks/:id/llm/quality-bench/:benchId/fidelity-compare",
  "/api/sparks/:id/llm/showcase",
  "/api/sparks/:id/llm/showcase/:sessionId",
  "/api/sparks/:id/metrics",
  "/api/sparks/:id/runtime-control",
  "/api/sparks/:id/storage",
  "/api/sparks/:id/storage/agent-junk",
  "/api/sparks/:id/storage/context",
  "/api/sparks/:id/storage/delete-many",
  "/api/sparks/:id/storage/delete-many/:jobId",
  "/api/sparks/:id/storage/folders",
  "/api/sparks/:id/storage/quarantine",
  "/api/sparks/:id/storage/scan",
  "/api/sparks/:id/tool-eval/install-command",
  "/api/sparks/:id/tool-eval/install/stream",
  "/api/sparks/:id/tool-eval/runs",
  "/api/sparks/:id/tool-eval/runs/:rid",
  "/api/sparks/:id/tool-eval/runs/:rid/stream",
  "/api/sparks/:id/tool-eval/status",
  "/api/sparks/:id/tool-eval/update-check",
  "/api/tool-eval/spec",
  "/metrics",
]);

/**
 * The GET routes that change state, so they are refused:
 *   - the Hermes check runs `git fetch` on the unit (updating its refs);
 *   - the launcher list runs one SSH round trip when `?status=1` is asked;
 *   - the price refresh persists its catalog to disk;
 *   - a tool-eval result is fetched from the unit and cached gzip on disk.
 * Asking sudo is not by itself a reason to refuse: a read-only probe that only
 * reads state (GPU clock/power, storage status/context) stays allowlisted.
 * This list is the audit trail; the gate never consults it, so a route that is
 * on neither list is refused too.
 */
export const READ_ONLY_REFUSED_GET_PATHS = Object.freeze([
  "/api/sparks/:id/hermes/updates",
  "/api/sparks/:id/llm-launchers",
  "/api/model-prices",
  "/api/sparks/:id/tool-eval/runs/:rid/result",
]);

const TEMPLATES = Object.freeze(READ_ONLY_GET_PATHS.map((path) => Object.freeze(path.split("/").slice(1))));

/** Prefixes the gate covers; everything else is the static frontend and SPA. */
const GATED_PREFIXES = new Set(["api", "metrics"]);

/**
 * Split a request path into segments, or null when the path is malformed or
 * could be decoded into a different route than the one compared here.
 * @param {unknown} pathname
 * @returns {string[] | null}
 */
function pathSegments(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || !decoded.startsWith("/")) return null;
  const segments = decoded.split("/").slice(1);
  // Express ignores one trailing slash; it never accepts an empty segment.
  if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments;
}

/** @param {string[]} segments @param {readonly string[]} template */
function matchesTemplate(segments, template) {
  if (segments.length !== template.length) return false;
  for (let i = 0; i < template.length; i++) {
    const expected = template[i];
    if (expected.startsWith(":")) {
      if (segments[i].length === 0) return false;
    } else if (expected.toLowerCase() !== segments[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Whether read-only mode may serve this request.
 * @param {string | undefined} method
 * @param {string | undefined} pathname path without a query string (`req.path`)
 * @returns {boolean}
 */
export function isReadOnlyRequestAllowed(method, pathname) {
  const upper = String(method ?? "GET").toUpperCase();
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") return false;
  const segments = pathSegments(pathname);
  if (!segments) return false;
  if (!GATED_PREFIXES.has((segments[0] ?? "").toLowerCase())) return true;
  return TEMPLATES.some((template) => matchesTemplate(segments, template));
}

/**
 * Registered after the auth middleware: a request that is not on the allowlist
 * is refused before any route (and therefore any command) can run.
 */
export function createReadOnlyMiddleware() {
  return function readOnly(req, res, next) {
    if (!readOnlyMode()) return next();
    if (isReadOnlyRequestAllowed(req.method, req.path)) return next();
    res.status(403).json({
      error: "Read-only mode (SPARKDASH_MODE_READONLY): this request is not on the allowlist",
    });
  };
}
