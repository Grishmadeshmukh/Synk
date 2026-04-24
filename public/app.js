const socket = io();

const roomIdEl = document.getElementById("roomId");
const usernameEl = document.getElementById("username");
const joinBtn = document.getElementById("joinBtn");
const mp4Input = document.getElementById("mp4Input");
const uploadBtn = document.getElementById("uploadBtn");
const youtubeInput = document.getElementById("youtubeInput");
const youtubeBtn = document.getElementById("youtubeBtn");
const platformInput = document.getElementById("platformInput");
const platformBtn = document.getElementById("platformBtn");
const videoWrapper = document.getElementById("videoWrapper");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const layoutEl = document.querySelector(".layout");
const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let roomId = "";
let activeVideoEl = null;
let suppressEmit = false;

function getRoomId() {
  const value = roomIdEl.value.trim();
  if (!value) {
    alert("Please enter a room ID.");
    return null;
  }
  return value;
}

function appendMessage({ username, text }) {
  const row = document.createElement("div");
  row.className = "msg";
  row.innerHTML = `<strong>${username}:</strong> ${text}`;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function normalizeYoutube(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }
    return parsed.searchParams.get("v");
  } catch (_err) {
    return null;
  }
}

function createVideoElement(url) {
  const video = document.createElement("video");
  video.src = url;
  video.controls = true;
  video.playsInline = true;
  video.setAttribute("controlsList", "nofullscreen");

  video.addEventListener("play", () => {
    if (suppressEmit) return;
    socket.emit("playback-event", {
      roomId,
      event: { type: "play", currentTime: video.currentTime },
    });
  });

  video.addEventListener("pause", () => {
    if (suppressEmit) return;
    socket.emit("playback-event", {
      roomId,
      event: { type: "pause", currentTime: video.currentTime },
    });
  });

  video.addEventListener("seeked", () => {
    if (suppressEmit) return;
    socket.emit("playback-event", {
      roomId,
      event: { type: "seek", currentTime: video.currentTime },
    });
  });

  return video;
}

function renderSource(source) {
  videoWrapper.innerHTML = "";
  activeVideoEl = null;

  if (!source) {
    videoWrapper.textContent = "No source selected yet.";
    return;
  }

  if (source.sourceType === "youtube") {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${source.videoId}?enablejsapi=1&fs=0`;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = false;
    videoWrapper.appendChild(iframe);
    return;
  }

  if (source.sourceType === "embed") {
    const iframe = document.createElement("iframe");
    iframe.src = source.url;
    iframe.allow = "autoplay; fullscreen";
    iframe.allowFullscreen = true;
    videoWrapper.appendChild(iframe);
    return;
  }

  const video = createVideoElement(source.url);
  videoWrapper.appendChild(video);
  activeVideoEl = video;
}

joinBtn.addEventListener("click", () => {
  if (!socket.connected) {
    alert("Still connecting to server. Please wait a moment and try again.");
    return;
  }
  const value = getRoomId();
  if (!value) return;
  roomId = value;
  socket.emit("join-room", {
    roomId,
    username: usernameEl.value.trim() || "Anonymous",
  });
});

uploadBtn.addEventListener("click", async () => {
  if (!socket.connected) {
    alert("Still connecting to server. Please wait a moment and try again.");
    return;
  }
  if (!roomId) {
    alert("Join a room first.");
    return;
  }
  if (!mp4Input.files?.[0]) {
    alert("Select an MP4 file first.");
    return;
  }
  const formData = new FormData();
  formData.append("video", mp4Input.files[0]);
  formData.append("roomId", roomId);
  const response = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "Upload failed");
    return;
  }
  socket.emit("set-source", {
    roomId,
    source: { sourceType: "mp4", url: data.url, name: data.name },
  });
});

youtubeBtn.addEventListener("click", () => {
  if (!socket.connected) {
    alert("Still connecting to server. Please wait a moment and try again.");
    return;
  }
  if (!roomId) {
    alert("Join a room first.");
    return;
  }
  const videoId = normalizeYoutube(youtubeInput.value.trim());
  if (!videoId) {
    alert("Please enter a valid YouTube URL.");
    return;
  }
  socket.emit("set-source", { roomId, source: { sourceType: "youtube", videoId } });
});

platformBtn.addEventListener("click", () => {
  if (!socket.connected) {
    alert("Still connecting to server. Please wait a moment and try again.");
    return;
  }
  if (!roomId) {
    alert("Join a room first.");
    return;
  }
  const url = platformInput.value.trim();
  if (!url) return;
  const sourceType = url.endsWith(".mp4") ? "mp4" : "embed";
  socket.emit("set-source", { roomId, source: { sourceType, url } });
});

sendBtn.addEventListener("click", () => {
  if (!roomId) {
    alert("Join a room first.");
    return;
  }
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", { roomId, text });
  chatInput.value = "";
});

if (fullscreenBtn && layoutEl) {
  fullscreenBtn.addEventListener("click", async () => {
    const isFocused = layoutEl.classList.toggle("focus-video");
    if (isFocused) {
      fullscreenBtn.textContent = "Exit Focus Video";
      return;
    }
    fullscreenBtn.textContent = "Focus Video (chat on side)";
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) return;

    if (document.fullscreenElement !== layoutEl) {
      document.exitFullscreen().catch(() => {});
      layoutEl.classList.add("focus-video");
      fullscreenBtn.textContent = "Exit Focus Video";
      return;
    }
    fullscreenBtn.textContent = "Exit Focus Video";
  });
}

socket.on("connect_error", () => {
  appendMessage({
    username: "System",
    text: "Connection issue. Retrying...",
  });
});

socket.on("room-state", (state) => {
  renderSource(state.source);
  if (activeVideoEl && state.playback) {
    suppressEmit = true;
    activeVideoEl.currentTime = state.playback.currentTime || 0;
    if (!state.playback.paused) {
      activeVideoEl.play().catch(() => {});
    }
    suppressEmit = false;
  }
});

socket.on("source-updated", (source) => {
  renderSource(source);
});

socket.on("playback-event", (event) => {
  if (!activeVideoEl) return;
  suppressEmit = true;
  if (typeof event.currentTime === "number") {
    activeVideoEl.currentTime = event.currentTime;
  }
  if (event.type === "play") activeVideoEl.play().catch(() => {});
  if (event.type === "pause") activeVideoEl.pause();
  suppressEmit = false;
});

socket.on("chat-message", (msg) => {
  appendMessage(msg);
});
