/**
 * Drives the real SPA in a real browser.
 *
 * A green build proves every import resolves. It proves nothing about whether
 * the app renders — a bad prop, an undefined call or a crashed effect gives you
 * a white screen and a green pipeline. So: sign in, walk the screens, and fail
 * on ANY console error or unhandled rejection.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const SHOTS = process.argv[2] ?? '.';

const results = [];
let passed = 0;
let failed = 0;

const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    results.push(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    results.push(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` \x1b[90m→ ${detail}\x1b[0m` : ''}`);
  }
};

const browser = await chromium.launch();

const run = async (label, { email, password }, walk) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  /** Any console error at all is a defect. React logs prop-type and key
   *  violations here, and so does every thrown error inside a render. */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // A 401 on the initial /auth/refresh is EXPECTED — that is the app
      // discovering there is no session yet. Everything else is real.
      if (text.includes('401') && text.includes('refresh')) return;
      if (text.includes('Failed to load resource') && text.includes('401')) return;
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(`UNCAUGHT: ${err.message}`));

  results.push(`\n\x1b[1m\x1b[36m${label}\x1b[0m`);

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- sign in ---
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  check(`${label}: signs in`, true);

  await walk(page, check);

  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));

  await context.close();
};

const settle = (page) => page.waitForTimeout(1400);

// ---------------------------------------------------------------------------
// EMPLOYEE — the task sheet
// ---------------------------------------------------------------------------
await run(
  'EMPLOYEE (Arjun, Tech Team)',
  { email: 'arjun.nair@ara-workbench.local', password: 'Password@2026!' },
  async (page, check) => {
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
    await settle(page);

    const body = await page.textContent('body');

    check('task sheet renders', body.includes('My Task Sheet'));
    check('the grid shows the TECH working hours (10:00 - 11:00)', body.includes('10:00 - 11:00'));
    check('…through to 05:00 - 06:00', body.includes('05:00 - 06:00'));
    check('the lunch break renders as a divider', body.toUpperCase().includes('LUNCH'));
    check('the day starts in DRAFT', body.includes('Draft'));
    check('completion is shown as a percentage', /\d+%/.test(body));

    // An hour opens for editing on click. Open the first one that is not
    // already open (the current hour auto-opens; the rest show a prompt).
    const prompt = page.getByText('What did you complete this hour?', { exact: false }).first();
    if (await prompt.count()) {
      await prompt.click();
      await settle(page);
    }

    const first = page.locator('textarea').first();
    await first.click();
    await first.fill('Implemented the login API and wrote its integration tests');
    await page.waitForTimeout(300);

    const typing = await page.textContent('body');
    check('the character counter is live', /\d+\/2000/.test(typing));

    // THE NEW CONTRACT: a description alone is not enough. Project is required,
    // and until it is chosen the Save button stays disabled — an autosave with no
    // project is deliberately held as a draft, never written.
    const saveBtn = page.getByRole('button', { name: /Save this hour|Save changes/ }).first();
    check('Save is DISABLED until a project is chosen', await saveBtn.isDisabled());

    await page.screenshot({ path: `${SHOTS}/01-employee-tasksheet.png`, fullPage: false });

    // Choose the project — the only other thing the form asks for.
    await page.getByRole('combobox', { name: 'Project' }).first().click();
    await settle(page);
    const options = await page.getByRole('option').allTextContents();
    check('the project list offers real projects', options.length > 0, options.join(' | '));
    check(
      'every department has an "Internal / Non-project" catch-all',
      options.some((o) => /Internal/i.test(o)),
    );
    // Pick a real project, not the Internal bucket.
    const realOption = page.getByRole('option').filter({ hasText: /^(?!.*Internal).*$/ }).first();
    await (await realOption.count() ? realOption : page.getByRole('option').first()).click();
    await settle(page);

    // NO Status, NO Priority, NO Work Type — the fields that made the old form a
    // wall. Their absence is the whole point of the redesign.
    const editing = await page.textContent('body');
    check('the form does NOT ask for a Status', !/\bStatus\b/.test(editing) || !/In Progress|Completed|Not Started/.test(editing));
    check('the form does NOT ask for a Priority', !/\bPriority\b/.test(editing));
    check('the form does NOT ask for a Work Type', !editing.includes('Work Type'));

    await saveBtn.click();
    await page.waitForTimeout(1200);

    const afterSave = await page.textContent('body');
    check('the saved hour reads back with its text', afterSave.includes('Implemented the login API'));

    await page.screenshot({ path: `${SHOTS}/02-employee-saved-hour.png` });

    // An Employee must not see the admin surfaces.
    const nav = await page.textContent('nav');
    check('Employee nav has no "Employees" admin item', !nav.includes('Employees'));
    check('Employee nav has no "Audit Log"', !nav.includes('Audit Log'));
    check('Employee nav has no "Approvals"', !nav.includes('Approvals'));
    check('Employee nav DOES have "My Task Sheet"', nav.includes('My Task Sheet'));
  },
);

// ---------------------------------------------------------------------------
// TECH LEAD — the isolation boundary, in the actual UI
// ---------------------------------------------------------------------------
await run(
  'TECH LEAD (Priya, Tech Team)',
  { email: 'priya.sharma@ara-workbench.local', password: 'Password@2026!' },
  async (page, check) => {
    const nav = await page.textContent('nav');
    check('Tech Lead nav HAS "Monitor"', nav.includes('Monitor'));
    check('Tech Lead nav HAS "Approvals"', nav.includes('Approvals'));
    check('Tech Lead nav has NO "Employees" (admin)', !nav.includes('Employees'));
    check('Tech Lead nav has NO "Audit Log"', !nav.includes('Audit Log'));
    check('Tech Lead nav has NO "Settings"', !nav.includes('Settings'));

    await page.goto(`${BASE}/monitor`, { waitUntil: 'networkidle' });
    await settle(page);

    const body = await page.textContent('body');
    check('monitor renders', body.includes('Monitor'));
    check(
      'the department dropdown is LOCKED to their own department',
      body.includes('You can only view your own department'),
      'expected the helper text explaining the lock',
    );
    check('their own department is named', body.includes('Tech Team'));
    check('no other department is offered', !body.includes('Video Editing') && !body.includes('Social Media'));

    await page.screenshot({ path: `${SHOTS}/03-techlead-monitor-locked.png` });

    await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
    await settle(page);
    check('approvals queue renders', (await page.textContent('body')).includes('Approvals'));
    await page.screenshot({ path: `${SHOTS}/04-techlead-approvals.png` });

    // Try to reach an admin page by URL. The route guard must refuse.
    await page.goto(`${BASE}/admin/audit`, { waitUntil: 'networkidle' });
    await settle(page);
    const blocked = await page.textContent('body');
    check(
      'typing /admin/audit directly is REFUSED',
      blocked.includes("don't have access"),
      blocked.slice(0, 80),
    );
  },
);

// ---------------------------------------------------------------------------
// MANAGEMENT — sees everything
// ---------------------------------------------------------------------------
await run(
  'MANAGEMENT (admin)',
  { email: 'admin@ara-workbench.local', password: 'ChangeMe@Admin123' },
  async (page, check) => {
    // The seeded admin is forced to change their password first.
    // Wait for the redirect rather than reading the URL immediately — the router
    // lands on '/' for a frame before RequireAuth bounces it to /change-password,
    // and asserting on that frame is a race, not a test.
    await page.waitForURL((u) => u.pathname.includes('/change-password'), { timeout: 10000 });
    check('forced onto /change-password (temporary password)', true);

    await page.fill('input[name="currentPassword"]', 'ChangeMe@Admin123');
    await page.fill('input[name="newPassword"]', 'Str0ng!Admin#2026');
    await page.fill('input[name="confirmPassword"]', 'Str0ng!Admin#2026');
    await page.screenshot({ path: `${SHOTS}/05-forced-password-change.png` });
    await page.click('button[type="submit"]');

    // The API revokes every session on a password change, so we land back at login.
    await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 15000 });
    check('all sessions revoked → bounced back to sign-in', true);

    await page.fill('input[type="email"], input[name="email"]', 'admin@ara-workbench.local');
    await page.fill('input[type="password"], input[name="password"]', 'Str0ng!Admin#2026');
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
    check('signs in with the NEW password', true);

    const nav = await page.textContent('nav');
    for (const item of ['Dashboard', 'Monitor', 'Approvals', 'Reports', 'Employees', 'Teams', 'Projects', 'Audit Log', 'Settings']) {
      check(`Management nav has "${item}"`, nav.includes(item));
    }

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);
    const dash = await page.textContent('body');

    check('dashboard renders', dash.length > 400);

    // The dashboard now leads with the CEO overview: one card per department and
    // a chase list. The charts moved BEHIND a toggle — deliberately, because a
    // 30-day compliance trend is not what a CEO opens this page to see.
    check('one card per department', /Tech Team/.test(dash) && /Video Editing/.test(dash));
    check('the X/Y headline is present', /\d+\s*\/\s*\d+/.test(dash));
    check('"Update required" chase list is present', /Update required/i.test(dash));
    check('it defaults to TODAY, not a 30-day range', !/Last 30 days/.test(dash));

    const chartsBefore = await page.locator('svg.recharts-surface').count();
    check('charts are hidden by default (not the CEO’s first question)', chartsBefore === 0);

    await page.screenshot({ path: `${SHOTS}/06-management-dashboard.png`, fullPage: true });

    // …and one click away for whoever wants them.
    await page.click('button:has-text("Detailed analytics")');
    await page.waitForTimeout(3000);
    const detail = await page.textContent('body');

    check('detailed analytics opens', /Compliance trend|Top projects|Hours logged/.test(detail));
    check('KPI cards are in there', /Hours logged|Projects active|Late/.test(detail));
    const svgs = await page.locator('svg.recharts-surface').count();
    check('charts actually render', svgs >= 1, `${svgs} chart surfaces`);

    await page.screenshot({ path: `${SHOTS}/06b-detailed-analytics.png`, fullPage: true });

    // THE headline requirement: department × date × employee.
    await page.goto(`${BASE}/monitor`, { waitUntil: 'networkidle' });
    await settle(page);
    const mon = await page.textContent('body');
    check('Management monitor renders', mon.includes('Monitor'));

    await page.locator('div[role="combobox"]').first().click();
    await page.waitForTimeout(600);
    const options = await page.textContent('body');
    check('department dropdown offers Tech Team', options.includes('Tech Team'));
    check('…and Digital Marketing', options.includes('Digital Marketing'));
    check('…and Social Media Management', options.includes('Social Media Management'));
    check('…and Video Editing', options.includes('Video Editing'));
    check('…and "All departments"', options.includes('All departments'));

    await page.screenshot({ path: `${SHOTS}/07-management-department-dropdown.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
    await settle(page);
    const users = await page.textContent('body');
    check('employee admin renders', users.length > 400);
    check('shows staff from multiple departments', users.includes('Tech Team') && users.includes('Video Editing'));
    await page.screenshot({ path: `${SHOTS}/08-management-users.png` });

    await page.goto(`${BASE}/admin/audit`, { waitUntil: 'networkidle' });
    await settle(page);
    const audit = await page.textContent('body');
    check('audit log renders', audit.length > 400);
    check('the audit log records LOGIN events', /LOGIN/i.test(audit));
    await page.screenshot({ path: `${SHOTS}/09-management-audit.png` });

    // Dark mode must not be an afterthought.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.locator('button:has(svg[data-testid="DarkModeOutlinedIcon"]), button:has(svg[data-testid="LightModeOutlinedIcon"])').first().click();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${SHOTS}/10-dark-mode.png`, fullPage: true });
    check('dark mode toggles without error', true);
  },
);

await browser.close();

console.log(results.join('\n'));
console.log(`\n${'─'.repeat(62)}`);
console.log(`\x1b[1m  ${passed} passed, ${failed} failed\x1b[0m`);
console.log(`${'─'.repeat(62)}\n`);
process.exit(failed > 0 ? 1 : 0);
