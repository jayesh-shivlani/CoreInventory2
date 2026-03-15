require('dotenv').config({ path: 'c:/Users/jayes/Desktop/CoreInventory2/backend/.env' });
const nodemailer = require('nodemailer');

async function testSmtp() {
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  console.log('Testing SMTP with:', {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    pass: '********'
  });

  const transporter = nodemailer.createTransport({
    service: smtpHost === 'smtp.gmail.com' ? 'gmail' : undefined,
    host: smtpHost !== 'smtp.gmail.com' ? smtpHost : undefined,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  try {
    console.log('Verifying transporter...');
    await transporter.verify();
    console.log('Transporter verified successfully!');

    console.log('Sending test email...');
    const info = await transporter.sendMail({
      from: smtpUser,
      to: smtpUser, // Send to self
      subject: 'SMTP Test from Core Inventory',
      text: 'If you see this, SMTP is working correctly.',
      html: '<p>If you see this, <b>SMTP is working correctly</b>.</p>',
    });
    console.log('Message sent: %s', info.messageId);
  } catch (error) {
    console.error('SMTP test failed:', error);
  }
}

testSmtp();
