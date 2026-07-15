/**
 * Transactional email templates.
 *
 * Table-based HTML with inline styles — not because it is pleasant, but because
 * Outlook (which is what an IT company actually reads mail in) ignores <style>
 * blocks, flexbox and grid. Every template returns { subject, html, text }.
 *
 * All interpolated content passes through `esc()`. A user's display name ends
 * up in an email body; without escaping, an employee named
 * `<img src=x onerror=...>` is a stored XSS in the Tech Lead's webmail client.
 */
import { env } from '../../config/env.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const BRAND = '#2563EB';
const INK = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

const layout = ({ title, preheader, body, cta }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader ?? '')}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:22px 32px;border-bottom:1px solid ${BORDER};">
            <span style="font-size:16px;font-weight:700;color:${INK};letter-spacing:-0.2px;">
              <span style="color:${BRAND};">◆</span>&nbsp;${esc(env.APP_NAME)}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${INK};font-weight:650;">${esc(title)}</h1>
            <div style="font-size:14px;line-height:1.65;color:#334155;">${body}</div>
            ${
              cta
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;">
                     <tr><td style="background:${BRAND};border-radius:8px;">
                       <a href="${esc(cta.url)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(cta.label)}</a>
                     </td></tr>
                   </table>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#F8FAFC;border-top:1px solid ${BORDER};">
            <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
              This is an automated message from ${esc(env.APP_NAME)}. Please do not reply.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const listHtml = (items) =>
  `<ul style="margin:12px 0;padding-left:20px;color:#334155;">${items
    .map((i) => `<li style="margin-bottom:6px;">${i}</li>`)
    .join('')}</ul>`;

const statCard = (label, value, color = INK) => `
  <td style="padding:12px 14px;border:1px solid ${BORDER};border-radius:8px;width:25%;" align="center">
    <div style="font-size:22px;font-weight:700;color:${color};line-height:1.2;">${esc(value)}</div>
    <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${esc(label)}</div>
  </td>`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const passwordResetOtpEmail = ({ firstName, otp, ttlMinutes }) => {
  const subject = `${otp} is your ${env.APP_NAME} verification code`;

  const body = `
    <p style="margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 20px;">Use the verification code below to reset your password.</p>
    <div style="margin:0 0 20px;padding:20px;background:#F8FAFC;border:1px dashed ${BORDER};border-radius:10px;text-align:center;">
      <div style="font-family:'SFMono-Regular',Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${INK};padding-left:10px;">${esc(otp)}</div>
    </div>
    <p style="margin:0 0 8px;color:${MUTED};font-size:13px;">
      This code expires in <strong>${ttlMinutes} minutes</strong> and can be used once.
    </p>
    <p style="margin:0;color:${MUTED};font-size:13px;">
      If you did not request a password reset, you can safely ignore this email — your password will not change.
    </p>`;

  return {
    subject,
    html: layout({ title: 'Reset your password', preheader: `Your code is ${otp}`, body }),
    text: `Hi ${firstName},\n\nYour ${env.APP_NAME} verification code is: ${otp}\n\nIt expires in ${ttlMinutes} minutes and can only be used once.\n\nIf you did not request this, ignore this email.\n`,
  };
};

export const welcomeEmail = ({ firstName, email, temporaryPassword, departmentName, role }) => {
  const body = `
    <p style="margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 16px;">An account has been created for you on ${esc(env.APP_NAME)}, where you'll log your daily work.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid ${BORDER};border-radius:8px;">
      <tr><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};width:40%;">Email</td><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};font-weight:600;">${esc(email)}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};">Temporary password</td><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-family:monospace;font-size:13px;color:${INK};font-weight:600;">${esc(temporaryPassword)}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};">Department</td><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};">${esc(departmentName ?? '—')}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:${MUTED};">Role</td><td style="padding:10px 14px;font-size:13px;color:${INK};">${esc(role)}</td></tr>
    </table>
    <p style="margin:0;color:#B45309;font-size:13px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:10px 12px;">
      <strong>You must change this password</strong> the first time you sign in.
    </p>`;

  return {
    subject: `Welcome to ${env.APP_NAME}`,
    html: layout({
      title: `Your ${env.APP_NAME} account is ready`,
      preheader: 'Sign in and set your password.',
      body,
      cta: { url: `${env.CLIENT_URL}/login`, label: 'Sign in' },
    }),
    text: `Hi ${firstName},\n\nYour ${env.APP_NAME} account is ready.\n\nEmail: ${email}\nTemporary password: ${temporaryPassword}\nDepartment: ${departmentName ?? '-'}\nRole: ${role}\n\nSign in at ${env.CLIENT_URL}/login. You must change your password on first sign-in.\n`,
  };
};

export const passwordChangedEmail = ({ firstName, ip, when }) => {
  const body = `
    <p style="margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 16px;">Your ${esc(env.APP_NAME)} password was changed on <strong>${esc(when)}</strong>${ip ? ` from IP <strong>${esc(ip)}</strong>` : ''}.</p>
    <p style="margin:0;padding:10px 12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;color:#B91C1C;font-size:13px;">
      If this wasn't you, contact your administrator immediately — your account may be compromised.
    </p>`;

  return {
    subject: 'Your password was changed',
    html: layout({ title: 'Password changed', preheader: 'Security notification', body }),
    text: `Hi ${firstName},\n\nYour ${env.APP_NAME} password was changed on ${when}${ip ? ` from IP ${ip}` : ''}.\n\nIf this wasn't you, contact your administrator immediately.\n`,
  };
};

export const missedUpdateEmail = ({ firstName, slotLabels, workDate }) => {
  const body = `
    <p style="margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 4px;">You haven't logged your work for the following hours on <strong>${esc(workDate)}</strong>:</p>
    ${listHtml(slotLabels.map((s) => `<strong>${esc(s)}</strong>`))}
    <p style="margin:12px 0 0;color:${MUTED};font-size:13px;">Please update your task sheet. Entries logged after the hour has passed are marked as late.</p>`;

  return {
    subject: `Reminder: ${slotLabels.length} hour${slotLabels.length === 1 ? '' : 's'} not logged`,
    html: layout({
      title: 'Your task sheet needs updating',
      preheader: `${slotLabels.length} hour(s) missing for ${workDate}`,
      body,
      cta: { url: `${env.CLIENT_URL}/tasks`, label: 'Update task sheet' },
    }),
    text: `Hi ${firstName},\n\nYou haven't logged work for these hours on ${workDate}:\n${slotLabels.map((s) => `  - ${s}`).join('\n')}\n\nUpdate at ${env.CLIENT_URL}/tasks\n`,
  };
};

export const leadDigestEmail = ({ leadName, departmentName, workDate, offenders, compliance }) => {
  const rows = offenders
    .map(
      (o) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};">${esc(o.name)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};">${esc(o.employeeCode)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:#B91C1C;font-weight:600;" align="right">${o.missing} missing</td>
      </tr>`,
    )
    .join('');

  const body = `
    <p style="margin:0 0 16px;">Hi ${esc(leadName)}, here is the ${esc(departmentName)} update status for <strong>${esc(workDate)}</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;margin:0 0 20px;">
      <tr>
        ${statCard('Compliance', `${compliance.rate}%`, compliance.rate >= 80 ? '#15803D' : '#B91C1C')}
        ${statCard('Logged', compliance.compliant)}
        ${statCard('Missing', compliance.offenders, '#B91C1C')}
        ${statCard('Team size', compliance.total)}
      </tr>
    </table>
    ${
      offenders.length
        ? `<p style="margin:0 0 8px;font-weight:600;color:${INK};font-size:14px;">Employees with missing hours</p>
           <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER};border-radius:8px;">${rows}</table>`
        : `<p style="margin:0;padding:12px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#15803D;font-size:13px;">Everyone in your department has logged their hours. Nothing to chase.</p>`
    }`;

  return {
    subject: `[${departmentName}] ${offenders.length} employee(s) with missing updates — ${workDate}`,
    html: layout({
      title: 'Team update status',
      preheader: `${compliance.rate}% compliance today`,
      body,
      cta: { url: `${env.CLIENT_URL}/monitor?date=${workDate}`, label: 'Review team sheets' },
    }),
    text: `Hi ${leadName},\n\n${departmentName} status for ${workDate}\nCompliance: ${compliance.rate}% (${compliance.compliant}/${compliance.total})\n\nMissing updates:\n${offenders.map((o) => `  - ${o.name} (${o.employeeCode}): ${o.missing} hours missing`).join('\n') || '  none'}\n`,
  };
};

export const managementSummaryEmail = ({ workDate, totals, departments }) => {
  const rows = departments
    .map(
      (d) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};font-weight:600;">${esc(d.name)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};" align="center">${d.employees}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};" align="center">${d.entries}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};" align="center">${d.projects}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-size:13px;font-weight:600;color:${d.compliance >= 80 ? '#15803D' : d.compliance >= 60 ? '#B45309' : '#1D4ED8'};" align="right">${d.compliance}%</td>
      </tr>`,
    )
    .join('');

  const body = `
    <p style="margin:0 0 16px;">Daily activity summary for <strong>${esc(workDate)}</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;margin:0 0 20px;">
      <tr>
        ${statCard('Hours logged', totals.entries)}
        ${statCard('Active staff', totals.activeEmployees)}
        ${statCard('Projects moved', totals.projects, '#1D4ED8')}
        ${statCard('Late updates', totals.lateUpdates, '#B45309')}
      </tr>
    </table>
    <p style="margin:0 0 8px;font-weight:600;color:${INK};font-size:14px;">By department</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER};border-radius:8px;">
      <tr style="background:#F8FAFC;">
        <th align="left" style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${BORDER};">Department</th>
        <th align="center" style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${BORDER};">Staff</th>
        <th align="center" style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${BORDER};">Hours</th>
        <th align="center" style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${BORDER};">Projects</th>
        <th align="right" style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${BORDER};">Compliance</th>
      </tr>
      ${rows}
    </table>`;

  return {
    subject: `Daily summary — ${workDate} — ${totals.entries} hours logged, ${totals.complianceRate}% compliance`,
    html: layout({
      title: 'Daily activity summary',
      preheader: `${totals.entries} hours logged across ${departments.length} departments`,
      body,
      cta: { url: `${env.CLIENT_URL}/dashboard`, label: 'Open dashboard' },
    }),
    text: `Daily summary for ${workDate}\n\nHours logged: ${totals.entries}\nActive staff: ${totals.activeEmployees}\nProjects moved: ${totals.projects}\nLate updates: ${totals.lateUpdates}\n\n${departments.map((d) => `${d.name}: ${d.employees} staff, ${d.entries} hours, ${d.projects} projects, ${d.compliance}% compliance`).join('\n')}\n`,
  };
};

export const taskReviewedEmail = ({ firstName, workDate, approved, reviewerName, note }) => {
  const body = `
    <p style="margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 16px;">Your task sheet for <strong>${esc(workDate)}</strong> was
      <strong style="color:${approved ? '#15803D' : '#B91C1C'};">${approved ? 'approved' : 'sent back for changes'}</strong>
      by ${esc(reviewerName)}.</p>
    ${
      note
        ? `<div style="padding:12px 14px;background:#F8FAFC;border-left:3px solid ${approved ? '#15803D' : '#B91C1C'};border-radius:4px;">
             <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};margin-bottom:4px;">Reviewer note</div>
             <div style="font-size:13px;color:${INK};">${esc(note)}</div>
           </div>`
        : ''
    }`;

  return {
    subject: `Task sheet ${approved ? 'approved' : 'returned'} — ${workDate}`,
    html: layout({
      title: approved ? 'Task sheet approved' : 'Task sheet returned for changes',
      preheader: note ?? '',
      body,
      cta: { url: `${env.CLIENT_URL}/tasks?date=${workDate}`, label: 'View task sheet' },
    }),
    text: `Hi ${firstName},\n\nYour task sheet for ${workDate} was ${approved ? 'approved' : 'returned for changes'} by ${reviewerName}.\n${note ? `\nNote: ${note}\n` : ''}`,
  };
};
