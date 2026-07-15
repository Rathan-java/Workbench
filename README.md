# Ara Workbench

**Enterprise Task Monitoring System** — hourly work logging, approval workflow and productivity analytics across four independently-isolated departments.

Node.js · Express · Prisma · MySQL 8 · React · Vite · Material UI

---

## Contents

- [What this is](#what-this-is)
- [The five decisions that shape everything else](#the-five-decisions-that-shape-everything-else)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [The access model](#the-access-model)
- [Security](#security)
- [Scheduled jobs](#scheduled-jobs)
- [API documentation](#api-documentation)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project structure](#project-structure)

---

## What this is

Every employee logs what they did, hour by hour, on a table where **a row is a day and the columns are the working hours**. Their Tech Lead reviews and approves it. Management watches the whole company.

Four departments run in the same system but cannot see each other:

| Department | Working hours | What an hour records |
|---|---|---|
| **Tech Team** | 10:00–18:00, Mon–Fri | Work type, ticket/PR reference, environment, blocker detail |
| **Digital Marketing** | 09:30–17:30, Mon–Fri | Channel, campaign, activity, ad spend, leads generated |
| **Social Media Management** | 10:00–18:00, **Mon–Sat** | Platform(s), content type, assets produced, scheduled date, published URL |
| **Video Editing** | 11:00–19:00, Mon–Fri | Edit stage, deliverable, runtime, render time, software, revision round |

Those are **seed rows, not code**. Adding a fifth department, changing a department's shift, or adding a field to Marketing is a data change — no deploy.

---

## The five decisions that shape everything else

Read these before changing anything. Each one is load-bearing, and each is documented in-place in the file that implements it.

### 1. Department isolation is structural, not conditional
> `backend/src/core/accessScope.js`

The naive build scatters `if (user.departmentId !== task.departmentId) throw 403` across sixty endpoints. One forgotten check in one rarely-used export is a data breach, and nothing reliably catches it.

Instead: auth middleware resolves the caller into an immutable **AccessScope**, and every repository read/write takes that scope as a **required argument** which compiles into a mandatory `WHERE` clause.

`scopeWhere()` returns `{ id: '__scope_denied__' }` for an unrecognised scope — **not `{}`**. An unhandled case therefore returns *zero* rows, never *all* rows. It fails closed.

### 2. Task entry is schema-driven
> `backend/src/modules/tasks/taskAttributes.js`

Four departments capture genuinely different metadata. Four tables would kill cross-department reporting; forty nullable columns would be unnormalised. Instead: one `TaskEntry` core plus a validated `attributes` JSON column, governed by `TaskFieldDefinition` rows.

The frontend renders its form from the same rows the server validates against (`frontend/src/features/tasks/DynamicField.jsx`). One source of truth, in the database, driving both sides. This is how Jira, Linear and ServiceNow do custom fields.

### 3. Two status axes, deliberately separated
- **Work status** (`NOT_STARTED … TESTING`) lives on the **entry**.
- **Approval status** (`DRAFT → SUBMITTED → APPROVED | REJECTED`) lives on the **day**, as an explicit state machine (`config/constants.js → DAY_TRANSITIONS`).

Collapse them and an employee can silently edit an already-approved timesheet.

### 4. Optimistic concurrency on every task write
Auto-save plus two browser tabs equals silent data loss. Every `TaskEntry` carries a `version`; a stale write returns **409 with the server's current row**, and the UI shows a real "yours / theirs" choice instead of eating the edit.

### 5. Cron takes a distributed lock
> `backend/src/jobs/lock.js`

Azure App Service scales out. `node-cron` fires on *every instance* — three instances means three reminder emails and three concurrent 180-day deletes racing each other. Every job acquires a database-backed lock first.

---

## Quick start

**Prerequisites:** Node ≥ 20.11, Docker.

```bash
git clone <repo> && cd "Ara Workbench"
npm install

# MySQL on :3307 and MailHog (catches every outbound email) on :8025
docker compose up -d mysql mailhog

cp backend/.env.example backend/.env
```

### Using a MySQL you already have

If MySQL is already installed on your machine, skip the `mysql` container and point
`DATABASE_URL` at it instead — you still want MailHog (`docker compose up -d mailhog`)
so you can read the password-reset emails.

```bash
DATABASE_URL="mysql://root:YourPassword@localhost:3306/ara_workbench?connection_limit=10"
```

> **Percent-encode special characters in the password.** A password like `P@ss:26`
> must be written `P%40ss%3A26`. Left raw, the URL parser treats everything before the
> *last* `@` as credentials and you get a baffling "unknown host" error. `@` → `%40`,
> `#` → `%23`, `:` → `%3A`, `/` → `%2F`.

You do not need to create the database yourself — `prisma migrate deploy` creates it.

Generate real JWT secrets — the defaults will not start in production:

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
```

Then:

```bash
npm run db:migrate --workspace backend   # create the schema
npm run db:seed --workspace backend      # 4 departments + admin (+ demo data)
npm run dev                              # API :4000, SPA :5173
```

| | |
|---|---|
| **App** | http://localhost:5173 |
| **API docs** | http://localhost:4000/api-docs |
| **Mail catcher** | http://localhost:8025 — watch the password-reset OTP arrive |

### Sign in

The seeded Management account (**you will be forced to change the password on first sign-in**):

```
admin@ara-workbench.local  /  ChangeMe@Admin123
```

With `SEED_DEMO_DATA=true` you also get 10 users across all four departments — password `Password@2026!` — including:

| Who | Role | Department |
|---|---|---|
| `priya.sharma@ara-workbench.local` | Tech Lead | Tech Team |
| `arjun.nair@ara-workbench.local` | Employee | Tech Team |
| `neha.kulkarni@ara-workbench.local` | Tech Lead | Digital Marketing |
| `ananya.reddy@ara-workbench.local` | Tech Lead | Social Media |
| `meera.joshi@ara-workbench.local` | Tech Lead | Video Editing |

**Try the isolation for yourself:** sign in as Priya (Tech), open **Monitor**, and note the department dropdown is locked to Tech Team. Then sign in as the admin and watch the same dropdown offer all four. The Tech Lead isn't having options *hidden* — the API never sent them.

---

## Configuration

Every variable is validated by Zod at boot (`backend/src/config/env.js`). **An invalid environment refuses to start** rather than failing three hours later inside a request handler. See `backend/.env.example` for all of them, with commentary.

Production guards that will refuse to boot:
- `SEED_ADMIN_PASSWORD` still at its default value
- `COOKIE_SECURE=false`

**Env vars vs. database settings.** Infrastructure and secrets (`DATABASE_URL`, JWT keys, SMTP) live in env vars. Business policy an administrator should change without a redeploy — reminder grace period, backdated-edit window, whether daily submission is mandatory — lives in the `system_settings` table and is editable from **Settings**. An admin UI that can rewrite the JWT secret is an admin UI that can compromise the system.

---

## Architecture

```
Request
  │
  ├─ requestContext ─── correlation id → threaded through every log line + audit row
  ├─ helmet · cors · hpp · rate limit
  ├─ authenticate ───── resolves req.user AND req.scope
  ├─ authorize(PERM) ── capability check (never a role literal)
  ├─ validate(zod) ──── replaces req.body/query/params with the parsed output
  │
  ▼
Controller  (reads the request, calls ONE service method, shapes the response)
  ▼
Service     (business rules, transactions, audit, notifications)
  ▼
Repository  (Prisma only — every list method takes `scope` as its first argument)
  ▼
MySQL
```

**Clean architecture, enforced by the layer boundaries:** a controller contains no Prisma, a repository contains no policy, and a service never touches `req`/`res`.

### Why JavaScript, and how the safety is bought back

TypeScript was replaced with JavaScript per requirement. Losing compile-time checks in a system this size is a real cost, so it is paid for at runtime:

- **Zod at every boundary** — HTTP, environment, and the department-specific JSON attributes. This validates *untrusted* data, which is the data TypeScript never sees anyway.
- **ESM + JSDoc typedefs** for editor-level inference.
- **ESLint** on `src`, `prisma` and `tests`.

### Frontend state

- **TanStack Query** for all server state — dedup, background refetch, cache invalidation, and optimistic updates for auto-save, for free.
- **Context** for exactly two things: **auth** and **theme**. That is what Context is good at.

The access token is held **in a module-scope variable, never in `localStorage`**. On a 401 the interceptor silently refreshes once and retries; concurrent 401s share **one** in-flight refresh promise — firing N refreshes would trip the server's token-reuse tripwire and log the user out.

---

## The access model

Authorisation has **two independent layers**, and a request must pass both.

| Layer | Question | Where |
|---|---|---|
| **Permission** | May this role do this *kind* of thing at all? | `authorize(PERMISSIONS.TASK_APPROVE)` on the route |
| **Scope** | May they do it to *these rows*? | `scopeWhere(scope)` inside every repository query |

```
MANAGEMENT  → GLOBAL      every department, every team, every employee
TECH_LEAD   → DEPARTMENT  their own department only — no parameter widens this
EMPLOYEE    → SELF        their own task data only
```

There is **no `if (role === 'MANAGEMENT')` anywhere in the codebase.** Answering "who can approve a timesheet?" is one lookup in `ROLE_PERMISSIONS`; adding a fourth role is one entry in `core/permissions.js`. The app refuses to boot if a permission is declared but wired to no role.

---

## Security

| Control | Implementation |
|---|---|
| **Refresh token rotation + reuse detection** | Opaque 64-byte token, **SHA-256 hashed at rest**, in an `httpOnly; Secure; SameSite=Strict` cookie. Rotates on every use. Replaying an already-rotated token revokes the **entire token family** and is written to the audit log — a stolen-token tripwire (RFC 6819 §5.2.2.3). |
| **Access tokens** | 15 minutes, in memory only. Carries `passwordChangedAt`; bumping that on the server invalidates every outstanding token without a per-request revocation list. |
| **Password policy** | 12 characters minimum (NIST SP 800-63B: length beats composition), bcrypt cost 12. |
| **Brute force** | Account locks for 15 minutes after 5 failed attempts. **Database-backed**, so it survives scale-out — unlike the in-memory rate limiter, which is defence in depth on top. |
| **No account enumeration** | `/login` returns an identical error *and burns identical CPU* whether or not the account exists. `/forgot-password` always returns the same success message. |
| **OTP** | 6 digits from a CSPRNG with rejection sampling (no modulo bias), **bcrypt-hashed at rest**, 5-minute TTL, 5 attempts, single-use. Verifying it mints a *separate* single-use reset token, so the 6-digit code is never the sole credential guarding the password write. |
| **Password reset / change** | Revokes **every** session. A reset is the canonical response to "my account may be compromised"; leaving other sessions alive is the bug. |
| **Sort-field allow-list** | `?sortBy=passwordHash` against a paginated list is a practical oracle for extracting hashes. Only allow-listed columns are sortable (`core/pagination.js`). |
| **CSV injection** | A task description beginning with `=` is neutralised before export. Excel executes `=cmd\|'/c calc'!A1` when the file is opened — an employee types it, and the *manager* is the victim. |
| **Upload validation** | **Magic-byte sniffing**, not the `Content-Type` header (which is attacker-controlled). Generated filenames. Written only after the bytes are verified. |
| **Avatars** | Served authenticated, via the refresh cookie — an `<img>` cannot send a Bearer header. Serving them openly and relying on an unguessable filename is security by obscurity, and a photograph is personal data. See `middleware/staticAuth.middleware.js`. |
| **Audit log** | Append-only. No update path, no delete path, and **explicitly exempt from the 180-day retention job** — the record of who deleted the data must outlive the data. |
| **Also** | Helmet, strict CORS allow-list, HPP, 1 MB body cap, `trust proxy` (so audit IPs and rate-limit buckets are the *client's*, not the load balancer's). |

---

## Scheduled jobs

All six take a distributed lock. Running three instances produces exactly one execution of each.

| Job | Schedule | What it does |
|---|---|---|
| `retention-cleanup` | `00:05` daily | **The 180-day rule.** Deletes task data older than `TASK_RETENTION_DAYS` in **batches of 1,000**, each its own short transaction. One big `DELETE` would hold gap locks across the clustered index and block every INSERT for minutes — at 00:05 the late shift is still logging work. Users, teams, projects, settings and audit logs are never touched. Writes an audit row of exactly what it removed. |
| `productivity-rollup` | `00:20` daily | Materialises `daily_productivity_rollups`. Dashboards read from here, never from the fact table — a 90-day compliance chart would otherwise scan hundreds of thousands of rows on every page load. Idempotent: safe to re-run. |
| `hourly-reminders` | `:50` hourly | Nudges employees who have not logged an *elapsed* hour. Skips holidays and each department's own non-working days — otherwise it emails 300 people on a public holiday and every compliance chart shows a false 0%. |
| `lead-digest` | `13:30`, `18:30` weekdays | One email per Tech Lead listing who is behind. Sends **nothing** if the department is fully compliant — a digest that arrives every day regardless is a digest nobody opens. |
| `management-summary` | `19:00` weekdays | Company-wide daily summary, broken down by department. |
| `unsubmitted-check` | `09:15` weekdays | Nudges anyone whose previous day's sheet is still in draft. |

Ops visibility at **Settings → Scheduled jobs**: last run, whether it succeeded, whether it is running right now. This is how you discover the retention job has been silently failing for a fortnight.

---

## API documentation

Swagger UI at **`/api-docs`**, generated from JSDoc that lives beside the routes it describes — a spec kept in a separate file drifts within a sprint.

Disabled by default in production (`SWAGGER_ENABLED=false`): a public, complete map of every endpoint and parameter is free reconnaissance.

Every response uses one envelope:

```jsonc
{ "success": true,  "data": {}, "meta": { "pagination": {} }, "correlationId": "…", "timestamp": "…" }
{ "success": false, "error": { "code": "…", "message": "…", "details": {} }, "correlationId": "…" }
```

The `correlationId` also comes back in the `x-correlation-id` header, and appears on every log line and audit row for that request. A user reporting "it broke" hands support **one id** that reconstructs their exact request across middleware, service, repository and job boundaries.

---

## Testing

```bash
npm run verify     # lint + unit tests + production build
npm run test:api   # 96 API assertions against a live stack
npm run test:e2e   # 60 browser assertions across all three roles
```

| Suite | Result | What it covers |
|---|---|---|
| Unit | **61 / 61** | scope engine, approval state machine, OTP, query parsing |
| API integration | **96 / 96** | live HTTP, including every path that must be **denied** |
| Browser E2E | **60 / 60** | real Chromium, all three roles, fails on any console error |
| Change-set E2E | **33 / 33** | `npm run test:changes` — dynamic departments, overtime, escalation, mail |
| `npm audit` | **0 vulnerabilities** | |

### What is actually tested, and why

The suites deliberately concentrate on the things that would hurt the business.

**`tests/integration/api.smoke.mjs`** spends as much effort on the paths that must be *refused* as on the ones that must succeed: a Social Media lead reading a Tech employee's sheet, an employee approving their own timesheet, a stale version overwriting a colleague's edit, a Digital Marketing field submitted against a Tech task, a Tech Lead widening their department filter. A suite that only proves the happy path proves nothing about a system whose entire value is a boundary.

**`e2e/journeys.mjs`** drives a real browser, because a green build proves every import resolves and nothing about whether the app *renders*. It caught two defects that nothing else would have:

- **The app rendered a blank page in development.** StrictMode double-invokes effects; a `bootstrapped` ref guard blocked the second run, but the first run's cleanup had already flipped a `cancelled` flag, so its `finally` skipped `setIsLoading(false)`. Stuck on the loading screen forever — with a green build and no console error.
- **The auto-save "Saved" tick was invisible.** The save succeeded, the cache patch flowed back as a new prop, and the effect reset the indicator within a frame. Work was being saved and the user was being shown nothing — which is exactly how people learn not to trust an auto-save.

The unit suite covers:

- **`tests/unit/accessScope.test.js`** — the isolation engine. Includes the assertion that an *unknown scope kind matches nothing rather than everything*, and the breach test: a Video Editing lead cannot touch a Tech record.
- **`tests/unit/domain.test.js`** — the approval state machine (every illegal transition, every state reachable, no self-transitions), OTP uniformity, and the sort-field allow-list.
- **`tests/unit/zod.test.js`** — locks down a real bug: `z.coerce.boolean()` is `Boolean()`, so `?success=false` arrives as **`true`**. Every boolean query filter in the API had this until `queryBoolean` replaced it. The test asserts the naive version really is broken, so nobody "simplifies" it back.

---

## Deployment

### Docker (full stack)

```bash
docker compose --profile full up -d --build
# SPA :8080 · API :4000 · MailHog :8025
```

The API image runs as a non-root user under `tini` (Node does not reap zombies and does not forward `SIGTERM` — without an init, `docker stop` waits the full grace period and then `SIGKILL`s, severing in-flight requests and defeating the graceful shutdown). The SPA image is nginx serving static files: no Node, no npm, no source.

### CI/CD → Azure App Service

`.github/workflows/ci.yml`: **lint → test (against a real MySQL) → security audit → build images → deploy → smoke test.**

The cheap gates run first — a pipeline that spends six minutes on a Docker build before discovering a lint error is a pipeline nobody wants to wait for.

Tests run against a real MySQL container, not an in-memory stand-in: the whole security model rests on database-level constraints — unique indexes, foreign keys, the atomic scheduler lock — and a mock exercises none of them.

Required secrets: `AZURE_CREDENTIALS`, `AZURE_API_APP_NAME`, `AZURE_WEB_APP_NAME`, `AZURE_API_URL`.

**Production checklist**
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — fresh, distinct, ≥ 48 bytes
- [ ] `SEED_ADMIN_PASSWORD` changed (**boot fails otherwise**)
- [ ] `COOKIE_SECURE=true` (**boot fails otherwise**)
- [ ] `COOKIE_DOMAIN` set to the apex domain
- [ ] `SWAGGER_ENABLED=false`
- [ ] `TRUST_PROXY=1`
- [ ] Real SMTP credentials
- [ ] `/readyz` wired as the App Service health probe

---

## Project structure

```
backend/
├─ prisma/
│  ├─ schema.prisma          # design notes at the top — read them first
│  └─ seed.js                # the 4 departments, their hours and their fields
└─ src/
   ├─ config/                # env (Zod-validated), logger, prisma, mailer, swagger, constants
   ├─ core/                  # ⭐ accessScope · permissions · errors · ApiResponse · pagination · zod
   ├─ middleware/            # auth · validate · rateLimit · upload · staticAuth · error
   ├─ modules/               # one folder per domain: routes · controller · service · repository · dto
   │  ├─ auth/  users/  departments/  teams/  projects/
   │  ├─ tasks/              # ⭐ taskAttributes.js — the department-driven field engine
   │  ├─ dashboard/  reports/  audit/  notifications/  settings/
   ├─ jobs/                  # ⭐ lock.js (the distributed lock) + the six scheduled jobs
   ├─ routes/                # the assembled API surface
   └─ utils/                 # crypto · jwt · date

frontend/src/
├─ api/                      # axios client with the silent-refresh interceptor
├─ theme/                    # the design system (light + dark)
├─ context/                  # auth + theme, and nothing else
├─ components/               # layout shell + reusable primitives (DataTable, chips, dialogs)
├─ features/
│  ├─ auth/                  # login · forgot-password wizard · forced change
│  ├─ tasks/                 # ⭐ the hourly grid · DynamicField · history drawer
│  ├─ monitor/               # ⭐ department × date × employee
│  ├─ approvals/  dashboard/  reports/  admin/  profile/
└─ routes/                   # permission-gated, lazy-loaded routes
```

⭐ = start here.

---

## Licence

Proprietary.
