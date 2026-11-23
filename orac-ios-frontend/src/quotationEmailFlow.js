export async function submitQuotationEmail({ payload, pending, send, markSent }) {
  const quoteId = payload.quote_id;
  let outcome = pending.get(quoteId);
  if (!outcome) {
    outcome = await send(payload);
    if (outcome?.mode === "dry-run" && outcome.status === "dry_run") return outcome;
    if (outcome?.mode !== "live-smtp" || outcome.status !== "accepted") {
      throw new Error("ORAC received no confirmed send result. Check the send evidence before retrying.");
    }
    pending.set(quoteId, outcome);
  }

  try {
    await markSent(quoteId);
  } catch (cause) {
    throw new Error("The mail server accepted the email. Retry saving the quotation status without sending another email.", { cause });
  }
  pending.delete(quoteId);
  return outcome;
}
