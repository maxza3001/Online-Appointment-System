import { getSettingsMap } from "@/lib/settings";
import { getRequestTelegramContextByReqId, persistTelegramStatusUpdate } from "@/lib/requests";
import { sendTelegramCallbackFeedback } from "@/lib/telegram";
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

    const [action, reqId] = String(callbackQuery.data ?? "").split("|");
    if (!reqId || !isTelegramAction(action)) return Response.json({ ok: true });

    const actorName = [callbackQuery.from?.first_name, callbackQuery.from?.last_name]
      .filter(Boolean)
      .join(" ") || "เจ้าหน้าที่";

    const settings = await getSettingsMap();
    const requestContext = await getRequestTelegramContextByReqId(reqId);

    await sendTelegramCallbackFeedback(settings, {
      action,
      requestSummary: requestContext?.requestSummary,
      agency: requestContext?.agency,
      reqId,
      callbackId: callbackQuery.id,
      messageId: callbackQuery.message?.message_id,
      chatId: callbackQuery.message?.chat?.id,
      actionBy: actorName,
    });

    await persistTelegramStatusUpdate(reqId, action);
  } catch (error) {
    console.error(error);
  }

  return Response.json({ ok: true });
}
