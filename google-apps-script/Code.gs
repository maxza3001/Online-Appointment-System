const REPORT_SPREADSHEET_ID = "16A8i3qppKBt-MTWeT-BlOzQHUuTEALdUKUvddxKNNQs";

const REPORT_HEADERS = [
  "ชื่อผู้รับเรื่อง",
  "จำนวน",
  "วันที่รับ",
  "ช่วงเวลา",
  "ชื่อผู้รับบริการ(หน่วยงาน)",
  "เรื่องที่ขอรับบริการ",
  "กลุ่มงานที่รับผิดชอบ",
  "รหัส",
  "สถานะ",
];

function doPost(e) {
  let lock;

  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const expectedSecret = scriptProperties.getProperty("GOOGLE_SHEETS_WEBHOOK_SECRET");
    if (!expectedSecret) return jsonResponse({ ok: false, error: "Webhook secret is not configured" });

    const payload = JSON.parse(e && e.postData ? e.postData.contents : "{}");
    if (payload.secret !== expectedSecret) return jsonResponse({ ok: false, error: "Unauthorized" });
    if (payload.action !== "upsert_booking") return jsonResponse({ ok: false, error: "Unsupported action" });

    const booking = payload.booking || {};
    if (!/^NID-[A-Z0-9]{6}$/.test(String(booking.ticketId || ""))) {
      return jsonResponse({ ok: false, error: "Invalid ticket ID" });
    }

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const spreadsheet = SpreadsheetApp.openById(REPORT_SPREADSHEET_ID);
    const tabName = scriptProperties.getProperty("REPORT_SHEET_TAB");
    const sheet = tabName ? spreadsheet.getSheetByName(tabName) : spreadsheet.getSheets()[0];
    if (!sheet) return jsonResponse({ ok: false, error: "No worksheet tab found" });

    let lastRow = sheet.getLastRow();
    if (lastRow === 0) {
      sheet.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
      lastRow = 1;
    }

    const values = [[
      String(booking.receiverName || ""),
      Number(booking.amount) || 1,
      String(booking.date || ""),
      String(booking.timeSlot || ""),
      String(booking.agency || ""),
      String(booking.topic || ""),
      String(booking.department || ""),
      String(booking.ticketId),
      String(booking.status || ""),
    ]];

    let existingRow = 0;
    if (lastRow > 1) {
      const ticketIds = sheet.getRange(2, 8, lastRow - 1, 1).getDisplayValues();
      const index = ticketIds.findIndex((row) => row[0].trim() === booking.ticketId);
      if (index >= 0) existingRow = index + 2;
    }

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, REPORT_HEADERS.length).setValues(values);
      return jsonResponse({ ok: true, operation: "updated", ticketId: booking.ticketId });
    }

    sheet.appendRow(values[0]);
    return jsonResponse({ ok: true, operation: "inserted", ticketId: booking.ticketId });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return jsonResponse({ ok: false, error: message });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
