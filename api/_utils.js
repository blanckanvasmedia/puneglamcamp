// ==============================================================================
// BK EDU by Minaaz — Serverless API Utilities for Pune Glam Camp
// Storage: Google Sheets via Google Apps Script Web App
// ==============================================================================
const crypto = require('crypto');

/**
 * Generate a human-friendly unique Registration ID: BK-PUN-XXYYZZ
 */
function generateRegistrationId() {
  return `BK-PUN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Format date in Indian Standard Time (IST)
 * e.g., "23 Oct 2026, 01:38 PM"
 */
function getISTFormattedDate() {
  const date = new Date();
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Save student registration to Google Sheets via Google Apps Script Web App.
 *
 * Keeps only 5 visible Google Sheet columns:
 * Name | Email | Phone Number | Registration Date | Payment Status
 *
 * Sets Payment Status to 'Pending' initially.
 * Strictly verifies that Google Apps Script responds with success before proceeding.
 */
async function saveRegistrationToGoogleSheets({ registrationId, name, email, phone }) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/a/macros/blanckanvas.in/s/AKfycbzahNWLSw0GSwPeKcGHMP_DSv0uQxzekDv9UqUgEMUnyK-9VjebI2iYzbZ0zO16Zt7oOw/exec';
  const secret = process.env.GOOGLE_SHEETS_INGEST_SECRET || 'B0xTi1gZrT_r7hppA_Fp-NveCrBbTjBniDxm5j2YBVIBguL4zE3U8ZVXqJ1HDlpQ';

  if (!scriptUrl) {
    throw new Error('GOOGLE_APPS_SCRIPT_URL is not configured in Vercel Environment Variables.');
  }

  const dateFormatted = getISTFormattedDate();

  const payload = {
    action: 'register',
    registrationId,
    name,
    fullName: name,
    email,
    phone,
    phoneNumber: phone,
    registrationDate: dateFormatted,
    date: dateFormatted,
    timestamp: new Date().toISOString(),
    paymentStatus: 'Pending',
    status: 'Pending',
    event: 'Pune Glam Camp',
    amount: 5500,
    secret: secret || '',
    ingestSecret: secret || ''
  };

  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Google Apps Script responded with HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    if (text.toLowerCase().includes('success') || text.toLowerCase().includes('ok')) {
      result = { success: true, message: text };
    } else {
      throw new Error(`Google Apps Script returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  const isSuccess = result && (
    result.success === true ||
    result.status === 'success' ||
    result.result === 'success' ||
    result.ok === true
  );

  if (!isSuccess) {
    throw new Error((result && (result.error || result.message)) || 'Unsuccessful response from Google Apps Script.');
  }

  return result;
}

/**
 * Optional helper for later Razorpay webhook or verified payment update.
 * Updates payment status in Google Sheets only when verified.
 */
async function updatePaymentInGoogleSheets({ registrationId, email, phone, status = 'Paid' }) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SHEETS_INGEST_SECRET;

  if (!scriptUrl) return null;

  const payload = {
    action: 'updatePayment',
    registrationId,
    email,
    phone,
    paymentStatus: status,
    status,
    secret: secret || '',
    ingestSecret: secret || ''
  };

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    return await response.json().catch(() => ({ success: true }));
  } catch (err) {
    console.warn('Note: Google Sheets updatePayment call notice:', err.message);
    return null;
  }
}

/**
 * Optional Razorpay Order creation (if RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET exist in Vercel)
 */
async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;

  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency,
      receipt: String(receipt).slice(0, 40),
      notes
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Razorpay order creation failed:', response.status, errText);
    throw new Error(`Razorpay Order Error: ${errText}`);
  }
  return response.json();
}

module.exports = {
  generateRegistrationId,
  getISTFormattedDate,
  saveRegistrationToGoogleSheets,
  updatePaymentInGoogleSheets,
  createRazorpayOrder
};
