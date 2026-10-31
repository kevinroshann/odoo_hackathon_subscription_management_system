const nodemailer = require('nodemailer');
const transport = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null;

exports.sendResetEmail = async (to, link) => {
  if (!transport) return console.log(`\n[DEV MAIL] Reset link for ${to}:\n${link}\n`);
  await transport.sendMail({
    from: process.env.MAIL_FROM, to, subject: 'Reset your Brightloop password',
    text: `Use this link to set a new password (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email.`
  });
};
