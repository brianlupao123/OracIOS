/**
 * Feedback Module Routes — Client feedback, NPS, QR engine, QBR deck
 */
import { Router } from "express";
import {
  submitFeedback, listFeedbacks, resolveFeedbackTriage,
  getFeedbackSummary, generateQrToken, getQbrReportDeck, getPublicFeedbackQr
} from "../../controllers/feedbackController.js";

const feedbackRouter = Router();

feedbackRouter.post("/feedback", submitFeedback);
feedbackRouter.get("/feedback", listFeedbacks);
feedbackRouter.post("/feedback/:id/triage", resolveFeedbackTriage);
feedbackRouter.get("/feedback/summary", getFeedbackSummary);
feedbackRouter.get("/feedback/public-qr", getPublicFeedbackQr);
feedbackRouter.post("/qr/generate", generateQrToken);
feedbackRouter.get("/reports/qbr-deck", getQbrReportDeck);

export default feedbackRouter;
