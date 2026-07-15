/**
 * Email transport (Nodemailer) + the template layer.
 *
 * DESIGN DECISIONS
 *  - Sending is NEVER awaited on a user-facing request path. A slow SMTP server
 *    must not turn a 40ms password-reset request into a 30-second one. The only
 *    exception is the OTP mail, where a silent failure would strand the user.
 *  - Templates live here as pure functions returning { subject, html, text }.
 *    Every mail ships a plaintext part — half of enterprise mail clients render
 *    it, and a missing text/plain part is a spam-score penalty.
 *  - MAIL_ENABLED=false logs the message instead of sending. That is how the
 *    test suite and a local dev box work without an SMTP server.
 */
import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from './logger.js';

let transporter = null;
/** Set by verifyMailer() at boot. Surfaced on /system/mail so an admin can see it. */
let lastVerification = { verified: false, error: null, checkedAt: null };

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,

    /**
     * `secure` means "open the connection with TLS immediately" (implicit TLS,
     * port 465). It does NOT mean "use encryption" in general.
     *
     * This distinction is the single most common reason a working SMTP config
     * refuses to connect, so, explicitly:
     *
     *   port 465  →  secure: true    implicit TLS from the first byte
     *   port 587  →  secure: FALSE   plaintext, then upgraded via STARTTLS
     *   port 25   →  secure: false
     *   port 1025 →  secure: false   (MailHog, local dev — no TLS at all)
     *
     * Setting secure:true on 587 makes the client wait forever for a TLS
     * handshake the server will never start. It looks like a network problem and
     * it is not.
     */
    secure: env.SMTP_SECURE,

    // Upgrade to TLS whenever the server offers it, which is what makes port 587
    // actually encrypted despite `secure: false` above.
    requireTLS: env.SMTP_REQUIRE_TLS,

    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,

    pool: true, // reuse connections — the digest job sends dozens at once
    maxConnections: 5,
    maxMessages: 100,

    // Without these, an unreachable SMTP host hangs the request that triggered it
    // until the OS gives up — which for a TCP connect can be over two minutes.
    // The user is left staring at a spinner on the forgot-password screen.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,

    // ONLY for a self-signed corporate relay, and never for a public provider.
    tls: env.SMTP_ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : undefined,

    logger: env.SMTP_DEBUG,
    debug: env.SMTP_DEBUG,
  });

  return transporter;
};

/** What the admin screen shows. Never leaks the password. */
export const getMailStatus = () => ({
  enabled: env.MAIL_ENABLED,
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  requireTLS: env.SMTP_REQUIRE_TLS,
  authenticated: Boolean(env.SMTP_USER),
  user: env.SMTP_USER ? `${env.SMTP_USER.slice(0, 3)}***` : null,
  from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
  ...lastVerification,
});

/**
 * Send a test email. Wired to a button in Settings so an administrator can prove
 * the SMTP configuration works WITHOUT having to trigger a real password reset on
 * somebody's account and hope.
 */
export const sendTestMail = async (to) => {
  if (!env.MAIL_ENABLED) {
    throw new Error('Mail is disabled (MAIL_ENABLED=false). Emails are logged, not sent.');
  }

  await getTransporter().verify();

  const info = await getTransporter().sendMail({
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
    to,
    subject: `${env.APP_NAME} — test email`,
    text: `This is a test email from ${env.APP_NAME}.\n\nIf you are reading it, SMTP is configured correctly and password-reset codes will be delivered.\n\nHost: ${env.SMTP_HOST}:${env.SMTP_PORT}\nSent: ${new Date().toISOString()}\n`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2 style="color:#0F172A;margin:0 0 8px">Mail is working ✅</h2>
      <p style="color:#334155;line-height:1.6">
        This is a test email from <strong>${env.APP_NAME}</strong>. If you are reading it, SMTP is
        configured correctly and password-reset codes will be delivered.
      </p>
      <table style="font-size:13px;color:#64748B;border-collapse:collapse">
        <tr><td style="padding:2px 12px 2px 0">Host</td><td>${env.SMTP_HOST}:${env.SMTP_PORT}</td></tr>
        <tr><td style="padding:2px 12px 2px 0">TLS</td><td>${env.SMTP_SECURE ? 'implicit (465)' : env.SMTP_REQUIRE_TLS ? 'STARTTLS' : 'none'}</td></tr>
        <tr><td style="padding:2px 12px 2px 0">Sent</td><td>${new Date().toISOString()}</td></tr>
      </table>
    </div>`,
  });

  lastVerification = { verified: true, error: null, checkedAt: new Date().toISOString() };
  logger.info('Test email sent', { to, messageId: info.messageId });

  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
};

export const verifyMailer = async () => {
  if (!env.MAIL_ENABLED) {
    logger.warn('Mail is DISABLED (MAIL_ENABLED=false). Emails will be logged, not sent.');
    lastVerification = { verified: false, error: 'MAIL_ENABLED=false', checkedAt: new Date().toISOString() };
    return false;
  }

  try {
    await getTransporter().verify();
    lastVerification = { verified: true, error: null, checkedAt: new Date().toISOString() };
    logger.info('✓ SMTP verified — password reset codes will be delivered', {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      authenticated: Boolean(env.SMTP_USER),
    });
    return true;
  } catch (error) {
    lastVerification = { verified: false, error: error.message, checkedAt: new Date().toISOString() };

    // A dead SMTP server must NOT prevent the API from booting — task logging is
    // the product; email is a courtesy. But it must be impossible to miss, because
    // the symptom otherwise is "password reset silently does nothing".
    logger.error(
      '✖ SMTP VERIFICATION FAILED — password reset emails will NOT be delivered',
      {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        error: error.message,
        hint: diagnose(error),
      },
    );
    return false;
  }
};

/**
 * Turn nodemailer's error codes into the sentence that actually fixes the problem.
 * A bare "ECONNREFUSED" costs an engineer half an hour; naming the likely cause
 * costs them nothing.
 */
const diagnose = (error) => {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'ECONNREFUSED') {
    return env.SMTP_PORT === 1025
      ? 'Nothing is listening on port 1025. Start MailHog: `docker compose up -d mailhog`.'
      : `Nothing is listening on ${env.SMTP_HOST}:${env.SMTP_PORT}. Check SMTP_HOST and SMTP_PORT.`;
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return env.SMTP_SECURE && env.SMTP_PORT === 587
      ? 'SMTP_SECURE=true on port 587 is wrong. 587 uses STARTTLS: set SMTP_SECURE=false (and SMTP_REQUIRE_TLS=true). Only port 465 uses SMTP_SECURE=true.'
      : 'The connection timed out. A firewall may be blocking outbound SMTP, or the host is wrong.';
  }
  if (code === 'EAUTH' || /invalid login|username and password/i.test(message)) {
    return /gmail/i.test(env.SMTP_HOST)
      ? 'Gmail rejects your normal account password. You must create an APP PASSWORD (Google Account → Security → 2-Step Verification → App passwords) and use that as SMTP_PASSWORD.'
      : 'The SMTP server rejected the username or password. Check SMTP_USER and SMTP_PASSWORD.';
  }
  if (/self.signed|certificate/i.test(message)) {
    return 'TLS certificate rejected. For an internal relay with a self-signed cert, set SMTP_ALLOW_SELF_SIGNED=true. Never do this for a public provider.';
  }
  return 'Set SMTP_DEBUG=true and restart to see the full SMTP conversation.';
};

/**
 * @param {{to: string|string[], subject: string, html: string, text: string}} message
 */
export const sendMail = async ({ to, subject, html, text }) => {
  if (!env.MAIL_ENABLED) {
    logger.info('[MAIL DISABLED] Would have sent email', { to, subject });
    return { accepted: [], disabled: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      html,
      text,
    });
    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error('Email delivery failed', { to, subject, error: error.message });
    throw error;
  }
};

/** Fire-and-forget wrapper for non-critical mail (reminders, digests). */
export const sendMailSafe = (message) =>
  void sendMail(message).catch((error) =>
    logger.warn('Non-critical email failed; continuing', {
      subject: message.subject,
      error: error.message,
    }),
  );

export default { sendMail, sendMailSafe, verifyMailer };
