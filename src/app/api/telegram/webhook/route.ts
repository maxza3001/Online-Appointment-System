import { getSettingsMap } from "@/lib/settings";
import { updateBookingStatusFromTelegram } from "@/lib/bookings";
import { getRequestTelegramContextByReqId, persistTelegramStatusUpdate } from "@/lib/requests";
import { sendTelegramBookingCallbackFeedback, sendTelegramCallbackFeedback } from "@/lib/telegram";
import type { TelegramAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTelegramAction(value: string): value is TelegramAction {
  return value === "RECEIVE" || value === "PENDING" || value === "APPROVE" || value === "NOT_FOUND";
}

export async function POST(request: Request) {
  try {
    const update = await request.json();
    const callbackQuery = update?.callback_query;
    if (!callbackQuery) return Response.json({ ok: true });

    const [action, recordId] = String(callbackQuery.data ?? "").split("|");
    if (!recordId) return Response.json({ ok: true });

    const actorName = [callbackQuery.from?.first_name, callbackQuery.from?.last_name]
      .filter(Boolean)
      .join(" ") || "เจ้าหน้าที่";

    const settings = await getSettingsMap();

    if (action === "BOOKING_CONFIRM" || action === "BOOKING_CANCEL") {
      const messageId = callbackQuery.message?.message_id;
      const chatId = callbackQuery.message?.chat?.id;
      if (!messageId || !chatId) return Response.json({ ok: true });

      const result = await updateBookingStatusFromTelegram(settings, recordId, action, chatId, actorName);
      await sendTelegramBookingCallbackFeedback(settings, {
        callbackId: callbackQuery.id,
        messageId,
        chatId,
        ticketId: result.ticketId,
        status: result.status,
        actionBy: actorName,
      });
      return Response.json({ ok: true });
    }

    if (!isTelegramAction(action)) return Response.json({ ok: true });
    const requestContext = await getRequestTelegramContextByReqId(recordId);

    await sendTelegramCallbackFeedback(settings, {
      action,
      requestSummary: requestContext?.requestSummary,
      agency: requestContext?.agency,
      reqId: recordId,
      callbackId: callbackQuery.id,
      messageId: callbackQuery.message?.message_id,
      chatId: callbackQuery.message?.chat?.id,
      actionBy: actorName,
    });

    await persistTelegramStatusUpdate(recordId, action);
  } catch (error) {
    console.error(error);
  }

  return Response.json({ ok: true });
}
