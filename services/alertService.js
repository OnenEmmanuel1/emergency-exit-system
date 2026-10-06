'use strict';

/**
 * alertService.js
 * ─────────────────────────────────────────────────────────────
 * Alert Module — Section 5.6
 *
 * Sends real email (Nodemailer) and SMS (Twilio) notifications
 * to the Administrator on:
 *   • Any hazard declaration
 *   • Sustained high-density readings (polled by the simulator)
 *
 * SMS_MODE=simulate → logs to console only (default, safe for dev)
 * SMS_MODE=live     → actually sends via Twilio
 *
 * Every attempt is logged to the alerts table with status Sent/Failed.
 */

const nodemailer = require('nodemailer');
const { query }  = require('../db/db');

// ── Email transport ───────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.example.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

// ── SMS via Twilio ────────────────────────────────────────────

async function sendSms(to, body) {
  const mode = process.env.SMS_MODE || 'simulate';
  if (mode !== 'live') {
    console.log(`[SMS SIMULATE] To: ${to} | Body: ${body}`);
    return { simulated: true };
  }
  const twilio = require('twilio');
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body,
  });
}

// ── Core send function ────────────────────────────────────────

/**
 * Send alert via both Email and SMS and log each attempt.
 * @param {object} opts
 * @param {number} opts.userId    – Administrator user ID
 * @param {number|null} opts.hazardId – linked hazard (null for density alerts)
 * @param {string} opts.message   – short alert message
 * @param {string} opts.subject   – email subject line
 */
async function sendAlert({ userId, hazardId = null, message, subject }) {
  // Fetch admin contact info
  const [users] = await query(
    'SELECT email, phone FROM users WHERE userId = ?', [userId]
  );
  if (!users.length) {
    console.warn(`[Alert] No user found for userId=${userId}`);
    return;
  }
  const { email, phone } = users[0];

  // ── Email ────────────────────────────────────────────────
  let emailStatus = 'Failed';
  try {
    const transport = createTransport();
    await transport.sendMail({
      from:    process.env.ALERT_FROM || 'alerts@seex.local',
      to:      email,
      subject: `[SEEX Alert] ${subject}`,
      text:    `${message}\n\n⚠️  SEEX is an academic prototype and is NOT a certified life-safety system.`,
      html:    `<p>${message}</p><hr/><p style="color:#888;font-size:12px;">SEEX is an academic software prototype and is NOT a substitute for certified fire-alarm or life-safety systems.</p>`,
    });
    emailStatus = 'Sent';
  } catch (err) {
    console.error('[Alert Email] Failed:', err.message);
  }

  await query(
    `INSERT INTO alerts (hazardId, userId, channel, message, status, sentAt)
     VALUES (?, ?, 'Email', ?, ?, NOW())`,
    [hazardId, userId, message.substring(0, 499), emailStatus]
  );

  // ── SMS ─────────────────────────────────────────────────
  {
    let smsStatus = 'Failed';
    try {
      if (!phone) throw new Error('Administrator phone number is not configured. Set ADMIN_PHONE and reseed the administrator.');
      const result = await sendSms(phone, `[SEEX] ${message}`);
      smsStatus = result.simulated ? 'Simulated' : 'Sent';
    } catch (err) {
      console.error('[Alert SMS] Failed:', err.message);
    }
    await query(
      `INSERT INTO alerts (hazardId, userId, channel, message, status, sentAt)
       VALUES (?, ?, 'SMS', ?, ?, NOW())`,
      [hazardId, userId, message.substring(0, 499), smsStatus]
    );
  }
}

/**
 * Alert all Administrator users about a hazard.
 */
async function alertAllAdmins({ hazardId, message, subject }) {
  const [admins] = await query(
    "SELECT userId FROM users WHERE role = 'Administrator'"
  );
  for (const admin of admins) {
    await sendAlert({ userId: admin.userId, hazardId, message, subject });
  }
}

module.exports = { sendAlert, alertAllAdmins };
