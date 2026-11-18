import React, { useEffect, useState } from "react";
import { surveys } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & Metrics" },
  { id: "surveys", label: "Technical Consultations" },
  { id: "room", label: "WebRTC Consultation & Notes" },
  { id: "ai_minutes", label: "Dash AI Minutes & Quotations" }
];

function formatCurrency(val) {
  const num = Number(val) || 0;
  return `USD $${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function VirtualSurveysPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [surveyList, setSurveyList] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);

  // Modals & submittals
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [extractingAi, setExtractingAi] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // Booking Form
  const [bookForm, setBookForm] = useState({
    client_id: "c-zimplats",
    client_name: "Zimplats SMC",
    equipment_tag_id: "TAG-PU-101",
    equipment_tag_name: "Primary Slurry Feed Pump PU-101",
    mine_site: "ZIMPLATS_SMC",
    scheduled_at: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    duration_minutes: 60,
    host_specialist_id: user?.id || "u-specialist",
    host_specialist_name: user?.name || "Lead Rubber Lining Specialist",
    client_engineer_name: "Eng. Chitepo",
    client_engineer_email: "chitepo@zimplats.co.zw"
  });

  // Observations Form
  const [notesForm, setNotesForm] = useState({
    wear_assessment_notes: "Visual CAD inspection confirms severe slurry cavitation wear on suction liner.",
    wear_depth_mm: 6.8,
    recommended_lining_spec: "15mm 40-Shore Natural Wear Rubber (Cold Vulcanized)"
  });

  // Transcript Form for AI Extraction
  const [transcriptText, setTranscriptText] = useState(
    `Specialist: We are reviewing the CAD drawings and ultrasonic thickness measurements for Primary Slurry Feed Pump PU-101.\n` +
    `Engineer: Yes, our plant inspection found the steel shell has worn down to 5.4mm from original 12mm.\n` +
    `Specialist: Understood. We recommend cold vulcanized rubber relining with 15mm 40-Shore natural wear rubber.\n` +
    `We will allocate Chemlok bonding primer kits and 16 hours of certified specialist artisan labour.`
  );

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [sumRes, surveysRes] = await Promise.all([
        surveys.getSummary().catch(() => null),
        surveys.listSurveys().catch(() => [])
      ]);
      setSummary(sumRes);
      setSurveyList(surveysRes || []);
      if (surveysRes && surveysRes.length > 0 && !selectedSurvey) {
        setSelectedSurvey(surveysRes[0]);
      }
    } catch (err) {
      setError(err.message || "Failed to load technical surveys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleBookSurvey(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await surveys.bookSurvey(bookForm);
      setSuccessMsg("Virtual Technical Survey consultation booked with Daily.co WebRTC room.");
      setBookModalOpen(false);
      await loadAll();
      if (res.data) setSelectedSurvey(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveNotes(e) {
    e.preventDefault();
    if (!selectedSurvey) return;
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await surveys.completeSurvey(selectedSurvey.id, {
        wear_assessment_notes: notesForm.wear_assessment_notes,
        wear_depth_mm: Number(notesForm.wear_depth_mm),
        recommended_lining_spec: notesForm.recommended_lining_spec
      });
      setSuccessMsg("Equipment wear observation notes saved and survey marked completed.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtractAiScope(e) {
    e.preventDefault();
    if (!selectedSurvey) return;
    setExtractingAi(true);
    setAiResult(null);
    setError("");
    setSuccessMsg("");
    try {
      const res = await surveys.extractAiScope(selectedSurvey.id, {
        transcript_text: transcriptText,
        auto_create_quote: true
      });
      setAiResult(res.data);
      setSuccessMsg("Dash AI extracted equipment wear scope and pre-populated USD Draft Quotation!");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setExtractingAi(false);
    }
  }

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <PageHeaderBanner
        title="Virtual Technical Surveys & AI Minutes Subsystem"
        subtitle="Manage remote engineering video consultations via Daily.co WebRTC, CAD wear inspections for heavy mining clients, and Dash AI automated quotation scope extraction in USD."
      />

      {error && <ErrorBanner message={error} />}
      {successMsg && (
        <div className="p-4 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
          {successMsg}
        </div>
      )}

      <TabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div role="tabpanel" aria-labelledby="tab-overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Consultations</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary?.total_surveys || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Scheduled Surveys</div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-300">{summary?.scheduled_surveys || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Completed Surveys</div>
              <div className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{summary?.completed_surveys || 0}</div>
            </div>
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm font-medium text-orac-blue">Quotes Drafted via AI</div>
              <div className="mt-2 text-2xl font-bold text-orac-navy dark:text-white">{summary?.quotes_drafted_from_ai || 0}</div>
            </div>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <SectionTitle title="Remote Technical Equipment Inspection & Quotation Pipeline" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Mining operations at remote sites (such as Zimplats Ngezi/SMC, Unki Concentrator in Shurugwi, and Mimosa Flotation in Zvishavane)
              frequently experience wear crises on slurry pumps, cyclones, and conveyor chutes.
              Using <strong>Virtual Technical Surveys</strong>, mine plant engineers meet with ORAC technical specialists over encrypted WebRTC video,
              inspect CAD drawings and wall-thickness ultrasound data in real time, and trigger <strong>Dash AI</strong> to automatically generate structured commercial quotations.
            </p>
          </div>
        </div>
      )}

      {activeTab === "surveys" && (
        <div role="tabpanel" aria-labelledby="tab-surveys" className="space-y-4">
          <div className="flex justify-between items-center">
            <SectionTitle title="Technical Consultation Appointments" />
            <Button variant="primary" onClick={() => setBookModalOpen(true)}>
              Book Technical Survey
            </Button>
          </div>

          <DataTable
            data={surveyList}
            keyField="id"
            columns={[
              { key: "survey_number", label: "Survey #" },
              { key: "client_name", label: "Client" },
              { key: "equipment_tag_name", label: "Equipment Inspected" },
              { key: "mine_site", label: "Mining Site" },
              {
                key: "scheduled_at",
                label: "Scheduled At",
                render: (val) => val ? new Date(val).toLocaleString() : "-"
              },
              { key: "host_specialist_name", label: "Lead Specialist" },
              {
                key: "status",
                label: "Status",
                render: (val) => (
                  <Badge variant={val === "COMPLETED" ? "success" : val === "SCHEDULED" ? "warning" : "default"}>
                    {val}
                  </Badge>
                )
              },
              {
                key: "linked_quote_id",
                label: "Linked Quote",
                render: (val) => val ? (
                  <Badge variant="info">Quote Linked</Badge>
                ) : (
                  <span className="text-gray-400 text-sm">None</span>
                )
              }
            ]}
          />
        </div>
      )}

      {activeTab === "room" && (
        <div role="tabpanel" aria-labelledby="tab-room" className="space-y-6">
          <div className="flex justify-between items-center">
            <SectionTitle title="Live Consultation Room & Inspection Observations" />
            {surveyList.length > 0 && (
              <select
                value={selectedSurvey?.id || ""}
                onChange={(e) => {
                  const s = surveyList.find((item) => item.id === e.target.value);
                  setSelectedSurvey(s || null);
                }}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white"
              >
                {surveyList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.survey_number} &mdash; {s.client_name} ({s.equipment_tag_name})
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedSurvey ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* WebRTC Video Room Launcher */}
              <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-4">
                <div className="text-base font-semibold text-gray-900 dark:text-white">
                  WebRTC Meeting: {selectedSurvey.meeting_room_name || selectedSurvey.survey_number}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Target Equipment: <strong>{selectedSurvey.equipment_tag_name}</strong> at <strong>{selectedSurvey.mine_site}</strong>
                </div>
                <div className="p-4 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Meeting Room URL:</div>
                  <div className="text-sm font-mono text-orac-blue break-all">
                    {selectedSurvey.meeting_room_url || "https://orac-systems.daily.co/survey-room"}
                  </div>
                </div>
                <div className="pt-2">
                  <Button variant="primary" onClick={() => setVideoModalOpen(true)}>
                    Join Video Consultation Room
                  </Button>
                </div>
              </div>

              {/* Wear Assessment Observation Notes Form */}
              <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                  Engineer Physical Wear Assessment Notes
                </div>
                <form onSubmit={handleSaveNotes} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Wear Depth Measurement (mm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={notesForm.wear_depth_mm}
                      onChange={(e) => setNotesForm({ ...notesForm, wear_depth_mm: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Recommended Lining Specification
                    </label>
                    <input
                      type="text"
                      required
                      value={notesForm.recommended_lining_spec}
                      onChange={(e) => setNotesForm({ ...notesForm, recommended_lining_spec: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Wear Assessment Observation Notes
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={notesForm.wear_assessment_notes}
                      onChange={(e) => setNotesForm({ ...notesForm, wear_assessment_notes: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button variant="primary" type="submit" disabled={submitting}>
                      {submitting ? "Saving Notes..." : "Complete & Save Inspection Notes"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500 text-sm">
              No technical surveys found. Please book a survey first.
            </div>
          )}
        </div>
      )}

      {activeTab === "ai_minutes" && (
        <div role="tabpanel" aria-labelledby="tab-ai_minutes" className="space-y-6">
          <div className="flex justify-between items-center">
            <SectionTitle title="Dash AI Technical Minutes & Quotation Scope Extractor" />
            {surveyList.length > 0 && (
              <select
                value={selectedSurvey?.id || ""}
                onChange={(e) => {
                  const s = surveyList.find((item) => item.id === e.target.value);
                  setSelectedSurvey(s || null);
                }}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white"
              >
                {surveyList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.survey_number} &mdash; {s.client_name} ({s.equipment_tag_name})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Technical Consultation Discussion Transcript / Audio Minutes
            </label>
            <textarea
              rows={5}
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-white"
            />

            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={handleExtractAiScope} disabled={extractingAi || !selectedSurvey}>
                {extractingAi ? "Analyzing with Dash AI..." : "Extract Industrial Scope & Generate USD Quote"}
              </Button>
            </div>
          </div>

          {aiResult && (
            <div className="space-y-6">
              <div className="p-6 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
                <div className="text-base font-bold text-emerald-900 dark:text-emerald-100">
                  AI Scope Extracted Successfully &mdash; Quotation Created
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-emerald-800 dark:text-emerald-200">
                  <div>
                    <span className="font-semibold">Measured Wear:</span> {aiResult.extracted_scope?.measured_wear_depth_mm} mm
                  </div>
                  <div>
                    <span className="font-semibold">Recommended Spec:</span> {aiResult.extracted_scope?.recommended_lining_spec}
                  </div>
                  <div>
                    <span className="font-semibold">Quotation Total:</span> {formatCurrency(aiResult.extracted_scope?.total_estimated_usd)}
                  </div>
                </div>
                {aiResult.created_quote && (
                  <div className="mt-4 p-3 rounded bg-white dark:bg-gray-900 border border-emerald-300 dark:border-emerald-700 text-sm">
                    <strong>Draft Quotation:</strong> {aiResult.created_quote.quote_number} (Status: {aiResult.created_quote.status}, Currency: {aiResult.created_quote.currency})
                  </div>
                )}
              </div>

              {aiResult.extracted_scope?.suggested_line_items && (
                <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-4">
                  <div className="text-base font-semibold text-gray-900 dark:text-white">
                    Pre-Populated Quotation Line Items (Strict USD Billing S-08)
                  </div>
                  <DataTable
                    data={aiResult.extracted_scope.suggested_line_items}
                    keyField="item_code"
                    columns={[
                      { key: "item_code", label: "Item Code" },
                      { key: "description", label: "Description" },
                      { key: "quantity", label: "Quantity" },
                      { key: "unit_of_measure", label: "UOM" },
                      {
                        key: "unit_price",
                        label: "Unit Price",
                        render: (val) => formatCurrency(val)
                      },
                      {
                        key: "total_price",
                        label: "Total Price",
                        render: (val) => formatCurrency(val)
                      }
                    ]}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Book Survey Modal */}
      {bookModalOpen && (
        <Modal title="Book Virtual Technical Survey Appointment" onClose={() => setBookModalOpen(false)}>
          <form onSubmit={handleBookSurvey} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client ID</label>
                <input
                  type="text"
                  required
                  value={bookForm.client_id}
                  onChange={(e) => setBookForm({ ...bookForm, client_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client Name</label>
                <input
                  type="text"
                  required
                  value={bookForm.client_name}
                  onChange={(e) => setBookForm({ ...bookForm, client_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Equipment Tag ID</label>
                <input
                  type="text"
                  required
                  value={bookForm.equipment_tag_id}
                  onChange={(e) => setBookForm({ ...bookForm, equipment_tag_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Equipment Name</label>
                <input
                  type="text"
                  required
                  value={bookForm.equipment_tag_name}
                  onChange={(e) => setBookForm({ ...bookForm, equipment_tag_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mining Site</label>
                <input
                  type="text"
                  required
                  value={bookForm.mine_site}
                  onChange={(e) => setBookForm({ ...bookForm, mine_site: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Scheduled Date & Time</label>
                <input
                  type="datetime-local"
                  required
                  value={bookForm.scheduled_at}
                  onChange={(e) => setBookForm({ ...bookForm, scheduled_at: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client Engineer Name</label>
                <input
                  type="text"
                  required
                  value={bookForm.client_engineer_name}
                  onChange={(e) => setBookForm({ ...bookForm, client_engineer_name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client Engineer Email</label>
                <input
                  type="email"
                  value={bookForm.client_engineer_email}
                  onChange={(e) => setBookForm({ ...bookForm, client_engineer_email: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setBookModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Booking Room..." : "Book Survey Appointment"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Embedded Video Consultation Modal */}
      {videoModalOpen && selectedSurvey && (
        <Modal title={`Live Consultation: ${selectedSurvey.survey_number}`} onClose={() => setVideoModalOpen(false)}>
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-gray-900 text-white text-center min-h-[300px] flex flex-col justify-center items-center space-y-3">
              <div className="text-lg font-bold">WebRTC Daily.co Video Room Active</div>
              <div className="text-sm text-gray-400">
                Equipment Tag: {selectedSurvey.equipment_tag_name} &bull; Mine: {selectedSurvey.mine_site}
              </div>
              <div className="text-xs font-mono text-emerald-600">
                {selectedSurvey.meeting_room_url}
              </div>
              <div className="pt-4 flex space-x-3">
                <Button variant="primary" onClick={() => window.open(selectedSurvey.meeting_room_url, "_blank")}>
                  Open Fullscreen CAD Room
                </Button>
                <Button variant="secondary" onClick={() => setVideoModalOpen(false)}>
                  Close Room Window
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
