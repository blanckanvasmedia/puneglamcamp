// ==============================================================================
// BK EDU by Minaaz — API: Register Student & Initiate Payment for Pune Glam Camp
// Endpoint: POST /api/register
// Storage: Google Sheets via Google Apps Script Web App
// ==============================================================================
const {
  saveRegistrationToGoogleSheets,
  createRazorpayOrder,
  generateRegistrationId
} = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const {
      fullName,
      email,
      phone,
      city        = '',
      utm_source  = '',
      utm_medium  = '',
      utm_campaign = '',
      utm_term    = '',
      utm_content = '',
      referrer    = ''
    } = req.body || {};

    // 1. Form Input Validation
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'A valid WhatsApp / Phone number is required.' });
    }

    const cleanName  = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // 2. Check Google Apps Script configuration
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/a/macros/blanckanvas.in/s/AKfycbzahNWLSw0GSwPeKcGHMP_DSv0uQxzekDv9UqUgEMUnyK-9VjebI2iYzbZ0zO16Zt7oOw/exec';
    if (!scriptUrl) {
      return res.status(503).json({
        error: 'Registration backend not configured. Missing GOOGLE_APPS_SCRIPT_URL in Vercel.',
        code: 'APPS_SCRIPT_NOT_CONFIGURED'
      });
    }

    const registrationId = generateRegistrationId();
    const campFeeINR = 5500; // Preserved Pune Glam Camp fee of ₹5,500
    const fallbackPaymentUrl = 'https://rzp.io/rzp/08VeAGUM'; // Preserved Razorpay Payment Link

    // 3. Save student details to Google Sheets through Apps Script with status Pending
    // Check response for success BEFORE proceeding to payment
    try {
      await saveRegistrationToGoogleSheets({
        registrationId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone
      });
      console.log(`Registration ${registrationId} saved to Google Sheets as Pending`);
    } catch (sheetErr) {
      console.error('Failed to save to Google Sheets:', sheetErr.message);
      return res.status(502).json({
        error: 'Unable to save registration to Google Sheets: ' + sheetErr.message,
        code: 'SHEETS_INGEST_FAILED'
      });
    }

    // 4. Create per-registration Razorpay Order (if Razorpay API keys are configured)
    let razorpayOrder = null;
    try {
      razorpayOrder = await createRazorpayOrder({
        amount: campFeeINR,
        currency: 'INR',
        receipt: registrationId,
        notes: {
          registration_id: registrationId,
          full_name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          event: 'Pune Glam Camp'
        }
      });
    } catch (rzpErr) {
      console.warn('Razorpay order creation skipped:', rzpErr.message);
    }

    // 5. If Razorpay order was generated, return checkout mode
    if (razorpayOrder && razorpayOrder.id) {
      return res.status(200).json({
        success: true,
        mode: 'checkout',
        registrationId,
        orderId: razorpayOrder.id,
        amount: campFeeINR,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID,
        customer: {
          name: cleanName,
          email: cleanEmail,
          contact: cleanPhone
        }
      });
    }

    // 6. Graceful fallback preserving the exact Razorpay link https://rzp.io/rzp/08VeAGUM
    return res.status(200).json({
      success: true,
      mode: 'fallback_link',
      registrationId,
      fallbackUrl: fallbackPaymentUrl,
      amount: campFeeINR,
      currency: 'INR',
      customer: {
        name: cleanName,
        email: cleanEmail,
        contact: cleanPhone
      },
      message: 'Registration recorded in Google Sheets as Pending. Proceeding to payment.'
    });

  } catch (err) {
    console.error('Unexpected error in /api/register:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
