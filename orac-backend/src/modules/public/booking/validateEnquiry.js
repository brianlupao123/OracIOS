// Public-form validation, copied from the demo (pure: no storage). Use it in front of POST /public/enquiries.
export const TYPES = ["quote", "emergency", "contact", "survey", "chat"];
export const STATUSES = ["new", "contacted", "quoted", "won", "lost"];
export const SLOT_STATUSES = ["requested", "confirmed", "cancelled"];

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function validate(body) {
  if (!body || typeof body !== "object") return { errors: ["Invalid request."] };

  const errors = [];
  const type = TYPES.includes(body.type) ? body.type : null;
  if (!type) errors.push("Unknown request type.");

  const name = clean(body.name, 120);
  const company = clean(body.company, 160);
  const email = clean(body.email, 160);
  const phone = clean(body.phone, 40);
  const siteLocation = clean(body.siteLocation, 200);
  const message = clean(body.message, 4000);
  const page = clean(body.page, 200);
  const surveyType = clean(body.surveyType, 80);
  const preferredDate = clean(body.preferredDate, 10);
  const preferredTime = clean(body.preferredTime, 40);
  const slotDate = clean(body.slotDate, 10);
  const slotTime = clean(body.slotTime, 5);
  const items = Array.isArray(body.items) ? body.items.slice(0, 30).map((i) => clean(i, 200)).filter(Boolean) : [];

  if (!name) errors.push("Name is required.");
  if (!email && !phone) errors.push("Please provide an email or a phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("The email address looks invalid.");
  if (type === "contact" && !message) errors.push("Please write a message.");
  if (type === "quote" && items.length === 0 && !message) {
    errors.push("Add at least one item to your quote list or describe what you need.");
  }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) errors.push("The preferred date is not valid.");
  if (slotDate || slotTime) {
    if (type !== "survey") errors.push("Time slots can only be booked for site surveys.");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate) || !/^\d{2}:\d{2}$/.test(slotTime)) errors.push("Please choose a date and a time.");
  }
  if (type === "survey") {
    if (!siteLocation) errors.push("Please tell us the site location.");
    if (!surveyType) errors.push("Please choose the type of survey.");
  }
  if (type === "chat" && !message) errors.push("Please describe what you need.");
  if (type === "emergency") {
    if (!phone) errors.push("A phone number is required for emergency call-outs.");
    if (!siteLocation) errors.push("Please tell us the site location.");
  }

  if (errors.length) return { errors };
  return {
    errors: [],
    record: {
      type, name, company, email, phone, siteLocation, message, items, page, surveyType,
      // a booked slot also fills the "preferred" fields so older views and exports still make sense
      preferredDate: slotDate || preferredDate,
      preferredTime: slotTime || preferredTime,
      slotDate,
      slotTime,
      slotStatus: slotDate ? "requested" : "",
    },
  };
}
