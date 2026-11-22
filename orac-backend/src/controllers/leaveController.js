/**
 * Leave & Absence Controller — HTTP handlers for leave management.
 *
 * Routes (all behind authMiddleware):
 *   POST   /leave-requests          → create draft
 *   GET    /leave-requests          → list (with filters)
 *   GET    /leave-requests/:id      → get single
 *   POST   /leave-requests/:id/submit   → submit for approval
 *   POST   /leave-requests/:id/approve  → approve
 *   POST   /leave-requests/:id/reject   → reject
 *   POST   /leave-requests/:id/cancel   → cancel
 *   GET    /leave-balance/:userId       → balance summary
 *   GET    /leave-calendar              → team calendar
 */

import { requirePermission } from "../permissions.js";
import {
  createLeaveRequest, submitLeaveRequest, approveLeaveRequest,
  rejectLeaveRequest, cancelLeaveRequest, getLeaveRequest,
  listLeaveRequests, getLeaveBalance, getTeamLeaveCalendar,
  LEAVE_TYPES
} from "../services/leaveService.js";

// POST /leave-requests
export function createLeave(req, res) {
  try {
    const request = createLeaveRequest({
      userId: req.user.id,
      leaveType: req.body.leave_type,
      startDate: req.body.start_date,
      endDate: req.body.end_date,
      reason: req.body.reason,
      medicalCertRef: req.body.medical_cert_ref,
      store: req.store,
      db: req.db
    });
    return res.status(201).json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /leave-requests
export function listLeaves(req, res) {
  try {
    // Admin/Management/HR see all; others see only their own
    const isElevated = ["Admin", "Management", "Human Resources"].includes(req.user?.role);
    const userId = isElevated
      ? req.query.user_id || undefined
      : req.user?.id;

    const requests = listLeaveRequests({
      userId,
      status: req.query.status,
      leaveType: req.query.leave_type,
      year: req.query.year,
      db: req.db
    });
    return res.json({ success: true, data: requests });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /leave-requests/:id
export function getLeave(req, res) {
  try {
    const request = getLeaveRequest({ requestId: req.params.id, db: req.db });
    const isElevated = ["Admin", "Management", "Human Resources"].includes(req.user?.role);
    if (!isElevated && request.user_id !== req.user?.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /leave-requests/:id/submit
export function submitLeave(req, res) {
  try {
    const request = submitLeaveRequest({
      requestId: req.params.id,
      userId: req.user.id,
      store: req.store,
      db: req.db
    });
    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /leave-requests/:id/approve
export function approveLeave(req, res) {
  try {
    const approverRoles = ["Admin", "Management", "Operations", "Human Resources"];
    if (!approverRoles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user?.role || "Unknown"} is not authorized to approve leave.`
      });
    }

    const request = approveLeaveRequest({
      requestId: req.params.id,
      approvedBy: req.user.id,
      store: req.store,
      db: req.db
    });
    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /leave-requests/:id/reject
export function rejectLeave(req, res) {
  try {
    const approverRoles = ["Admin", "Management", "Operations", "Human Resources"];
    if (!approverRoles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user?.role || "Unknown"} is not authorized to reject leave.`
      });
    }

    const request = rejectLeaveRequest({
      requestId: req.params.id,
      rejectedBy: req.user.id,
      reason: req.body.reason,
      store: req.store,
      db: req.db
    });
    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /leave-requests/:id/cancel
export function cancelLeave(req, res) {
  try {
    const existing = getLeaveRequest({ requestId: req.params.id, db: req.db });
    const isElevated = ["Admin", "Management", "Human Resources"].includes(req.user?.role);
    if (!isElevated && existing.user_id !== req.user?.id) {
      return res.status(403).json({ success: false, message: "Access denied: cannot cancel another user's leave request." });
    }
    const request = cancelLeaveRequest({
      requestId: req.params.id,
      cancelledBy: req.user.id,
      reason: req.body.reason,
      store: req.store,
      db: req.db
    });
    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /leave-balance/:userId
export function getBalance(req, res) {
  try {
    // Non-admin/HR can only view their own balance
    const targetUserId = req.params.userId;
    const canViewBalance = ["Admin", "Management", "Human Resources"].includes(req.user?.role);
    if (!canViewBalance && targetUserId !== req.user?.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    const balance = getLeaveBalance({
      userId: targetUserId,
      year: req.query.year ? parseInt(req.query.year, 10) : undefined,
      db: req.db
    });
    return res.json({ success: true, data: balance });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /leave-calendar
export function getCalendar(req, res) {
  try {
    const startDate = req.query.start_date || new Date().toISOString().split("T")[0];
    const endDate = req.query.end_date || new Date(Date.now() + 30 * 86400_000).toISOString().split("T")[0];
    const calendar = getTeamLeaveCalendar({ startDate, endDate, db: req.db });
    return res.json({ success: true, data: calendar });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /leave-types
export function getLeaveTypes(req, res) {
  return res.json({ success: true, data: LEAVE_TYPES });
}
