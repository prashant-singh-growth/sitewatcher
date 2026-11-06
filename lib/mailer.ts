import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
export function smtpConfigured() { const e = process.env; return Boolean(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD); }
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
  transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 465), secure: SMTP_SECURE !== 'false', auth: { user: SMTP_USER, pass: SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000 });
  return transporter;
}
export type MailInput = { to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] };
/** Returns { skipped: true } when SMTP is not configured; throws on delivery failure. */
export async function sendMail(m: MailInput): Promise<{ skipped: boolean }> {
  if (!smtpConfigured() || !m.to) { console.warn('[SiteWatch] SMTP not configured or no recipient; skipping email:', m.subject); return { skipped: true }; }
  await getTransporter().sendMail({ from: process.env.ALERT_FROM || process.env.SMTP_USER, ...m });
  return { skipped: false };
}
/** Backwards-compatible helper: sends to ALERT_TO. */
export async function sendAlert(subject: string, text: string, to = process.env.ALERT_TO || '') { return sendMail({ to, subject, text }); }
