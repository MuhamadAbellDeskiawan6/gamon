const firebaseConfig = {
  apiKey: "AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ",
  authDomain: "gamon-tawing.firebaseapp.com",
  projectId: "gamon-tawing",
  storageBucket: "gamon-tawing.firebasestorage.app",
  messagingSenderId: "370162915989",
  appId: "1:370162915989:web:76779062da83aa0c5c999c",
  measurementId: "G-DDRQKDZXV7"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

const state = {
  sessionId: null,
  role: null,
  sessionData: null,
  unsubscribe: null,
  cameraStream: null,
  myPhoto: null,
  partnerPhoto: null,
  resultImage: null,
  frameImage: null,
  rtcPeerConnection: null,
  rtcOfferApplied: false,
  rtcAnswerApplied: false,
  rtcCandidateKeys: new Set(),
  pendingRemoteCandidates: [],
  countdownTimer: null,
  countdownStartedAt: null,
  countdownValue: 0,
  captureInProgress: false,
  captureNonce: null,
  isCountingDown: false,
  lastTriggeredCountdownAt: null,
};

const $ = (id) => document.getElementById(id);

const startScreen = $("startScreen");
const waitingScreen = $("waitingScreen");
const captureScreen = $("captureScreen");
const resultScreen = $("resultScreen");

const createBtn = $("createBtn");
const joinBtn = $("joinBtn");
const joinCodeInput = $("joinCodeInput");
const roomCode = $("roomCode");
const sessionStatusText = $("sessionStatusText");
const waitingMessage = $("waitingMessage");
const helpBtn = $("helpBtn");
const cameraToggleBtn = $("cameraToggleBtn");
const captureBtn = $("captureBtn");
const retakeBtn = $("retakeBtn");
const downloadBtn = $("downloadBtn");
const cameraVideo = $("cameraVideo");
const partnerVideo = $("partnerVideo");
const captureCanvas = $("captureCanvas");
const cameraPlaceholder = $("cameraPlaceholder");
const resultCanvas = $("resultCanvas");
const resultMessage = $("resultMessage");
const captureStatusText = $("captureStatusText");
const toast = $("toast");

let toastTimer = null;

function prepareVideoElement(videoEl) {
  if (!videoEl) {
    return;
  }

  videoEl.setAttribute("autoplay", "true");
  videoEl.setAttribute("muted", "true");
  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("webkit-playsinline", "true");
  videoEl.setAttribute("controls", "false");
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.controls = false;
  videoEl.disablePictureInPicture = true;
}

function logSync(message, payload) {
  console.log("[LDR sync]", message, payload || "");
}

function setCaptureBusy(isBusy) {
  if (!captureBtn) {
    return;
  }

  captureBtn.disabled = isBusy;
  captureBtn.textContent = isBusy ? "Bersiap..." : "Ambil Foto";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function showCountdownOverlay(value) {
  let overlay = document.getElementById("syncCountdownOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "syncCountdownOverlay";
    document.body.appendChild(overlay);
  }

  overlay.textContent = String(value);
  overlay.classList.add("show");
  overlay.setAttribute("aria-live", "polite");
}

function clearCountdownOverlay() {
  const overlay = document.getElementById("syncCountdownOverlay");
  if (overlay) {
    overlay.classList.remove("show");
    overlay.remove();
  }
}

function showScreen(screen) {
  [startScreen, waitingScreen, captureScreen, resultScreen].forEach((el) => el.classList.remove("active"));
  screen.classList.add("active");
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 6; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function sessionRef(id = state.sessionId) {
  return db.collection("fotoLdrSessions").doc(id);
}

function resolveCountdownMs(value) {
  if (value === null || typeof value === "undefined") {
    return 0;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value.seconds === "number") {
    return Number(value.seconds) * 1000 + (Number(value.nanoseconds || 0) / 1_000_000);
  }

  return 0;
}

async function updateSession(patch) {
  if (!state.sessionId) {
    return;
  }

  const payload = {
    code: state.sessionId,
    ...patch,
  };

  try {
    await fetch("/api/foto-ldr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, action: "update-session" }),
    });
  } catch (error) {
    console.error("updateSession failed:", error);
  }
}

function setSessionStatusText(value) {
  sessionStatusText.textContent = value;
}

function syncCaptureUi(data = state.sessionData) {
  const user1Photo = data?.user1Photo || null;
  const user2Photo = data?.user2Photo || null;
  const myPhoto = state.role === "user1" ? user1Photo : user2Photo;
  const partnerPhoto = state.role === "user1" ? user2Photo : user1Photo;
  state.myPhoto = myPhoto;
  state.partnerPhoto = partnerPhoto;

  if (data?.status === "waiting") {
    captureStatusText.textContent = "Menunggu pasangan";
  } else if (data?.status === "connected") {
    captureStatusText.textContent = "Kamera siap";
  } else if (data?.status === "ready") {
    captureStatusText.textContent = "Foto siap diunduh";
  }
}

function listenSession() {
  if (state.unsubscribe) {
    state.unsubscribe();
  }

  state.unsubscribe = sessionRef().onSnapshot((snapshot) => {
    if (!snapshot.exists) {
      showToast("Sesi tidak ditemukan atau sudah dihapus.");
      resetSession();
      return;
    }

    const data = snapshot.data();
    state.sessionData = data;
    handleSessionUpdate(data);
  }, (error) => {
    console.error("Listener gagal:", error);
    showToast("Koneksi sesi bermasalah.");
  });
}

function setPartnerRemoteStream(stream) {
  if (!stream) {
    partnerVideo.srcObject = null;
    partnerVideo.classList.remove("active");
    const partnerPlaceholder = document.querySelector(".partner-placeholder");
    if (partnerPlaceholder) {
      partnerPlaceholder.style.display = "grid";
    }
    return;
  }

  partnerVideo.srcObject = stream;
  partnerVideo.classList.add("active");
  const partnerPlaceholder = document.querySelector(".partner-placeholder");
  if (partnerPlaceholder) {
    partnerPlaceholder.style.display = "none";
  }
}

function resetPeerConnection() {
  if (state.rtcPeerConnection) {
    state.rtcPeerConnection.close();
    state.rtcPeerConnection = null;
  }

  state.rtcOfferApplied = false;
  state.rtcAnswerApplied = false;
  state.rtcCandidateKeys.clear();
  state.pendingRemoteCandidates = [];
  setPartnerRemoteStream(null);
}

async function ensurePeerConnection() {
  if (state.rtcPeerConnection) {
    return state.rtcPeerConnection;
  }

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) {
      setPartnerRemoteStream(stream);
      showToast("Kamera pasangan terhubung.");
    }
  };

  pc.onicecandidate = async (event) => {
    if (!event.candidate || !state.sessionId) {
      return;
    }

    try {
      const candidate = event.candidate.toJSON();
      await sessionRef().set({
        rtcCandidates: firebase.firestore.FieldValue.arrayUnion(candidate),
      }, { merge: true });
    } catch (error) {
      console.error("Gagal mengirim kandidat ICE:", error);
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      partnerVideo.classList.add("active");
    }
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      setPartnerRemoteStream(null);
    }
  };

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => pc.addTrack(track, state.cameraStream));
  }

  state.rtcPeerConnection = pc;
  return pc;
}

async function applyRemoteCandidates(candidates = []) {
  if (!Array.isArray(candidates)) {
    return;
  }

  if (!state.rtcPeerConnection) {
    state.pendingRemoteCandidates.push(...candidates.filter(Boolean));
    return;
  }

  if (!state.rtcPeerConnection.remoteDescription) {
    state.pendingRemoteCandidates.push(...candidates.filter(Boolean));
    return;
  }

  const items = [...state.pendingRemoteCandidates, ...candidates];
  state.pendingRemoteCandidates = [];

  for (const candidate of items) {
    if (!candidate || !candidate.candidate) {
      continue;
    }

    const key = `${candidate.sdpMid || "default"}:${candidate.sdpMLineIndex ?? 0}:${candidate.candidate}`;
    if (state.rtcCandidateKeys.has(key)) {
      continue;
    }

    state.rtcCandidateKeys.add(key);

    try {
      await state.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Gagal menambahkan kandidat remote:", error);
    }
  }
}

async function startRtcOffer() {
  const pc = await ensurePeerConnection();
  if (!state.cameraStream) {
    await startCamera();
  }

  if (!state.cameraStream) {
    return;
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const offerPayload = { type: offer.type, sdp: offer.sdp };
  await sessionRef().set({ rtcOffer: offerPayload, rtcAnswer: null }, { merge: true });
}

async function startRtcAnswer(offer) {
  const pc = await ensurePeerConnection();
  if (!offer) {
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  if (state.pendingRemoteCandidates.length) {
    await applyRemoteCandidates(state.pendingRemoteCandidates);
    state.pendingRemoteCandidates = [];
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const answerPayload = { type: answer.type, sdp: answer.sdp };
  await sessionRef().set({ rtcAnswer: answerPayload, rtcOffer: null }, { merge: true });
}

async function handleRtcFlow(data) {
  if (!state.sessionId || !state.cameraStream) {
    return;
  }

  if (state.role === "user1" && data.user2 && !state.rtcPeerConnection) {
    await startRtcOffer();
  }

  if (state.role === "user2" && data.rtcOffer && !state.rtcOfferApplied) {
    state.rtcOfferApplied = true;
    await startRtcAnswer(data.rtcOffer);
  }

  if (state.role === "user1" && data.rtcAnswer && !state.rtcAnswerApplied) {
    state.rtcAnswerApplied = true;
    const pc = await ensurePeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.rtcAnswer));

    if (state.pendingRemoteCandidates.length) {
      await applyRemoteCandidates(state.pendingRemoteCandidates);
      state.pendingRemoteCandidates = [];
    }
  }

  if (Array.isArray(data.rtcCandidates)) {
    await applyRemoteCandidates(data.rtcCandidates);
  }
}

function startSharedCountdownFromSession(data) {
  const startedAt = resolveCountdownMs(data?.countdownStartedAt);
  const totalSeconds = Number(data?.countdownFrom || 5);

  if (!startedAt || totalSeconds <= 0) {
    logSync("countdown ignored", { startedAt, totalSeconds, sessionId: state.sessionId, role: state.role });
    return;
  }

  if (state.lastTriggeredCountdownAt === startedAt) {
    logSync("countdown already processed for timestamp", { startedAt, sessionId: state.sessionId });
    return;
  }

  state.lastTriggeredCountdownAt = startedAt;
  state.countdownStartedAt = startedAt;
  state.isCountingDown = true;
  state.countdownValue = totalSeconds;
  clearInterval(state.countdownTimer);

  const endAt = startedAt + totalSeconds * 1000;
  logSync("countdown started", { startedAt, endAt, totalSeconds, sessionId: state.sessionId, role: state.role });

  const tick = () => {
    const remainingMs = endAt - Date.now();
    const nextValue = Math.max(0, Math.ceil(remainingMs / 1000));
    state.countdownValue = nextValue;

    if (nextValue > 0) {
      showCountdownOverlay(nextValue);
      captureStatusText.textContent = `Mengambil foto dalam ${nextValue}`;
      return;
    }

    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    state.isCountingDown = false;
    setCaptureBusy(false);
    clearCountdownOverlay();
    captureStatusText.textContent = "Mengambil foto...";
    logSync("countdown finished, triggering auto-capture", { sessionId: state.sessionId, role: state.role });
    performAutoCapture();
  };

  tick();
  state.countdownTimer = setInterval(tick, 200);
}

async function performAutoCapture() {
  if (state.captureInProgress || !state.sessionId || !state.cameraStream) {
    logSync("auto-capture skipped", {
      inProgress: state.captureInProgress,
      sessionId: state.sessionId,
      hasCamera: !!state.cameraStream,
    });
    return;
  }

  state.captureInProgress = true;

  try {
    const field = state.role === "user1" ? "user1Photo" : "user2Photo";
    const photoDataUrl = captureLocalVideoToDataUrl();
    logSync("capturing local snapshot", { field, width: cameraVideo.videoWidth, height: cameraVideo.videoHeight, sessionId: state.sessionId });

    await updateSession({
      field,
      photo: photoDataUrl,
      status: "captured",
      action: "capture-complete",
    });

    showToast("Foto berhasil diambil secara bersamaan.");

    if (state.sessionData?.user1Photo && state.sessionData?.user2Photo) {
      await buildCombinedResult();
      showScreen(resultScreen);
    }
  } catch (error) {
    console.error("performAutoCapture failed:", error);
    showToast("Gagal mengambil foto otomatis.");
  } finally {
    state.captureInProgress = false;
    setCaptureBusy(false);
  }
}

function captureLocalVideoToDataUrl() {
  const videoWidth = cameraVideo.videoWidth || 1280;
  const videoHeight = cameraVideo.videoHeight || 1280;

  const coverWidth = Math.max(videoWidth, videoHeight * (900 / 1560));
  const coverHeight = Math.max(videoHeight, videoWidth * (1560 / 900));
  const cropX = (videoWidth - coverWidth) / 2;
  const cropY = (videoHeight - coverHeight) / 2;

  captureCanvas.width = 900;
  captureCanvas.height = 1560;

  const ctx = captureCanvas.getContext("2d");
  ctx.save();
  ctx.translate(900, 0);
  ctx.scale(-1, 1);
  ctx.clearRect(0, 0, 900, 1560);
  ctx.fillStyle = "#f3efe9";
  ctx.fillRect(0, 0, 900, 1560);
  ctx.drawImage(
    cameraVideo,
    cropX,
    cropY,
    Math.max(1, coverWidth),
    Math.max(1, coverHeight),
    0,
    0,
    900,
    1560,
  );
  ctx.restore();

  return captureCanvas.toDataURL("image/jpeg", 0.82);
}

async function handleSessionUpdate(data) {
  if (!data) {
    return;
  }

  if (data.status === "waiting") {
    if (state.role === "user1") {
      setSessionStatusText("Menunggu pasangan...");
      waitingMessage.textContent = "Bagikan kode ke pasanganmu agar sesi dapat dimulai.";
    } else {
      setSessionStatusText("Menunggu sesi...");
      waitingMessage.textContent = "Pasangan sedang menyiapkan sesi.";
    }
    return;
  }

  if (typeof data.countdownStartedAt !== "undefined" && data.countdownStartedAt !== null) {
    startSharedCountdownFromSession(data);
  }

  syncCaptureUi(data);
  await handleRtcFlow(data);

  if (data.status === "connected" || data.status === "captured" || data.status === "ready" || data.status === "sent") {
    if (startScreen.classList.contains("active") || waitingScreen.classList.contains("active")) {
      showScreen(captureScreen);
    }

    if (state.role === "user1") {
      setSessionStatusText("Pasangan terhubung");
    } else {
      setSessionStatusText("Sesi aktif");
    }
  }

  if (data.resultImage) {
    renderResult(data.resultImage);
    showScreen(resultScreen);
    resultMessage.textContent = "Foto LDR siap diunduh.";
  }

  if (data.user1Photo && data.user2Photo && !data.resultImage) {
    await buildCombinedResult();
  }
}

async function startCamera() {
  if (state.cameraStream) {
    prepareVideoElement(cameraVideo);
    if (cameraVideo.srcObject !== state.cameraStream) {
      cameraVideo.srcObject = state.cameraStream;
    }
    try {
      await cameraVideo.play().catch(() => undefined);
    } catch (error) {
      console.warn("Video play fallback failed:", error);
    }
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Browser ini tidak mendukung akses kamera.");
    return;
  }

  try {
    const cameraConstraintsList = [
      {
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: { facingMode: "user" },
        audio: false,
      },
      {
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      },
      {
        video: { width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    let stream = null;
    let lastError = null;

    for (const options of cameraConstraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(options);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!stream) {
      throw lastError || new Error("Tidak dapat mengakses kamera.");
    }

    state.cameraStream = stream;
    prepareVideoElement(cameraVideo);
    cameraVideo.srcObject = stream;
    cameraVideo.load();

    const videoWrap = cameraVideo.closest(".panel-video-wrap");
    if (videoWrap) {
      videoWrap.classList.remove("hidden-placeholder");
    }
    cameraPlaceholder.style.display = "none";

    try {
      await cameraVideo.play();
    } catch (error) {
      console.warn("Autoplay video diblokir, menunggu interaksi user:", error);
    }

    if (state.rtcPeerConnection) {
      const tracks = state.cameraStream.getTracks();
      state.rtcPeerConnection.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.replaceTrack(tracks[0] || sender.track);
        }
      });
    }
    setPartnerRemoteStream(null);
  } catch (error) {
    console.error(error);
    showToast("Kamera tidak dapat diakses. Pastikan izin kamera sudah diberikan dan browser mendukung akses kamera mobile.");
  }
}

async function createSession() {
  try {
    createBtn.disabled = true;
    createBtn.textContent = "Membuat sesi...";

    const response = await fetch("/api/foto-ldr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-session" }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Gagal membuat sesi.");
    }

    state.sessionId = payload.code;
    state.role = "user1";
    roomCode.textContent = payload.code;
    showScreen(waitingScreen);
    listenSession();
    await startCamera();
    await updateSession({
      status: "waiting",
      user1: true,
      user2: false,
      user1Photo: null,
      user2Photo: null,
      resultImage: null,
    });
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal membuat sesi.");
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = "Buat Sesi LDR";
  }
}

async function joinSession() {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    showToast("Masukkan kode sesi 6 karakter.");
    return;
  }

  try {
    joinBtn.disabled = true;
    joinBtn.textContent = "Menghubungkan...";

    const response = await fetch("/api/foto-ldr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join-session", code }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Gagal bergabung ke sesi.");
    }

    state.sessionId = code;
    state.role = "user2";
    roomCode.textContent = code;
    showScreen(waitingScreen);
    listenSession();
    await startCamera();
    await updateSession({ status: "connected", user2: true });
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal bergabung.");
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = "Gabung Sesi";
  }
}

async function capturePhoto() {
  if (!state.sessionId || !state.cameraStream) {
    await startCamera();
  }

  if (!state.cameraStream) {
    return;
  }

  if (state.isCountingDown || state.captureInProgress) {
    return;
  }

  const triggerId = `${state.sessionId}:${Date.now()}`;
  const countdownStartedAt = Date.now();
  logSync("capturePhoto triggered", { triggerId, countdownStartedAt, role: state.role, sessionId: state.sessionId });

  state.isCountingDown = true;
  state.captureNonce = triggerId;
  setCaptureBusy(true);

  await updateSession({
    status: "countdown",
    action: "countdown",
    countdownStartedAt,
    countdownFrom: 5,
    captureTriggerId: triggerId,
  });

  startSharedCountdownFromSession({
    countdownStartedAt,
    countdownFrom: 5,
  });
  showToast("Hitung mundur foto dimulai.");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function drawRoundedCard(ctx, x, y, width, height, radius, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function getCoverDrawMetrics(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  return {
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
  };
}

async function drawPhotoSlot(ctx, slotX, slotY, slotWidth, slotHeight, photoDataUrl) {
  drawRoundedCard(ctx, slotX, slotY, slotWidth, slotHeight, 24, "#f3efe9");

  if (!photoDataUrl) {
    return;
  }

  const img = await loadImage(photoDataUrl);
  const { drawWidth, drawHeight, offsetX, offsetY } = getCoverDrawMetrics(
    img.width,
    img.height,
    slotWidth,
    slotHeight,
  );

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(slotX + 24, slotY);
  ctx.lineTo(slotX + slotWidth - 24, slotY);
  ctx.quadraticCurveTo(slotX + slotWidth, slotY, slotX + slotWidth, slotY + 24);
  ctx.lineTo(slotX + slotWidth, slotY + slotHeight - 24);
  ctx.quadraticCurveTo(slotX + slotWidth, slotY + slotHeight, slotX + slotWidth - 24, slotY + slotHeight);
  ctx.lineTo(slotX + 24, slotY + slotHeight);
  ctx.quadraticCurveTo(slotX, slotY + slotHeight, slotX, slotY + slotHeight - 24);
  ctx.lineTo(slotX, slotY + 24);
  ctx.quadraticCurveTo(slotX, slotY, slotX + 24, slotY);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, slotX + offsetX, slotY + offsetY, drawWidth, drawHeight);
  ctx.restore();
}

function getLdrSlotLayout() {
  return {
    canvasWidth: 900,
    canvasHeight: 1560,
    topSlot: { x: 100, y: 101, w: 700, h: 449 },
    bottomSlot: { x: 100, y: 659, w: 700, h: 449 },
  };
}

async function renderResult(resultDataUrl) {
  const layout = getLdrSlotLayout();
  const canvas = resultCanvas;
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext("2d");

  const topPhoto = state.sessionData?.user1Photo || state.myPhoto || null;
  const bottomPhoto = state.sessionData?.user2Photo || state.partnerPhoto || null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8f3ed";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await drawPhotoSlot(ctx, layout.topSlot.x, layout.topSlot.y, layout.topSlot.w, layout.topSlot.h, topPhoto);
  await drawPhotoSlot(ctx, layout.bottomSlot.x, layout.bottomSlot.y, layout.bottomSlot.w, layout.bottomSlot.h, bottomPhoto);

  const frame = await loadImage("/image/assets/frame-ldr.png");
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);

  const title = "Foto LDR";
  ctx.fillStyle = "rgba(19, 21, 25, 0.85)";
  ctx.font = "700 26px Arial";
  ctx.textAlign = "center";
  ctx.fillText(title, canvas.width / 2, 1440);

  state.resultImage = resultDataUrl || canvas.toDataURL("image/png");
  resultMessage.textContent = "Foto LDR siap dikirim.";
}

async function buildCombinedResult() {
  const user1Photo = state.sessionData?.user1Photo || null;
  const user2Photo = state.sessionData?.user2Photo || null;
  if (!user1Photo || !user2Photo) {
    return;
  }

  const layout = getLdrSlotLayout();
  const composite = resultCanvas;
  composite.width = layout.canvasWidth;
  composite.height = layout.canvasHeight;

  const ctx = composite.getContext("2d");
  ctx.clearRect(0, 0, composite.width, composite.height);
  ctx.fillStyle = "#f8f3ed";
  ctx.fillRect(0, 0, composite.width, composite.height);

  await drawPhotoSlot(ctx, layout.topSlot.x, layout.topSlot.y, layout.topSlot.w, layout.topSlot.h, user1Photo);
  await drawPhotoSlot(ctx, layout.bottomSlot.x, layout.bottomSlot.y, layout.bottomSlot.w, layout.bottomSlot.h, user2Photo);

  const frame = await loadImage("/image/assets/frame-ldr.png");
  ctx.drawImage(frame, 0, 0, composite.width, composite.height);

  ctx.fillStyle = "rgba(19, 21, 25, 0.85)";
  ctx.font = "700 26px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Foto LDR", composite.width / 2, 1440);

  const imageDataUrl = composite.toDataURL("image/png");
  await updateSession({
    imageDataUrl,
    status: "ready",
    action: "ready",
  });

  state.resultImage = imageDataUrl;
  resultMessage.textContent = "Foto LDR siap diunduh.";
  showScreen(resultScreen);
}

function resetSession() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }

  state.sessionId = null;
  state.role = null;
  state.sessionData = null;
  state.myPhoto = null;
  state.partnerPhoto = null;
  state.resultImage = null;
  state.captureInProgress = false;
  state.captureNonce = null;
  state.countdownStartedAt = null;
  state.countdownValue = 0;
  state.isCountingDown = false;
  state.lastTriggeredCountdownAt = null;
  setCaptureBusy(false);
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  clearCountdownOverlay();
  resetPeerConnection();

  roomCode.textContent = "------";
  joinCodeInput.value = "";
  captureStatusText.textContent = "Siap mengambil foto";
  resultMessage.textContent = "Foto siap diunduh.";
  cameraVideo.srcObject = null;
  partnerVideo.srcObject = null;
  partnerVideo.classList.remove("active");
  cameraPlaceholder.style.display = "grid";
  const partnerPlaceholder = document.querySelector(".partner-placeholder");
  if (partnerPlaceholder) {
    partnerPlaceholder.style.display = "grid";
  }
  showScreen(startScreen);
}

createBtn.addEventListener("click", createSession);
joinBtn.addEventListener("click", joinSession);
joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

cameraToggleBtn.addEventListener("click", async () => {
  if (cameraVideo.srcObject) {
    cameraVideo.srcObject.getTracks().forEach((track) => track.stop());
    cameraVideo.srcObject = null;
    partnerVideo.srcObject = null;
    partnerVideo.classList.remove("active");
    state.cameraStream = null;
    cameraPlaceholder.style.display = "grid";
    const partnerPlaceholder = document.querySelector(".partner-placeholder");
    if (partnerPlaceholder) {
      partnerPlaceholder.style.display = "grid";
    }
    showToast("Kamera dimatikan.");
    return;
  }

  await startCamera();
  if (state.cameraStream) {
    showToast("Kamera aktif.");
  }
});

captureBtn.addEventListener("click", capturePhoto);
retakeBtn.addEventListener("click", () => {
  if (!state.sessionId) {
    showToast("Buat atau gabung sesi terlebih dahulu.");
    return;
  }

  if (state.role === "user1") {
    updateSession({ field: "user1Photo", photo: null, status: "connected", action: "connected" });
  } else {
    updateSession({ field: "user2Photo", photo: null, status: "connected", action: "connected" });
  }

  state.myPhoto = null;
  showToast("Siap ambil foto baru.");
});

helpBtn.addEventListener("click", () => {
  showToast("Buat sesi lalu bagikan kode ke pasangan. Setelah foto selesai, hasil dapat diunduh langsung.");
});

downloadBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  const source = state.resultImage || resultCanvas.toDataURL("image/png");
  if (!source) {
    showToast("Belum ada hasil foto yang bisa diunduh.");
    return;
  }

  link.href = source;
  link.download = "foto-ldr-gamon.png";
  link.click();
  showToast("File PNG sedang diunduh.");
});

roomCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode.textContent);
    showToast("Kode sesi berhasil disalin.");
  } catch (error) {
    showToast("Kode sesi: " + roomCode.textContent);
  }
});

$("cancelSessionBtn").addEventListener("click", async () => {
  if (state.sessionId) {
    try {
      await sessionRef().delete();
    } catch (error) {
      console.error(error);
    }
  }

  resetSession();
});

$("newSessionBtn").addEventListener("click", () => {
  if (state.sessionId) {
    sessionRef().delete().catch(() => undefined);
  }
  resetSession();
});

window.addEventListener("beforeunload", () => {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
});

showScreen(startScreen);
