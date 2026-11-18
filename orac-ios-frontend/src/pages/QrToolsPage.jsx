import React, { useState } from "react";
import { qr } from "../api/client.js";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import TabNav from "../components/TabNav.jsx";
import { ErrorBanner } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

const TABS = [
  { id: "generator", label: "QR Code Token Generator" },
  { id: "equipment", label: "Plant Equipment Sticker Tags" },
  { id: "signoff", label: "Field Worksheet Sign-Offs" },
  { id: "badges", label: "Artisan Kiosk Badges" }
];

export default function QrToolsPage({ user }) {
  const [activeTab, setActiveTab] = useState("generator");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [generating, setGenerating] = useState(false);

  // Active generated bundle
  const [generatedResult, setGeneratedResult] = useState(null);

  // Generator form
  const [formData, setFormData] = useState({
    token_type: "EQUIPMENT_TAG",
    target_id: "TAG-PU-101",
    client_name: "Zimplats SMC",
    mine_site: "Zimplats Hartley Complex",
    description: "Suction liner slurry pump casing (15mm 40-Shore natural rubber)",
    expiry_date: "2027-11-17"
  });

  const handleGenerate = async (e) => {
    if (e) e.preventDefault();
    setGenerating(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await qr.generateToken({
        token_type: formData.token_type,
        target_id: formData.target_id,
        metadata: {
          client_name: formData.client_name,
          mine_site: formData.mine_site,
          description: formData.description,
          expiry_date: formData.expiry_date,
          generated_by: user?.name || "ORAC Field Engineer"
        }
      });

      setGeneratedResult(res.data);
      setSuccessMsg(`Optical QR code generated for ${formData.target_id} (${formData.token_type}).`);
    } catch (err) {
      setError(err.message || "Failed to generate QR token");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeaderBanner
        badge="Subsystem 8"
        description="Universal Optical QR Code Generation, Secure HMAC Signatures, Mobile Worksheet Sign-Offs, and Heavy Plant Asset Tags."
        title="Universal QR Optical Tools"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3">
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} />
        <div className="flex items-center gap-2">
          <Badge tone="success">HMAC-SHA256 Cryptographically Signed</Badge>
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

      <div role="tabpanel">
        {activeTab === "generator" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Form Column */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <SectionTitle title="Optical Token Configuration" />
              <form className="mt-4 space-y-4" onSubmit={handleGenerate}>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">QR Optical Token Type</label>
                  <select
                    className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                    onChange={(e) => setFormData({ ...formData, token_type: e.target.value })}
                    value={formData.token_type}
                  >
                    <option value="EQUIPMENT_TAG">EQUIPMENT_TAG (Plant Machinery Asset Tag)</option>
                    <option value="WORKSHEET_SIGNOFF">WORKSHEET_SIGNOFF (Mobile Client Sign-Off URL)</option>
                    <option value="ARTISAN_BADGE">ARTISAN_BADGE (Kiosk Badge Clock-In)</option>
                    <option value="WARRANTY_VERIFY">WARRANTY_VERIFY (Vulcanization Warranty Verification)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Target Identifier (ID / Tag / Serial)</label>
                  <input
                    className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs font-mono text-gray-900 dark:text-white"
                    onChange={(e) => setFormData({ ...formData, target_id: e.target.value })}
                    placeholder="e.g. TAG-PU-101 or DSP-2026-11-001"
                    required
                    value={formData.target_id}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Client / Plant Name</label>
                    <input
                      className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                      onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                      value={formData.client_name}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Mine Site</label>
                    <input
                      className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                      onChange={(e) => setFormData({ ...formData, mine_site: e.target.value })}
                      value={formData.mine_site}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Asset or Scope Description</label>
                  <textarea
                    className="mt-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-900 dark:text-white"
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    value={formData.description}
                  />
                </div>

                <div className="pt-2">
                  <Button disabled={generating} type="submit" variant="primary">
                    {generating ? "Generating Optical QR..." : "Generate Signed Optical QR Token"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Preview Column */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <SectionTitle title="Generated Optical Token & Live Preview" />
              {!generatedResult ? (
                <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="text-4xl text-gray-400">📷</div>
                  <div className="mt-3 font-semibold text-gray-700 dark:text-gray-200">No QR Token Rendered Yet</div>
                  <div className="mt-1 text-xs">Configure the fields on the left and click Generate to produce a live signed QR bundle.</div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-6 shadow-inner">
                    <img
                      alt={`Optical QR Code for ${generatedResult.target_id}`}
                      className="h-56 w-56 rounded-lg bg-white p-2 shadow-md"
                      src={generatedResult.data_url}
                    />
                    <div className="mt-3 text-center">
                      <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{generatedResult.token_type}</div>
                      <div className="font-mono text-sm font-bold text-gray-900 dark:text-white">{generatedResult.target_id}</div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Encoded Protocol URI:</span>
                      <span className="font-mono text-gray-700 dark:text-gray-300">{generatedResult.uri}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">HMAC-SHA256 Signature:</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400">{generatedResult.signature?.slice(0, 16)}...</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Database Token ID:</span>
                      <span className="font-mono text-gray-700 dark:text-gray-300">{generatedResult.token_id || "Ephemeral"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        const win = window.open("");
                        win.document.write(`<img alt="QR Code" src="${generatedResult.data_url}" style="width:300px; height:300px;"/><br/><h2>${generatedResult.target_id}</h2><p>${generatedResult.uri}</p>`);
                        win.print();
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Print Physical Tag Sticker
                    </Button>
                    <a
                      className="inline-flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      download={`qr-${generatedResult.target_id}.png`}
                      href={generatedResult.data_url}
                    >
                      Download PNG
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "equipment" && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
            <SectionTitle title="Plant Equipment QR Plate Workflows" />
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Heavy plant machinery—including Primary Slurry Feed Pumps, Conveyor Splice Joints, and Rubber-Lined Flotation Tanks—are tagged with weatherproof 316 stainless-steel or industrial vinyl QR stickers.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">SCAN TO INSPECT</div>
                <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">Instant Ultrasonic History</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Technicians scan in the field to pull previous wear mm readings and lining spec.</div>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">PREVENT MISIDENTIFICATION</div>
                <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">Tag-Locked Dispatches</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Ensures work orders cannot be completed against the wrong slurry pump or conveyor belt.</div>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">AUDITED REPAIR RECORDS</div>
                <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">10-Year Mining History</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Complete immutable audit trail of every cold vulcanization and hot splice performed.</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "signoff" && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
            <SectionTitle title="Mobile Client Sign-Off Workflows" />
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              When a field job is completed at Zimplats, Unki, or Mimosa, the technician presents a dynamic QR code on their tablet. The mine superintendent scans the QR code with their mobile smartphone camera, opening the secure sign-off portal with zero login friction.
            </p>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 font-mono text-xs text-emerald-600 dark:text-emerald-400">
              Target Route: https://orac.co.zw/signoff/DSP-2026-11-001?sig=9f8a7b...
            </div>
          </div>
        )}

        {activeTab === "badges" && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
            <SectionTitle title="Artisan Kiosk Badges & Security Badging" />
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Artisans and technicians hold physical PVC security badges encoded with cryptographically verified QR tokens. Scanning at workshop or field kiosks logs shift start, verification of S-10 mine induction validity, and automated attendance registers.
            </p>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 font-mono text-xs text-gray-700 dark:text-gray-300">
              Token Protocol: orac://kiosk/clockin/ART-001?site=ZIMPLATS_SMC&gate=S10_VERIFIED
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
