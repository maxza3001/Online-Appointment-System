export const dashboardStatusValues = [
  "รออนุมัติ",
  "รับเรื่องแล้ว",
  "รอพิจารณา",
  "ยังไม่มีในระบบ d-pension",
  "อนุมัติแล้ว",
] as const;

export type DashboardStatus = (typeof dashboardStatusValues)[number];

export function getStatusTone(status: string) {
  if (status === "รับเรื่องแล้ว") return "received";
  if (status === "รอพิจารณา") return "review";
  if (status === "ยังไม่มีในระบบ" || status === "ยังไม่มีในระบบ d-pension") return "missing";
  if (status === "อนุมัติแล้ว") return "approved";
  if (status === "ยกเลิก") return "cancelled";
  return "pending";
}
