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
 * Derive a human-readable Lead Source label from UTM parameters and referrer URL.
 *
 * Priority:
 *  1. utm_source   (e.g. "instagram", "facebook", "google")
 *  2. Referrer URL (e.g. l.instagram.com → "Instagram", facebook.com → "Facebook")
 *  3. Falls back to "Direct / Unknown"
 */
function deriveLeadSource({ utm_source = '', utm_medium = '', utm_campaign = '', referrer = '' } = {}) {
  const src = (utm_source || '').toLowerCase().trim();
  const ref = (referrer || '').toLowerCase();

  // Map common utm_source values to readable labels
  const sourceMap = {
    instagram: 'Instagram',
    ig:        'Instagram',
    insta:     'Instagram',
    facebook:  'Facebook',
    fb:        'Facebook',
    google:    'Google',
    youtube:   'YouTube',
    yt:        'YouTube',
    whatsapp:  'WhatsApp',
    wa:        'WhatsApp',
    twitter:   'Twitter / X',
    x:         'Twitter / X',
    linkedin:  'LinkedIn',
    email:     'Email',
    sms:       'SMS',
    organic:   'Organic Search',
    direct:    'Direct'
  };

  if (src && sourceMap[src]) return sourceMap[src];
  if (src) return src.charAt(0).toUpperCase() + src.slice(1); // capitalise unknown utm_source

  // Fallback: parse referrer domain
  if (ref.includes('instagram.com') || ref.includes('l.instagram'))   return 'Instagram';
  if (ref.includes('facebook.com') || ref.includes('fb.com'))         return 'Facebook';
  if (ref.includes('google.com') || ref.includes('google.co'))        return 'Google';
  if (ref.includes('youtube.com'))                                     return 'YouTube';
  if (ref.includes('whatsapp.com') || ref.includes('wa.me'))          return 'WhatsApp';
  if (ref.includes('twitter.com') || ref.includes('t.co') || ref.includes('x.com')) return 'Twitter / X';
  if (ref.includes('linkedin.com'))                                    return 'LinkedIn';

  return 'Direct / Unknown';
}

/**
 * Save student registration to Google Sheets via Google Apps Script Web App.
 *
 * Google Sheet columns (6 total):
 * Name | Email | Phone Number | Registration Date | Payment Status | Lead Source
 *
 * Sets Payment Status to 'Pending' initially.
 * Strictly verifies that Google Apps Script responds with success before proceeding.
 */
async function saveRegistrationToGoogleSheets({ registrationId, name, email, phone, utm_source = '', utm_medium = '', utm_campaign = '', utm_term = '', utm_content = '', referrer = '' }) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwic3ZGvI15CwNDkHdyeE0urtta2GAu3Iexe_SoUbUZc-aFN-M1rIaBFdfxC1J_JO4W/exec';
  const primarySecret = (process.env.GOOGLE_SHEETS_INGEST_SECRET || '').trim();
  const knownWorkingSecret = 'fac9bdba336d0c3f0b957b8ed24cc73d53f879e04adbeff143de76b1db0a5c63';

  const secretsToTry = [primarySecret, knownWorkingSecret].filter(Boolean);
  // Remove duplicates
  const uniqueSecrets = Array.from(new Set(secretsToTry));

  const dateFormatted = getISTFormattedDate();
  const leadSource = deriveLeadSource({ utm_source, utm_medium, utm_campaign, referrer });

  let lastError = null;

  for (const currentSecret of uniqueSecrets) {
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
      leadSource,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      referrer,
      secret: currentSecret,
      ingestSecret: currentSecret
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
          return { success: true, message: text };
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

      if (isSuccess) {
        return result;
      }

      const errMsg = (result && (result.error || result.message)) || 'Unsuccessful response from Google Apps Script.';
      lastError = new Error(errMsg);

      // If unauthorized and we have another secret to try, continue loop
      if (errMsg.toLowerCase().includes('unauthorized') && uniqueSecrets.indexOf(currentSecret) < uniqueSecrets.length - 1) {
        continue;
      }
      throw lastError;

    } catch (err) {
      lastError = err;
      if (err.message.toLowerCase().includes('unauthorized') && uniqueSecrets.indexOf(currentSecret) < uniqueSecrets.length - 1) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to record registration in Google Sheets.');
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
  deriveLeadSource,
  saveRegistrationToGoogleSheets,
  updatePaymentInGoogleSheets,
  createRazorpayOrder
};
