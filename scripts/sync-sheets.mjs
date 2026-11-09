import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("ไม่พบไฟล์ .env.local");
  }

  const content = fs.readFileSync(filePath, "utf8");
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

async function syncAllBookings() {
  const env = readEnvFile(envPath);

  const supabaseUrl = env.SUPABASE_URL && !env.SUPABASE_URL.includes("your-project.supabase.co")
    ? env.SUPABASE_URL
    : env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const scriptUrl = env.GOOGLE_APPS_SCRIPT_URL?.trim();
  const secret = env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!scriptUrl || !secret) {
    throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_APPS_SCRIPT_URL หรือ GOOGLE_SHEETS_WEBHOOK_SECRET");
  }

  console.log("กำลังดึงรายการจองจาก Supabase...");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/bookings?select=receiver_name,amount,appointment_date,time_slot,agency,topic,department,ticket_id,status&order=created_at.asc`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`โหลดรายการจองไม่สำเร็จ: ${response.status} ${response.statusText}`);
  }

  const bookings = await response.json();
  console.log(`พบรายการจองทั้งหมด ${bookings.length} รายการ`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    const payload = {
      action: "upsert_booking",
      secret,
      booking: {
        receiverName: b.receiver_name ?? "",
        amount: b.amount || 1,
        date: b.appointment_date,
        timeSlot: b.time_slot,
        agency: b.agency,
        topic: b.topic,
        department: b.department,
        ticketId: b.ticket_id,
        status: b.status,
      },
    };

    try {
      const res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => null);
      if (res.ok && result?.ok) {
        console.log(`[${i + 1}/${bookings.length}] ${b.ticket_id}: ${result.operation}`);
        successCount++;
      } else {
        console.error(`[${i + 1}/${bookings.length}] ${b.ticket_id} ล้มเหลว: ${result?.error || res.statusText}`);
        failCount++;
      }
    } catch (err) {
      console.error(`[${i + 1}/${bookings.length}] ${b.ticket_id} error:`, err.message);
      failCount++;
    }

    // Small delay to prevent hitting Apps Script rate limits
    if (i < bookings.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log(`\nเสร็จสิ้น: ซิงค์สำเร็จ ${successCount} รายการ, ล้มเหลว ${failCount} รายการ`);

  console.log("กำลังประมวลผลตารางสรุปรายเดือน...");
  try {
    const rebuildRes = await fetch(scriptUrl, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "rebuild_all_summaries", secret }),
    });
    const rebuildResult = await rebuildRes.json().catch(() => null);
    if (rebuildResult?.ok) {
      console.log("สร้าง/อัปเดตแท็บสรุปรายเดือนสำเร็จเรียบร้อย!");
    }
  } catch (err) {
    console.warn("ไม่สามารถเรียก rebuild_all_summaries ได้:", err.message);
  }
}

syncAllBookings().catch((err) => {
  console.error("เกิดข้อผิดพลาด:", err);
  process.exit(1);
});
