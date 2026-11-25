/**
 * SPARKDASH_MODE_READONLY: every GET route was classified. A path is matched
 * segment by segment (no regular expressions), and anything outside the
 * allowlist -- including a GET added later -- is refused.
 *
 * The route count below is the audit ledger. Adding a GET route must update one
 * of the two policy lists and this count; otherwise the gate refuses it (safe,
 * but the test says the classification is stale).
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { isolatedConfigEnv } from "./isolatedEnv.js";
import {
  READ_ONLY_GET_PATHS,
  READ_ONLY_REFUSED_GET_PATHS,
  isReadOnlyRequestAllowed,
  readOnlyMode,
} from "../readOnlyPolicy.js";

/** Every GET route the server registers, by file: 26 index + 2 alerts + 3 apiKeys
 *  + 2 attic + 3 energy + 3 gpuclock + 2 llmtokens + 2 metrics + 2 occupancy
 *  + 1 powermeter + 8 storage + 9 tooleval = 63. */
const REGISTERED_GET_ROUTES = 63;

const concrete = (template) =>
  template
    .replaceAll(":id", "unit-1")
    .replaceAll(":benchId", "bench-1")
    .replaceAll(":jobId", "job-1")
    .replaceAll(":sessionId", "session-1")
    .replaceAll(":rid", "run-1");

test("readOnlyMode accepts 1/true and rejects everything else", () => {
  const previous = process.env.SPARKDASH_MODE_READONLY;
  try {
    for (const value of ["1", "true", "TRUE"]) {
      process.env.SPARKDASH_MODE_READONLY = value;
      assert.equal(readOnlyMode(), true, value);
    }
    for (const value of [undefined, "", "0", "false", "yes"]) {
      if (value === undefined) delete process.env.SPARKDASH_MODE_READONLY;
      else process.env.SPARKDASH_MODE_READONLY = value;
      assert.equal(readOnlyMode(), false, String(value));
    }
  } finally {
    if (previous === undefined) delete process.env.SPARKDASH_MODE_READONLY;
    else process.env.SPARKDASH_MODE_READONLY = previous;
  }
});

test("the two lists cover every registered GET route exactly once", () => {
  const allowed = new Set(READ_ONLY_GET_PATHS);
  const refused = new Set(READ_ONLY_REFUSED_GET_PATHS);
  assert.equal(allowed.size, READ_ONLY_GET_PATHS.length, "allowlist has a duplicate");
  assert.equal(refused.size, READ_ONLY_REFUSED_GET_PATHS.length, "refused list has a duplicate");
  for (const path of allowed) assert.equal(refused.has(path), false, `${path} is in both lists`);
  assert.equal(allowed.size + refused.size, REGISTERED_GET_ROUTES);
});

test("every allowlisted GET is served and every refused GET is blocked", () => {
  for (const template of READ_ONLY_GET_PATHS) {
    assert.equal(isReadOnlyRequestAllowed("GET", concrete(template)), true, template);
  }
  for (const template of READ_ONLY_REFUSED_GET_PATHS) {
    assert.equal(isReadOnlyRequestAllowed("GET", concrete(template)), false, template);
  }
});

test("path matching is segment-based, not a regex", () => {
  const ok = (pathname) => assert.equal(isReadOnlyRequestAllowed("GET", pathname), true, pathname);
  const no = (pathname) => assert.equal(isReadOnlyRequestAllowed("GET", pathname), false, pathname);

  // Case-insensitive literals like Express; parameters are not compared.
  ok("/API/EVENTS");
  ok("/api/sparks/ANY-ID/metrics");
  ok("/api/events/");
  // Wrong segment count, wrong literal, unlisted API, empty segments.
  no("/api/sparks/unit-1");
  no("/api/sparks/unit-1/metrics/extra");
  no("/api/events/extra");
  ok("/api/sparks/unit-1/storage");
  no("/api/sparks/unit-1/storage/unknown");
  no("/api/unknown");
  no("/api/events//");
  // Paths that decode into a different route never match.
  no("/api/sparks/%2e%2e/metrics");
  no("/api/sparks/unit-1/%2Fmetrics");
  no("/api/sparks/unit-1/metrics%2F..%2Fstorage");
  no("/api/%00events");
  no("api/events");
  // A query string is not part of req.path; passing one cannot widen the match.
  no("/api/events?limit=1");

  // HEAD and OPTIONS read; every other method is a mutation.
  ok("/api/events");
  assert.equal(isReadOnlyRequestAllowed("HEAD", "/api/events"), true);
  assert.equal(isReadOnlyRequestAllowed("OPTIONS", "/api/events"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(isReadOnlyRequestAllowed(method, "/api/events"), false, method);
  }

  // Outside /api and /metrics only the built frontend and the SPA fallback exist.
  ok("/");
  ok("/index.html");
  ok("/assets/index-abc.js");
  ok("/unit/unit-1");
  no("/favicon.ico/../api/events");
});

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("read-only server serves allowlisted GETs and refuses the rest", async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sparkdash-readonly-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = isolatedConfigEnv(tmp);
  await writeFile(env.SPARKS_JSON_PATH, '{"sparks":[]}\n');
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      ...env,
      BIND_HOST: "127.0.0.1",
      PORT: String(port),
      SPARKDASH_TOKEN: "",
      SPARKDASH_MODE_READONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`server did not start:\n${output}`));
    }, 5_000);
    const check = () => {
      if (settled) return;
      if (output.includes("server listening")) {
        settled = true;
        clearTimeout(timer);
        return resolve();
      }
      setTimeout(check, 10);
    };
    check();
  });

  const base = `http://127.0.0.1:${port}`;

  // Every allowlisted route passes the gate (200, 404 or 503 is the route's own answer).
  for (const template of READ_ONLY_GET_PATHS) {
    const res = await fetch(base + concrete(template));
    assert.notEqual(res.status, 403, `${template} must pass the read-only gate`);
  }

  // Every refused route is stopped before its handler (404 from a missing unit never happens).
  for (const template of READ_ONLY_REFUSED_GET_PATHS) {
    const res = await fetch(base + concrete(template));
    assert.equal(res.status, 403, `${template} must be refused`);
    const body = await res.json();
    assert.match(body.error, /allowlist/, template);
  }

  // A GET added later is refused until it is classified.
  const unknown = await fetch(base + "/api/not-classified-yet");
  assert.equal(unknown.status, 403);

  const mutations = [
    ["POST", "/api/sparks/test"],
    ["PUT", "/api/settings"],
    ["PATCH", "/api/sparks/unit-1"],
    ["DELETE", "/api/events"],
  ];
  for (const [method, pathname] of mutations) {
    const res = await fetch(base + pathname, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "DELETE" ? undefined : "{}",
    });
    assert.equal(res.status, 403, `${method} ${pathname}`);
  }
});
