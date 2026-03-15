require('dotenv').config({ path: 'c:/Users/jayes/Desktop/CoreInventory2/backend/.env' });

async function testResend() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const to = 'coreinventory.support@gmail.com';

  console.log('Testing Resend with API Key:', apiKey ? '********' : 'MISSING');

  if (!apiKey) {
    console.error('RESEND_API_KEY is missing');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: to,
        subject: 'Resend Test from Core Inventory',
        html: '<p>If you see this, <b>Resend is working correctly</b>.</p>',
      }),
    });

    const data = await response.json();
    console.log('Resend response:', data);
  } catch (error) {
    console.error('Resend test failed:', error);
  }
}

testResend();
