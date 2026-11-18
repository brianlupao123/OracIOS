/**
 * Gantt Scheduling Controller.
 *
 * HTTP handlers for the Visual Gantt scheduling endpoints.
 * Routes:
 *   GET  /scheduling/gantt          → timeline data
 *   GET  /scheduling/utilisation    → resource utilisation
 *   GET  /scheduling/conflicts      → scheduling conflicts
 *   POST /scheduling/reschedule     → drag-drop reschedule
 */

import {
  buildGanttTimeline,
  getResourceUtilisation,
  detectSchedulingConflicts,
  rescheduleDispatch
} from "../services/ganttSchedulingService.js";

// GET /scheduling/gantt?startDate=...&endDate=...&technicianId=...
export function getGanttTimeline(req, res) {
  try {
    const data = buildGanttTimeline({
      startDate:    req.query.startDate,
      endDate:      req.query.endDate,
      technicianId: req.query.technicianId,
      db:           req.db
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /scheduling/utilisation?startDate=...&endDate=...
export function getUtilisation(req, res) {
  try {
    const data = getResourceUtilisation({
      startDate: req.query.startDate,
      endDate:   req.query.endDate,
      db:        req.db
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /scheduling/conflicts
export function getConflicts(req, res) {
  try {
    const data = detectSchedulingConflicts({ db: req.db });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /scheduling/reschedule { dispatchId, newStart, newEnd }
export function postReschedule(req, res) {
  try {
    const data = rescheduleDispatch({
      dispatchId: req.body.dispatchId,
      newStart:   req.body.newStart,
      newEnd:     req.body.newEnd,
      userId:     req.user.id,
      store:      req.store,
      db:         req.db
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}
