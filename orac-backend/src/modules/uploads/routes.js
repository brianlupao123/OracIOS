/**
 * File Uploads Module Routes
 */
import { Router } from "express";
import { postUpload, getFile, getEntityFiles, deleteFile, getUploadStats } from "../../controllers/fileUploadController.js";

const uploadsRouter = Router();

uploadsRouter.post("/uploads", postUpload);
uploadsRouter.get("/uploads/stats", getUploadStats);
uploadsRouter.get("/uploads/:id", getFile);
uploadsRouter.get("/uploads/entity/:entityType/:entityId", getEntityFiles);
uploadsRouter.delete("/uploads/:id", deleteFile);

export default uploadsRouter;
