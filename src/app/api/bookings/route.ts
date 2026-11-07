import { createBooking, checkBookingStatus } from "@/lib/bookings";
import { createServerErrorResponse } from "@/lib/requests";
import { createBookingSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ message: parsed.error.issues[0]?.message ?? "ข้อมูลการจองไม่ถูกต้อง" }, { status: 400 });
    }

    const result = await createBooking(parsed.data, new URL(request.url).origin);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return createServerErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId") ?? "";
    const booking = await checkBookingStatus(ticketId);

    if (!booking) {
      return Response.json(
        { found: false, message: "ไม่พบหมายเลขคิวนี้ในระบบ กรุณาตรวจสอบรหัสอีกครั้ง" },
        { status: 404 },
      );
    }

    return Response.json({ found: true, ...booking }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return createServerErrorResponse(error);
  }
}
