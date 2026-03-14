require('dotenv').config()
const nodemailer = require('nodemailer')

async function testEmail() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.FROM_EMAIL || user

  console.log('Sending test email using:', { host, port, user, from })

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 5000, // 5 seconds manually
      greetingTimeout: 5000,
      socketTimeout: 5000
    })

    console.log('Attempting to send email...')
    const info = await transporter.sendMail({
      from,
      to: user, // send to self
      subject: 'Core Inventory SMTP Test',
      text: 'This is a test email from the SMTP debugger.',
    })

    console.log('Email sent successfully:', info.messageId)
  } catch (error) {
    console.error('Error sending email:', error)
  }
}

testEmail()
