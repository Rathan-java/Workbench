# Testing Ara Workbench

Everything below assumes the stack is running:

```bash
docker compose up -d mysql mailhog
npm run dev
```

| | |
|---|---|
| **App** | http://localhost:5173 |
| **API docs (Swagger)** | http://localhost:4000/api-docs |
| **Mail catcher** | http://localhost:8025 |

If the data ever gets messy, reset it:

```bash
cd backend
npx prisma migrate reset --force --skip-seed
node --env-file=.env prisma/seed.js
```

---

## Accounts

| Email | Password | Role | Department |
|---|---|---|---|
| `admin@ara-workbench.local` | `ChangeMe@Admin123` | Management | — (company-wide) |
| `priya.sharma@ara-workbench.local` | `Password@2026!` | Tech Lead | Tech Team |
| `arjun.nair@ara-workbench.local` | `Password@2026!` | Employee | Tech Team |
| `divya.menon@ara-workbench.local` | `Password@2026!` | Employee | Tech Team |
| `rohan.gupta@ara-workbench.local` | `Password@2026!` | Employee | Tech Team |
| `neha.kulkarni@ara-workbench.local` | `Password@2026!` | Tech Lead | Digital Marketing |
| `karthik.iyer@ara-workbench.local` | `Password@2026!` | Employee | Digital Marketing |
| `ananya.reddy@ara-workbench.local` | `Password@2026!` | Tech Lead | Social Media |
| `vikram.singh@ara-workbench.local` | `Password@2026!` | Employee | Social Media |
| `meera.joshi@ara-workbench.local` | `Password@2026!` | Tech Lead | Video Editing |
| `aditya.rao@ara-workbench.local` | `Password@2026!` | Employee | Video Editing |

> The admin is forced to change its password on first sign-in — the seed password sits in a config file, so it is a shared secret until replaced. Use something you'll remember; you'll need it again.

---

## What changed in the latest revision

| # | Change | Where to see it |
|---|---|---|
| 1 | **Departments are fully dynamic** — create, edit, delete, with their own hours and fields | Admin → **Departments** |
| 2 | **Employees can be permanently deleted** (with a preview of what it destroys) | Admin → Employees → ⋮ → *Delete permanently* |
| 3 | **"+ Add an extra hour"** for anyone still working past the end of the day | My Task Sheet, bottom |
| 4 | **Grace period is 2 hours**, and past it the **Employee, their Team Lead AND Management** are all alerted | Settings → Notifications |
| 5 | **Team follow-up** on the dashboard — fill rate vs **on-time** rate | Dashboard, under the KPI cards |
| 6 | **Mail is configurable and testable** — a "Send test email" button that names the actual fault | Settings → Mail |
| 7 | Password minimum is now **6 characters** | Any password form |
| 8 | Role reads **"Tech Lead / Team Lead"** | Admin → Employees |
| 9 | Management **no longer has a task sheet** (they monitor; they don't log hours) | Sign in as admin — the nav item is gone |
| 10 | Reports has **no Team / Status / Priority** filter | Reports |
| 11 | An hour can be filled **late and edited after saving** | See below |

---

## The seven-minute tour

Do these in order. Each one proves something the system would be worthless without.

### 1 · The department-driven task form (2 min)

Sign in as **Arjun** (Tech Team) → **My Task Sheet**.

- The grid columns are **10:00–11:00 … 05:00–06:00** with a **Lunch** divider. Those are *Tech's* hours.
- Type into the current hour. Wait ~1.5s → the **"Saved"** tick appears. You never pressed a button.
- Reload the page. Your text is still there.
- Click the **⌄ chevron** on that cell → expand the details.
- Under **DEPARTMENT DETAILS** you'll see **Work Type**, **Ticket / PR Reference**, **Environment**, **Blocker Detail**.

Now sign out and sign in as **Karthik** (Digital Marketing) → **My Task Sheet**.

- The columns are now **09:30–10:30 …** — a *different shift*.
- Expand a cell. The department fields are now **Channel**, **Campaign**, **Activity**, **Ad Spend (₹)**, **Leads Generated**.

Then try **Aditya** (Video Editing): hours run to **07:00 PM**, and the fields are **Edit Stage**, **Deliverable**, **Runtime**, **Render Time**, **Software**, **Revision Round**.

**Nobody wrote three forms.** All of that comes from `task_field_definitions` and `time_slots` rows. Adding a fifth department is a seed row, not a deploy.

---

### 2 · Department isolation (1 min) — the important one

Sign in as **Priya** (Tech Lead, Tech Team) → **Monitor**.

- The **Department** dropdown is **locked** to Tech Team, with the helper text *"You can only view your own department."*
- The **Employee** dropdown holds **4 people** — Tech only.
- The sidebar has **no** Employees / Teams / Projects / Audit Log / Settings.

Now try to break it. Paste this straight into the address bar:

```
http://localhost:5173/admin/audit
```

You get *"You don't have access to this page."*

Now sign in as **admin** → **Monitor**.

- Same screen. But the Department dropdown now offers **All departments, Tech Team, Digital Marketing, Social Media Management, Video Editing**, and the Employee dropdown holds **all 10**.

Priya isn't having options *hidden* from her. **The API never sent them.** See §6 for the proof.

---

### 3 · The approval workflow (2 min)

As **Arjun**, fill in **all 7 hours** (any text ≥ 3 chars in each). Watch the completion bar climb to 100%.

- The **Submit** button is disabled until then. Hover it — it tells you why.
- Click **Submit**. The sheet becomes **Submitted** and locks. Try typing in a cell → *"This sheet has been submitted for approval and can no longer be edited."*

Sign in as **Priya** → **Approvals**.

- Arjun's sheet is in the queue, oldest first.
- Click **Return**. Try to submit with an empty reason → **it refuses**. A rejection *must* carry a note; "returned, no reason given" is how an approval workflow loses its users.
- Type a reason and return it.

Back as **Arjun**:

- Amber banner: *"Returned for changes"* with Priya's note.
- Edit any cell → the sheet silently drops back to **Draft** and is editable again.
- Submit → now as Priya, **Approve**. Arjun's sheet is locked green.

---

### 4 · Optimistic locking — two tabs, one cell (1 min)

This is the one that would silently eat people's work in a naive build.

1. As **Arjun**, open **/tasks** in **two browser tabs**.
2. In **Tab A**, edit the 10:00 cell → wait for **"Saved"**.
3. Switch to **Tab B** (which still has the *old* version) → edit the **same** cell → wait.

Tab B shows an amber conflict box:

> *Someone else edited this hour while you were typing.*
> Their version: "…"
> **[ Use theirs ]  [ Keep mine ]**

No silent overwrite. The user *chooses*.

---

### 5 · Password reset over real email (1 min)

Sign out → **Forgot password?** → enter `arjun.nair@ara-workbench.local`.

Open **http://localhost:8025** (MailHog). The OTP email is sitting there.

- The 6-digit code auto-advances between boxes and accepts a **paste**.
- Enter it **wrong** → *"Incorrect code. 4 attempts remaining."*
- Enter it right → set a new password. The live checklist ticks green as you satisfy each rule.
- The reset **revokes every session** — that's the correct response to "my account may be compromised".

Also try entering an email that **doesn't exist**. You get the *identical* success message. The endpoint deliberately cannot be used to enumerate who works here.

---

### 6 · Prove the isolation at the API layer (30 sec)

The UI is a courtesy. The real boundary is the API. Paste this into a terminal:

```bash
# Sign in as the SOCIAL MEDIA lead
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ananya.reddy@ara-workbench.local","password":"Password@2026!"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")

# Ask for the departments she can see  →  ONE
curl -s http://localhost:4000/api/v1/departments -H "Authorization: Bearer $TOKEN" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.map(d=>d.name).join(', ')"

# Ask for every user  →  only her own department's staff
curl -s "http://localhost:4000/api/v1/users?pageSize=100" -H "Authorization: Bearer $TOKEN" \
  | node -pe "[...new Set(JSON.parse(require('fs').readFileSync(0)).data.map(u=>u.department?.name))].join(', ')"

# Try to read a TECH employee's task grid  →  403
curl -s -o /dev/null -w "cross-department read: %{http_code}\n" \
  "http://localhost:4000/api/v1/tasks/grid?userId=<any-tech-user-id>" \
  -H "Authorization: Bearer $TOKEN"
```

There is no query parameter that widens her scope. The `WHERE` clause is not optional.

---

### 7 · The new stuff (2 min)

**Overtime.** As any employee → *My Task Sheet* → scroll to the bottom → **"+ Add an extra hour"**. An **18:00 – 19:00** column appears with a dashed border and an **EXTRA** chip.

Now look at the completion bar: it still says **"of 7 hours"**. That is the whole point — the extra column is *recorded* but never *required*. An overtime column that counted toward the requirement would silently make overtime mandatory for the entire department, and an employee who went home on time would show as non-compliant because a colleague stayed late.

**Late entry, and editing after saving.** Type into the **10:00 – 11:00** box right now, whatever time it is. It saves. Edit it again — it saves again. Nothing about an hour having passed makes it read-only.

What *does* happen is that the entry gets flagged **LATE** once the hour has been over for more than the grace period (2 hours). The system **measures** the behaviour rather than **preventing** the record — a timesheet that refuses a late entry doesn't produce better data, it produces an empty timesheet.

**Dynamic departments.** Admin → **Departments** → *New department*. A 3-step wizard: details → working hours → task fields. Create one with, say, a 09:00–17:00 day and a `testType` dropdown. Then assign an employee to it and open their task sheet — **their grid has your hours and your fields.** No code was written.

Try to delete a department that has people in it: refused, and the error names exactly what's blocking. Delete an empty one: gone.

**Escalation.** Settings → Scheduled Jobs → **Run now** on `hourly-reminders`. Anyone with an hour more than 2 hours overdue gets a bell notification, **their Team Lead gets one rolled-up alert naming everyone who's behind**, and **Management gets a company-wide one**. Run it again immediately — nothing new fires. Every alert carries a unique dedupe key, so the same fact is never reported twice. A notification system that repeats itself is one everybody mutes.

**Mail.** Settings → **Mail**. Green banner = codes will be delivered. Click **Send test email** → check http://localhost:8025. Break it on purpose (set `SMTP_PORT=587` with `SMTP_SECURE=true` in `.env` and restart) and the error tells you exactly what's wrong instead of just saying `ETIMEDOUT`.

---

### 8 · Everything else worth poking

| Where | What to look for |
|---|---|
| **Dashboard** (admin) | **"Not Logged Today"** goes red when > 0 — it's the loudest thing on the page. All four departments appear on the compliance chart *even when they logged nothing*, because a department at zero is the thing you most need to see. |
| **Reports** | Pick filters → it tells you **how many rows** the export will contain *before* you commit. Export **CSV**, open in Excel — accented names render correctly (UTF-8 BOM), and a description starting with `=` is neutralised (CSV formula injection). Try **PDF** with > 2,000 rows: it warns you and suggests Excel. |
| **Audit Log** (admin) | Filter to **failed** events → you'll see the `LOGIN_FAILED` rows from your wrong-OTP attempt. Click a row → a **before/after diff** with the actor's IP, user agent, and correlation ID. |
| **Employees** (admin) | Create a user with a blank password → the temporary password is shown **once**, with a copy button. Try to deactivate the *last* Management account → refused. Try to deactivate a Tech Lead who still leads a team → refused, with the reason. |
| **Settings** (admin) | Change **"Allow backdated edit days"** to `0`, then as an employee try to edit yesterday's sheet → refused. **No redeploy.** Scroll down to **Scheduled Jobs** → hit **Run now** on `productivity-rollup`, then reload the Dashboard: the leaderboard populates. |
| **Notification bell** | Trigger `hourly-reminders` from Settings → Jobs. Employees who missed an elapsed hour get a bell notification (and an email in MailHog if ≥ 3 hours are missing). |
| **Dark mode** | Top-right toggle. Charts, chips and tables all adapt — it isn't a filter slapped on at the end. |
| **Task history** | The 🕘 icon on any filled cell → every revision, who made it, when, and a field-level diff. Have **Priya** edit Arjun's cell from Monitor: it gets flagged **LEAD EDIT**, Arjun gets a notification, and the audit log records it. |

---

## Automated suites

```bash
npm run verify      # lint + 61 unit tests + production build
npm run test:api    # 96 assertions against the live API
npm run test:e2e    # 60 assertions in a real Chromium browser (writes screenshots)
```

Both integration suites are **stateful** — `test:e2e` changes the admin password, `test:api` submits and approves today's sheet. Reset between runs (see the top of this file).

The API suite spends as much effort on what must be **refused** as on what must succeed: a Social Media lead reading a Tech sheet, an employee approving their own timesheet, a stale version overwriting a colleague, a Digital Marketing field posted against a Tech task. A suite that only walks the happy path proves nothing about a system whose entire value is a boundary.

`npm run test:e2e` drops annotated screenshots into `e2e/screenshots/`.

---

## Swagger

**http://localhost:4000/api-docs** — every endpoint, with the access model explained up front.

To call a protected endpoint from the UI: `POST /auth/login`, copy `data.accessToken` from the response, click **Authorize** at the top right, paste it. Then try `GET /departments` as different users and watch the response shrink.
