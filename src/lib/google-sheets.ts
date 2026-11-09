import "server-only";

export type BookingReportRow = {
  receiverName: string;
  amount: number;
  date: string;
  timeSlot: string;
  agency: string;
  topic: string;
  department: string;
  ticketId: string;
  status: string;
};

export async function syncBookingReportRow(booking: BookingReportRow) {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();
  if (!endpoint || !secret) {
    console.warn(`[Google Sheets] Skip sync for ${booking.ticketId}: GOOGLE_APPS_SCRIPT_URL or GOOGLE_SHEETS_WEBHOOK_SECRET is not configured in environment variables.`);
    return { configured: false, synced: false };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "upsert_booking", secret, booking }),
      cache: "no-store",
      redirect: "follow",
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `Apps Script returned HTTP ${response.status}`);
    }
    return { configured: true, synced: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Apps Script error";
    console.error(`Google Sheets sync failed for ${booking.ticketId}: ${message}`);
    return { configured: true, synced: false };
  }
}
