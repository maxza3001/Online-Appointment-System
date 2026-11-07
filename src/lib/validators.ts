import { z } from "zod";

import { dashboardStatusValues } from "@/lib/statuses";

export const createRequestSchema = z.object({
  requestCount: z.coerce.number().int("จำนวนต้องเป็นเลขจำนวนเต็ม").min(1, "กรุณาระบุจำนวนผู้ขออย่างน้อย 1 ราย"),
  agency: z.string().trim().min(1, "กรุณาเลือกส่วนราชการ"),
});

export const createBookingSchema = z.object({
  agency: z.string().trim().min(1, "กรุณาระบุชื่อส่วนราชการผู้รับบริการ").max(200),
  topicId: z.string().trim().min(1, "กรุณาเลือกเรื่องที่ขอรับบริการ"),
  topicOther: z.string().trim().max(300).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  timeSlot: z.string().trim().min(1, "กรุณาเลือกช่วงเวลา"),
});

export const updateRequestStatusSchema = z.object({
  status: z.enum(dashboardStatusValues),
  note: z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").optional(),
  sendNotification: z.boolean().optional(),
});
