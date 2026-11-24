// Single definition of "anonymous public (QR) feedback", shared by the intake controller,
// the staff/client read paths and the NPS calculation so they cannot drift apart.
export const PUBLIC_FEEDBACK_SOURCE = "PUBLIC_QR";
export const isPublicFeedback = (record) => record?.source === PUBLIC_FEEDBACK_SOURCE;
