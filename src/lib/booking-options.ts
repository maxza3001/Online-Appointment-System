export const BOOKING_TOPIC_GROUPS = [
  {
    department: "ฝ่ายบริหารทั่วไป",
    topics: [
      { id: "admin-contact", label: "ติดต่อประสานงานทั่วไป" },
      { id: "admin-other", label: "อื่นๆ", allowsOther: true },
    ],
  },
  {
    department: "กลุ่มงานวิชาการ",
    topics: [
      { id: "academic-egp-register", label: "ลงทะเบียนเข้าใช้งานในระบบ e-GP" },
      {
        id: "academic-egp-consult",
        label: "ปรึกษาหารือเกี่ยวกับงานด้านจัดซื้อจัดจ้าง/การปฏิบัติงานในระบบ e-GP",
      },
      { id: "academic-pension-copy", label: "ขอรับสำเนาหนังสือรับรองบำเหน็จค้ำประกัน" },
      { id: "academic-finance-law", label: "ปรึกษาหารือเกี่ยวกับกฎหมาย ระเบียบ การเงินการคลัง" },
      { id: "academic-other", label: "อื่นๆ", allowsOther: true },
    ],
  },
  {
    department: "กลุ่มงานระบบการคลัง GF",
    topics: [
      {
        id: "gf-gfmis-ktb-vendor",
        label: "New GFMIS Thai/KTB Corporate Online/ข้อมูลหลักผู้ขาย",
      },
      { id: "gf-token", label: "ต่ออายุ Token key/Soft Token" },
      { id: "gf-other", label: "อื่นๆ", allowsOther: true },
    ],
  },
  {
    department: "กลุ่มนโยบายเศรษฐกิจการคลัง",
    topics: [
      { id: "policy-nsf", label: "กองทุนการออมแห่งชาติ (กอช.)" },
      { id: "policy-economic-data", label: "ข้อมูลเศรษฐกิจการคลัง" },
      {
        id: "policy-state-benefits",
        label: "นโยบายของรัฐ เช่น เบี้ยยังชีพผู้สูงอายุ บัตรสวัสดิการแห่งรัฐ ฯลฯ เป็นต้น",
      },
      { id: "policy-complaint", label: "ร้องทุกข์/ร้องเรียน" },
      { id: "policy-other", label: "อื่นๆ", allowsOther: true },
    ],
  },
] as const;

export type BookingTopicOption = {
  id: string;
  label: string;
  department: string;
  allowsOther: boolean;
};

export const BOOKING_TOPICS: BookingTopicOption[] = BOOKING_TOPIC_GROUPS.flatMap((group) =>
  group.topics.map((topic) => ({
    id: topic.id,
    label: topic.label,
    department: group.department,
    allowsOther: "allowsOther" in topic && topic.allowsOther,
  })),
);

export const BOOKING_TIME_SLOTS = [
  { id: "09.00-10.00", label: "เช้า (09.00 - 10.00 น.)" },
  { id: "10.30-11.30", label: "เช้า (10.30 - 11.30 น.)" },
  { id: "13.30-14.30", label: "บ่าย (13.30 - 14.30 น.)" },
  { id: "14.30-15.30", label: "บ่าย (14.30 - 15.30 น.)" },
] as const;

export function getBookingTopic(topicId: string) {
  return BOOKING_TOPICS.find((topic) => topic.id === topicId);
}
