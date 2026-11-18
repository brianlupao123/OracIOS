/**
 * Surveys Module Routes
 */
import { Router } from "express";
import {
  bookSurvey, listSurveys, getSurveyMeetingAccess,
  completeSurveyWithNotes, extractSurveyAiScopeAndDraftQuote, getSurveySummary
} from "../../controllers/surveyController.js";

const surveysRouter = Router();

surveysRouter.post("/surveys/book", bookSurvey);
surveysRouter.get("/surveys", listSurveys);
surveysRouter.get("/surveys/:id/room", getSurveyMeetingAccess);
surveysRouter.post("/surveys/:id/notes", completeSurveyWithNotes);
surveysRouter.post("/surveys/:id/extract-ai-scope", extractSurveyAiScopeAndDraftQuote);
surveysRouter.get("/surveys/summary", getSurveySummary);

export default surveysRouter;
