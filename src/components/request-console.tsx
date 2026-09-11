"use client";

import clsx from "clsx";
import Image from "next/image";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { dashboardStatusValues, getStatusTone } from "@/lib/statuses";
import type { CreateRequestInput, RequestRecord } from "@/lib/types";

type DashboardStatus = (typeof dashboardStatusValues)[number];

type FlashState = {
  type: "success" | "error";
  title: string;
  message: string;
} | null;

const INITIAL_FORM = {
  requestCount: "",
  agency: "",
};

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.message || "คำขอไม่สำเร็จ");
  }

  return payload as T;
}

async function fetchRequestsFromApi(options?: {
  search?: string;
  status?: "all" | DashboardStatus;
}) {
  const params = new URLSearchParams();

  if (options?.search) {
    params.set("search", options.search);
  }

  if (options?.status && options.status !== "all") {
    params.set("status", options.status);
  }

  const url = params.size > 0 ? `/api/requests?${params.toString()}` : "/api/requests";
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  return parseResponse<RequestRecord[]>(response);
}

async function createRequestFromApi(input: CreateRequestInput) {
  const response = await fetch("/api/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  return parseResponse<{ message: string }>(response);
}

function parseFormData(formData: typeof INITIAL_FORM): CreateRequestInput {
  const requestCount = Number.parseInt(formData.requestCount, 10);
  const agency = formData.agency.trim();

  if (!Number.isInteger(requestCount) || requestCount < 1) {
    throw new Error("กรุณาระบุจำนวนผู้ขออย่างน้อย 1 ราย");
  }

  if (!agency) {
    throw new Error("กรุณาเลือกส่วนราชการ");
  }

  return {
    requestCount,
    agency,
  };
}

export function RequestConsole({ agencies }: { agencies: readonly string[] }) {
  const [activeTab, setActiveTab] = useState<"form" | "dashboard">("form");
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [requestsError, setRequestsError] = useState("");
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | DashboardStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [modalRequest, setModalRequest] = useState<RequestRecord | null>(null);
  const [modalStatus, setModalStatus] = useState<DashboardStatus>(dashboardStatusValues[0]);
  const [modalNote, setModalNote] = useState("");
  const [modalNotify, setModalNotify] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  const flashTimerRef = useRef<number | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());

  function pushFlash(nextFlash: FlashState) {
    setFlash(nextFlash);

    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
    }

    flashTimerRef.current = window.setTimeout(() => {
      setFlash(null);
    }, 4_000);
  }

  async function loadRequests(silent = false) {
    if (!silent) {
      setIsLoadingRequests(true);
    }

    try {
      const data = await fetchRequestsFromApi({
        search: deferredSearchTerm,
        status: statusFilter,
      });
      startTransition(() => {
        setRequests(data);
        setRequestsError("");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "โหลดข้อมูลล้มเหลว";
      if (!silent) {
        setRequestsError(message);
      }
    } finally {
      if (!silent) {
        setIsLoadingRequests(false);
      }
    }
  }

  const refreshDashboardPoll = useEffectEvent(async () => {
    try {
      const data = await fetchRequestsFromApi({
        search: deferredSearchTerm,
        status: statusFilter,
      });
      startTransition(() => {
        setRequests(data);
        setRequestsError("");
      });
    } catch {
      // Ignore polling errors so the dashboard keeps the last good state.
    }
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchRequestsFromApi({
          search: deferredSearchTerm,
          status: statusFilter,
        });
        if (cancelled) return;

        startTransition(() => {
          setRequests(data);
          setRequestsError("");
        });
      } catch (error) {
        if (!cancelled) {
          setRequestsError(error instanceof Error ? error.message : "โหลดข้อมูลล้มเหลว");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRequests(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deferredSearchTerm, statusFilter]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (activeTab === "dashboard") {
        void refreshDashboardPoll();
      }
    }, 2_500);

    return () => window.clearInterval(intervalId);
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const filteredRequests = requests;

  function resetForm() {
    setFormData(INITIAL_FORM);
  }

  function handleRequestCountChange(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    setFormData((current) => ({ ...current, requestCount: digitsOnly }));
  }

  async function handleSubmitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let nextRequest: CreateRequestInput;

    try {
      nextRequest = parseFormData(formData);
    } catch (error) {
      pushFlash({
        type: "error",
        title: "ส่งคำขอไม่สำเร็จ",
        message: error instanceof Error ? error.message : "เกิดข้อผิดพลาด",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createRequestFromApi(nextRequest);
      resetForm();
      void loadRequests(true);
      pushFlash({
        type: "success",
        title: "ส่งคำขอสำเร็จ",
        message: result.message || "ส่งคำขอสำเร็จแล้ว",
      });
    } catch (error) {
      pushFlash({
        type: "error",
        title: "ส่งคำขอไม่สำเร็จ",
        message: error instanceof Error ? error.message : "เกิดข้อผิดพลาด",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function openModal(request: RequestRecord) {
    setModalRequest(request);
    setModalStatus(
      dashboardStatusValues.includes(request.status as DashboardStatus)
        ? (request.status as DashboardStatus)
        : dashboardStatusValues[0],
    );
    setModalNote(request.note === "-" ? "" : request.note);
    setModalNotify(false);
  }

  function closeModal() {
    setModalRequest(null);
    setModalNote("");
    setModalNotify(false);
  }

  async function handleSaveStatus() {
    if (!modalRequest) return;

    setIsSavingStatus(true);

    try {
      const response = await fetch(`/api/requests/${modalRequest.reqId}/status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: modalStatus,
          note: modalNote,
          sendNotification: modalNotify,
        }),
      });

      await parseResponse<{ success: boolean }>(response);
      closeModal();
      pushFlash({
        type: "success",
        title: "อัปเดตสถานะสำเร็จ",
        message: `คำขอ ${modalRequest.reqId} ถูกอัปเดตเป็น ${modalStatus} แล้ว`,
      });
      void loadRequests(false);
    } catch (error) {
      pushFlash({
        type: "error",
        title: "อัปเดตสถานะไม่สำเร็จ",
        message: error instanceof Error ? error.message : "เกิดข้อผิดพลาด",
      });
    } finally {
      setIsSavingStatus(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-frame">
        <header className="hero-bar">
          <div className="hero-brand">
            <div className="hero-brand-badge" aria-hidden="true">
              <Image
                src="/logo.svg"
                alt=""
                width={40}
                height={40}
                className="hero-brand-logo"
                unoptimized
              />
            </div>
            <div className="hero-copy">
              <h1>ระบบแจ้งเตือนคำขอหนังสือบำเหน็จค้ำประกัน</h1>
              <p>สำนักงานคลังจังหวัดสกลนคร</p>
            </div>
          </div>
          <div className="hero-status">
            <span className="hero-status-dot" />
            Live workflow
          </div>
        </header>

        <div className="control-row">
          <div className="tab-set" role="tablist" aria-label="เลือกมุมมอง">
            <button
              type="button"
              className={clsx("tab-button", activeTab === "form" && "is-active")}
              onClick={() => startTransition(() => setActiveTab("form"))}
            >
              📝 แบบฟอร์ม
            </button>
            <button
              type="button"
              className={clsx("tab-button", activeTab === "dashboard" && "is-active")}
              onClick={() => startTransition(() => setActiveTab("dashboard"))}
            >
              📊 แดชบอร์ด
            </button>
          </div>
        </div>

        {requestsError ? (
          <div className="setup-note">
            <strong>ระบบยังไม่พร้อมใช้งานเต็มรูปแบบ</strong>
            <div>{requestsError}</div>
            <div>ตรวจสอบ `.env.local` และรัน SQL schema ของ Supabase ก่อนใช้งานครั้งแรก</div>
          </div>
        ) : null}

        <div className="layout-grid">
          {activeTab === "form" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">บันทึกคำขอใหม่</div>
                  <div className="panel-subtitle">
                    กรอกข้อมูลให้ครบแล้วกดส่ง ระบบจะบันทึกคำขอและแจ้งเตือนทันที
                  </div>
                </div>
                <div className="panel-chip">พร้อมส่งคำขอ</div>
              </div>

              <form onSubmit={handleSubmitRequest}>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="requestCount">จำนวนผู้ขอ</label>
                    <input
                      id="requestCount"
                      className="input"
                      type="text"
                      inputMode="numeric"
                      value={formData.requestCount}
                      onChange={(event) => handleRequestCountChange(event.target.value)}
                      placeholder="ระบุจำนวน เช่น 12"
                      autoComplete="off"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="agency">สังกัดส่วนราชการ</label>
                    <select
                      id="agency"
                      className="select"
                      value={formData.agency}
                      onChange={(event) => setFormData((current) => ({ ...current, agency: event.target.value }))}
                    >
                      <option value="">-- เลือกส่วนราชการ --</option>
                      {agencies.map((agency) => (
                        <option key={agency} value={agency}>
                          {agency}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="button-row">
                  <button type="button" className="button-secondary" onClick={resetForm} disabled={isSubmitting}>
                    ล้างฟอร์ม
                  </button>
                  <button type="submit" className="button-primary" disabled={isSubmitting}>
                    {isSubmitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="panel">
              <div className="toolbar">
                <div className="toolbar-stats">
                  <strong>{filteredRequests.length}</strong> รายการที่แสดง
                </div>

                <div className="toolbar-actions">
                  <div className="search-shell">
                    <span>🔎</span>
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="ค้นหา จำนวนผู้ขอ, หน่วยงาน"
                    />
                  </div>

                  <select
                    className="select"
                    style={{ minWidth: 164 }}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as "all" | DashboardStatus)}
                  >
                    <option value="all">ทุกสถานะ</option>
                    {dashboardStatusValues.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="table-shell">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>วันที่-เวลา</th>
                        <th>จำนวนผู้ขอ</th>
                        <th>ส่วนราชการ</th>
                        <th>สถานะ</th>
                        <th>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingRequests ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="empty-state">กำลังโหลดข้อมูล...</div>
                          </td>
                        </tr>
                      ) : filteredRequests.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="empty-state">
                              <div>
                                <strong>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</strong>
                                <div>ลองเปลี่ยนคำค้นหาหรือสถานะที่กรองอยู่</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredRequests.map((request) => (
                          <tr key={request.id}>
                            <td>
                              <div className="row-primary">{request.requestDate}</div>
                              <div className="row-secondary">{request.requestTime}</div>
                            </td>
                            <td className="row-primary">{request.requestSummary}</td>
                            <td className="row-secondary">{request.agency}</td>
                            <td>
                              <span className={clsx("status-badge", getStatusTone(request.status))}>
                                {request.status}
                              </span>
                            </td>
                            <td>
                              <button type="button" className="button-secondary" onClick={() => openModal(request)}>
                                จัดการ
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>

        <footer className="developer-footer" aria-label="ข้อมูลผู้พัฒนา">
          <div className="developer-card">
            <p className="developer-name">
              <span className="developer-icons" aria-hidden="true">
                <span>🦋</span>
                <span>👧</span>
              </span>
              <span>พรรณลิณี แผนเมือง</span>
            </p>
            <p className="developer-role">นักวิชาการเงินและบัญชี กลุ่มงานวิชาการ</p>
            <p className="developer-caption">ผู้พัฒนาระบบแจ้งเตือนคำขอหนังสือบำเหน็จค้ำประกัน</p>
          </div>
        </footer>

        {modalRequest ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="status-modal-title">
              <h3 id="status-modal-title">อัปเดตสถานะคำขอ</h3>
              <p>
                {modalRequest.reqId} • {modalRequest.requestSummary}
              </p>

              <div className="field-grid" style={{ marginTop: 20 }}>
                <div className="field full">
                  <label htmlFor="modalStatus">สถานะใหม่</label>
                  <select
                    id="modalStatus"
                    className="select"
                    value={modalStatus}
                    onChange={(event) => setModalStatus(event.target.value as DashboardStatus)}
                  >
                    {dashboardStatusValues.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-secondary status-quick-button"
                    aria-pressed={modalStatus === "ยังไม่มีในระบบ d-pension"}
                    onClick={() => setModalStatus("ยังไม่มีในระบบ d-pension")}
                  >
                    ยังไม่มีในระบบ d-pension
                  </button>
                </div>

                <div className="field full">
                  <label htmlFor="modalNote">หมายเหตุ</label>
                  <input
                    id="modalNote"
                    className="input"
                    value={modalNote}
                    onChange={(event) => setModalNote(event.target.value)}
                    placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)"
                  />
                </div>

                <div className="field full">
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={modalNotify}
                      onChange={(event) => setModalNotify(event.target.checked)}
                    />
                    ส่งแจ้งเตือน Telegram ด้วย
                  </label>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="button-secondary" onClick={closeModal} disabled={isSavingStatus}>
                  ยกเลิก
                </button>
                <button type="button" className="button-primary" onClick={handleSaveStatus} disabled={isSavingStatus}>
                  {isSavingStatus ? "กำลังบันทึก..." : "บันทึกสถานะ"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {flash ? (
          <div className={clsx("flash", flash.type)}>
            <strong>{flash.title}</strong>
            <div>{flash.message}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
