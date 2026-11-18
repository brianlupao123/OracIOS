/**
 * Gantt Scheduling Module Routes
 */
import { Router } from "express";
import { getGanttTimeline, getUtilisation, getConflicts, postReschedule } from "../../controllers/ganttSchedulingController.js";

const ganttRouter = Router();

ganttRouter.get("/scheduling/gantt", getGanttTimeline);
ganttRouter.get("/scheduling/utilisation", getUtilisation);
ganttRouter.get("/scheduling/conflicts", getConflicts);
ganttRouter.post("/scheduling/reschedule", postReschedule);

export default ganttRouter;
