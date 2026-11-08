import { getSettingsMap } from "@/lib/settings";
import {
  beginBookingCancellationFromTelegram,
  completeBookingCancellationFromTelegram,
  prepareBookingCancellationReasonFromTelegram,
  updateBookingStatusFromTelegram,
} from "@/lib/bookings";
import { getRequestTelegramContextByReqId, persistTelegramStatusUpdate } from "@/lib/requests";
import {
  answerTelegramCallbackQuery,
  restoreTelegramBookingActions,
  sendTelegramBookingCancellationFeedback,
  sendTelegramBookingCancellationNotice,
  sendTelegramBookingCallbackFeedback,
  sendTelegramBookingCancellationPrompt,
  sendTelegramBookingCancellationOptions,
  sendTelegramCallbackFeedback,
} from "@/lib/telegram";
import type { TelegramAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTelegramAction(value: string): value is TelegramAction {
  return value === "RECEIVE" || value === "PENDING" || value === "APPROVE" || value === "NOT_FOUND";
}

function getActorName(user: { first_name?: string; last_name?: string; username?: string } | undefined) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "เจ้าหน้าที่";
}

function getCancellationTicketIdFromReply(message: {
  reply_to_message?: { from?: { is_bot?: boolean }; text?: unknown };
}) {
  if (message.reply_to_message?.from?.is_bot !== true) return null;
  const promptText = message.reply_to_message.text;
  if (typeof promptText !== "string") return null;

  const match = /^✍️ เหตุผลการยกเลิกคิว (NID-[A-Z0-9]{6}) \(พิมพ์เหตุผลด้านล่างได้เลย\)$/.exec(promptText);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  try {
    const update = await request.json();

    const incomingMessage = update?.message;
    if (incomingMessage) {
      const ticketId = getCancellationTicketIdFromReply(incomingMessage);
      const reason = typeof incomingMessage.text === "string" ? incomingMessage.text.trim() : "";
      const chatId = incomingMessage.chat?.id;
      const userId = incomingMessage.from?.id;
      const messageId = incomingMessage.message_id;
      if (!ticketId || !reason || chatId == null || userId == null || messageId == null) {
        return Response.json({ ok: true });
      }

      const settings = await getSettingsMap();
      if (reason.length > 1000) {
        await sendTelegramBookingCancellationNotice(settings, {
          chatId,
          replyToMessageId: messageId,
          text: "เหตุผลยาวเกิน 1,000 ตัวอักษร กรุณาส่งเหตุผลที่สั้นลง หรือกดยกเลิกโดยไม่ระบุเหตุผล",
        });
        return Response.json({ ok: true });
      }

      const result = await completeBookingCancellationFromTelegram(
        settings,
        ticketId,
        chatId,
        userId,
        getActorName(incomingMessage.from),
        reason,
      );

      if (result.updated) {
        await sendTelegramBookingCancellationFeedback(settings, {
          chatId,
          originalMessageId: result.originalMessageId,
          replyToMessageId: messageId,
          ticketId: result.ticketId,
          status: result.status,
          actionBy: getActorName(incomingMessage.from),
          reason,
        });
      } else if (result.authorized && result.expired) {
        if (result.originalMessageId != null) {
          await restoreTelegramBookingActions(settings, {
            chatId,
            messageId: result.originalMessageId,
            ticketId: result.ticketId,
          });
        }
        await sendTelegramBookingCancellationNotice(settings, {
          chatId,
          replyToMessageId: messageId,
          text: "คำขอยกเลิกหมดอายุแล้ว กรุณากดปุ่มยกเลิกคิวในข้อความแจ้งเตือนอีกครั้ง",
        });
      }

      return Response.json({ ok: true });
    }

    const callbackQuery = update?.callback_query;
    if (!callbackQuery) return Response.json({ ok: true });

    const [action, recordId] = String(callbackQuery.data ?? "").split("|");
    if (!recordId) return Response.json({ ok: true });

    const actorName = getActorName(callbackQuery.from);

    const settings = await getSettingsMap();

    if (action === "BOOKING_CANCEL") {
      const messageId = callbackQuery.message?.message_id;
      const chatId = callbackQuery.message?.chat?.id;
      const userId = callbackQuery.from?.id;
      if (messageId == null || chatId == null || userId == null) {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "ไม่สามารถตรวจสอบข้อมูลผู้กดปุ่มได้");
        return Response.json({ ok: true });
      }

      const result = await beginBookingCancellationFromTelegram(settings, recordId, chatId, userId, messageId);
      if (!result.updated) {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, `คิวนี้เปลี่ยนสถานะแล้ว: ${result.status}`);
        return Response.json({ ok: true });
      }

      await sendTelegramBookingCancellationOptions(settings, {
        callbackId: callbackQuery.id,
        chatId,
        bookingMessageId: messageId,
        ticketId: result.ticketId,
      });
      return Response.json({ ok: true });
    }

    if (action === "BOOKING_CANCEL_REASON") {
      const messageId = callbackQuery.message?.message_id;
      const chatId = callbackQuery.message?.chat?.id;
      const userId = callbackQuery.from?.id;
      if (messageId == null || chatId == null || userId == null) {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "ไม่สามารถตรวจสอบข้อมูลผู้กดปุ่มได้");
        return Response.json({ ok: true });
      }

      const result = await prepareBookingCancellationReasonFromTelegram(settings, recordId, chatId, userId);
      if (!result.authorized) {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "เฉพาะผู้เริ่มยกเลิกคิวเท่านั้นที่ระบุเหตุผลได้");
        return Response.json({ ok: true });
      }
      if (result.expired) {
        if (result.originalMessageId != null) {
          await restoreTelegramBookingActions(settings, {
            chatId,
            messageId: result.originalMessageId,
            ticketId: result.ticketId,
          });
        }
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "คำขอยกเลิกหมดอายุแล้ว กรุณากดปุ่มยกเลิกอีกครั้ง");
        return Response.json({ ok: true });
      }

      await sendTelegramBookingCancellationPrompt(settings, {
        callbackId: callbackQuery.id,
        chatId,
        bookingMessageId: messageId,
        ticketId: result.ticketId,
      });
      return Response.json({ ok: true });
    }

    if (action === "BOOKING_CANCEL_SKIP") {
      const messageId = callbackQuery.message?.message_id;
      const chatId = callbackQuery.message?.chat?.id;
      const userId = callbackQuery.from?.id;
      if (messageId == null || chatId == null || userId == null) {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "ไม่สามารถตรวจสอบข้อมูลผู้กดปุ่มได้");
        return Response.json({ ok: true });
      }

      const result = await completeBookingCancellationFromTelegram(settings, recordId, chatId, userId, actorName, "");
      if (result.updated) {
        await sendTelegramBookingCancellationFeedback(settings, {
          callbackId: callbackQuery.id,
          chatId,
          sourceMessageId: messageId,
          originalMessageId: result.originalMessageId,
          replyToMessageId: result.originalMessageId ?? messageId,
          ticketId: result.ticketId,
          status: result.status,
          actionBy: actorName,
          reason: "",
        });
      } else if (result.authorized && result.expired) {
        if (result.originalMessageId != null) {
          await restoreTelegramBookingActions(settings, {
            chatId,
            messageId: result.originalMessageId,
            ticketId: result.ticketId,
          });
        }
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "คำขอยกเลิกหมดอายุแล้ว กรุณากดปุ่มยกเลิกอีกครั้ง");
      } else {
        await answerTelegramCallbackQuery(settings, callbackQuery.id, "เฉพาะผู้เริ่มยกเลิกคิวเท่านั้นที่เลือกตัวเลือกนี้ได้");
      }
      return Response.json({ ok: true });
    }

    if (action === "BOOKING_CONFIRM") {
      const messageId = callbackQuery.message?.message_id;
      const chatId = callbackQuery.message?.chat?.id;
      if (!messageId || !chatId) return Response.json({ ok: true });

      const result = await updateBookingStatusFromTelegram(settings, recordId, chatId, actorName);
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
