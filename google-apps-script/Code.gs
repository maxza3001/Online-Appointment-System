const REPORT_SPREADSHEET_ID = "1kpweyi5BoNQXBAUkC-YYR4Bpui7MB5jIkkVlm-izBE0";
const DAILY_SHEET_NAME = "รายการจองรายวัน";

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

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

const STANDARD_DEPARTMENTS = [
  "ฝ่ายบริหารทั่วไป",
  "กลุ่มงานวิชาการ",
  "กลุ่มงานระบบการคลัง GF",
  "กลุ่มนโยบายเศรษฐกิจการคลัง",
];

function doPost(e) {
  let lock;

  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const expectedSecret = scriptProperties.getProperty("GOOGLE_SHEETS_WEBHOOK_SECRET");
    if (!expectedSecret) return jsonResponse({ ok: false, error: "Webhook secret is not configured" });

    const payload = JSON.parse(e && e.postData ? e.postData.contents : "{}");
    if (payload.secret !== expectedSecret) return jsonResponse({ ok: false, error: "Unauthorized" });

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const spreadsheet = SpreadsheetApp.openById(REPORT_SPREADSHEET_ID);

    // 1. Rebuild all summaries action
    if (payload.action === "rebuild_all_summaries") {
      const dailySheet = getOrCreateDailySheet(spreadsheet);
      rebuildAllMonthlySummaries(spreadsheet, dailySheet);
      return jsonResponse({ ok: true, message: "Rebuilt all monthly summaries" });
    }

    // 2. Upsert booking action
    if (payload.action !== "upsert_booking") {
      return jsonResponse({ ok: false, error: "Unsupported action" });
    }

    const booking = payload.booking || {};
    if (!/^NID-[A-Z0-9]{6}$/.test(String(booking.ticketId || ""))) {
      return jsonResponse({ ok: false, error: "Invalid ticket ID" });
    }

    const dailySheet = getOrCreateDailySheet(spreadsheet);
    let lastRow = dailySheet.getLastRow();
    if (lastRow === 0) {
      dailySheet.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
      formatDailyHeaders(dailySheet);
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
      const ticketIds = dailySheet.getRange(2, 8, lastRow - 1, 1).getDisplayValues();
      const index = ticketIds.findIndex((row) => row[0].trim() === booking.ticketId);
      if (index >= 0) existingRow = index + 2;
    }

    let operation = "inserted";
    if (existingRow) {
      dailySheet.getRange(existingRow, 1, 1, REPORT_HEADERS.length).setValues(values);
      operation = "updated";
    } else {
      dailySheet.appendRow(values[0]);
    }

    // อัปเดตแท็บสรุปรายเดือนของเดือนนั้นทันที
    if (booking.date) {
      updateMonthlySummary(spreadsheet, dailySheet, String(booking.date));
    }

    return jsonResponse({ ok: true, operation, ticketId: booking.ticketId });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return jsonResponse({ ok: false, error: message });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

// -------------------------------------------------------------
// จัดการแท็บรายการจองรายวัน (เปลี่ยนชื่อ ชีต1 -> รายการจองรายวัน)
// -------------------------------------------------------------
function getOrCreateDailySheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(DAILY_SHEET_NAME);
  if (sheet) return sheet;

  // ตรวจหา "ชีต1" เพื่อเปลี่ยนชื่อ
  sheet = spreadsheet.getSheetByName("ชีต1");
  if (sheet) {
    sheet.setName(DAILY_SHEET_NAME);
    formatDailyHeaders(sheet);
    return sheet;
  }

  // หรือชีตแรกของไฟล์
  const sheets = spreadsheet.getSheets();
  if (sheets.length > 0 && !sheets[0].getName().startsWith("สรุป")) {
    sheets[0].setName(DAILY_SHEET_NAME);
    formatDailyHeaders(sheets[0]);
    return sheets[0];
  }

  const newSheet = spreadsheet.insertSheet(DAILY_SHEET_NAME, 0);
  newSheet.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
  formatDailyHeaders(newSheet);
  return newSheet;
}

function formatDailyHeaders(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, REPORT_HEADERS.length);
  headerRange
    .setFontWeight("bold")
    .setBackground("#fef08a") // สีเหลืองตามรูปเดิมของผู้ใช้
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

// -------------------------------------------------------------
// แปลงวันที่เป็นชื่อแท็บสรุป เช่น "2026-11-09" -> "สรุป พ.ย. 2569"
// -------------------------------------------------------------
function getMonthlySheetName(dateStr) {
  const parts = String(dateStr).trim().split("-");
  if (parts.length >= 2) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
      const thaiYear = year > 2400 ? year : year + 543;
      const monthName = THAI_MONTHS[month - 1];
      return `สรุป ${monthName} ${thaiYear}`;
    }
  }
  return "สรุปยอดรายเดือน";
}

function getYearMonthKey(dateStr) {
  const parts = String(dateStr).trim().split("-");
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return "";
}

// -------------------------------------------------------------
// อัปเดตแท็บสรุปรายเดือนทั้งหมด
// -------------------------------------------------------------
function rebuildAllMonthlySummaries(spreadsheet, dailySheet) {
  const lastRow = dailySheet.getLastRow();
  if (lastRow <= 1) return;

  const dates = dailySheet.getRange(2, 3, lastRow - 1, 1).getDisplayValues();
  const yearMonths = new Set();
  dates.forEach((row) => {
    const ym = getYearMonthKey(row[0]);
    if (ym) yearMonths.add(ym);
  });

  yearMonths.forEach((ym) => {
    updateMonthlySummary(spreadsheet, dailySheet, `${ym}-01`);
  });
}

// -------------------------------------------------------------
// อัปเดตตารางสรุปรายเดือน: มีทั้งแยกกลุ่มงาน และแยกรายวันในเดือน
// -------------------------------------------------------------
function updateMonthlySummary(spreadsheet, dailySheet, dateStr) {
  const targetYm = getYearMonthKey(dateStr);
  if (!targetYm) return;

  const summarySheetName = getMonthlySheetName(dateStr);
  let summarySheet = spreadsheet.getSheetByName(summarySheetName);
  if (!summarySheet) {
    summarySheet = spreadsheet.insertSheet(summarySheetName);
  }

  const lastRow = dailySheet.getLastRow();
  const rows = lastRow > 1 ? dailySheet.getRange(2, 1, lastRow - 1, REPORT_HEADERS.length).getValues() : [];

  // กรองเฉพาะข้อมูลของเดือนเป้าหมาย
  const monthRows = rows.filter((r) => getYearMonthKey(String(r[2])) === targetYm);

  // 1. คำนวณสรุปแยกตามกลุ่มงาน
  const deptStats = {};
  STANDARD_DEPARTMENTS.forEach((dept) => {
    deptStats[dept] = { pending: 0, confirmed: 0, cancelled: 0, total: 0 };
  });

  // 2. คำนวณสรุปแยกรายวัน
  const dailyStats = {};

  monthRows.forEach((r) => {
    const date = String(r[2]).trim();
    const dept = String(r[6]).trim() || "ไม่ระบุ";
    const status = String(r[8]).trim();

    if (!deptStats[dept]) {
      deptStats[dept] = { pending: 0, confirmed: 0, cancelled: 0, total: 0 };
    }

    if (!dailyStats[date]) {
      dailyStats[date] = { pending: 0, confirmed: 0, cancelled: 0, total: 0 };
    }

    // จัดหมวดหมู่สถานะ
    if (status.includes("รอ") || status === "รอตอบรับ") {
      deptStats[dept].pending++;
      dailyStats[date].pending++;
    } else if (status.includes("ยืนยัน") || status === "ยืนยันแล้ว") {
      deptStats[dept].confirmed++;
      dailyStats[date].confirmed++;
    } else if (status.includes("ยกเลิก")) {
      deptStats[dept].cancelled++;
      dailyStats[date].cancelled++;
    } else {
      deptStats[dept].pending++;
      dailyStats[date].pending++;
    }

    deptStats[dept].total++;
    dailyStats[date].total++;
  });

  // ล้างเนื้อหาเดิมเพื่อเขียนใหม่
  summarySheet.clear();

  // --- ส่วนหัวเรื่อง ---
  summarySheet.getRange("A1").setValue(`📊 รายงานสรุปการจองคิวนัดหมายออนไลน์ ประจำเดือน ${summarySheetName.replace("สรุป ", "")}`);
  summarySheet.getRange("A1").setFontSize(14).setFontWeight("bold");

  // --- ตารางที่ 1: สรุปแยกตามกลุ่มงาน ---
  summarySheet.getRange("A3").setValue("🏢 สรุปยอดการจองแยกตามกลุ่มงานที่รับผิดชอบ").setFontWeight("bold").setFontSize(11);

  const deptHeaders = ["กลุ่มงานที่รับผิดชอบ", "รอตอบรับ", "ยืนยันแล้ว", "ยกเลิก", "รวมทั้งสิ้น (คิว)"];
  summarySheet.getRange(4, 1, 1, deptHeaders.length).setValues([deptHeaders])
    .setBackground("#0284c7")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  const deptDataRows = [];
  let totalPending = 0, totalConfirmed = 0, totalCancelled = 0, grandTotal = 0;

  // เอา standard departments มาก่อน ตามด้วยอื่นๆ
  const allDepts = Object.keys(deptStats).sort((a, b) => {
    const idxA = STANDARD_DEPARTMENTS.indexOf(a);
    const idxB = STANDARD_DEPARTMENTS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  allDepts.forEach((dept) => {
    const s = deptStats[dept];
    deptDataRows.push([dept, s.pending, s.confirmed, s.cancelled, s.total]);
    totalPending += s.pending;
    totalConfirmed += s.confirmed;
    totalCancelled += s.cancelled;
    grandTotal += s.total;
  });

  let currentRow = 5;
  if (deptDataRows.length > 0) {
    summarySheet.getRange(currentRow, 1, deptDataRows.length, deptHeaders.length).setValues(deptDataRows);
    summarySheet.getRange(currentRow, 2, deptDataRows.length, 4).setHorizontalAlignment("center");
    currentRow += deptDataRows.length;
  }

  // แถวรวมทั้งหมดของตารางกลุ่มงาน
  summarySheet.getRange(currentRow, 1, 1, deptHeaders.length).setValues([
    ["รวมทั้งหมด", totalPending, totalConfirmed, totalCancelled, grandTotal]
  ]).setBackground("#e0f2fe").setFontWeight("bold");
  summarySheet.getRange(currentRow, 2, 1, 4).setHorizontalAlignment("center");

  // --- ตารางที่ 2: สรุปยอดการจองรายวันในเดือน ---
  currentRow += 3;
  summarySheet.getRange(currentRow, 1).setValue("📅 สรุปยอดการจองแยกตามรายวันในเดือน").setFontWeight("bold").setFontSize(11);
  currentRow += 1;

  const dailyHeaders = ["วันที่รับ", "รอตอบรับ", "ยืนยันแล้ว", "ยกเลิก", "รวม (คิว)"];
  summarySheet.getRange(currentRow, 1, 1, dailyHeaders.length).setValues([dailyHeaders])
    .setBackground("#10b981")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  currentRow += 1;

  const sortedDates = Object.keys(dailyStats).sort();
  const dailyDataRows = [];
  sortedDates.forEach((d) => {
    const s = dailyStats[d];
    dailyDataRows.push([formatThaiDisplayDate(d), s.pending, s.confirmed, s.cancelled, s.total]);
  });

  if (dailyDataRows.length > 0) {
    summarySheet.getRange(currentRow, 1, dailyDataRows.length, dailyHeaders.length).setValues(dailyDataRows);
    summarySheet.getRange(currentRow, 2, dailyDataRows.length, 4).setHorizontalAlignment("center");
    currentRow += dailyDataRows.length;
  }

  // แถวรวมของตารางรายวัน
  summarySheet.getRange(currentRow, 1, 1, dailyHeaders.length).setValues([
    ["รวมตลอดทั้งเดือน", totalPending, totalConfirmed, totalCancelled, grandTotal]
  ]).setBackground("#d1fae5").setFontWeight("bold");
  summarySheet.getRange(currentRow, 2, 1, 4).setHorizontalAlignment("center");

  // ปรับความกว้างคอลัมน์อัตโนมัติ
  for (let c = 1; c <= 5; c++) {
    summarySheet.autoResizeColumn(c);
  }
}

function formatThaiDisplayDate(dateStr) {
  const parts = String(dateStr).trim().split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    const thaiYear = year > 2400 ? year : year + 543;
    const monthName = THAI_MONTHS[month - 1] || parts[1];
    return `${day} ${monthName} ${thaiYear}`;
  }
  return dateStr;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
