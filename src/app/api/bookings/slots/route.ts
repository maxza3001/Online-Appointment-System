import { getAvailableBookingSlots } from "@/lib/bookings";
import { createServerErrorResponse } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? "";
    const topicId = searchParams.get("topicId") ?? "";
    const slots = await getAvailableBookingSlots(date, topicId);

    return Response.json(slots, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return createServerErrorResponse(error);
  }
}
