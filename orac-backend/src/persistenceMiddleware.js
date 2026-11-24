// A few GET requests must leave a persisted audit row (who opened a Daily Time Sheet or the review
// queue, or downloaded a Pastel review export). Ordinary GETs never write, so these exact paths opt in to the write path.
const AUDITED_READS = [
  /^\/document-data\/daily_timesheets\/[^/]+$/,
  /^\/daily-timesheet-review-queue$/,
  /^\/exports\/pastel-payroll\.csv$/,
  /^\/exports\/pastel(?:\.csv|-review\/.*)?$/
];
const isAuditedRead = (req) => req.method === "GET" && AUDITED_READS.some((re) => re.test(req.path));

export function persistenceMiddleware(store) {
  return async (req, res, next) => {
    let context;
    let released = false;
    let writeStarted = false;
    let sendingResponse = false;

    // These exact POST paths return data without writing to the store.
    const isReadOnly = (["GET", "HEAD", "OPTIONS"].includes(req.method) && !isAuditedRead(req))
      || (req.method === "POST" && ((req.path === "/auth/login" && !process.env.ORAC_TOTP_PROTECTED_ROLES)
        || req.path === "/worksheet_registers/preview"
        || req.path === "/public/google-profile"));

    const safeRelease = async () => {
      if (writeStarted || released) return;
      released = true;
      if (context) await store.release(context);
    };

    try {
      const { db, release } = await store.read({ lock: !isReadOnly });
      context = release;
      req.db = db;
      req.store = store;
      req.releaseDb = release;
      // A side effect outside the database may need a durably saved reservation.
      // Reacquire the write lock and return fresh state before continuing.
      req.checkpointWrite = async () => {
        if (isReadOnly || !context || released || writeStarted || res.destroyed) {
          throw new Error("The request has no active write transaction.");
        }
        writeStarted = true;
        try {
          await store.write(req.db, context);
          released = true;
          if (res.destroyed) throw new Error("The request closed after saving the reservation.");
          const fresh = await store.read({ lock: true });
          context = fresh.release;
          released = false;
          req.db = fresh.db;
          req.releaseDb = context;
        } finally {
          writeStarted = false;
          if (res.destroyed) await safeRelease();
        }
        if (res.destroyed) throw new Error("The request closed after saving the reservation.");
        return req.db;
      };
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      const originalEnd = res.end.bind(res);

      const respond = (send, args) => {
        if (sendingResponse) return send(...args);
        if (isReadOnly || ((res.statusCode < 200 || res.statusCode >= 300) && !req.persistOnFailure)) {
          Promise.resolve(safeRelease()).then(() => {
            if (!res.destroyed) {
              sendingResponse = true;
              send(...args);
              sendingResponse = false;
            }
          }).catch(next);
          return res;
        }
        if (writeStarted) return res;
        writeStarted = true;
        if (released) {
          // The checkpoint committed, but acquiring the next transaction failed.
          sendingResponse = true;
          try { return send(...args); } finally { sendingResponse = false; }
        }
        Promise.resolve().then(() => store.write(req.db, context)).then(() => {
          released = true;
          if (!res.destroyed) {
            sendingResponse = true;
            send(...args);
            sendingResponse = false;
          }
        }).catch((error) => {
          writeStarted = false;
          return Promise.resolve(safeRelease()).then(() => next(error), next);
        });
        return res;
      };

      res.json = (...args) => respond(originalJson, args);
      res.send = (...args) => respond(originalSend, args);
      res.end = (...args) => respond(originalEnd, args);
      res.once("finish", () => { void safeRelease(); });
      res.once("close", () => { void safeRelease(); });
      next();
    } catch (error) {
      Promise.resolve(safeRelease()).then(() => next(error), next);
    }
  };
}
