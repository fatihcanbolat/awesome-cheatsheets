import express from "express";

function asyncRoute(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function createApp(store) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/days", asyncRoute((_req, res) => {
    res.json(store.listDays());
  }));

  app.get("/api/days/:date", asyncRoute((req, res) => {
    const day = store.getDay(req.params.date);
    if (!day) {
      res.status(404).json({ error: "Gün bulunamadı" });
      return;
    }
    res.json(day);
  }));

  app.post("/api/days", asyncRoute((req, res) => {
    res.status(201).json(store.ensureDay(req.body?.date));
  }));

  app.post("/api/days/:date/groups", asyncRoute((req, res) => {
    res.status(201).json(store.createGroup(req.params.date, req.body || {}));
  }));

  app.patch("/api/groups/:id", asyncRoute((req, res) => {
    res.json(store.updateGroup(Number(req.params.id), req.body || {}));
  }));

  app.delete("/api/groups/:id", asyncRoute((req, res) => {
    res.json(store.deleteGroup(Number(req.params.id)));
  }));

  app.post("/api/groups/:id/lines", asyncRoute((req, res) => {
    res.status(201).json(store.createLine(Number(req.params.id), req.body || {}));
  }));

  app.patch("/api/lines/:id", asyncRoute((req, res) => {
    res.json(store.updateLine(Number(req.params.id), req.body || {}));
  }));

  app.delete("/api/lines/:id", asyncRoute((req, res) => {
    res.json(store.deleteLine(Number(req.params.id)));
  }));

  app.post("/api/reorder", asyncRoute((req, res) => {
    const body = req.body || {};
    if (body.kind === "line") {
      res.json(store.moveLine(Number(body.lineId), Number(body.toGroupId), Number(body.index)));
      return;
    }
    if (body.kind === "group") {
      res.json(store.moveGroup(Number(body.groupId), Number(body.index)));
      return;
    }
    if (body.kind === "regroup") {
      res.json(store.regroupLines(body.lineIds, Number(body.afterGroupId)));
      return;
    }
    res.status(400).json({ error: "Sıralama türü geçersiz" });
  }));

  app.post("/api/lines/copy", asyncRoute((req, res) => {
    res.status(201).json(store.copyLines(req.body?.lineIds, req.body?.toDate));
  }));

  app.get("/api/search", asyncRoute((req, res) => {
    res.json(store.search(req.query.q || ""));
  }));

  app.get("/api/plates", asyncRoute((_req, res) => {
    res.json(store.plates());
  }));

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || "Sunucu hatası" });
  });

  return app;
}
