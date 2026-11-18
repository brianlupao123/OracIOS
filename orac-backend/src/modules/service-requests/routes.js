/**
 * Service Requests Module Routes — Client service requests, internal work requests, contracts
 */
import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  CreateServiceRequestSchema, TriageServiceRequestSchema,
  CreateInternalWorkRequestSchema, TransitionInternalWorkRequestSchema
} from "../../schemas.js";
import {
  createServiceRequest, listOwnServiceRequests, listServiceRequestTriageQueue,
  triageServiceRequest, convertServiceRequestToLead
} from "../../controllers/serviceRequestsController.js";
import {
  getInternalWorkRequestOptions, createInternalWorkRequest, listInternalWorkRequestOutbox,
  listInternalWorkRequestInbox, getInternalWorkRequest, acknowledgeInternalWorkRequest,
  transitionInternalWorkRequest
} from "../../controllers/internalWorkRequestsController.js";
import { approveTechnicianRegistration } from "../../controllers/technicianRegistrationController.js";
import {
  listContracts, createContract, updateContract,
  listMaintenanceSchedules, createMaintenanceSchedule, updateMaintenanceSchedule
} from "../../controllers/contractsController.js";

const serviceRequestsRouter = Router();

// Client Service Requests
serviceRequestsRouter.post("/service-requests", validate(CreateServiceRequestSchema), createServiceRequest);
serviceRequestsRouter.get("/service-requests/mine", listOwnServiceRequests);
serviceRequestsRouter.get("/service-requests/triage", listServiceRequestTriageQueue);
serviceRequestsRouter.post("/service-requests/:id/triage", validate(TriageServiceRequestSchema), triageServiceRequest);
serviceRequestsRouter.post("/service-requests/:id/convert-lead", convertServiceRequestToLead);

// Internal Work Requests
serviceRequestsRouter.get("/internal-work-requests/options", getInternalWorkRequestOptions);
serviceRequestsRouter.get("/internal-work-requests/outbox", listInternalWorkRequestOutbox);
serviceRequestsRouter.get("/internal-work-requests/inbox", listInternalWorkRequestInbox);
serviceRequestsRouter.get("/internal-work-requests/:id", getInternalWorkRequest);
serviceRequestsRouter.post("/internal-work-requests", validate(CreateInternalWorkRequestSchema), createInternalWorkRequest);
serviceRequestsRouter.post("/internal-work-requests/:id/acknowledge", acknowledgeInternalWorkRequest);
serviceRequestsRouter.post("/internal-work-requests/:id/approve-technician", approveTechnicianRegistration);
serviceRequestsRouter.post("/internal-work-requests/:id/transition", validate(TransitionInternalWorkRequestSchema), transitionInternalWorkRequest);

// Contracts & Preventative Maintenance
serviceRequestsRouter.get("/contracts", listContracts);
serviceRequestsRouter.post("/contracts", createContract);
serviceRequestsRouter.patch("/contracts/:id", updateContract);
serviceRequestsRouter.get("/maintenance-schedules", listMaintenanceSchedules);
serviceRequestsRouter.post("/maintenance-schedules", createMaintenanceSchedule);
serviceRequestsRouter.patch("/maintenance-schedules/:id", updateMaintenanceSchedule);

export default serviceRequestsRouter;
