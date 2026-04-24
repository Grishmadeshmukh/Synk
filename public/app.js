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
const roomMetaEl = document.getElementById("roomMeta");
const participantsEl = document.getElementById("participants");
const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let roomId = "";
let currentSourceType = null;
let activeVideoEl = null;
let activeYoutubePlayer = null;
let suppressEmit = false;
let lastMp4SyncEmitAt = 0;
let youtubeApiPromise = null;
let youtubeSyncInterval = null;
let lastYoutubeTime = 0;
let releaseSuppressTimer = null;
let pendingPlaybackState = null;

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

function renderParticipants(participants = []) {
  if (!roomMetaEl || !participantsEl) return;
  if (!roomId) {
    roomMetaEl.textContent = "Not in a room yet.";
    participantsEl.textContent = "Participants: -";
    return;
  }
  roomMetaEl.textContent = `Room: ${roomId}`;
  participantsEl.textContent = `Participants (${participants.length}): ${participants.join(", ") || "-"}`;
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

function withSuppressedEmit(callback, delayMs = 400) {
  suppressEmit = true;
  callback();
  if (releaseSuppressTimer) {
    clearTimeout(releaseSuppressTimer);
  }
  releaseSuppressTimer = setTimeout(() => {
    suppressEmit = false;
  }, delayMs);
}

function emitPlaybackEvent(event) {
  if (!roomId || !currentSourceType) return;
  socket.emit("playback-event", {
    roomId,
    event: { ...event, sourceType: currentSourceType },
  });
}

function stopYoutubeSync() {
  if (!youtubeSyncInterval) return;
  clearInterval(youtubeSyncInterval);
  youtubeSyncInterval = null;
}

function destroyYoutubePlayer() {
  stopYoutubeSync();
  if (!activeYoutubePlayer) return;
  try {
    activeYoutubePlayer.destroy();
  } catch (_err) {}
  activeYoutubePlayer = null;
}

function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") {
        previousReady();
      }
      resolve();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      appendMessage({ username: "System", text: "Could not load YouTube API right now." });
    };
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function createVideoElement(url) {
  const video = document.createElement("video");
  video.src = url;
  video.controls = true;
  video.playsInline = true;
  video.setAttribute("controlsList", "nofullscreen");

  video.addEventListener("play", () => {
    if (suppressEmit) return;
    emitPlaybackEvent({ type: "play", currentTime: video.currentTime });
  });

  video.addEventListener("pause", () => {
    if (suppressEmit) return;
    emitPlaybackEvent({ type: "pause", currentTime: video.currentTime });
  });

  video.addEventListener("seeked", () => {
    if (suppressEmit) return;
    emitPlaybackEvent({ type: "seek", currentTime: video.currentTime });
  });

  video.addEventListener("timeupdate", () => {
    if (suppressEmit) return;
    const now = Date.now();
    if (now - lastMp4SyncEmitAt < 800) return;
    lastMp4SyncEmitAt = now;
    emitPlaybackEvent({ type: "sync", currentTime: video.currentTime });
  });

  return video;
}

function startYoutubeSyncTicker() {
  stopYoutubeSync();
  youtubeSyncInterval = setInterval(() => {
    if (!activeYoutubePlayer || suppressEmit || !roomId) return;
    const state = activeYoutubePlayer.getPlayerState?.();
    const time = activeYoutubePlayer.getCurrentTime?.();
    if (typeof time !== "number") return;

    if (Math.abs(time - lastYoutubeTime) > 2) {
      emitPlaybackEvent({ type: "seek", currentTime: time });
    }

    if (state === window.YT?.PlayerState?.PLAYING) {
      emitPlaybackEvent({ type: "sync", currentTime: time });
    }
    lastYoutubeTime = time;
  }, 900);
}

function applyVideoPlaybackEvent(event) {
  if (!activeVideoEl) return;
  withSuppressedEmit(() => {
    if (typeof event.currentTime === "number") {
      const drift = Math.abs(activeVideoEl.currentTime - event.currentTime);
      if (event.type === "seek" || drift > 1) {
        activeVideoEl.currentTime = event.currentTime;
      }
    }
    if (event.type === "play") activeVideoEl.play().catch(() => {});
    if (event.type === "pause") activeVideoEl.pause();
  });
}

function applyYoutubePlaybackEvent(event) {
  if (!activeYoutubePlayer) return;
  withSuppressedEmit(() => {
    const current = activeYoutubePlayer.getCurrentTime?.() || 0;
    if (typeof event.currentTime === "number") {
      const drift = Math.abs(current - event.currentTime);
      if (event.type === "seek" || drift > 1.2) {
        activeYoutubePlayer.seekTo(event.currentTime, true);
      }
    }
    if (event.type === "play") activeYoutubePlayer.playVideo();
    if (event.type === "pause") activeYoutubePlayer.pauseVideo();
  }, 700);
}

function applyPlaybackState(playback) {
  if (!playback) return;
  if (currentSourceType === "mp4") {
    applyVideoPlaybackEvent({
      type: playback.paused ? "pause" : "play",
      currentTime: playback.currentTime || 0,
    });
    return;
  }
  if (currentSourceType === "youtube") {
    if (!activeYoutubePlayer) {
      pendingPlaybackState = playback;
      return;
    }
    applyYoutubePlaybackEvent({
      type: playback.paused ? "pause" : "play",
      currentTime: playback.currentTime || 0,
    });
  }
}

function setupYoutubePlayer(videoId) {
  const mount = document.createElement("div");
  videoWrapper.appendChild(mount);

  return loadYoutubeApi().then(() => {
    if (!window.YT?.Player) return;

    activeYoutubePlayer = new window.YT.Player(mount, {
      videoId,
      playerVars: {
        fs: 0,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          startYoutubeSyncTicker();
          if (pendingPlaybackState) {
            applyPlaybackState(pendingPlaybackState);
            pendingPlaybackState = null;
          }
        },
        onStateChange: (ytEvent) => {
          if (suppressEmit) return;
          const currentTime = activeYoutubePlayer?.getCurrentTime?.() || 0;
          if (ytEvent.data === window.YT.PlayerState.PLAYING) {
            emitPlaybackEvent({ type: "play", currentTime });
          } else if (ytEvent.data === window.YT.PlayerState.PAUSED) {
            emitPlaybackEvent({ type: "pause", currentTime });
          }
        },
      },
    });
  });
}

function renderSource(source) {
  videoWrapper.innerHTML = "";
  activeVideoEl = null;
  destroyYoutubePlayer();
  pendingPlaybackState = null;
  currentSourceType = source?.sourceType || null;

  if (!source) {
    videoWrapper.textContent = "No source selected yet.";
    return;
  }

  if (source.sourceType === "youtube") {
    setupYoutubePlayer(source.videoId);
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
  fullscreenBtn.addEventListener("click", () => {
    const isFocused = layoutEl.classList.toggle("focus-video");
    fullscreenBtn.textContent = isFocused ? "Exit Focus Video" : "Focus Video (chat on side)";
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) return;
    if (document.fullscreenElement !== layoutEl) {
      document.exitFullscreen().catch(() => {});
      layoutEl.classList.add("focus-video");
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
  renderParticipants(state.participantsList || []);
  setTimeout(() => applyPlaybackState(state.playback), 450);
});

socket.on("source-updated", (source) => {
  renderSource(source);
});

socket.on("playback-event", (event) => {
  if (event.sourceType && currentSourceType && event.sourceType !== currentSourceType) return;
  if (currentSourceType === "mp4") {
    applyVideoPlaybackEvent(event);
    return;
  }
  if (currentSourceType === "youtube") {
    applyYoutubePlaybackEvent(event);
  }
});

socket.on("chat-message", (msg) => {
  appendMessage(msg);
});

socket.on("participants-updated", ({ roomId: updatedRoomId, participants }) => {
  if (updatedRoomId !== roomId) return;
  renderParticipants(participants || []);
});
