// Turns a validated website enquiry into an IOS lead (the shape IOS's createLead stores today).
// Pure function: no I/O, easy to test. A website visitor becomes a LEAD, never a Client:
// Sales verifies the lead first, then creates the Client and Quote through IOS's normal pipeline.

const MAX = 1000;
const cap = (s) => String(s ?? "").trim().slice(0, MAX);

export function describeNeed(e) {
  const items = (e.items || []).join("; ");
  const slot = e.slotDate ? ` Requested slot: ${e.slotDate} ${e.slotTime} (Zimbabwe time).` : "";
  switch (e.type) {
    case "emergency":
      return cap(`EMERGENCY call-out. ${e.message || "No description given."}`);
    case "survey":
      return cap(`Site survey: ${e.surveyType || "type not given"}.${slot} ${e.message || ""}`);
    case "quote":
      return cap(`Quote request: ${items || "see message"}. ${e.message || ""}`);
    default:
      return cap(e.message || "Website enquiry");
  }
}

export function toLead(e, { reference = "" } = {}) {
  return {
    company_name: cap(e.company) || "Website enquiry (company not given)",
    contact_name: cap(e.name),
    email: cap(e.email), // may be empty: emergencies only require a phone number
    phone: cap(e.phone),
    mine_site: cap(e.siteLocation),
    service_need: describeNeed(e),
    urgency: e.type === "emergency" ? "urgent" : "standard",
    // extra fields (IOS stores the whole object, so these are kept):
    source: "website",
    enquiry_type: e.type,
    website_reference: reference,
    booking_reference: e.slotDate ? reference : "",
  };
}
