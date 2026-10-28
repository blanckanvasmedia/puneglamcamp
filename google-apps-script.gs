/**
 * ==============================================================================
 * BK EDU by Minaaz — Pune Glam Camp Google Sheets Ingestion Script
 * ==============================================================================
 *
 * This Google Apps Script connects your Pune Glam Camp website directly to your
 * Google Sheet, recording each student registration securely.
 *
 * EXACT 6 VISIBLE COLUMNS IN SHEET:
 * Column A: Name
 * Column B: Email
 * Column C: Phone Number
 * Column D: Registration Date
 * Column E: Payment Status (Default: "Pending")
 * Column F: Lead Source  (e.g., "Instagram", "Facebook", "Direct / Unknown")
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open your Google Sheet for Pune Glam Camp.
 * 2. Click "Extensions" -> "Apps Script".
 * 3. Delete any default code in Code.gs, paste this entire file, and click Save (Ctrl+S).
 * 4. (Recommended) Set a secret token:
 *    - Click Project Settings (gear icon on left) -> "Script Properties".
 *    - Add Property: "INGEST_SECRET", Value: your chosen secret string.
 *      (e.g., "B0xTi1gZrT_r7hppA_Fp-NveCrBbTjBniDxm5j2YBVIBguL4zE3U8ZVXqJ1HDlpQ")
 * 5. Click "Deploy" (top right) -> "New deployment":
 *    - Click Select type (gear icon) -> select "Web app".
 *    - Description: "Pune Glam Camp Registration Ingestion"
 *    - Execute as: "Me (<your-email>)"
 *    - Who has access: "Anyone" (CRITICAL: Must be "Anyone" so Vercel can POST without Google Sign-In)
 *    - Click "Deploy".
 * 6. Copy the "Web app URL" (starts with https://script.google.com/macros/s/.../exec).
 * 7. In Vercel Project Settings -> Environment Variables, add:
 *    - GOOGLE_APPS_SCRIPT_URL = <pasted Web app URL>
 *    - GOOGLE_SHEETS_INGEST_SECRET = <your chosen secret string>
 * ==============================================================================
 */

// Fallback secret if not set in Script Properties
const DEFAULT_INGEST_SECRET = "fac9bdba336d0c3f0b957b8ed24cc73d53f879e04adbeff143de76b1db0a5c63";

function getExpectedSecret() {
  try {
    const props = PropertiesService.getScriptProperties();
    const val = props.getProperty("INGEST_SECRET");
    if (val && val.trim()) {
      return val.trim();
    }
  } catch (e) {}
  return DEFAULT_INGEST_SECRET;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ success: false, error: "Empty request payload" }, 400);
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOutput({ success: false, error: "Malformed JSON payload: " + parseErr.message }, 400);
    }

    // 1. Verify Authentication Secret
    const expectedSecret = getExpectedSecret().trim();
    const incomingSecret = ((data && (data.secret || data.ingestSecret)) || (e.parameter && e.parameter.secret) || '').toString().trim();

    // Authorize if it matches the configured secret or the fallback secret
    const isAuthorized = incomingSecret === expectedSecret || incomingSecret === DEFAULT_INGEST_SECRET;

    if (!isAuthorized) {
      console.warn("Secret mismatch. Incoming secret length: " + incomingSecret.length + ", Expected: " + expectedSecret.length);
      return jsonOutput({ success: false, error: "Unauthorized: Invalid secret" }, 401);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getTargetSheet(ss);
    setupSheetHeaderIfEmpty(sheet);

    const action = data.action || 'register';

    // Action 1: Register Student
    if (action === 'register') {
      const name         = (data.name || data.fullName || '').toString().trim();
      const email        = (data.email || '').toString().trim().toLowerCase();
      const phone        = (data.phone || data.phoneNumber || '').toString().trim();
      const date         = (data.registrationDate || data.date || getFormattedCurrentISTDate()).toString().trim();
      const paymentStatus = (data.paymentStatus || data.status || 'Pending').toString().trim();
      const regId        = (data.registrationId || '').toString().trim();
      const leadSource   = (data.leadSource || '').toString().trim();

      if (!name || !email || !phone) {
        return jsonOutput({ success: false, error: "Name, email, and phone number are required." }, 400);
      }

      // Check for existing registration (deduplication)
      const lastRow = sheet.getLastRow();
      let existingRow = -1;

      if (lastRow > 1) {
        // Read all 6 columns: [Name, Email, Phone Number, Registration Date, Payment Status, Lead Source]
        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        const cleanIncomingPhone = phone.replace(/[^0-9]/g, '');

        for (let i = 0; i < values.length; i++) {
          const rowEmail = (values[i][1] || '').toString().trim().toLowerCase();
          const rowPhone = (values[i][2] || '').toString().trim().replace(/[^0-9]/g, '');

          // Match by email or last 10 digits of phone number
          const emailMatch = rowEmail && email && (rowEmail === email);
          const phoneMatch = cleanIncomingPhone.length >= 10 && rowPhone.length >= 10 &&
                             (cleanIncomingPhone.slice(-10) === rowPhone.slice(-10));

          if (emailMatch || phoneMatch) {
            existingRow = i + 2; // +2 for 1-based indexing and header row
            break;
          }
        }
      }

      if (existingRow > 0) {
        // Prevent duplicate row: Update existing record
        const existingStatus = sheet.getRange(existingRow, 5).getValue().toString().trim();

        // Never downgrade a "Paid" student back to "Pending"
        if (existingStatus.toLowerCase() !== 'paid') {
          sheet.getRange(existingRow, 1).setValue(name);
          sheet.getRange(existingRow, 4).setValue(date);
          sheet.getRange(existingRow, 5).setValue(paymentStatus);
        }

        // Update Lead Source only if the existing cell is blank
        if (leadSource && !sheet.getRange(existingRow, 6).getValue()) {
          sheet.getRange(existingRow, 6).setValue(leadSource);
        }

        return jsonOutput({
          success: true,
          registrationId: regId,
          status: sheet.getRange(existingRow, 5).getValue(),
          updated: true,
          message: "Registration already exists; record updated."
        });
      }

      // Append new student record to Google Sheet (6 columns)
      // Name | Email | Phone Number | Registration Date | Payment Status | Lead Source
      sheet.appendRow([name, email, phone, date, paymentStatus, leadSource]);

      return jsonOutput({
        success: true,
        registrationId: regId,
        status: paymentStatus,
        message: "Registration recorded successfully."
      });
    }

    // Action 2: Update Payment Status (for later verified Razorpay confirmation)
    if (action === 'updatePayment') {
      const email    = (data.email || '').toString().trim().toLowerCase();
      const phone    = (data.phone || data.phoneNumber || '').toString().trim().replace(/[^0-9]/g, '');
      const newStatus = (data.paymentStatus || data.status || 'Paid').toString().trim();

      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        for (let i = 0; i < values.length; i++) {
          const rowEmail = (values[i][1] || '').toString().trim().toLowerCase();
          const rowPhone = (values[i][2] || '').toString().trim().replace(/[^0-9]/g, '');

          if ((email && rowEmail === email) || (phone && rowPhone && rowPhone.slice(-10) === phone.slice(-10))) {
            sheet.getRange(i + 2, 5).setValue(newStatus);
            return jsonOutput({ success: true, updated: true, status: newStatus });
          }
        }
      }
      return jsonOutput({ success: true, updated: false, message: "Record not located for payment update." });
    }

    return jsonOutput({ success: false, error: "Unrecognized action: " + action }, 400);

  } catch (err) {
    return jsonOutput({ success: false, error: "Internal Server Error: " + err.toString() }, 500);
  }
}

/**
 * Health check endpoint for verifying deployment via GET.
 * Opening this URL in your browser shows the EXACT spreadsheet and tab being written to!
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    const tabInfo = sheets.map(function(s) {
      return {
        tabName: s.getName(),
        rowCount: s.getLastRow(),
        columnCount: s.getLastColumn()
      };
    });

    const activeSheet = ss.getActiveSheet() || sheets[0];
    let lastRowValues = [];
    if (activeSheet.getLastRow() > 1) {
      lastRowValues = activeSheet.getRange(activeSheet.getLastRow(), 1, 1, Math.min(activeSheet.getLastColumn(), 6)).getValues()[0];
    }

    return jsonOutput({
      status: "ok",
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      activeTabName: activeSheet.getName(),
      allTabs: tabInfo,
      lastRowData: lastRowValues,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return jsonOutput({
      status: "error",
      error: err.toString(),
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Finds the correct tab in the spreadsheet (searches for tab with "Name" header, or defaults to first tab)
 */
function getTargetSheet(ss) {
  const sheets = ss.getSheets();
  if (!sheets || sheets.length === 0) return ss.getActiveSheet();
  if (sheets.length === 1) return sheets[0];

  // Look for the tab that already contains student registration columns
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getLastRow() > 0) {
      const firstCell = sheets[i].getRange(1, 1).getValue().toString().trim().toLowerCase();
      if (firstCell === 'name' || firstCell.includes('name')) {
        return sheets[i];
      }
    }
  }

  // Fallback to active sheet or first sheet
  return ss.getActiveSheet() || sheets[0];
}

/**
 * Ensures the Google Sheet has the exact 6 visible columns.
 * NOTE: If your sheet already has data, manually add "Lead Source" as the header in cell F1.
 */
function setupSheetHeaderIfEmpty(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = [
      "Name",
      "Email",
      "Phone Number",
      "Registration Date",
      "Payment Status",
      "Lead Source"
    ];
    sheet.appendRow(headers);

    const range = sheet.getRange(1, 1, 1, headers.length);
    range.setFontWeight("bold");
    range.setBackground("#2b0e16");
    range.setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
}

/**
 * Returns formatted Indian Standard Time timestamp
 * e.g., "23 Oct 2026, 01:38 PM"
 */
function getFormattedCurrentISTDate() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, hh:mm a");
}

function jsonOutput(obj, statusCode) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
