# Read-only mode

`SPARKDASH_MODE_READONLY=1` turns sparkDash into a viewer: a request that is not a
reference is refused before any route (and therefore any command) runs. The
authoritative allowlist is [`server/readOnlyPolicy.js`](../server/readOnlyPolicy.js);
this page explains how to turn it on, what it serves, and how to change it.

## Enable

Set the variable in the server's environment and restart.

```bash
# direct
SPARKDASH_MODE_READONLY=1 npm start

# .env for docker compose (docker-compose.yml forwards the variable)
echo 'SPARKDASH_MODE_READONLY=1' >> .env
docker compose up -d

# docker run
docker run -e SPARKDASH_MODE_READONLY=1 ...
```

Accepted values are `1` and `true` (case-insensitive). Anything else, including
an empty value, leaves the mode off. The startup log says when it is on:

```
[sparkDash] read-only mode: serving only allowlisted reads
```

## Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5555/api/sparks
# 200

curl -s -w '\n%{http_code}\n' -X POST http://127.0.0.1:5555/api/settings
# {"error":"Read-only mode (SPARKDASH_MODE_READONLY): this request is not on the allowlist"}
# 403

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5555/api/model-prices
# 403 (this GET writes a cache)
```

## What counts as a reference

The rule is about the target state, not the HTTP method alone:

- **Allowed**: `GET`, `HEAD`, `OPTIONS` that only read state. A read-only probe
  over SSH or HTTP counts, including one that tries `sudo -n true` to report
  whether sudo works. In-memory cache updates do not count as state changes.
- **Refused**: every other method, and any `GET` that changes state — writes a
  file, runs `git fetch` on a unit, dispatches or cancels a job, applies a
  setting, or deletes.

Refused today (4 GET routes):

| Route | Why it is not a reference |
| --- | --- |
| `GET /api/sparks/:id/hermes/updates` | runs `git fetch` on the unit, updating its refs |
| `GET /api/sparks/:id/llm-launchers` | runs one SSH round trip when `?status=1` is asked |
| `GET /api/model-prices` | persists the fetched catalog to disk |
| `GET /api/sparks/:id/tool-eval/runs/:rid/result` | fetches a result from the unit and caches it gzip on disk |

Asking sudo is not itself a reason to refuse: `storage`, `storage/context`,
`gpu-clock` and `gpu-power` only check whether sudo would work and read state.

## Allowed routes (59)

The list below is the current allowlist. Keep it in sync with
`READ_ONLY_GET_PATHS`; the policy file is the source of truth.

### Core and settings

| Route | Returns |
| --- | --- |
| `GET /api/alerts` | alert settings and firing state |
| `GET /api/alerts/config` | alert settings |
| `GET /api/auth/status` | whether a token is required |
| `GET /api/events` | fleet event log (memory) |
| `GET /api/health` | health (filesystem reads) |
| `GET /api/restart` | whether an in-app restart is available |
| `GET /api/settings` | settings |
| `GET /api/sparks` | unit list (memory) |
| `GET /metrics` | Prometheus exposition (404 when the export is off) |

### Aggregates and history

| Route | Returns |
| --- | --- |
| `GET /api/fleet-energy` | fleet energy summary |
| `GET /api/fleet-energy/history` | hourly energy (in-memory pruning only) |
| `GET /api/fleet-energy/monthly` | monthly archive |
| `GET /api/llm-token-totals` | cumulative tokens per model |
| `GET /api/llm-token-totals/history` | token history |
| `GET /api/occupancy/helpers` | helper settings |
| `GET /api/occupancy/health` | cached helper health |
| `GET /api/power-meters` | cached meter status |
| `GET /api/quality-bench/runs` | saved quality runs across units |

### External reads

| Route | Returns | Note |
| --- | --- | --- |
| `GET /api/apikeys/status` | bridge health (404 when the feature is off) | bridge is read-only |
| `GET /api/apikeys/keys` | key list | bridge is read-only |
| `GET /api/apikeys/keys/:id` | one key | bridge is read-only |
| `GET /api/inference/activity` | inference activity | GET to the configured source |
| `GET /api/model-launcher/discover` | model candidates | local `find`, 15 s memory cache |

### Unit state

| Route | Returns |
| --- | --- |
| `GET /api/sparks/:id/attic/install` | password flags only |
| `GET /api/sparks/:id/attic/status` | attic state (`systemctl show`) |
| `GET /api/sparks/:id/gpu-clock` | clock state and sudo availability (read) |
| `GET /api/sparks/:id/gpu-clock/command` | manual command string (generated only) |
| `GET /api/sparks/:id/gpu-history` | GPU history |
| `GET /api/sparks/:id/gpu-power` | power limits and sudo availability (read) |
| `GET /api/sparks/:id/history` | unit history |
| `GET /api/sparks/:id/metrics` | latest snapshot |
| `GET /api/sparks/:id/runtime-control` | Mac agent state (GET only) |
| `GET /api/sparks/:id/llm-launchers/jobs/:jobId` | job log (memory) |

### LLM history and benchmarks

| Route | Returns |
| --- | --- |
| `GET /api/sparks/:id/llm/bench` | decode benchmark history |
| `GET /api/sparks/:id/llm/bench/:benchId` | one decode run |
| `GET /api/sparks/:id/llm/daily` | daily token series |
| `GET /api/sparks/:id/llm/prefill-bench` | prefill history |
| `GET /api/sparks/:id/llm/prefill-bench/:benchId` | one prefill run |
| `GET /api/sparks/:id/llm/quality-bench` | quality history |
| `GET /api/sparks/:id/llm/quality-bench/:benchId` | one quality run |
| `GET /api/sparks/:id/llm/quality-bench/:benchId/fidelity-compare` | comparison of two saved runs |
| `GET /api/sparks/:id/llm/showcase` | showcase history |
| `GET /api/sparks/:id/llm/showcase/:sessionId` | one showcase session |

### Storage

| Route | Returns |
| --- | --- |
| `GET /api/sparks/:id/storage` | disk state (`sudo -n true` checks availability only) |
| `GET /api/sparks/:id/storage/agent-junk` | agent leftovers (non-elevated `find`) |
| `GET /api/sparks/:id/storage/context` | execution context (availability check only) |
| `GET /api/sparks/:id/storage/delete-many` | latest bulk delete (memory) |
| `GET /api/sparks/:id/storage/delete-many/:jobId` | one bulk delete (memory) |
| `GET /api/sparks/:id/storage/folders` | folder listing (non-elevated) |
| `GET /api/sparks/:id/storage/quarantine` | quarantine state (list only) |
| `GET /api/sparks/:id/storage/scan` | scan progress (memory) |

### Tool Eval

| Route | Returns |
| --- | --- |
| `GET /api/sparks/:id/tool-eval/install-command` | install command string |
| `GET /api/sparks/:id/tool-eval/install/stream` | install log (memory) |
| `GET /api/sparks/:id/tool-eval/runs` | run history |
| `GET /api/sparks/:id/tool-eval/runs/:rid` | one run |
| `GET /api/sparks/:id/tool-eval/runs/:rid/stream` | run log (memory) |
| `GET /api/sparks/:id/tool-eval/status` | install state (read) |
| `GET /api/sparks/:id/tool-eval/update-check` | latest commit (read) |
| `GET /api/tool-eval/spec` | static option spec |

## How the gate matches a path

- **Segments, never regular expressions.** A path is split on `/`; a segment
  starting with `:` accepts one non-empty segment (a route parameter); every
  other segment must match, ignoring case like Express. One trailing slash is
  ignored.
- **Decoded before matching.** `%2F`, `%2E%2E`, an empty segment (`//`), `.`/`..`
  and a NUL byte never match.
- **Only `/api` and `/metrics` are gated.** The built frontend and the SPA
  fallback live outside those prefixes and always load.
- **Fail closed.** A path that is on neither list answers 403. A GET added
  later is refused until it is classified, so an unknown route can never widen
  read-only mode by accident.

## Add a route

1. Read the handler and every script it runs. Decide whether it changes state
   (writes a file, updates remote refs, dispatches a job, applies a setting,
   deletes, or persists a cache).
2. No state change: add the path to `READ_ONLY_GET_PATHS`. State change: add it
   to `READ_ONLY_REFUSED_GET_PATHS` (the audit list). Keep both sorted.
3. If a query turns the same path into a writer or an SSH probe, either split
   that variant into its own path first or leave the whole path out.
4. Bump `REGISTERED_GET_ROUTES` in
   [`server/__tests__/read-only-policy.test.js`](../server/__tests__/read-only-policy.test.js)
   and run:

```bash
node --test server/__tests__/read-only-policy.test.js
```

The test proves every allowlisted path passes the gate, every refused path is
403, an unknown GET is 403, and mutations are 403.

## Scope and caveats

- **The server keeps working.** Polling, metric history, the energy archive,
  alerts and MQTT publishing continue; read-only mode governs requests to the
  HTTP API, not the server's own loops.
- **WebSocket connections still open.** The socket only pushes snapshots and
  accepts no commands, so it is a reference.
- **Authentication is unchanged.** `SPARKDASH_TOKEN`, `BIND_HOST` and the host
  guard apply exactly as before; read-only is checked after auth.
- **The UI is not re-laid out.** Pages that read will show data; actions answer
  403 and the page shows that error. Hide or disable a control in the frontend
  only after its route has been classified.
- **No scheduled jobs are stopped.** A benchmark or scan already running when
  the mode is turned on keeps running; only new requests are refused.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every mutation returns 403 with “not on the allowlist” | the mode is on; this is expected |
| One page loads nothing and its requests are 403 | that GET is not allowlisted; check `READ_ONLY_GET_PATHS` and classify it |
| A GET that used to work now 403s after an upgrade | a new route was added without a policy entry; the gate fails closed |
| The mode seems off | the value must be exactly `1` or `true`; check the startup log |
| A proxied request returns 403 | the proxy may rewrite the path; check the request path the server sees |

## Porting to a fork

This feature is one self-contained module plus small wiring edits, so it can be
cherry-picked or applied by hand.

Created:

- `server/readOnlyPolicy.js` — the mode flag, both path lists, the matcher and
  the middleware.
- `server/__tests__/read-only-policy.test.js` — unit, matcher and live-server
  tests.
- `docs/READONLY.md` — this page.

Edited (additive; no existing behavior changes):

- `server/index.js` — import `createReadOnlyMiddleware` and `readOnlyMode` from
  `./readOnlyPolicy.js` and register the middleware right after
  `createAuthMiddleware()`.
- `docker-compose.yml`, `docker-compose.image.yml`, `docker-compose.dev.yml` —
  forward `SPARKDASH_MODE_READONLY`.
- `.env.example`, `README.md` — document the variable and link here.
- `.gitignore` — un-ignore `docs/READONLY.md` (that file's `/docs/*` rule keeps
  new pages untracked by default).

Apply order by hand:

1. Copy `server/readOnlyPolicy.js` and its test.
2. Wire the middleware in `server/index.js`.
3. Add the compose, env and README entries.
4. Run `node --test server/__tests__/read-only-policy.test.js`,
   `npm run typecheck` and `npm run build`.

Nothing else imports the policy module. A fork can add the policy and classify
its own routes.
