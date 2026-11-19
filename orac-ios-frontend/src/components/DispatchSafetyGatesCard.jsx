import React from "react";

export default function DispatchSafetyGatesCard({ safetyGates }) {
  if (!safetyGates) return null;

  const { mine_induction, ppe_checklist, vehicle_vid } = safetyGates;

  const inductionPassed = mine_induction?.status === "PASSED";
  const inductionBlocked = mine_induction?.status === "BLOCKED";

  const ppePassed = ppe_checklist?.status === "PASSED";

  const vidPassed = vehicle_vid?.status === "PASSED";
  const vidExpired = vehicle_vid?.status === "VID_EXPIRED";

  return (
    <section aria-labelledby="safety-gates-title" className="border-y border-orac-border bg-orac-surface px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orac-border pb-3">
        <div>
          <h2 id="safety-gates-title" className="text-base font-semibold text-orac-text-primary">
            Mining Safety & Statutory Pre-Dispatch Compliance
          </h2>
          <p className="mt-1 text-ux-secondary text-orac-text-secondary">
            Statutory Zimbabwe mining tripwires enforced at dispatch gate (Controls S-10, S-11, S-12).
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {/* S-10 Mine Site Induction Gate */}
        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="text-ux-caption font-semibold text-orac-text-secondary">S-10: MINE SITE INDUCTION</div>
          <div className="mt-1 font-semibold text-ux-body text-orac-text-primary">
            Site: {mine_induction?.site_name || "Unspecified"}
          </div>
          <div className="mt-2">
            {inductionPassed && (
              <span className="inline-flex rounded-md border border-orac-success-border bg-orac-success-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-success-text">
                ✓ Induction Active & Verified
              </span>
            )}
            {inductionBlocked && (
              <span className="inline-flex rounded-md border border-orac-danger-border bg-orac-danger-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-danger-text">
                ✗ Induction Missing / Expired
              </span>
            )}
            {!inductionPassed && !inductionBlocked && (
              <span className="inline-flex rounded-md border border-orac-border bg-orac-surface px-2.5 py-1 text-ux-caption font-medium text-orac-text-muted">
                {mine_induction?.status === "NO_ROSTER" ? "No Technicians Rostered" : "Exempt / Off-Site"}
              </span>
            )}
          </div>
        </div>

        {/* S-11 Pre-Dispatch PPE Checklist Gate */}
        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="text-ux-caption font-semibold text-orac-text-secondary">S-11: PRE-DISPATCH PPE CHECK</div>
          <div className="mt-1 font-semibold text-ux-body text-orac-text-primary">
            8-Point Statutory PPE Check
          </div>
          <div className="mt-2">
            {ppePassed ? (
              <span className="inline-flex rounded-md border border-orac-success-border bg-orac-success-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-success-text">
                ✓ PPE Verified ({ppe_checklist?.checklist_number || "Passed"})
              </span>
            ) : (
              <span className="inline-flex rounded-md border border-orac-warning-border bg-orac-warning-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-warning-text">
                ⚠ Supervisor Sign-off Pending
              </span>
            )}
          </div>
        </div>

        {/* S-12 Vehicle Roadworthiness VID Gate */}
        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="text-ux-caption font-semibold text-orac-text-secondary">S-12: VEHICLE VID ROADWORTHINESS</div>
          <div className="mt-1 font-semibold text-ux-body text-orac-text-primary">
            {vehicle_vid?.plate_number ? `Plate: ${vehicle_vid.plate_number}` : "Assigned Transport"}
          </div>
          <div className="mt-2">
            {vidPassed && (
              <span className="inline-flex rounded-md border border-orac-success-border bg-orac-success-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-success-text">
                ✓ VID Certificate Valid
              </span>
            )}
            {vidExpired && (
              <span className="inline-flex rounded-md border border-orac-danger-border bg-orac-danger-bg px-2.5 py-1 text-ux-caption font-semibold text-orac-danger-text">
                ✗ VID Expired / Grounded
              </span>
            )}
            {!vidPassed && !vidExpired && (
              <span className="inline-flex rounded-md border border-orac-border bg-orac-surface px-2.5 py-1 text-ux-caption font-medium text-orac-text-muted">
                Vehicle Not Assigned
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
