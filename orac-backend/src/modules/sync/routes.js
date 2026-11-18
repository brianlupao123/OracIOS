/**
 * Sync Module Routes — Offline field sync engine
 */
import { Router } from "express";
import { syncBatchMutations, getSyncJournal, resolveConflict } from "../../controllers/syncController.js";

const syncRouter = Router();

syncRouter.post("/sync/batch", syncBatchMutations);
syncRouter.get("/sync/journal", getSyncJournal);
syncRouter.post("/sync/conflicts/:id/resolve", resolveConflict);

export default syncRouter;
