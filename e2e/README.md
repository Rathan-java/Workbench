# End-to-end verification

Two suites, both of which run against a **live** stack (API on :4000, SPA on :5173,
MySQL on :3307) rather than mocks.

```bash
docker compose up -d mysql mailhog
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
npm run dev            # in another terminal

npm run test:api       # 96 API assertions
npm run test:e2e       # 60 browser assertions, screenshots into e2e/screenshots
```

## Why these exist

**`backend/tests/integration/api.smoke.mjs`** exercises the paths that must be
*denied* as carefully as the ones that must succeed — a Social Media lead reading
a Tech employee's sheet, an employee approving their own timesheet, a stale
version overwriting a colleague's edit, a Digital Marketing field submitted
against a Tech task. A test suite that only proves the happy path proves nothing
about a system whose entire value is a boundary.

**`e2e/journeys.mjs`** drives a real browser. A green build proves every import
resolves; it proves nothing about whether the app *renders*. A bad prop or a
crashed effect gives you a white screen and a green pipeline. This walks all three
roles through their real screens and **fails on any console error**.

It caught two genuine defects that nothing else would have:

1. **The app rendered a blank page in development.** React 18 StrictMode
   double-invokes effects; the `bootstrapped` ref guard blocked the second run,
   but the first run's cleanup had already set `cancelled = true`, so its
   `finally` block skipped `setIsLoading(false)`. `isLoading` stuck at `true`
   forever. No console error, green build, dead app.

2. **The auto-save "Saved" tick was invisible.** The save succeeded, the parent
   patched the query cache, the new version flowed back down as a prop, and the
   effect — seeing a version it did not recognise — reset the state to IDLE and
   wiped the confirmation within a frame. Work was being saved and the user was
   being shown nothing.

## Note

Both suites are **stateful**: the E2E run changes the seeded admin's password, and
the API suite submits and approves today's sheet. Reset between runs:

```bash
cd backend && npx prisma migrate reset --force --skip-seed && node --env-file=.env prisma/seed.js
```
