/**
 * Notifications Module Routes
 */
import { Router } from "express";
import { getNotifications, markAllRead, markRead } from "../../controllers/notificationController.js";

const notificationsRouter = Router();

notificationsRouter.get("/notifications", getNotifications);
notificationsRouter.post("/notifications/read-all", markAllRead);
notificationsRouter.post("/notifications/:id/read", markRead);

export default notificationsRouter;
