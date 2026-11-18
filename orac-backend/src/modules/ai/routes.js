/**
 * AI Module Routes — Deterministic AI briefing, attention, chat, workflow guide
 */
import { Router } from "express";
import {
  getAiHealth, getBriefing, getAttentionItems, getMetricExplanation,
  getChatResponse, getWorkflowGuide, getRecordAnalysis, flagAiResponse
} from "../../controllers/aiController.js";

const aiRouter = Router();

aiRouter.get("/ai/health", getAiHealth);
aiRouter.post("/ai/briefing", getBriefing);
aiRouter.post("/ai/attention", getAttentionItems);
aiRouter.post("/ai/explain", getMetricExplanation);
aiRouter.post("/ai/chat", getChatResponse);
aiRouter.post("/ai/workflow", getWorkflowGuide);
aiRouter.post("/ai/record-analysis", getRecordAnalysis);
aiRouter.post("/ai/feedback", flagAiResponse);

export default aiRouter;
