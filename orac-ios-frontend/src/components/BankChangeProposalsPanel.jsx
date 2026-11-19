import React, { useState } from "react";
import Button from "./ui/Button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { collections } from "../api/client.js";
import { PageEmptyState } from "./PageStates.jsx";
import { ICONS } from "./icons.jsx";

export default function BankChangeProposalsPanel({ proposals = [], user, onReload, setNotice, setError }) {
  const [busyId, setBusyId] = useState("");

  return (
    <section className="rounded-xl border border-orac-border-default bg-orac-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold text-orac-text-primary">Bank &amp; EcoCash change proposals</h2>
      <p className="mt-1 text-ux-caption text-orac-text-secondary">
        S-02 Maker-Checker: a second Admin must approve any artisan bank or EcoCash detail change before it takes effect.
      </p>
      {proposals.length === 0 ? (
        <PageEmptyState
          compact
          iconPath={ICONS.document}
          title="No pending proposals"
          subtitle="When an Admin proposes a bank detail change, it appears here for a second Admin to approve or reject."
        />
      ) : (
        <ul className="mt-3 space-y-3">
          {proposals.map((bp) => {
            const isBusy = busyId === bp.id;
            const isPending = bp.status === "Pending";
            const isOwnProposal = bp.proposed_by === user?.id;

            return (
              <li
                key={bp.id}
                className={`rounded-md border p-3 ${
                  isPending
                    ? "border-orac-warning-border bg-orac-warning-bg/10"
                    : "border-orac-border-default bg-orac-surface-muted/30"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-ux-body font-medium text-orac-text-primary">
                      Proposal {bp.id} &middot; Target: {bp.target_user_id}
                    </p>
                    <p className="text-ux-caption text-orac-text-secondary">
                      Proposed by {bp.proposed_by} on {bp.proposed_at ? new Date(bp.proposed_at).toLocaleString() : "—"}
                      {bp.proposed_fields ? ` · Fields: ${bp.proposed_fields.join(", ")}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={bp.status} />
                </div>
                {isPending && !isOwnProposal && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isBusy}
                      onClick={async () => {
                        setBusyId(bp.id);
                        setError("");
                        setNotice("");
                        try {
                          await collections.action("bank-change-proposals", bp.id, "approve");
                          setNotice(`Bank change proposal ${bp.id} approved.`);
                          if (onReload) await onReload();
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setBusyId("");
                        }
                      }}
                    >
                      {isBusy ? "Processing..." : "Approve change"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={isBusy}
                      onClick={async () => {
                        setBusyId(bp.id);
                        setError("");
                        setNotice("");
                        try {
                          await collections.action("bank-change-proposals", bp.id, "reject");
                          setNotice(`Bank change proposal ${bp.id} rejected.`);
                          if (onReload) await onReload();
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setBusyId("");
                        }
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
                {isPending && isOwnProposal && (
                  <p className="mt-2 text-ux-caption font-medium text-orac-warning-text">
                    You proposed this change — a different Admin must approve or reject it.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
