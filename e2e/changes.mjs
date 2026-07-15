/**
 * Browser verification of the CHANGE SET (the 11 requested changes).
 * Fails on any console error.
 */
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'e2e/screenshots';

let passed = 0;
let failed = 0;
const out = [];
const check = (n, ok, d = '') => {
  if (ok) { passed += 1; out.push(`  ✓ ${n}`); }
  else { failed += 1; out.push(`  ✗ ${n}${d ? ` → ${d}` : ''}`); }
};
const section = (t) => out.push(`\n${t}`);

/** Give MUI popovers and the 1.2s autosave debounce time to settle. */
const settle = (page) => page.waitForTimeout(1400);

const browser = await chromium.launch();

const signIn = async (page, email, password) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
};

const errorsOf = (page, bag) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (t.includes('401')) return; // the pre-auth /auth/refresh probe
    bag.push(t.slice(0, 140));
  });
  page.on('pageerror', (e) => bag.push(`UNCAUGHT: ${e.message.slice(0, 140)}`));
};

// ---------------------------------------------------------------------------
section('EMPLOYEE — overtime "+", late entry, edit after save');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  errorsOf(page, errs);

  await signIn(page, 'arjun.nair@ara-workbench.local', 'Password@2026!');
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  let body = await page.textContent('body');
  check('task sheet renders', body.includes('My Task Sheet'));
  check('the "+" (Add an extra hour) is offered', body.includes('Add an extra hour'));

  // Count hour COLUMNS, not textareas — each cell owns a description box and a
  // remarks box, and remarks only mounts when the cell is expanded. The textarea
  // count therefore moves for reasons that have nothing to do with the grid.
  const countHours = () => page.locator('text=/^\\d{2}:\\d{2} - \\d{2}:\\d{2}$/').count();
  const before = await countHours();

  // Fill the 10:00 hour NOW — long after it elapsed. This must be allowed.
  // The new flow: type WHAT you did, pick the project it was FOR, then Save.
  const openFirstHour = async () => {
    const prompt = page.getByText('What did you complete this hour?', { exact: false }).first();
    if (await prompt.count()) {
      await prompt.click();
      await settle(page);
    }
  };
  const pickFirstProject = async () => {
    await page.getByRole('combobox', { name: 'Project' }).first().click();
    await settle(page);
    await page.getByRole('option').first().click();
    await settle(page);
  };

  await openFirstHour();
  const first = page.locator('textarea').first();
  await first.click();
  await first.fill('Wrote the payment reconciliation logic and its tests');
  await pickFirstProject();
  await page.getByRole('button', { name: /Save this hour|Save changes/ }).first().click();
  await page.waitForTimeout(1400);

  body = await page.textContent('body');
  check(
    'the 10:00 hour can be filled at any point in the day',
    body.includes('Wrote the payment reconciliation logic'),
  );

  /**
   * The LATE flag is time-dependent, and asserting it unconditionally makes this
   * test pass or fail depending on what time of day CI happens to run.
   *
   * The rule: an entry is late once the hour has been over for longer than the
   * grace period (2 hours). The 10:00–11:00 slot therefore only turns late after
   * 13:00. Compute the same thing the server does, and assert accordingly — so
   * this test proves the flag is CORRECT rather than merely present.
   */
  const nowIst = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h, m] = nowIst.split(':').map(Number);
  const minutesNow = h * 60 + m;
  const shouldBeLate = minutesNow > 660 + 120; // slot ends 11:00, grace 2h → 13:00

  check(
    shouldBeLate
      ? `it IS past 13:00 (${nowIst}), so the entry is correctly flagged LATE`
      : `it is only ${nowIst}, still inside the 2-hour grace, so the entry is correctly NOT late`,
    body.includes('LATE') === shouldBeLate,
    `LATE chip ${body.includes('LATE') ? 'present' : 'absent'}, expected ${shouldBeLate ? 'present' : 'absent'}`,
  );

  // Edit it AGAIN, after it was saved. The saved hour now reads as a card; click
  // it to reopen, change the text, and save the change.
  await page.getByText('Wrote the payment reconciliation logic', { exact: false }).first().click();
  await settle(page);
  const reopened = page.locator('textarea').first();
  await reopened.click();
  await reopened.fill('Wrote the payment reconciliation logic, its tests, and the migration');
  await page.getByRole('button', { name: /Save changes|Save this hour/ }).first().click();
  await page.waitForTimeout(1400);
  body = await page.textContent('body');
  check(
    'an already-saved entry can be edited again',
    body.includes('and the migration'),
  );

  await page.screenshot({ path: `${SHOTS}/c1-late-entry.png` });

  // The "+".
  await page.click('button:has-text("Add an extra hour")');
  await page.waitForTimeout(2600);

  const after = await countHours();
  body = await page.textContent('body');

  check('the "+" appends a new hour column', after === before + 1, `${before} → ${after} columns`);
  check('…marked EXTRA (optional)', body.includes('EXTRA'));
  check('…and 18:00 - 19:00 is the appended hour', body.includes('18:00 - 19:00'));

  // The critical assertion: it must NOT change the required-hours denominator.
  check(
    'the required-hours count is UNCHANGED (overtime is never mandatory)',
    /of 7 hours logged/.test(body),
    body.match(/\d+ of \d+ hours logged/)?.[0],
  );

  await page.screenshot({ path: `${SHOTS}/c2-overtime-added.png` });

  const nav = await page.textContent('nav');
  check('an Employee still sees no admin nav', !nav.includes('Departments'));

  check('no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
section('MANAGEMENT — no task sheet, dynamic departments, team follow-up');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  const errs = [];
  errorsOf(page, errs);

  await signIn(page, 'admin@ara-workbench.local', 'ChangeMe@Admin123');

  // Forced password change first.
  await page.waitForURL((u) => u.pathname.includes('/change-password'), { timeout: 10000 });
  await page.fill('input[name="currentPassword"]', 'ChangeMe@Admin123');
  await page.fill('input[name="newPassword"]', 'Adm1n!2026');
  await page.fill('input[name="confirmPassword"]', 'Adm1n!2026');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 15000 });
  check('a 10-char password is accepted (min is now 6)', true);

  await signIn(page, 'admin@ara-workbench.local', 'Adm1n!2026');

  const nav = await page.textContent('nav');
  check('MANAGEMENT has NO "My Task Sheet"', !nav.includes('My Task Sheet'));
  check('…but does have Monitor', nav.includes('Monitor'));
  check('a "Departments" admin item exists', nav.includes('Departments'));

  // Typing /tasks must not dump them on an error.
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(
    'typing /tasks redirects them away instead of erroring',
    !page.url().includes('/tasks'),
    page.url(),
  );

  // The dashboard now LEADS with the CEO overview: one card per department, plus
  // a chase list. Everything analytical (including team follow-up) moved behind a
  // "Detailed analytics" toggle — a 30-day trend is not the first question.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const dash = await page.textContent('body');

  check('one card per department', /Tech Team/.test(dash) && /Video Editing/.test(dash));
  check('each card reads X / Y updates', /\d+\s*\/\s*\d+/.test(dash));
  check('"hourly updates done" is the metric', /hourly updates done/i.test(dash));
  check('"Update required" chase list is present', /Update required/i.test(dash));
  check('defaults to TODAY, not a 30-day range', !/Last 30 days/.test(dash));
  check('Live compliance is kept', /Not logged|Compliant/.test(dash));
  await page.screenshot({ path: `${SHOTS}/c3-ceo-dashboard.png`, fullPage: true });

  // Team follow-up still exists — one click away.
  await page.click('button:has-text("Detailed analytics")');
  await page.waitForTimeout(3200);
  const detail = await page.textContent('body');
  check('TEAM FOLLOW-UP lives in detailed analytics', /follow.?up/i.test(detail));
  check('…with a fill vs on-time distinction', /on time/i.test(detail) && /filled/i.test(detail));
  check('…and names the 2-hour grace period', /2 hours|120/i.test(detail));
  await page.screenshot({ path: `${SHOTS}/c3b-team-followup.png`, fullPage: true });

  // Departments admin.
  await page.goto(`${BASE}/admin/departments`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const depts = await page.textContent('body');
  check('the Departments admin page renders', depts.includes('Departments'));
  check('…listing all four', depts.includes('Tech Team') && depts.includes('Video Editing'));
  const newBtn = await page.locator('button:has-text("New department"), button:has-text("Add department"), button:has-text("Create")').count();
  check('…with a way to CREATE one', newBtn > 0);
  await page.screenshot({ path: `${SHOTS}/c4-departments-admin.png` });

  // Role label.
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const users = await page.textContent('body');
  check('the role reads "Tech Lead / Team Lead"', users.includes('Tech Lead / Team Lead'),
    users.match(/Tech Lead[^,<]*/)?.[0]);
  await page.screenshot({ path: `${SHOTS}/c5-role-label.png` });

  // Reports filters.
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const rep = await page.textContent('body');
  check('Reports has NO Team filter', !/All teams/.test(rep));
  check('Reports has NO Status filter', !/Any status/.test(rep));
  check('Reports has NO Priority filter', !/Any priority/.test(rep));
  check('Reports still has Department', /Department/.test(rep));
  check('Reports still has Project', /All projects|Project/.test(rep));
  await page.screenshot({ path: `${SHOTS}/c6-reports-trimmed.png` });

  // Mail settings.
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const set = await page.textContent('body');
  check('Settings has a Mail section', /mail/i.test(set));
  check('…showing mail IS working', /working|verified|delivered/i.test(set));
  check('…with a "Send test email" control', /test email/i.test(set));
  // The grace period renders inside a controlled <input>. React sets `.value` as
  // a DOM PROPERTY, not an attribute — so neither textContent nor an
  // `input[value="120"]` attribute selector can see it. Read the live property.
  const graceValue = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((i) => i.value).find((v) => v === '120'),
  );
  check(
    '…and the grace period reads 120 minutes (2 hours)',
    graceValue === '120' || /120/.test(set),
    'no input holds the value 120',
  );
  await page.screenshot({ path: `${SHOTS}/c7-mail-settings.png`, fullPage: true });

  check('no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();

console.log(out.join('\n'));
console.log(`\n${'─'.repeat(60)}\n  ${passed} passed, ${failed} failed\n${'─'.repeat(60)}\n`);
process.exit(failed > 0 ? 1 : 0);
