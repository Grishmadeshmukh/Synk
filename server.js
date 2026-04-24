const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "video/mp4") {
      cb(null, true);
      return;
    }
    cb(new Error("Only MP4 files are allowed."));
  },
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "public")));

const roomUploads = new Map();

function trackRoomUpload(roomId, filename) {
  if (!roomUploads.has(roomId)) {
    roomUploads.set(roomId, new Set());
  }
  roomUploads.get(roomId).add(filename);
}

function cleanupRoomUploads(roomId) {
  const files = roomUploads.get(roomId);
  if (!files) return;
  files.forEach((filename) => {
    const filePath = path.join(uploadsDir, filename);
    fs.unlink(filePath, () => {});
  });
  roomUploads.delete(roomId);
}

app.post("/api/upload", upload.single("video"), (req, res) => {
  const roomId = String(req.body.roomId || "").trim();
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }
  if (!roomId) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: "Room ID is required for upload." });
    return;
  }
  trackRoomUpload(roomId, req.file.filename);
  res.json({
    sourceType: "mp4",
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const roomStates = new Map();

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, username }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username || "Anonymous";

    if (!roomStates.has(roomId)) {
      roomStates.set(roomId, {
        source: null,
        playback: { currentTime: 0, paused: true },
        participants: 0,
      });
    }
    roomStates.get(roomId).participants += 1;

    socket.emit("room-state", roomStates.get(roomId));
    io.to(roomId).emit("chat-message", {
      username: "System",
      text: `${socket.data.username} entered the room :))`,
      ts: Date.now(),
    });
  });

  socket.on("set-source", ({ roomId, source }) => {
    if (!roomStates.has(roomId)) return;
    const current = roomStates.get(roomId);
    current.source = source;
    current.playback = { currentTime: 0, paused: true };
    io.to(roomId).emit("source-updated", source);
  });

  socket.on("playback-event", ({ roomId, event }) => {
    if (!roomStates.has(roomId)) return;
    const current = roomStates.get(roomId);
    current.playback = {
      currentTime: event.currentTime ?? current.playback.currentTime,
      paused: event.type !== "play",
    };
    socket.to(roomId).emit("playback-event", event);
  });

  socket.on("chat-message", ({ roomId, text }) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("chat-message", {
      username: socket.data.username || "Anonymous",
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    const { roomId, username } = socket.data;
    if (!roomId) return;
    const roomState = roomStates.get(roomId);
    if (roomState) {
      roomState.participants = Math.max(0, roomState.participants - 1);
    }
    socket.to(roomId).emit("chat-message", {
      username: "System",
      text: `${username || "Someone"} left the room :(`,
      ts: Date.now(),
    });

    if (!roomState || roomState.participants > 0) return;
    cleanupRoomUploads(roomId);
    roomStates.delete(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`WatchTogether app running at http://localhost:${PORT}`);
  console.log("Temporary upload cleanup enabled for active room sessions.");
});
