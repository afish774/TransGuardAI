// backend/server.js
// Trans Guard AI - Node.js / MongoDB WebSocket orchestrator
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const { WebSocketServer } = require("ws");

const Incident = require("./models/Incident");
const Zone = require("./models/Zone");

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/trans_guard";
const WATCHLIST_DIR = path.join(__dirname, "..", "uploads", "watchlist");
fs.mkdirSync(WATCHLIST_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ---------------------------------------------------------------------------
// REST: incidents
// ---------------------------------------------------------------------------
app.get("/api/incidents", async (req, res) => {
  try {
    const { type, cameraId, limit = 100 } = req.query;
    const q = {};
    if (type) q.incidentType = type;
    if (cameraId) q.cameraId = cameraId;
    const incidents = await Incident.find(q).sort({ timestamp: -1 }).limit(Number(limit));
    res.json(incidents);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/incidents/:id/ack", async (req, res) => {
  try {
    const doc = await Incident.findByIdAndUpdate(
      req.params.id,
      { acknowledged: true },
      { new: true }
    );
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// REST: restricted zones (dashboard -> DB -> push to engine over WS)
// ---------------------------------------------------------------------------
app.get("/api/zones/:cameraId", async (req, res) => {
  try {
    const zone = await Zone.findOne({ cameraId: req.params.cameraId });
    res.json(zone || { cameraId: req.params.cameraId, polygon: [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/zones/:cameraId", async (req, res) => {
  try {
    const { polygon, name, active = true } = req.body;
    if (!Array.isArray(polygon) || (polygon.length > 0 && polygon.length < 3)) {
      return res.status(400).json({ error: "polygon must have 0 or >= 3 vertices" });
    }
    const zone = await Zone.findOneAndUpdate(
      { cameraId: req.params.cameraId },
      { polygon, name, active },
      { new: true, upsert: true }
    );
    // Push live to the connected edge engine for this camera
    pushZoneToEngine(req.params.cameraId, zone.polygon);
    res.json(zone);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// REST: watchlist uploads
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: WATCHLIST_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) =>
    /\.(jpe?g|png)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new Error("Only .jpg/.jpeg/.png allowed")),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.get("/api/watchlist", (_req, res) => {
  const files = fs
    .readdirSync(WATCHLIST_DIR)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => ({ name: f, url: `/uploads/watchlist/${f}` }));
  res.json(files);
});

app.post("/api/watchlist", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo file required" });
  res.status(201).json({
    name: req.file.filename,
    url: `/uploads/watchlist/${req.file.filename}`,
  });
});

app.delete("/api/watchlist/:name", (req, res) => {
  const target = path.join(WATCHLIST_DIR, path.basename(req.params.name));
  if (fs.existsSync(target)) fs.unlinkSync(target);
  res.json({ deleted: req.params.name });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Two WS endpoints:
//   /ws/engine    <- Python edge engines (one per camera)
//   /ws/dashboard <- React dashboards (broadcast fan-out)
const engines = new Map();    // cameraId -> ws
const dashboards = new Set(); // ws

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/ws/engine")) {
    wss.handleUpgrade(req, socket, head, (ws) => handleEngine(ws));
  } else if (req.url.startsWith("/ws/dashboard")) {
    wss.handleUpgrade(req, socket, head, (ws) => handleDashboard(ws));
  } else {
    socket.destroy();
  }
});

function handleEngine(ws) {
  let cameraId = null;
  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "engine_hello") {
      cameraId = msg.cameraId;
      engines.set(cameraId, ws);
      console.log(`[engine] connected: ${cameraId}`);
      // Send the persisted zone (if any) so engines recover state on reconnect
      const zone = await Zone.findOne({ cameraId });
      if (zone && zone.polygon.length >= 3) {
        ws.send(JSON.stringify({ type: "zone_update", cameraId, polygon: zone.polygon }));
      }
      return;
    }

    if (msg.type === "incident") {
      try {
        const doc = await Incident.create({
          incidentType: msg.incidentType,
          cameraId: msg.cameraId,
          timestamp: new Date((msg.timestamp || Date.now() / 1000) * 1000),
          snapshot: msg.snapshot || "",
          persons: msg.persons,
          objectClass: msg.objectClass,
          trackId: msg.trackId,
          stationarySeconds: msg.stationarySeconds,
          bbox: msg.bbox,
          point: msg.point,
          zone: msg.zone,
          identity: msg.identity,
        });
        broadcastToDashboards({ type: "incident", incident: doc });
      } catch (e) {
        console.error("[incident] persist failed:", e.message);
      }
    }
  });

  ws.on("close", () => {
    if (cameraId && engines.get(cameraId) === ws) engines.delete(cameraId);
    console.log(`[engine] disconnected: ${cameraId}`);
  });
}

function handleDashboard(ws) {
  dashboards.add(ws);
  console.log(`[dashboard] connected (${dashboards.size})`);
  ws.on("close", () => dashboards.delete(ws));
}

function broadcastToDashboards(payload) {
  const raw = JSON.stringify(payload);
  for (const ws of dashboards) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
}

function pushZoneToEngine(cameraId, polygon) {
  const ws = engines.get(cameraId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "zone_update", cameraId, polygon }));
    console.log(`[zone] pushed to engine ${cameraId} (${polygon.length} vertices)`);
  } else {
    console.log(`[zone] engine ${cameraId} offline; zone persisted for next connect`);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("[mongo] connected");
    server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("[mongo] connection failed:", e.message);
    process.exit(1);
  });
