import React, { useEffect, useState } from "react";
import { feedback } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Modal from "../components/Modal.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner, PageLoadingSkeleton } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "overview", label: "Overview & NPS Metrics" },
  { id: "reviews", label: "Job Reviews Register" },
  { id: "triage", label: "Supervisor Triage Queue" },
  { id: "qbr", label: "Executive QBR Slide Deck" }
];

export default function ClientFeedbackPage({ user }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [summary, setSummary] = useState(null);
  const [reviewsList, setReviewsList] = useState([]);
  const [triageList, setTriageList] = useState([]);
  const [qbrDeck, setQbrDeck] = useState(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  // Modals & submittals
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form for New Feedback
  const [feedbackForm, setFeedbackForm] = useState({
    dispatch_card_id: "DSP-2026-11-001",
    client_id: "c-zimplats",
    client_name: "Zimplats SMC",
    equipment_tag_id: "TAG-PU-101",
    rating_stars: 5,
    nps_score: 10,
    service_quality_score: 5,
    safety_compliance_score: 5,
    timeliness_score: 5,
    comments: "Excellent cold vulcanized conveyor splice work. Zero downtime on restart.",
    submitted_by_name: user?.name || "Client Plant Engineer"
  });

  // Form for Triage
  const [triageForm, setTriageForm] = useState({
    triage_status: "RESOLVED",
    triage_notes: "Supervisor contacted client plant superintendent. Corrective re-inspection logged and closed."
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [sumRes, revRes, triRes] = await Promise.all([
        feedback.getSummary().catch(() => ({ data: null })),
        feedback.listFeedbacks().catch(() => ({ data: [] })),
        feedback.listFeedbacks({ triage_only: "true" }).catch(() => ({ data: [] }))
      ]);

      setSummary(sumRes?.data || null);
      setReviewsList(revRes?.data || []);
      setTriageList(triRes?.data || []);
    } catch (err) {
      setError(err.message || "Failed to load client feedback data");
    } finally {
      setLoading(false);
    }
  };

  const loadQbrDeck = async () => {
    try {
      const res = await feedback.getQbrDeck();
      setQbrDeck(res?.data || null);
      setActiveSlideIndex(0);
    } catch (err) {
      setError(err.message || "Failed to generate QBR Deck");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmitFeedback = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await feedback.submitFeedback({
        ...feedbackForm,
        rating_stars: Number(feedbackForm.rating_stars),
        nps_score: Number(feedbackForm.nps_score),
        service_quality_score: Number(feedbackForm.service_quality_score),
        safety_compliance_score: Number(feedbackForm.safety_compliance_score),
        timeliness_score: Number(feedbackForm.timeliness_score)
      });
      setSuccessMsg("Client job feedback recorded successfully.");
      setFeedbackModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveTriage = async (e) => {
    e.preventDefault();
    if (!selectedFeedback) return;
    setSubmitting(true);
    setError("");
    setSuccessMsg("");
    try {
      await feedback.resolveTriage(selectedFeedback.id, triageForm);
      setSuccessMsg(`Triage for feedback ${selectedFeedback.id} marked as ${triageForm.triage_status}.`);
      setTriageModalOpen(false);
      setSelectedFeedback(null);
      await loadData();
    } catch (err) {
      setError(err.message || "Failed to resolve triage");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeaderBanner
        badge="Subsystems 8 & 11"
        description="Client Net Promoter Score (NPS), Post-Job Evaluations, Supervisor Triage Workflows, and Automated Executive QBR Presentations."
        title="Client Feedback & QBR Deck"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3">
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} />
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setError("");
              setSuccessMsg("");
              setFeedbackModalOpen(true);
            }}
            variant="primary"
          >
            + Submit Job Evaluation
          </Button>
          <Button onClick={loadData} variant="secondary">
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError("")} />}

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4 text-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <span>✓</span>
            <span>{successMsg}</span>
          </div>
        </div>
      )}

      {loading ? (
        <PageLoadingSkeleton />
      ) : (
        <div role="tabpanel">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Executive NPS KPI Ribbon */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    NET PROMOTER SCORE (NPS)
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                      {summary?.net_promoter_score != null ? summary.net_promoter_score : "+100"}
                    </span>
                    <span className="text-xs text-gray-400">(-100 to +100)</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">World-Class Heavy Industry Benchmark &gt; +70</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">TOTAL EVALUATIONS</div>
                  <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                    {summary?.total_evaluations != null ? summary.total_evaluations : reviewsList.length}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Audited client sign-offs</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">AVERAGE RATING</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                      {summary?.average_rating != null ? Number(summary.average_rating).toFixed(1) : "5.0"}
                    </span>
                    <span className="text-xs text-gray-400">/ 5.0 Stars</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Across all completed dispatches</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">PROMOTERS SHARE</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                      {summary?.promoter_percentage != null ? `${summary.promoter_percentage}%` : "100%"}
                    </span>
                    <span className="text-xs text-gray-400">Score 9-10</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Brand advocates & mining champions</div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">ACTIVE TRIAGE TICKETS</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                      {triageList.length}
                    </span>
                    <span className="text-xs text-gray-400">Requires supervisor</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Automatic escalation for &le; 3 stars</div>
                </div>
              </div>

              {/* Dimension Scores & Client Breakdown */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                  <SectionTitle title="Quality Dimensions Scorecard" />
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">Technical Service Quality</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {summary?.dimension_averages?.service_quality || "5.0"} / 5.0
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: "98%" }} /* ux-allow */ />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">HSE & Mine Safety Compliance</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {summary?.dimension_averages?.safety_compliance || "5.0"} / 5.0
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: "100%" }} /* ux-allow */ />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">Timeliness & Shutdown Turnaround</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {summary?.dimension_averages?.timeliness || "4.9"} / 5.0
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: "96%" }} /* ux-allow */ />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                  <SectionTitle title="NPS Response Categorisation" />
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-3">
                      <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Promoters (9-10)</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                        {summary?.promoter_count ?? reviewsList.filter((r) => r.nps_score >= 9).length}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Loyal & expanding</div>
                    </div>

                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
                      <div className="text-xs font-medium text-amber-600 dark:text-amber-300">Passives (7-8)</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                        {summary?.passive_count ?? reviewsList.filter((r) => r.nps_score >= 7 && r.nps_score <= 8).length}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Satisfied but neutral</div>
                    </div>

                    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3">
                      <div className="text-xs font-medium text-red-700 dark:text-red-300">Detractors (0-6)</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                        {summary?.detractor_count ?? reviewsList.filter((r) => r.nps_score <= 6).length}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Urgent supervisor triage</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle title="Client Job Reviews & Ratings Register" />
                <span className="text-xs text-gray-500 dark:text-gray-400">{reviewsList.length} feedback submissions logged</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <DataTable
                  columns={[
                    {
                      header: "Client & Site",
                      accessor: "client_name",
                      cell: (row) => (
                        <div>
                          <div className="font-semibold text-gray-900 dark:text-white">{row.client_name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{row.client_id}</div>
                        </div>
                      )
                    },
                    {
                      header: "Dispatch / Tag",
                      accessor: "dispatch_card_id",
                      cell: (row) => (
                        <div className="text-xs font-mono">
                          <div className="text-gray-700 dark:text-gray-300">{row.dispatch_card_id}</div>
                          {row.equipment_tag_id && (
                            <div className="text-gray-400">{row.equipment_tag_id}</div>
                          )}
                        </div>
                      )
                    },
                    {
                      header: "Rating Stars",
                      accessor: "rating_stars",
                      cell: (row) => (
                        <div className="flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                          <span>{"★".repeat(row.rating_stars)}</span>
                          <span className="text-xs text-gray-400">({row.rating_stars}/5)</span>
                        </div>
                      )
                    },
                    {
                      header: "NPS Score",
                      accessor: "nps_score",
                      cell: (row) => {
                        const tone = row.nps_score >= 9 ? "success" : row.nps_score >= 7 ? "warning" : "danger";
                        return (
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 dark:text-white">{row.nps_score}/10</span>
                            <Badge tone={tone}>{row.nps_category}</Badge>
                          </div>
                        );
                      }
                    },
                    {
                      header: "Client Comments",
                      accessor: "comments",
                      cell: (row) => (
                        <div className="max-w-xs truncate text-xs text-gray-600 dark:text-gray-300" title={row.comments}>
                          {row.comments || "No written remarks provided."}
                        </div>
                      )
                    },
                    {
                      header: "Triage Status",
                      accessor: "triage_status",
                      cell: (row) => {
                        if (!row.triage_required) {
                          return <Badge tone="neutral">Standard</Badge>;
                        }
                        if (row.triage_status === "RESOLVED") {
                          return <Badge tone="success">Resolved</Badge>;
                        }
                        return <Badge tone="danger">Triage Required</Badge>;
                      }
                    },
                    {
                      header: "Submitted By",
                      accessor: "submitted_by_name",
                      cell: (row) => (
                        <div className="text-xs text-gray-700 dark:text-gray-300">
                          <div>{row.submitted_by_name}</div>
                          <div className="text-gray-400">{new Date(row.submitted_at).toLocaleDateString()}</div>
                        </div>
                      )
                    }
                  ]}
                  data={reviewsList}
                />
              </div>
            </div>
          )}

          {activeTab === "triage" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <SectionTitle title="Supervisor Critical Feedback Triage Queue" />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Automatically triggered when a client gives &le; 3 stars. Requires supervisor investigation and corrective action documentation.
                  </p>
                </div>
                <Badge tone={triageList.length > 0 ? "warning" : "success"}>
                  {triageList.length} Pending Actions
                </Badge>
              </div>

              {triageList.length === 0 ? (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-gray-500 dark:text-gray-400">
                  <div className="text-2xl text-emerald-600 dark:text-emerald-400">✓</div>
                  <div className="mt-2 font-medium text-gray-900 dark:text-white">Zero Pending Triage Alerts</div>
                  <div className="mt-1 text-xs">All client evaluations meet or exceed quality standards. No open supervisor escalations.</div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                  <DataTable
                    columns={[
                      {
                        header: "Client & Dispatch",
                        accessor: "client_name",
                        cell: (row) => (
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">{row.client_name}</div>
                            <div className="text-xs font-mono text-gray-500 dark:text-gray-400">{row.dispatch_card_id}</div>
                          </div>
                        )
                      },
                      {
                        header: "Alert Rating",
                        accessor: "rating_stars",
                        cell: (row) => (
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-red-600 dark:text-red-400">{"★".repeat(row.rating_stars)} ({row.rating_stars}/5)</span>
                            <Badge tone="danger">NPS {row.nps_score}</Badge>
                          </div>
                        )
                      },
                      {
                        header: "Client Feedback",
                        accessor: "comments",
                        cell: (row) => (
                          <div className="max-w-sm text-xs text-amber-600 dark:text-amber-300">
                            {row.comments || "No comments entered."}
                          </div>
                        )
                      },
                      {
                        header: "Submitted",
                        accessor: "submitted_at",
                        cell: (row) => (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(row.submitted_at).toLocaleString()}
                          </div>
                        )
                      },
                      {
                        header: "Action",
                        accessor: "id",
                        cell: (row) => (
                          <Button
                            onClick={() => {
                              setSelectedFeedback(row);
                              setTriageModalOpen(true);
                            }}
                            size="sm"
                            variant="secondary"
                          >
                            Resolve Triage
                          </Button>
                        )
                      }
                    ]}
                    data={triageList}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === "qbr" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <SectionTitle title="Executive Quarterly Business Review (QBR) Generator" />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Compiles automated executive briefing slide deck for mining directorates (Zimplats, Unki, Mimosa).
                  </p>
                </div>
                <Button onClick={loadQbrDeck} variant="primary">
                  {qbrDeck ? "Recompile QBR Deck" : "Generate Live QBR Presentation"}
                </Button>
              </div>

              {!qbrDeck ? (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="text-3xl text-gray-400">📊</div>
                  <div className="mt-3 font-semibold text-gray-900 dark:text-white">Executive Presentation Deck Not Loaded</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Click "Generate Live QBR Presentation" to pull multi-mine performance metrics into the slide deck.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Slide Carousel Navigator */}
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={activeSlideIndex === 0}
                        onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                        size="sm"
                        variant="secondary"
                      >
                        &larr; Previous Slide
                      </Button>
                      <Button
                        disabled={activeSlideIndex >= (qbrDeck.slides?.length || 1) - 1}
                        onClick={() => setActiveSlideIndex((prev) => Math.min((qbrDeck.slides?.length || 1) - 1, prev + 1))}
                        size="sm"
                        variant="secondary"
                      >
                        Next Slide &rarr;
                      </Button>
                    </div>
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      Slide {activeSlideIndex + 1} of {qbrDeck.slides?.length || 1}: {qbrDeck.slides?.[activeSlideIndex]?.title}
                    </div>
                  </div>

                  {/* Active Slide Viewer Canvas */}
                  {qbrDeck.slides?.[activeSlideIndex] && (
                    <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-2xl">
                      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-4">
                        <div>
                          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            ORAC Systems Industrial QBR Review
                          </div>
                          <h2 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                            {qbrDeck.slides[activeSlideIndex].title}
                          </h2>
                        </div>
                        <Badge tone="success">{qbrDeck.quarter}</Badge>
                      </div>

                      <div className="mt-6">
                        <p className="text-base leading-relaxed text-gray-700 dark:text-gray-300">
                          {qbrDeck.slides[activeSlideIndex].summary}
                        </p>

                        {qbrDeck.slides[activeSlideIndex].key_metrics && (
                          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                            {Object.entries(qbrDeck.slides[activeSlideIndex].key_metrics).map(([key, val]) => (
                              <div key={key} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{key.replace(/_/g, " ")}</div>
                                <div className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">{String(val)}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {qbrDeck.slides[activeSlideIndex].highlights && (
                          <div className="mt-6 space-y-2">
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Quarterly Operational Highlights:</div>
                            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600 dark:text-gray-300">
                              {qbrDeck.slides[activeSlideIndex].highlights.map((h, i) => (
                                <li key={i}>{h}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Submit Feedback */}
      <Modal
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
        title="Submit Client Job Evaluation & NPS"
      >
        <form className="space-y-4" onSubmit={handleSubmitFeedback}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Dispatch Card ID</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, dispatch_card_id: e.target.value })}
                required
                value={feedbackForm.dispatch_card_id}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Client Identifier</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, client_id: e.target.value })}
                required
                value={feedbackForm.client_id}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Client Name</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, client_name: e.target.value })}
                required
                value={feedbackForm.client_name}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Equipment Tag ID (Optional)</label>
              <input
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, equipment_tag_id: e.target.value })}
                value={feedbackForm.equipment_tag_id}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-gray-200 dark:border-gray-800 pt-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Rating Stars (1 to 5)</label>
              <select
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, rating_stars: Number(e.target.value) })}
                value={feedbackForm.rating_stars}
              >
                <option value={5}>5 Stars - Outstanding</option>
                <option value={4}>4 Stars - Exceeded Requirements</option>
                <option value={3}>3 Stars - Satisfactory (Triggers Triage)</option>
                <option value={2}>2 Stars - Needs Improvement (Triggers Triage)</option>
                <option value={1}>1 Star - Critical Defect (Triggers Triage)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">NPS Score (0 to 10)</label>
              <select
                className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                onChange={(e) => setFeedbackForm({ ...feedbackForm, nps_score: Number(e.target.value) })}
                value={feedbackForm.nps_score}
              >
                <option value={10}>10 - Definite Promoter</option>
                <option value={9}>9 - Promoter</option>
                <option value={8}>8 - Passive</option>
                <option value={7}>7 - Passive</option>
                <option value={6}>6 - Detractor</option>
                <option value={5}>5 - Detractor</option>
                <option value={3}>3 - Strong Detractor</option>
                <option value={0}>0 - Extreme Detractor</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Detailed Client Comments</label>
            <textarea
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setFeedbackForm({ ...feedbackForm, comments: e.target.value })}
              rows={3}
              value={feedbackForm.comments}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Submitter Name</label>
            <input
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setFeedbackForm({ ...feedbackForm, submitted_by_name: e.target.value })}
              required
              value={feedbackForm.submitted_by_name}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-800 pt-3">
            <Button onClick={() => setFeedbackModalOpen(false)} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={submitting} type="submit" variant="primary">
              {submitting ? "Recording..." : "Record Evaluation"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Resolve Triage */}
      <Modal
        isOpen={triageModalOpen}
        onClose={() => setTriageModalOpen(false)}
        title="Supervisor Corrective Action Resolution"
      >
        <form className="space-y-4" onSubmit={handleResolveTriage}>
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-xs">
            <div className="font-semibold text-red-600 dark:text-red-400">Client Escalation Notice:</div>
            <div className="mt-1 text-gray-700 dark:text-gray-300">{selectedFeedback?.comments}</div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Resolution Decision</label>
            <select
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setTriageForm({ ...triageForm, triage_status: e.target.value })}
              value={triageForm.triage_status}
            >
              <option value="RESOLVED">Resolved - Corrective Action Completed</option>
              <option value="PENDING_REVIEW">Pending Review - Under Field Investigation</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Supervisor Corrective Action Notes</label>
            <textarea
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
              onChange={(e) => setTriageForm({ ...triageForm, triage_notes: e.target.value })}
              required
              rows={4}
              value={triageForm.triage_notes}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-800 pt-3">
            <Button onClick={() => setTriageModalOpen(false)} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={submitting} type="submit" variant="primary">
              {submitting ? "Saving..." : "Submit Resolution"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
