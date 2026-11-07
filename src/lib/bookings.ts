import "server-only";

import { randomInt } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { BOOKING_TIME_SLOTS, getBookingTopic } from "@/lib/booking-options";
import type { CreateBookingInput } from "@/lib/types";
import { AppError, formatBangkokDay } from "@/lib/utils";

const TICKET_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLOT_TAKEN_MESSAGE = "ขออภัย ช่วงเวลานี้ของกลุ่มงานดังกล่าวมีผู้จองแล้ว กรุณาเลือกช่วงเวลาอื่น";

function validateBookingDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError("รูปแบบวันที่ไม่ถูกต้อง");
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new AppError("วันที่ไม่ถูกต้อง");
  }

  if (date < formatBangkokDay(new Date())) {
    throw new AppError("ไม่สามารถจองวันที่ผ่านมาแล้วได้");
  }
}

function generateTicketId() {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += TICKET_ALPHABET[randomInt(TICKET_ALPHABET.length)];
  }
  return `NID-${suffix}`;
}

export async function getAvailableBookingSlots(date: string, topicId: string) {
  validateBookingDate(date);

  const topic = getBookingTopic(topicId);
  if (!topic) {
    throw new AppError("กรุณาเลือกเรื่องที่ขอรับบริการ");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("time_slot")
    .eq("appointment_date", date)
    .eq("department", topic.department)
    .neq("status", "ยกเลิก");

  if (error) {
    throw new AppError(`ตรวจสอบคิวว่างไม่สำเร็จ: ${error.message}`, 500);
  }

  const bookedSlots = new Set((data ?? []).map((row) => row.time_slot));
  return BOOKING_TIME_SLOTS.map((slot) => ({
    ...slot,
    available: !bookedSlots.has(slot.id),
  }));
}

export async function createBooking(input: CreateBookingInput) {
  const topic = getBookingTopic(input.topicId);
  if (!topic) {
    throw new AppError("เรื่องที่ขอรับบริการไม่ถูกต้อง");
  }

  const topicOther = (input.topicOther ?? "").trim();
  if (topic.allowsOther && !topicOther) {
    throw new AppError("กรุณาระบุรายละเอียดเรื่องที่ขอรับบริการ");
  }

  const timeSlot = BOOKING_TIME_SLOTS.find((slot) => slot.id === input.timeSlot);
  if (!timeSlot) {
    throw new AppError("ช่วงเวลาที่เลือกไม่ถูกต้อง");
  }

  validateBookingDate(input.date);

  const agency = input.agency.trim();
  if (!agency) {
    throw new AppError("กรุณาระบุชื่อส่วนราชการผู้รับบริการ");
  }

  const topicText = topic.allowsOther ? `${topic.label} (${topicOther})` : topic.label;
  const availableSlots = await getAvailableBookingSlots(input.date, input.topicId);
  if (!availableSlots.find((slot) => slot.id === input.timeSlot)?.available) {
    throw new AppError(SLOT_TAKEN_MESSAGE, 409);
  }

  const supabase = getSupabaseAdminClient();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketId = generateTicketId();
    const { error } = await supabase.from("bookings").insert({
      ticket_id: ticketId,
      amount: 1,
      appointment_date: input.date,
      time_slot: timeSlot.id,
      agency,
      topic: topicText,
      department: topic.department,
      receiver_name: "",
      status: "รอตอบรับ",
    });

    if (!error) {
      return {
        success: true,
        ticketId,
        message: "จองคิวสำเร็จเรียบร้อยแล้ว",
        booking: {
          ticketId,
          agency,
          topic: topicText,
          department: topic.department,
          date: input.date,
          timeSlot: timeSlot.id,
          status: "รอตอบรับ",
          receiverName: "รอเจ้าหน้าที่ตอบรับ",
        },
      };
    }

    if (error.code === "23505") {
      const { data: occupiedSlot, error: lookupError } = await supabase
        .from("bookings")
        .select("ticket_id")
        .eq("appointment_date", input.date)
        .eq("department", topic.department)
        .eq("time_slot", timeSlot.id)
        .neq("status", "ยกเลิก")
        .maybeSingle();

      if (lookupError) {
        throw new AppError(`ตรวจสอบสถานะคิวไม่สำเร็จ: ${lookupError.message}`, 500);
      }
      if (occupiedSlot) {
        throw new AppError(SLOT_TAKEN_MESSAGE, 409);
      }
      continue;
    }

    throw new AppError(`บันทึกการจองไม่สำเร็จ: ${error.message}`, 500);
  }

  throw new AppError("สร้างหมายเลขคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", 500);
}

export async function checkBookingStatus(ticketId: string) {
  const normalizedTicketId = ticketId.trim().toUpperCase();
  if (!/^NID-[A-Z0-9]{6}$/.test(normalizedTicketId)) {
    throw new AppError("รูปแบบหมายเลขคิวไม่ถูกต้อง");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("ticket_id, agency, topic, department, appointment_date, time_slot, status, receiver_name")
    .eq("ticket_id", normalizedTicketId)
    .maybeSingle();

  if (error) {
    throw new AppError(`ค้นหาสถานะคิวไม่สำเร็จ: ${error.message}`, 500);
  }
  if (!data) return null;

  return {
    ticketId: data.ticket_id,
    agency: data.agency,
    topic: data.topic,
    department: data.department,
    date: data.appointment_date,
    timeSlot: data.time_slot,
    status: data.status || "รอตอบรับ",
    receiverName: data.receiver_name || "รอเจ้าหน้าที่ตอบรับ",
  };
}
