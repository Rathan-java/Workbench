/**
 * Interactive SMTP setup.
 *
 * WHY A SCRIPT AND NOT JUST "EDIT .env"
 * Because the two things that break an SMTP config are invisible in a text file:
 *
 *   1. The 465-vs-587 TLS trap. `SMTP_SECURE` means "open the connection with TLS
 *      immediately" (implicit TLS, port 465). It does NOT mean "use encryption".
 *      Port 587 uses STARTTLS and needs SMTP_SECURE=false. Set it true on 587 and
 *      the client waits forever for a handshake the server will never begin — it
 *      looks exactly like a firewall problem, and it is not. This script picks the
 *      right combination for you from the provider alone.
 *
 *   2. Gmail rejecting your account password. It requires an App Password, and the
 *      error it returns ("Username and Password not accepted") does not say so.
 *
 * So: this asks a few questions, writes .env, and then actually CONNECTS and SENDS
 * before telling you it worked. A config that has not delivered an email is not a
 * config that works — it is a config that has not failed yet.
 *
 *   node scripts/setup-mail.mjs
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const ENV_PATH = path.resolve(process.cwd(), '.env');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  amber: '\x1b[33m',
  blue: '\x1b[36m',
};

const say = (s = '') => console.log(s);
const ok = (s) => say(`  ${c.green}✓${c.reset} ${s}`);
const bad = (s) => say(`  ${c.red}✗${c.reset} ${s}`);
const note = (s) => say(`  ${c.dim}${s}${c.reset}`);

/**
 * The provider presets. Each one encodes the port/TLS combination that actually
 * works, so nobody has to know the 465-vs-587 rule.
 */
const PROVIDERS = {
  1: {
    name: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // 587 = STARTTLS. NEVER true here.
    requireTLS: true,
    needsAuth: true,
    passwordLabel: 'App Password (16 characters, NOT your Gmail password)',
    help: [
      'Gmail rejects your normal account password over SMTP. You need an App Password:',
      '',
      '  1. https://myaccount.google.com/security',
      '  2. Turn ON 2-Step Verification (App Passwords do not exist without it)',
      '  3. https://myaccount.google.com/apppasswords',
      '  4. Name it "Ara Workbench" → Create',
      '  5. Copy the 16-character code it shows you (spaces are fine)',
    ],
  },
  2: {
    name: 'Office 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    requireTLS: true,
    needsAuth: true,
    passwordLabel: 'password (or an App Password if MFA is on)',
    help: ['If your account has MFA enabled, you will need an App Password rather than your normal one.'],
  },
  3: {
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    requireTLS: true,
    needsAuth: true,
    fixedUser: 'apikey', // SendGrid's username is literally the word "apikey"
    passwordLabel: 'API key (starts with SG.)',
    help: ['SendGrid uses the literal username "apikey" and your API key as the password.'],
  },
  4: {
    name: 'Brevo (formerly Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    requireTLS: true,
    needsAuth: true,
    passwordLabel: 'SMTP key',
    help: ['Find your SMTP key under Brevo → SMTP & API → SMTP.'],
  },
  5: {
    name: 'MailHog (local dev — catches mail, sends nothing)',
    host: 'localhost',
    port: 1025,
    secure: false,
    requireTLS: false,
    needsAuth: false,
    help: ['Run `docker compose up -d mailhog`, then read the OTPs at http://localhost:8025'],
  },
  6: { name: 'Something else (enter the details manually)', custom: true },
};

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (q, fallback = '') => {
  const answer = (await rl.question(`  ${q}${fallback ? ` ${c.dim}[${fallback}]${c.dim}${c.reset}` : ''}: `)).trim();
  return answer || fallback;
};

say('');
say(`${c.bold}${c.blue}  Ara Workbench — SMTP setup${c.reset}`);
say(`${c.dim}  Configures the mail server that delivers password-reset OTPs.${c.reset}`);
say('');
say(`${c.bold}  Which provider?${c.reset}`);
for (const [key, p] of Object.entries(PROVIDERS)) say(`    ${key}. ${p.name}`);
say('');

const choice = await ask('Choose 1-6', '1');
const preset = PROVIDERS[choice];

if (!preset) {
  bad('Not a valid choice.');
  rl.close();
  process.exit(1);
}

say('');
say(`${c.bold}  ${preset.name}${c.reset}`);

if (preset.help) {
  say('');
  for (const line of preset.help) note(line);
  say('');
}

let config;

if (preset.custom) {
  const host = await ask('SMTP host');
  const port = Number(await ask('SMTP port', '587'));
  // Derive the TLS mode from the port rather than asking. This is the single most
  // common misconfiguration and there is no reason to let a human get it wrong.
  const secure = port === 465;
  const needsAuth = (await ask('Requires a username/password? (y/n)', 'y')).toLowerCase() !== 'n';
  const user = needsAuth ? await ask('Username') : '';
  const password = needsAuth ? await ask('Password') : '';
  const allowSelfSigned =
    (await ask('Is it an internal server with a self-signed certificate? (y/n)', 'n')).toLowerCase() === 'y';

  config = {
    host,
    port,
    secure,
    requireTLS: !secure && port !== 25,
    user,
    password,
    allowSelfSigned,
  };
  note(`Port ${port} → ${secure ? 'implicit TLS' : port === 25 ? 'no TLS' : 'STARTTLS'} (chosen for you)`);
} else {
  const user = preset.fixedUser ?? (preset.needsAuth ? await ask('Email address / username') : '');
  const password = preset.needsAuth ? await ask(preset.passwordLabel) : '';

  config = {
    host: preset.host,
    port: preset.port,
    secure: preset.secure,
    requireTLS: preset.requireTLS,
    user,
    password,
    allowSelfSigned: false,
  };

  if (preset.fixedUser) note(`Username is fixed as "${preset.fixedUser}" for ${preset.name}.`);
}

const fromAddress =
  (await ask('"From" address on the emails', config.user || 'no-reply@ara-workbench.local')) ||
  'no-reply@ara-workbench.local';
const fromName = await ask('"From" name', 'Ara Workbench');

// ---------------------------------------------------------------------------
// Test BEFORE writing. A config that has not delivered mail is not a config that
// works — it is one that has not failed yet.
// ---------------------------------------------------------------------------
say('');
say(`${c.bold}  Testing the connection…${c.reset}`);

const transporter = nodemailer.createTransport({
  host: config.host,
  port: config.port,
  secure: config.secure,
  requireTLS: config.requireTLS,
  auth: config.user ? { user: config.user, pass: config.password } : undefined,
  tls: config.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
  connectionTimeout: 12_000,
  greetingTimeout: 12_000,
});

/** Turn nodemailer's error codes into the sentence that actually fixes it. */
const diagnose = (error) => {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'ECONNREFUSED') {
    return config.port === 1025
      ? 'Nothing is listening on port 1025. Start MailHog:  docker compose up -d mailhog'
      : `Nothing is listening on ${config.host}:${config.port}. Check the host and port.`;
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return 'Connection timed out. Your network or antivirus may be blocking outbound SMTP (port 587). Corporate networks often do.';
  }
  if (code === 'EAUTH' || /invalid login|username and password|5\.7\.8/i.test(message)) {
    return /gmail/i.test(config.host)
      ? 'Gmail rejected the credentials. This almost always means you used your NORMAL password.\n     You must use a 16-character APP PASSWORD from https://myaccount.google.com/apppasswords\n     (2-Step Verification must be ON for that page to exist.)'
      : 'The server rejected the username or password.';
  }
  if (/self.signed|certificate/i.test(message)) {
    return 'TLS certificate rejected. For an internal relay, re-run and answer "y" to the self-signed question.';
  }
  return message;
};

try {
  await transporter.verify();
  ok('Connected and authenticated.');
} catch (error) {
  say('');
  bad(`Could not connect: ${error.message}`);
  say('');
  say(`  ${c.amber}${diagnose(error)}${c.reset}`);
  say('');
  note('Nothing was written to .env. Fix the above and run this again.');
  rl.close();
  process.exit(1);
}

// Now actually SEND one. Verifying the connection proves the server is reachable;
// it does not prove the server will accept a message from this sender.
const testTo = await ask('Send a test email to', config.user || fromAddress);

try {
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to: testTo,
    subject: 'Ara Workbench — SMTP is working',
    text: `Mail is configured correctly.\n\nPassword-reset codes will now be delivered to your employees.\n\nHost: ${config.host}:${config.port}\n`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2 style="color:#0F172A;margin:0 0 8px">Mail is working ✅</h2>
      <p style="color:#334155;line-height:1.6">
        Password-reset codes will now be delivered to your employees.
      </p>
      <p style="color:#64748B;font-size:13px">${config.host}:${config.port}</p>
    </div>`,
  });
  ok(`Test email sent to ${testTo}  ${c.dim}(${info.messageId})${c.reset}`);
} catch (error) {
  say('');
  bad(`Connected, but the server refused to send: ${error.message}`);
  say('');
  say(`  ${c.amber}${diagnose(error)}${c.reset}`);
  note('Nothing was written to .env.');
  rl.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// It works. Only now do we touch .env.
// ---------------------------------------------------------------------------
let env = fs.readFileSync(ENV_PATH, 'utf8');

const setKey = (key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env}\n${line}`;
};

setKey('MAIL_ENABLED', 'true');
setKey('SMTP_HOST', config.host);
setKey('SMTP_PORT', String(config.port));
setKey('SMTP_SECURE', String(config.secure));
setKey('SMTP_REQUIRE_TLS', String(config.requireTLS));
setKey('SMTP_USER', config.user);
setKey('SMTP_PASSWORD', config.password);
setKey('SMTP_ALLOW_SELF_SIGNED', String(config.allowSelfSigned));
setKey('MAIL_FROM_ADDRESS', fromAddress);
setKey('MAIL_FROM_NAME', `"${fromName}"`);

fs.writeFileSync(ENV_PATH, env);

say('');
ok('Written to backend/.env');
say('');
say(`${c.bold}  Done. Restart the API and the OTP flow will send real email.${c.reset}`);
say('');
note('  npm run dev');
note('');
note('  Then: sign out → "Forgot password?" → the code arrives in the inbox.');
say('');
say(`  ${c.amber}⚠ backend/.env now contains a live credential. It is already in .gitignore —${c.reset}`);
say(`  ${c.amber}  keep it that way, and never commit it.${c.reset}`);
say('');

rl.close();
