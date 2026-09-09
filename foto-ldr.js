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
const SESSION_TIME_LIMIT_SECONDS = 60;

const state = {
  sessionId: null,
  role: null,
  sessionData: null,
  unsubscribe: null,
  cameraStream: null,
  micEnabled: true,
  myPhoto: null,
  partnerPhoto: null,
  resultImage: null,
  frameImage: null,
  rtcPeerConnection: null,
  rtcPeerConnectionPromise: null,
  rtcPcDebugId: null,
  rtcOfferApplied: false,
  rtcAnswerApplied: false,
  rtcFlowBusy: false,
  isNegotiating: false,
  lastSentOfferHash: null,
  lastAnsweredOfferHash: null,
  lastAppliedAnswerHash: null,
  rtcCandidateKeys: new Set(),
  rtcCandidateSentCount: 0,
  rtcCandidateReceivedCount: 0,
  pendingRemoteCandidates: [],
  countdownTimer: null,
  sessionTimeLimitTimer: null,
  sessionTimeLimitStartedAt: null,
  sessionTimeLimitExpired: false,
  sessionTimeLimitWarningShown: false,
  countdownStartedAt: null,
  countdownValue: 0,
  captureInProgress: false,
  captureNonce: null,
  isCountingDown: false,
  lastTriggeredCountdownAt: null,
  reconnectTimer: null,
  rtcIceServers: null,
  rtcIceServersPromise: null,
  rtcTurnActive: false,
  availableFrames: [],
  frameSelectionInProgress: null,
  resultFramePickerOpen: false,
  resultBuildInProgress: false,
  resultBuildCompleted: false,
  paymentOrderId: null,
  paymentStatus: null,
  paymentUnsubscribe: null,
  downloadCompleted: false,
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
const micToggleBtn = $("micToggleBtn");
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
const sessionTimeLimitText = $("sessionTimeLimitText");
const rtcDebugText = $("rtcDebugText");
const rtcTurnStatus = $("rtcTurnStatus");
const selfMicStatus = $("selfMicStatus");
const toast = $("toast");
const processingOverlay = $("processingOverlay");
const processingMessage = $("processingMessage");
const framePickerRole = $("framePickerRole");
const framePickerMessage = $("framePickerMessage");
const frameGrid = $("frameGrid");
const framePicker = $("framePicker");
const waitingFramePickerHost = $("waitingFramePickerHost");
const resultFramePickerHost = $("resultFramePickerHost");
const changeFrameBtn = $("changeFrameBtn");
const cancelSessionBtn = $("cancelSessionBtn");
const newSessionBtn = $("newSessionBtn");
const paymentPanel = $("paymentPanel");
const paymentStatusText = $("paymentStatusText");
const payBtn = $("payBtn");

const cameraIcon = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7Z"></path><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>';
const cameraOffIcon = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7Z"></path><rect x="1" y="5" width="15" height="14" rx="2"></rect><path d="M3 3l18 18"></path></svg>';
const micIcon = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3M8 22h8"></path></svg>';
const micOffIcon = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3M8 22h8M3 3l18 18"></path></svg>';

const debugQuery = new URLSearchParams(window.location.search);
const debugWebRtcEnabled = debugQuery.get("debug") === "1" || debugQuery.get("debug") === "webrtc";
if (debugWebRtcEnabled) {
  [rtcDebugText, rtcTurnStatus].forEach((element) => {
    element?.classList.add("is-debug-visible");
  });
}

let toastTimer = null;
const paymentStorageKey = "fotoLdrPaymentSession";

function configureVideoElement(videoEl, { muted = true } = {}) {
  if (!videoEl) {
    return;
  }

  videoEl.setAttribute("autoplay", "true");
  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("webkit-playsinline", "true");
  videoEl.playsInline = true;
  videoEl.controls = false;

  if (muted) {
    videoEl.setAttribute("muted", "true");
    videoEl.muted = true;
  } else {
    videoEl.removeAttribute("muted");
    videoEl.muted = false;
  }
}

function attachVideoStream(videoEl, stream, { muted = true } = {}) {
  if (!videoEl) {
    return;
  }

  configureVideoElement(videoEl, { muted });
  videoEl.srcObject = stream;

  if (videoEl.play) {
    videoEl.play().catch(() => {
      console.warn("Video autoplay/play gagal untuk elemen kamera.", { element: videoEl.id, muted });
      if (videoEl === partnerVideo) {
        showToast("Audio partner tidak bisa diputar otomatis. Ketuk layar untuk mengaktifkan suara.");
      }
    });
  }
}

function stopCameraStream(stream) {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => {
    track.stop();
  });
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

function updateRtcDebugInfo() {
  const pc = state.rtcPeerConnection;
  const statusText = [
    `pc: ${pc ? pc.connectionState || "new" : "none"}`,
    `ice: ${pc ? pc.iceConnectionState || "new" : "none"}`,
    `sent: ${state.rtcCandidateSentCount || 0}`,
    `recv: ${state.rtcCandidateReceivedCount || 0}`,
  ].join(" • ");

  if (rtcDebugText) {
    rtcDebugText.textContent = statusText;
  }
}

function showCountdownOverlay(value) {
  const videoContainer = document.querySelector(".self-card .panel-video-wrap");
  if (!videoContainer) {
    return;
  }

  let overlay = document.getElementById("syncCountdownOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "syncCountdownOverlay";
  }

  if (overlay.parentElement !== videoContainer) {
    videoContainer.appendChild(overlay);
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

function showProcessingOverlay(message) {
  updateProcessingOverlay(message);
  processingOverlay.classList.add("show");
  processingOverlay.setAttribute("aria-busy", "true");
}

function updateProcessingOverlay(message) {
  if (processingMessage && message) {
    processingMessage.textContent = message;
  }
}

function hideProcessingOverlay() {
  processingOverlay.classList.remove("show");
  processingOverlay.setAttribute("aria-busy", "false");
}

function showScreen(screen) {
  [startScreen, waitingScreen, captureScreen, resultScreen].forEach((el) => el.classList.remove("active"));
  screen.classList.add("active");
  syncChangeFrameButton();
}

function syncChangeFrameButton() {
  if (!changeFrameBtn) {
    return;
  }

  const paymentInProgress = state.paymentOrderId && !["EXPIRED", "FAILED"].includes(state.paymentStatus);
  changeFrameBtn.hidden = state.role !== "user1" || !resultScreen.classList.contains("active") || paymentInProgress;
  changeFrameBtn.textContent = state.resultFramePickerOpen ? "Tutup Pilihan Frame" : "Ganti Frame";
}

async function toggleResultFramePicker() {
  if (state.role !== "user1" || !resultFramePickerHost || !framePicker) {
    return;
  }

  if (state.resultFramePickerOpen) {
    if (waitingFramePickerHost) {
      waitingFramePickerHost.appendChild(framePicker);
    }
    state.resultFramePickerOpen = false;
    syncChangeFrameButton();
    return;
  }

  changeFrameBtn.disabled = true;
  try {
    if (!state.availableFrames.length) {
      await loadAvailableFrames();
    }

    resultFramePickerHost.appendChild(framePicker);
    state.resultFramePickerOpen = true;
    renderFramePicker();
    syncChangeFrameButton();
  } finally {
    changeFrameBtn.disabled = false;
  }
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

function savePaymentSession() {
  if (!state.sessionId) {
    return;
  }

  localStorage.setItem(paymentStorageKey, JSON.stringify({
    sessionId: state.sessionId,
    role: state.role,
    paymentOrderId: state.paymentOrderId,
  }));
}

function clearPaymentSession() {
  localStorage.removeItem(paymentStorageKey);
}

function isPaymentPaid() {
  return state.paymentStatus === "PAID";
}

function syncPaymentUi() {
  const paid = isPaymentPaid();
  const hasResult = !!state.resultImage || !!state.sessionData?.resultImage;

  if (paymentPanel) {
    paymentPanel.classList.toggle("is-paid", paid);
  }
  if (paymentStatusText) {
    paymentStatusText.textContent = paid
      ? "Pembayaran terkonfirmasi. Foto siap diunduh."
      : state.paymentStatus === "EXPIRED"
        ? "Pembayaran sebelumnya kedaluwarsa. Silakan buat pembayaran QRIS baru."
        : "Pembayaran diperlukan sebelum foto dapat diunduh.";
  }
  if (payBtn) {
    payBtn.hidden = paid;
    payBtn.disabled = !hasResult || state.paymentStatus === "PENDING";
    payBtn.textContent = state.paymentStatus === "PENDING" ? "Menunggu pembayaran..." : "Bayar dengan QRIS";
  }
  if (downloadBtn) {
    downloadBtn.disabled = !paid;
  }
  if (cancelSessionBtn) {
    cancelSessionBtn.disabled = paid && !state.downloadCompleted;
  }
  if (newSessionBtn) {
    newSessionBtn.disabled = paid && !state.downloadCompleted;
  }
  syncChangeFrameButton();
}

function setPaymentState(orderId, status) {
  state.paymentOrderId = orderId || state.paymentOrderId || null;
  state.paymentStatus = status || null;
  savePaymentSession();
  syncPaymentUi();
}

function listenPayment(orderId) {
  if (!orderId) {
    syncPaymentUi();
    return;
  }

  if (state.paymentOrderId === orderId && state.paymentUnsubscribe) {
    return;
  }

  if (state.paymentUnsubscribe) {
    state.paymentUnsubscribe();
  }

  state.paymentOrderId = orderId;
  state.paymentUnsubscribe = db.collection("ldr_order").doc(orderId).onSnapshot((snapshot) => {
    const data = snapshot.exists ? snapshot.data() || {} : {};
    console.log("[LDR payment] Status order berubah:", { orderId, status: data.paymentStatus || data.status });
    setPaymentState(orderId, data.paymentStatus || data.status || "PENDING");
  }, (error) => {
    console.error("[LDR payment] Listener order gagal:", error);
    showToast("Status pembayaran belum bisa diperiksa.");
    syncPaymentUi();
  });
}

async function createPayment() {
  if (!state.sessionId || !state.resultImage || isPaymentPaid()) {
    return;
  }

  try {
    payBtn.disabled = true;
    payBtn.textContent = "Menyiapkan QRIS...";
    const response = await fetch("/api/foto-ldr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-payment", sessionId: state.sessionId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success || !payload.response?.payment?.url) {
      throw new Error(payload.message || payload.error || "Gagal mendapatkan halaman pembayaran QRIS.");
    }

    setPaymentState(payload.orderId, "PENDING");
    console.log("[LDR payment] Redirect ke checkout DOKU:", { orderId: payload.orderId, sessionId: state.sessionId });
    window.location.replace(payload.response.payment.url);
  } catch (error) {
    console.error("[LDR payment] Checkout gagal dibuat:", error);
    showToast(error.message || "Pembayaran gagal disiapkan.");
    syncPaymentUi();
  }
}

async function downloadPaidResult() {
  if (!state.paymentOrderId) {
    showToast("Order pembayaran belum tersedia.");
    return;
  }

  try {
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Memeriksa pembayaran...";
    const response = await fetch(`/api/foto-ldr?action=download-result&orderId=${encodeURIComponent(state.paymentOrderId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success || !payload.resultImage) {
      throw new Error(payload.message || "Pembayaran belum terkonfirmasi.");
    }

    const link = document.createElement("a");
    link.href = payload.resultImage;
    link.download = "foto-ldr-gamon.png";
    link.click();
    state.downloadCompleted = true;
    localStorage.removeItem(paymentStorageKey);
    syncPaymentUi();
    showToast("File PNG sedang diunduh.");
  } catch (error) {
    console.error("[LDR payment] Download ditolak:", error);
    showToast(error.message || "Foto belum bisa diunduh.");
    syncPaymentUi();
  } finally {
    downloadBtn.textContent = "Unduh Foto";
    syncPaymentUi();
  }
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
    const response = await fetch("/api/foto-ldr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, action: "update-session" }),
    });

    if (!response.ok) {
      throw new Error(`Gagal memperbarui sesi (${response.status}).`);
    }
  } catch (error) {
    console.error("updateSession failed:", error);
    throw error;
  }
}

function setSessionStatusText(value) {
  sessionStatusText.textContent = value;
}

function renderFramePicker(data = state.sessionData) {
  if (!frameGrid || !framePickerMessage) {
    return;
  }

  const selectedFrameId = data?.selectedFrameId || null;
  const selectedFrameImage = data?.selectedFrameImage || null;
  const canSelect = state.role === "user1";
  framePickerRole.textContent = canSelect ? "Bisa diganti kapan saja" : "Pilihan Orang A";

  if (!state.availableFrames.length) {
    frameGrid.innerHTML = "";
    framePickerMessage.textContent = "Belum ada frame tersedia, foto akan pakai frame default.";
    return;
  }

  framePickerMessage.textContent = selectedFrameId
    ? (canSelect ? "Pilih frame lain kapan saja sebelum foto diambil." : "Frame ini dipilih oleh pembuat sesi.")
    : (canSelect ? "Pilih frame atau lanjut dengan frame default." : "Pembuat sesi belum memilih frame. Frame default akan digunakan.");

  frameGrid.innerHTML = state.availableFrames.map((frame) => {
    const isSelected = frame.id === selectedFrameId;
    const buttonType = canSelect ? "button" : "button";
    const isProcessing = state.frameSelectionInProgress === frame.id;
    return `
      <button class="frame-option ${isSelected ? "selected" : ""} ${canSelect ? "selectable" : ""}" type="${buttonType}" data-frame-id="${frame.id}" ${canSelect && !isProcessing ? "" : "disabled"} aria-busy="${isProcessing}">
        <img src="${frame.previewImage || frame.frameImage || ""}" alt="${frame.name || "Frame"}" loading="lazy" />
        <span class="frame-option-name">${frame.name || "Frame"}</span>
        ${isSelected ? '<span class="frame-selected-badge">Terpilih</span>' : ""}
      </button>
    `;
  }).join("");

  if (selectedFrameImage && !selectedFrameId) {
    framePickerMessage.textContent = canSelect
      ? "Frame terpilih tersimpan untuk sesi ini."
      : "Frame terpilih dari pembuat sesi.";
  }
}

function renderFrameSkeletons() {
  if (!frameGrid) {
    return;
  }

  frameGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="frame-skeleton" aria-hidden="true"></div>').join("");
}

async function loadAvailableFrames() {
  if (!framePickerMessage) {
    return;
  }

  framePickerMessage.textContent = "Memuat frame...";
  renderFrameSkeletons();

  try {
    const response = await fetch("/api/foto-ldr?action=list-frames", { cache: "no-store" });
    console.log("[LDR frames] HTTP response list-frames:", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });
    let payload;
    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[LDR frames] Response list-frames bukan JSON valid:", parseError);
      throw parseError;
    }
    console.log("[LDR frames] Payload lengkap list-frames:", payload);
    if (!response.ok || !payload.success || !Array.isArray(payload.frames)) {
      throw new Error(payload.message || "Daftar frame tidak tersedia.");
    }

    state.availableFrames = payload.frames;
    renderFramePicker();
  } catch (error) {
    state.availableFrames = [];
    frameGrid.innerHTML = "";
    framePickerMessage.textContent = "Belum ada frame tersedia, foto akan pakai frame default.";
    console.warn("[LDR frames] Daftar frame Foto LDR tidak tersedia:", error);
  }
}

async function selectFrame(frameId) {
  if (state.role !== "user1" || state.frameSelectionInProgress) {
    return;
  }

  const frame = state.availableFrames.find((item) => item.id === frameId);
  if (!frame || !frame.frameImage) {
    return;
  }

  const previousSessionData = state.sessionData;
  const optimisticSessionData = {
    ...(state.sessionData || {}),
    selectedFrameId: frame.id,
    selectedFrameImage: frame.frameImage,
  };
  state.frameSelectionInProgress = frame.id;
  state.sessionData = optimisticSessionData;
  renderFramePicker(optimisticSessionData);

  let persisted = false;
  try {
    await persistSignalingPatch({
      selectedFrameId: frame.id,
      selectedFrameImage: frame.frameImage,
    }, "menyimpan pilihan frame");

    persisted = true;
    if (state.resultFramePickerOpen) {
      await rebuildResultWithFrame(frame.frameImage);
    }
    showToast(`Frame "${frame.name || "Frame"}" dipilih.`);
  } catch (error) {
    state.sessionData = previousSessionData;
    renderFramePicker(previousSessionData);
    if (persisted && state.resultFramePickerOpen && previousSessionData) {
      try {
        await persistSignalingPatch({
          selectedFrameId: previousSessionData.selectedFrameId || null,
          selectedFrameImage: previousSessionData.selectedFrameImage || null,
        }, "mengembalikan pilihan frame");
      } catch (rollbackError) {
        console.error("Rollback pilihan frame gagal:", rollbackError);
      }
    }
    console.error("Gagal menyimpan pilihan frame:", error);
    showToast("Pilihan frame gagal disimpan.");
  } finally {
    state.frameSelectionInProgress = null;
    renderFramePicker(state.sessionData);
  }
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

function formatSessionTimeLimit(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

if (sessionTimeLimitText) {
  sessionTimeLimitText.textContent = formatSessionTimeLimit(SESSION_TIME_LIMIT_SECONDS);
}

async function ensureSessionTimeLimitStarted(data) {
  if (state.role !== "user1" || !data?.user2 || data.sessionTimeLimitStartedAt || state.sessionTimeLimitStartedAt) {
    return;
  }

  const startedAt = Date.now();
  state.sessionTimeLimitStartedAt = startedAt;

  try {
    await persistSignalingPatch({
      sessionTimeLimitStartedAt: startedAt,
      sessionTimeLimitSeconds: SESSION_TIME_LIMIT_SECONDS,
    }, "memulai batas waktu sesi");
  } catch (error) {
    state.sessionTimeLimitStartedAt = null;
    console.error("Gagal memulai batas waktu sesi:", error);
  }
}

function startSessionTimeLimitFromSession(data) {
  const startedAt = resolveCountdownMs(data?.sessionTimeLimitStartedAt);
  const totalSeconds = SESSION_TIME_LIMIT_SECONDS;

  if (!startedAt || totalSeconds <= 0 || (state.sessionTimeLimitStartedAt === startedAt && (state.sessionTimeLimitTimer || state.sessionTimeLimitExpired))) {
    return;
  }

  state.sessionTimeLimitStartedAt = startedAt;
  state.sessionTimeLimitExpired = false;
  state.sessionTimeLimitWarningShown = false;
  clearInterval(state.sessionTimeLimitTimer);

  const tick = () => {
    const remainingSeconds = Math.max(0, Math.ceil((startedAt + totalSeconds * 1000 - Date.now()) / 1000));
    if (sessionTimeLimitText) {
      sessionTimeLimitText.hidden = false;
      sessionTimeLimitText.textContent = formatSessionTimeLimit(remainingSeconds);
      sessionTimeLimitText.classList.toggle("warning", remainingSeconds <= 15);
    }

    if (remainingSeconds > 0) {
      if (remainingSeconds <= 15 && !state.sessionTimeLimitWarningShown) {
        state.sessionTimeLimitWarningShown = true;
        showToast("Waktu sesi tersisa 15 detik.");
      }
      return;
    }

    clearInterval(state.sessionTimeLimitTimer);
    state.sessionTimeLimitTimer = null;
    state.sessionTimeLimitExpired = true;

    if (state.myPhoto) {
      captureStatusText.textContent = "Menunggu pasangan mengambil foto...";
      return;
    }

    if (state.role === "user1") {
      captureStatusText.textContent = "Waktu habis, mengambil foto...";
      void capturePhoto({ fromSessionTimeLimit: true }).catch((error) => {
        console.error("Auto-capture batas waktu gagal:", error);
      });
    } else {
      captureStatusText.textContent = "Menunggu pasangan mengambil foto...";
    }
  };

  tick();
  state.sessionTimeLimitTimer = setInterval(tick, 1000);
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
    if (data.paymentOrderId) {
      listenPayment(data.paymentOrderId);
    } else if (data.paymentStatus) {
      setPaymentState(null, data.paymentStatus);
    }
    console.log("[LDR signaling] onSnapshot fired", {
      sessionId: state.sessionId,
      role: state.role,
      user1: !!data?.user1,
      user2: !!data?.user2,
      hasRtcOffer: !!data?.rtcOffer,
      hasRtcAnswer: !!data?.rtcAnswer,
      rtcCandidatesUser1: Array.isArray(data?.rtcCandidatesUser1) ? data.rtcCandidatesUser1.length : 0,
      rtcCandidatesUser2: Array.isArray(data?.rtcCandidatesUser2) ? data.rtcCandidatesUser2.length : 0,
    });

    void handleSessionUpdate(data).catch((error) => {
      console.error("[LDR signaling] handleSessionUpdate failed:", error);
      showToast("Sesi gagal diproses. Periksa permission Firestore dan signaling WebRTC.");
    });
  }, (error) => {
    console.error("[LDR signaling] Listener gagal:", error);
    showToast("Koneksi sesi bermasalah.");
  });
}

function setPartnerRemoteStream(stream) {
  if (!stream) {
    if (partnerVideo) {
      partnerVideo.srcObject = null;
      configureVideoElement(partnerVideo, { muted: false });
    }
    partnerVideo.classList.remove("active");
    const partnerPlaceholder = document.querySelector(".partner-placeholder");
    if (partnerPlaceholder) {
      partnerPlaceholder.style.display = "grid";
    }
    return;
  }

  attachVideoStream(partnerVideo, stream, { muted: false });
  partnerVideo.classList.add("active");
  const partnerPlaceholder = document.querySelector(".partner-placeholder");
  if (partnerPlaceholder) {
    partnerPlaceholder.style.display = "none";
  }
}

function updateMicUi() {
  if (!micToggleBtn || !selfMicStatus) {
    return;
  }

  const enabled = state.micEnabled !== false;
  setMicButtonUi(enabled);
  micToggleBtn.classList.toggle("is-muted", !enabled);
  micToggleBtn.setAttribute("aria-pressed", String(enabled));
  selfMicStatus.classList.toggle("muted", !enabled);

  const micLabel = selfMicStatus.querySelector(".mic-label");
  const micOnIcon = selfMicStatus.querySelector(".mic-icon-on");
  const micMutedIcon = selfMicStatus.querySelector(".mic-icon-muted");
  if (micLabel) {
    micLabel.textContent = enabled ? "Mic on" : "Mic off";
  }
  if (micOnIcon) {
    micOnIcon.hidden = !enabled;
  }
  if (micMutedIcon) {
    micMutedIcon.hidden = enabled;
  }

  if (state.cameraStream) {
    state.cameraStream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }
}

function setMicButtonUi(enabled) {
  micToggleBtn.innerHTML = `${enabled ? micIcon : micOffIcon}<span>${enabled ? "Mic" : "Mic off"}</span>`;
}

function setCameraButtonUi(enabled) {
  cameraToggleBtn.innerHTML = `${enabled ? cameraIcon : cameraOffIcon}<span>${enabled ? "Kamera" : "Kamera off"}</span>`;
  cameraToggleBtn.classList.toggle("is-muted", !enabled);
  cameraToggleBtn.setAttribute("aria-pressed", String(enabled));
}

function getIceServers() {
  const fallbacks = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];

  return Array.isArray(state.rtcIceServers) && state.rtcIceServers.length ? state.rtcIceServers : fallbacks;
}

function setTurnStatus(message, active = false) {
  state.rtcTurnActive = active;
  if (rtcTurnStatus) {
    rtcTurnStatus.textContent = `TURN: ${message}`;
  }
}

async function loadIceServers() {
  if (state.rtcIceServers) {
    return state.rtcIceServers;
  }

  if (state.rtcIceServersPromise) {
    return state.rtcIceServersPromise;
  }

  state.rtcIceServersPromise = (async () => {
    try {
      const response = await fetch("/api/foto-ldr?action=ice-servers", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.turnConfigured || !Array.isArray(payload.iceServers)) {
        throw new Error(payload.message || "TURN tidak tersedia.");
      }

      state.rtcIceServers = payload.iceServers;
      setTurnStatus("AKTIF, kredensial diterima", true);
      console.log("[LDR TURN] AKTIF: browser menerima konfigurasi TURN dari backend.");
      return state.rtcIceServers;
    } catch (error) {
      state.rtcIceServers = null;
      setTurnStatus("TIDAK AKTIF, cek konfigurasi", false);
      console.error("[LDR TURN] TIDAK AKTIF, cek konfigurasi:", error.message);
      throw error;
    } finally {
      state.rtcIceServersPromise = null;
    }
  })();

  return state.rtcIceServersPromise;
}

async function logSelectedIceCandidate(pc) {
  if (!pc || typeof pc.getStats !== "function") {
    return;
  }

  const stats = await pc.getStats();
  let selectedPair = null;
  let localCandidate = null;

  stats.forEach((report) => {
    if (report.type === "candidate-pair" && (report.selected || report.nominated) && report.state === "succeeded") {
      selectedPair = report;
    }
  });

  if (selectedPair?.localCandidateId) {
    localCandidate = stats.get(selectedPair.localCandidateId);
  }

  if (localCandidate?.candidateType === "relay") {
    setTurnStatus("AKTIF, relay sedang dipakai", true);
    console.log("[LDR TURN] AKTIF: koneksi WebRTC memakai relay TURN.", {
      candidateType: localCandidate.candidateType,
      protocol: localCandidate.protocol,
      address: localCandidate.address,
    });
    return;
  }

  console.warn("[LDR TURN] BELUM DIPAKAI: koneksi aktif tetapi candidate bukan relay TURN.", {
    candidateType: localCandidate?.candidateType || "unknown",
  });
}

function isInAppBrowser() {
  const userAgent = (navigator.userAgent || "").toLowerCase();
  return /instagram|facebook|fbav|line|twitter|wa|whatsapp|wechat|tiktok|snapchat|miuibrowser|micromessenger|wv\)/i.test(userAgent);
}

function isIPhoneSafari() {
  const userAgent = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(userAgent) && /safari/i.test(userAgent) && !/crios|fxios|opios|android/i.test(userAgent);
}

function isSecureContextAvailable() {
  return !!window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function describeMediaError(error) {
  const details = [error?.name, error?.message].filter(Boolean).join(" — ");
  if (!isSecureContextAvailable()) {
    return "Browser tidak dalam secure context (HTTPS/localhost diperlukan).";
  }
  if (isIPhoneSafari() && isInAppBrowser()) {
    return "iOS in-app browser memblokir kamera/WebRTC total.";
  }
  return details || "Error kamera tidak diketahui.";
}

async function persistSignalingPatch(patch, label = "mengupdate sesi") {
  if (!state.sessionId) {
    throw new Error("Sesi belum aktif.");
  }

  const response = await fetch("/api/foto-ldr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: state.sessionId,
      ...patch,
      action: "update-session",
    }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || `Gagal ${label}.`);
  }

  return payload;
}

function getRtcPayloadFingerprint(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const text = JSON.stringify({
    type: payload.type || "",
    sdp: String(payload.sdp || "").slice(0, 2000),
  });

  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return String(hash);
}

function logTrackHealth(label, track, extra = {}) {
  if (!track) {
    console.log(`[LDR media] ${label} track missing`, { ...extra });
    return;
  }

  console.log(`[LDR media] ${label} track state`, {
    kind: track.kind,
    readyState: track.readyState,
    muted: track.muted,
    enabled: track.enabled,
    ended: track.readyState === "ended",
    ...extra,
  });
}

function getPcDebugId(pc = state.rtcPeerConnection) {
  if (!pc) {
    return "pc:none";
  }

  if (!pc.__gamonDebugId) {
    pc.__gamonDebugId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `pc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return pc.__gamonDebugId;
}

function syncLocalTracksToPeerConnection() {
  const pc = state.rtcPeerConnection;
  const stream = state.cameraStream;

  if (!pc || !stream) {
    return;
  }

  const existingSenderTracks = new Set(pc.getSenders().map((sender) => sender.track).filter(Boolean));
  let addedVideo = 0;
  let addedAudio = 0;

  stream.getTracks().forEach((track) => {
    if (!existingSenderTracks.has(track)) {
      pc.addTrack(track, stream);
      if (track.kind === "video") {
        addedVideo += 1;
      }
      if (track.kind === "audio") {
        addedAudio += 1;
      }

      console.log("[LDR signaling] local track attached to peer connection", {
        sessionId: state.sessionId,
        role: state.role,
        kind: track.kind,
        id: track.id,
        readyState: track.readyState,
        muted: track.muted,
        enabled: track.enabled,
      });
    }
  });

  if (addedVideo || addedAudio) {
    console.log("[LDR signaling] local track attach summary", {
      sessionId: state.sessionId,
      role: state.role,
      addedVideo,
      addedAudio,
      totalSenders: pc.getSenders().length,
    });
  }
}

function resetPeerConnection() {
  if (state.rtcPeerConnection) {
    state.rtcPeerConnection.close();
    state.rtcPeerConnection = null;
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  state.rtcPcDebugId = null;
  state.rtcOfferApplied = false;
  state.rtcAnswerApplied = false;
  state.rtcFlowBusy = false;
  state.isNegotiating = false;
  state.lastSentOfferHash = null;
  state.lastAnsweredOfferHash = null;
  state.lastAppliedAnswerHash = null;
  state.rtcCandidateKeys.clear();
  state.rtcCandidateSentCount = 0;
  state.rtcCandidateReceivedCount = 0;
  state.pendingRemoteCandidates = [];
  setPartnerRemoteStream(null);
  updateRtcDebugInfo();
}

async function ensurePeerConnection() {
  console.log("[LDR signaling] ensurePeerConnection called", {
    sessionId: state.sessionId,
    role: state.role,
    hasCamera: !!state.cameraStream,
    existingPc: !!state.rtcPeerConnection,
    creatingPc: !!state.rtcPeerConnectionPromise,
  });

  if (!state.cameraStream) {
    await startCamera();
  }

  if (state.rtcPeerConnection) {
    syncLocalTracksToPeerConnection();
    updateRtcDebugInfo();
    return state.rtcPeerConnection;
  }

  if (state.rtcPeerConnectionPromise) {
    return state.rtcPeerConnectionPromise;
  }

  state.rtcPeerConnectionPromise = (async () => {
    await loadIceServers();
    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceTransportPolicy: "all",
    });
    const pcDebugId = getPcDebugId(pc);
    state.rtcPcDebugId = pcDebugId;

    console.log("[LDR signaling] RTCPeerConnection created", {
      pcDebugId,
      sessionId: state.sessionId,
      role: state.role,
      iceServers: getIceServers(),
      hasCamera: !!state.cameraStream,
    });

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      const remoteTrack = event.track;
      const baseMeta = {
        pcDebugId,
        sessionId: state.sessionId,
        role: state.role,
        kind: remoteTrack?.kind,
        readyState: remoteTrack?.readyState,
        muted: remoteTrack?.muted,
        enabled: remoteTrack?.enabled,
      };

      console.log("[LDR signaling] remote track received", baseMeta);
      logTrackHealth("remote", remoteTrack, {
        pcDebugId,
        sessionId: state.sessionId,
        role: state.role,
      });

      if (remoteTrack) {
        remoteTrack.addEventListener("mute", () => {
          console.warn("[LDR signaling] remote track muted", {
            pcDebugId,
            sessionId: state.sessionId,
            role: state.role,
            readyState: remoteTrack.readyState,
            muted: remoteTrack.muted,
            enabled: remoteTrack.enabled,
          });
        });

        remoteTrack.addEventListener("unmute", () => {
          console.log("[LDR signaling] remote track unmuted", {
            pcDebugId,
            sessionId: state.sessionId,
            role: state.role,
            readyState: remoteTrack.readyState,
            muted: remoteTrack.muted,
            enabled: remoteTrack.enabled,
          });
        });

        remoteTrack.addEventListener("ended", () => {
          console.warn("[LDR signaling] remote track ended", {
            pcDebugId,
            sessionId: state.sessionId,
            role: state.role,
            readyState: remoteTrack.readyState,
            muted: remoteTrack.muted,
            enabled: remoteTrack.enabled,
          });
        });
      }

      if (stream) {
        setPartnerRemoteStream(stream);
        showToast("Kamera pasangan terhubung.");
      }
    };

    pc.onicecandidate = async (event) => {
      console.log("[LDR signaling] ICE candidate callback fired", {
        pcDebugId,
        sessionId: state.sessionId,
        role: state.role,
        hasCandidate: !!event.candidate,
        candidate: event.candidate ? event.candidate.toJSON() : null,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      });

      if (!event.candidate || !state.sessionId) {
        return;
      }

      const candidate = {
        ...event.candidate.toJSON(),
        from: state.role,
      };

      console.log("[LDR signaling] ICE candidate generated", {
        pcDebugId,
        sessionId: state.sessionId,
        role: state.role,
        iceGatheringState: pc.iceGatheringState,
        candidate,
      });

      try {
        const candidateField = state.role === "user1" ? "rtcCandidatesUser1" : "rtcCandidatesUser2";
        const existing = Array.isArray(state.sessionData?.[candidateField]) ? state.sessionData[candidateField] : [];
        const response = await persistSignalingPatch({ [candidateField]: [...existing, candidate] }, "mengirim kandidat ICE");
        console.log("[LDR signaling] ICE candidate write success", {
          pcDebugId,
          sessionId: state.sessionId,
          role: state.role,
          candidateField,
          response,
        });

        state.rtcCandidateSentCount += 1;
        updateRtcDebugInfo();
      } catch (error) {
        console.error("[LDR signaling] Gagal mengirim kandidat ICE:", error);
        showToast("Koneksi kamera pasangan gagal mengirim kandidat ICE. Coba lagi atau cek permission Firestore dan koneksi jaringan.");
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log("[LDR signaling] ICE gathering state changed", {
        pcDebugId,
        role: state.role,
        sessionId: state.sessionId,
        state: pc.iceGatheringState,
        signalingState: pc.signalingState,
      });
    };

    pc.onsignalingstatechange = () => {
      console.log("[LDR signaling] signaling state changed", {
        pcDebugId,
        role: state.role,
        sessionId: state.sessionId,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
      });
    };

    pc.oniceconnectionstatechange = () => {
      updateRtcDebugInfo();
      console.warn("ICE state berubah:", {
        role: state.role,
        state: pc.iceConnectionState,
        connection: pc.connectionState,
        sessionId: state.sessionId,
      });

      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        setSessionStatusText("Menyambungkan ulang...");
        showToast("Koneksi WebRTC terputus. Mencoba kembali ke server ICE...");
        if (!state.reconnectTimer) {
          state.reconnectTimer = setTimeout(async () => {
            state.reconnectTimer = null;
            if (!state.sessionId) {
              return;
            }

            try {
              if (pc.restartIce) {
                pc.restartIce();
              }

              if (state.role === "user1" && state.sessionData?.user2) {
                state.rtcOfferApplied = false;
                await startRtcOffer();
              } else if (state.role === "user2" && state.sessionData?.rtcOffer) {
                state.rtcOfferApplied = false;
                await startRtcAnswer(state.sessionData.rtcOffer);
              }
            } catch (error) {
              console.error("Reconnect WebRTC gagal:", error);
              showToast("Reconnect WebRTC gagal. Pastikan jaringan stabil dan koneksi TURN/STUN tersedia.");
            }
          }, 1500);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      updateRtcDebugInfo();
      if (pc.connectionState === "connected") {
        partnerVideo.classList.add("active");
        setSessionStatusText("Pasangan terhubung");
        void logSelectedIceCandidate(pc);
      }

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        setPartnerRemoteStream(null);
      }
    };

    syncLocalTracksToPeerConnection();
    state.rtcPeerConnection = pc;
    updateRtcDebugInfo();
    return pc;
  })();

  try {
    return await state.rtcPeerConnectionPromise;
  } finally {
    state.rtcPeerConnectionPromise = null;
  }
}

function getRemoteCandidateList(data = {}) {
  const items = [];

  if (Array.isArray(data.rtcCandidates)) {
    items.push(...data.rtcCandidates);
  }

  if (Array.isArray(data.rtcCandidatesUser1)) {
    items.push(...data.rtcCandidatesUser1);
  }

  if (Array.isArray(data.rtcCandidatesUser2)) {
    items.push(...data.rtcCandidatesUser2);
  }

  return items.filter((candidate) => {
    if (!candidate || !candidate.candidate) {
      return false;
    }

    if (typeof candidate.from === "string") {
      return candidate.from !== state.role;
    }

    return true;
  });
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
      state.rtcCandidateReceivedCount += 1;
      updateRtcDebugInfo();
    } catch (error) {
      console.error("Gagal menambahkan kandidat remote:", error);
    }
  }
}

async function startRtcOffer() {
  console.log("[LDR signaling] startRtcOffer invoked", {
    sessionId: state.sessionId,
    role: state.role,
    hasCamera: !!state.cameraStream,
    rtcOfferApplied: state.rtcOfferApplied,
    lastSentOfferHash: state.lastSentOfferHash,
  });

  if (!state.sessionId || !state.cameraStream || state.isNegotiating) {
    return;
  }

  state.isNegotiating = true;

  try {
    const pc = await ensurePeerConnection();
    const pcDebugId = getPcDebugId(pc);
    syncLocalTracksToPeerConnection();
    const senderCountBeforeOffer = pc.getSenders().length;
    console.log("[LDR signaling] createOffer preflight", {
      pcDebugId,
      sessionId: state.sessionId,
      role: state.role,
      senderCountBeforeOffer,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const offerPayload = { type: offer.type, sdp: offer.sdp };
    const offerHash = getRtcPayloadFingerprint(offerPayload);

    console.log("[LDR signaling] offer created", {
      sessionId: state.sessionId,
      role: state.role,
      offerHash,
      offerPayload,
    });

    if (state.lastSentOfferHash === offerHash) {
      console.log("[LDR signaling] skip duplicate offer write", { sessionId: state.sessionId, offerHash });
      return;
    }

    state.lastSentOfferHash = offerHash;
    state.rtcOfferApplied = true;

    const response = await persistSignalingPatch({ rtcOffer: offerPayload, rtcAnswer: null }, "membuat offer WebRTC");
    console.log("[LDR signaling] offer write success", { sessionId: state.sessionId, role: state.role, response, offerHash });
  } catch (error) {
    state.rtcOfferApplied = false;
    console.error("[LDR signaling] startRtcOffer failed:", error);
    showToast(error.message || "Offer WebRTC gagal dibuat. Periksa permission Firestore, izin kamera, dan koneksi.");
  } finally {
    state.isNegotiating = false;
  }
}

async function startRtcAnswer(offer) {
  console.log("[LDR signaling] startRtcAnswer invoked", {
    sessionId: state.sessionId,
    role: state.role,
    hasOffer: !!offer,
    rtcAnswerApplied: state.rtcAnswerApplied,
    rtcFlowBusy: state.rtcFlowBusy,
    lastAnsweredOfferHash: state.lastAnsweredOfferHash,
  });

  if (!offer || state.isNegotiating || state.rtcFlowBusy) {
    return;
  }

  const offerHash = getRtcPayloadFingerprint(offer);
  if (offerHash && state.lastAnsweredOfferHash === offerHash) {
    console.log("[LDR signaling] skip duplicate answer for stale offer", { sessionId: state.sessionId, offerHash });
    return;
  }

  state.rtcFlowBusy = true;
  state.isNegotiating = true;

  try {
    const pc = await ensurePeerConnection();
    const pcDebugId = getPcDebugId(pc);
    syncLocalTracksToPeerConnection();
    console.log("[LDR signaling] createAnswer preflight", {
      pcDebugId,
      sessionId: state.sessionId,
      role: state.role,
      senderCountBeforeAnswer: pc.getSenders().length,
      hasRemoteDescription: !!pc.remoteDescription,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      offerHash,
    });

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    if (state.pendingRemoteCandidates.length) {
      await applyRemoteCandidates(state.pendingRemoteCandidates);
      state.pendingRemoteCandidates = [];
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const answerPayload = { type: answer.type, sdp: answer.sdp };
    const answerHash = getRtcPayloadFingerprint(answerPayload);
    console.log("[LDR signaling] answer created", {
      sessionId: state.sessionId,
      role: state.role,
      offerHash,
      answerHash,
      answerPayload,
    });

    state.lastAnsweredOfferHash = offerHash;
    state.rtcAnswerApplied = true;

    const response = await persistSignalingPatch({ rtcAnswer: answerPayload, rtcOffer: null }, "membuat answer WebRTC");
    console.log("[LDR signaling] answer write success", {
      sessionId: state.sessionId,
      role: state.role,
      offerHash,
      answerHash,
      response,
    });
  } catch (error) {
    state.rtcAnswerApplied = false;
    console.error("[LDR signaling] startRtcAnswer failed:", error);
    showToast(error.message || "Answer WebRTC gagal dibuat. Periksa permission Firestore, secure context, dan koneksi jaringan.");
  } finally {
    state.rtcFlowBusy = false;
    state.isNegotiating = false;
  }
}

async function handleRtcFlow(data) {
  console.log("[LDR signaling] handleRtcFlow called", {
    sessionId: state.sessionId,
    role: state.role,
    user1: !!data?.user1,
    user2: !!data?.user2,
    hasRtcOffer: !!data?.rtcOffer,
    hasRtcAnswer: !!data?.rtcAnswer,
    rtcOfferApplied: state.rtcOfferApplied,
    rtcAnswerApplied: state.rtcAnswerApplied,
    rtcFlowBusy: state.rtcFlowBusy,
    lastSentOfferHash: state.lastSentOfferHash,
    lastAnsweredOfferHash: state.lastAnsweredOfferHash,
    lastAppliedAnswerHash: state.lastAppliedAnswerHash,
  });

  if (!state.sessionId || !state.cameraStream || state.rtcFlowBusy) {
    return;
  }

  const remoteCandidates = getRemoteCandidateList(data);
  if (remoteCandidates.length) {
    await applyRemoteCandidates(remoteCandidates);
  }

  if (state.role === "user1" && data.user2 && !state.rtcOfferApplied) {
    console.log("[LDR signaling] trigger startRtcOffer from handleRtcFlow", {
      pcDebugId: getPcDebugId(state.rtcPeerConnection),
      sessionId: state.sessionId,
      role: state.role,
      hasUser2: !!data.user2,
      rtcOfferApplied: state.rtcOfferApplied,
    });
    await startRtcOffer();
  }

  if (state.role === "user2" && data.rtcOffer) {
    const offerHash = getRtcPayloadFingerprint(data.rtcOffer);
    console.log("[LDR signaling] trigger startRtcAnswer from handleRtcFlow", {
      pcDebugId: getPcDebugId(state.rtcPeerConnection),
      sessionId: state.sessionId,
      role: state.role,
      offerHash,
      lastAnsweredOfferHash: state.lastAnsweredOfferHash,
      isDuplicate: !!(offerHash && offerHash === state.lastAnsweredOfferHash),
    });
    if (offerHash && offerHash !== state.lastAnsweredOfferHash) {
      await startRtcAnswer(data.rtcOffer);
    }
  }

  if (state.role === "user1" && data.rtcAnswer) {
    const answerHash = getRtcPayloadFingerprint(data.rtcAnswer);
    if (answerHash && answerHash !== state.lastAppliedAnswerHash) {
      state.lastAppliedAnswerHash = answerHash;
      state.rtcAnswerApplied = true;
      try {
        const pc = await ensurePeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(data.rtcAnswer));

        if (state.pendingRemoteCandidates.length) {
          await applyRemoteCandidates(state.pendingRemoteCandidates);
          state.pendingRemoteCandidates = [];
        }
      } catch (error) {
        state.rtcAnswerApplied = false;
        console.error("[LDR signaling] Penerapan remote answer gagal:", error);
        showToast("Pasangan sudah mengirim jawaban WebRTC, tapi jawaban gagal dipasang. Coba ulang.");
      }
    }
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
  hideProcessingOverlay();
  clearInterval(state.countdownTimer);

  const endAt = startedAt + totalSeconds * 1000;
  logSync("countdown started", { startedAt, endAt, totalSeconds, sessionId: state.sessionId, role: state.role });

  const tick = () => {
    const remainingMs = endAt - Date.now();
    const nextValue = Math.max(0, Math.ceil(remainingMs / 1000));
    state.countdownValue = nextValue;
    console.log("[LDR countdown] tick", {
      startedAt,
      endAt,
      now: Date.now(),
      remainingMs,
      nextValue,
      role: state.role,
      sessionId: state.sessionId,
    });

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
    showProcessingOverlay("Menyimpan foto...");
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

    updateProcessingOverlay("Menunggu foto pasangan...");
    showToast("Foto berhasil diambil secara bersamaan.");
  } catch (error) {
    console.error("performAutoCapture failed:", error);
    showToast("Gagal mengambil foto otomatis.");
    hideProcessingOverlay();
  } finally {
    state.captureInProgress = false;
    setCaptureBusy(false);
  }
}

function captureLocalVideoToDataUrl() {
  const videoWidth = cameraVideo.videoWidth;
  const videoHeight = cameraVideo.videoHeight;
  const videoContainer = cameraVideo.parentElement;
  const containerWidth = videoContainer?.clientWidth || 0;
  const containerHeight = videoContainer?.clientHeight || 0;

  if (!videoWidth || !videoHeight || !containerWidth || !containerHeight) {
    throw new Error("Video belum siap untuk diambil.");
  }

  const objectFitScale = Math.max(containerWidth / videoWidth, containerHeight / videoHeight);
  const renderedWidth = videoWidth * objectFitScale;
  const renderedHeight = videoHeight * objectFitScale;
  const renderedOffsetX = (containerWidth - renderedWidth) / 2;
  const renderedOffsetY = (containerHeight - renderedHeight) / 2;
  const sourceX = Math.max(0, -renderedOffsetX / objectFitScale);
  const sourceY = Math.max(0, -renderedOffsetY / objectFitScale);
  const sourceWidth = Math.min(videoWidth - sourceX, containerWidth / objectFitScale);
  const sourceHeight = Math.min(videoHeight - sourceY, containerHeight / objectFitScale);

  if (sourceWidth <= 0 || sourceHeight <= 0 || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    throw new Error("Area crop video belum valid.");
  }

  const outputWidth = 1400;
  const outputHeight = 898;
  captureCanvas.width = outputWidth;
  captureCanvas.height = outputHeight;

  const ctx = captureCanvas.getContext("2d");
  ctx.save();
  ctx.translate(outputWidth, 0);
  ctx.scale(-1, 1);
  ctx.clearRect(0, 0, outputWidth, outputHeight);
  ctx.fillStyle = "#f3efe9";
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  ctx.drawImage(
    cameraVideo,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  ctx.restore();

  return captureCanvas.toDataURL("image/jpeg", 0.78);
}

async function handleSessionUpdate(data) {
  if (!data) {
    return;
  }

  if (data.paymentOrderId) {
    listenPayment(data.paymentOrderId);
  }
  if (data.paymentStatus) {
    state.paymentStatus = data.paymentStatus;
  }
  syncPaymentUi();
  renderFramePicker(data);

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
  void ensureSessionTimeLimitStarted(data).catch((error) => {
    console.error("Gagal memulai batas waktu sesi (non-blocking):", error);
  });
  startSessionTimeLimitFromSession(data);

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

  void handleRtcFlow(data).catch((error) => {
    console.error("[LDR signaling] handleRtcFlow gagal (non-blocking):", error);
    showToast("Sesi gagal diproses. Periksa permission Firestore dan signaling WebRTC.");
  });

  if (data.resultImage) {
    hideProcessingOverlay();
    showScreen(resultScreen);
    try {
      await renderResult(data.resultImage);
      resultMessage.textContent = isPaymentPaid() ? "Foto LDR siap diunduh." : "Selesaikan pembayaran untuk mengunduh foto.";
    } catch (error) {
      console.error("[LDR result] Gagal merender ulang hasil dari sesi:", error);
      resultMessage.textContent = isPaymentPaid()
        ? "Pembayaran terkonfirmasi. Gunakan tombol unduh untuk mengambil foto."
        : "Hasil foto tersedia, tetapi preview gagal dimuat.";
      showToast("Preview foto gagal dimuat, tetapi hasil tetap bisa diproses.");
    }
    syncPaymentUi();
    return;
  }

  if (data.user1Photo && data.user2Photo && !data.resultImage) {
    stopRealtimeMediaAfterCapture();
    if (state.role === "user1") {
      updateProcessingOverlay("Menyusun hasil...");
      await buildCombinedResult();
    } else {
      showProcessingOverlay("Menunggu hasil dari pembuat sesi...");
    }
  }
}

async function requestCameraAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Browser ini tidak mendukung akses kamera.");
  }

  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const attempts = [
    {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 1280, min: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: audioConstraints,
    },
    {
      video: { facingMode: "user" },
      audio: audioConstraints,
    },
    {
      video: true,
      audio: audioConstraints,
    },
  ];

  let lastError = null;
  for (const constraint of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraint);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Gagal meminta izin kamera.");
}

async function startCamera() {
  if (state.cameraStream) {
    syncLocalTracksToPeerConnection();
    updateMicUi();
    return;
  }

  try {
    if (!isSecureContextAvailable()) {
      throw new Error("Akses kamera memerlukan HTTPS atau localhost. Buka halaman lewat URL yang aman, bukan via IP LAN/HTTP raw.");
    }

    const stream = await requestCameraAccess();
    state.cameraStream = stream;

    const localAudioTrack = stream.getAudioTracks()[0] || null;
    if (localAudioTrack) {
      localAudioTrack.enabled = state.micEnabled !== false;
    }

    const localVideoTrack = stream.getVideoTracks()[0] || null;
    console.log("[LDR camera] local camera stream ready", {
      hasVideoTrack: !!localVideoTrack,
      readyState: localVideoTrack?.readyState,
      muted: localVideoTrack?.muted,
      enabled: localVideoTrack?.enabled,
      hasAudioTrack: !!localAudioTrack,
      audioEnabled: localAudioTrack?.enabled,
      trackCount: stream.getVideoTracks().length,
      sessionId: state.sessionId,
      role: state.role,
    });

    attachVideoStream(cameraVideo, stream, { muted: true });
    cameraPlaceholder.parentElement.classList.remove("hidden-placeholder");
    cameraPlaceholder.style.display = "none";

    await cameraVideo.play().catch(() => {
      console.warn("Panggilan play() video utama ditolak; preview masih akan terpasang.");
    });

    const localVideoTrackAfterPlay = state.cameraStream.getVideoTracks()[0] || null;
    console.log("[LDR camera] local camera track post-play", {
      hasVideoTrack: !!localVideoTrackAfterPlay,
      readyState: localVideoTrackAfterPlay?.readyState,
      muted: localVideoTrackAfterPlay?.muted,
      enabled: localVideoTrackAfterPlay?.enabled,
      sessionId: state.sessionId,
      role: state.role,
    });

    syncLocalTracksToPeerConnection();
    setPartnerRemoteStream(null);
    updateMicUi();
  } catch (error) {
    console.error(error);
    const detail = describeMediaError(error);
    const browserWarning = isInAppBrowser()
      ? " Buka halaman ini di browser utama Safari/Chrome, bukan in-app browser WhatsApp/Instagram/FB, agar izin kamera dan WebRTC bisa diproses."
      : "";
    const secureContextWarning = !isSecureContextAvailable()
      ? " Pastikan URL memakai HTTPS atau localhost; testing lewat http://IP-lokal sering gagal di iPhone."
      : "";
    showToast(`Kamera tidak dapat diakses (${detail})${browserWarning}${secureContextWarning}`);
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
    state.paymentOrderId = null;
    state.paymentStatus = null;
    state.downloadCompleted = false;
    savePaymentSession();
    roomCode.textContent = payload.code;
    showScreen(waitingScreen);
    void loadAvailableFrames();
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
    state.paymentOrderId = null;
    state.paymentStatus = null;
    state.downloadCompleted = false;
    savePaymentSession();
    roomCode.textContent = code;
    showScreen(waitingScreen);
    void loadAvailableFrames();
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

async function capturePhoto({ fromSessionTimeLimit = false } = {}) {
  if (!state.sessionId || !state.cameraStream) {
    await startCamera();
  }

  if (!state.cameraStream) {
    return;
  }

  if (state.isCountingDown || state.captureInProgress) {
    return;
  }

  if (fromSessionTimeLimit && state.role !== "user1") {
    return;
  }

  const triggerId = `${state.sessionId}:${Date.now()}`;
  const countdownStartedAt = Date.now();
  logSync("capturePhoto triggered", { triggerId, countdownStartedAt, role: state.role, sessionId: state.sessionId });

  state.isCountingDown = true;
  state.captureNonce = triggerId;
  setCaptureBusy(true);

  startSharedCountdownFromSession({
    countdownStartedAt,
    countdownFrom: 5,
  });

  await updateSession({
    status: "countdown",
    action: "countdown",
    countdownStartedAt,
    countdownFrom: 5,
    captureTriggerId: triggerId,
  });

  showToast("Hitung mundur foto dimulai.");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
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

  ctx.drawImage(img, slotX + offsetX, slotY + offsetY, drawWidth, drawHeight);
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

  await drawPhotoSlot(ctx, layout.topSlot.x, layout.topSlot.y, layout.topSlot.w, layout.topSlot.h, topPhoto);
  await drawPhotoSlot(ctx, layout.bottomSlot.x, layout.bottomSlot.y, layout.bottomSlot.w, layout.bottomSlot.h, bottomPhoto);

  const frame = await loadImage(state.sessionData?.selectedFrameImage || "/image/assets/frame-ldr.png");
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);

  state.resultImage = resultDataUrl || canvas.toDataURL("image/jpeg", 0.88);
  resultMessage.textContent = "Foto LDR siap dikirim.";
  syncPaymentUi();
}

async function buildCombinedResult() {
  if (state.role !== "user1" || state.resultBuildInProgress || state.resultBuildCompleted) {
    return;
  }

  const user1Photo = state.sessionData?.user1Photo || null;
  const user2Photo = state.sessionData?.user2Photo || null;
  if (!user1Photo || !user2Photo) {
    return;
  }

  state.resultBuildInProgress = true;

  try {
    await composeResultWithFrame(state.sessionData?.selectedFrameImage || "/image/assets/frame-ldr.png");
    state.resultBuildCompleted = true;
    resultMessage.textContent = "Foto LDR siap diunduh.";
    hideProcessingOverlay();
    showScreen(resultScreen);
  } catch (error) {
    hideProcessingOverlay();
    throw error;
  } finally {
    state.resultBuildInProgress = false;
  }
}

async function composeResultWithFrame(frameImage) {
  const user1Photo = state.sessionData?.user1Photo || null;
  const user2Photo = state.sessionData?.user2Photo || null;
  if (!user1Photo || !user2Photo) {
    throw new Error("Foto pasangan belum lengkap.");
  }

  const layout = getLdrSlotLayout();
  const composite = resultCanvas;
  composite.width = layout.canvasWidth;
  composite.height = layout.canvasHeight;

  const ctx = composite.getContext("2d");
  ctx.clearRect(0, 0, composite.width, composite.height);

  await drawPhotoSlot(ctx, layout.topSlot.x, layout.topSlot.y, layout.topSlot.w, layout.topSlot.h, user1Photo);
  await drawPhotoSlot(ctx, layout.bottomSlot.x, layout.bottomSlot.y, layout.bottomSlot.w, layout.bottomSlot.h, user2Photo);

  const frame = await loadImage(frameImage || "/image/assets/frame-ldr.png");
  ctx.drawImage(frame, 0, 0, composite.width, composite.height);

  const imageDataUrl = composite.toDataURL("image/jpeg", 0.88);
  await updateSession({
    imageDataUrl,
    status: "ready",
    action: "ready",
  });

  state.resultImage = imageDataUrl;
  state.sessionData = {
    ...(state.sessionData || {}),
    resultImage: imageDataUrl,
    status: "ready",
  };
  syncPaymentUi();
  return imageDataUrl;
}

async function rebuildResultWithFrame(frameImage) {
  showProcessingOverlay("Mengganti frame...");
  try {
    await composeResultWithFrame(frameImage);
    resultMessage.textContent = "Foto LDR siap diunduh.";
    showScreen(resultScreen);
    showToast("Frame berhasil diganti.");
  } finally {
    hideProcessingOverlay();
  }
}

function stopRealtimeMediaAfterCapture() {
  if (state.cameraStream) {
    stopCameraStream(state.cameraStream);
    state.cameraStream = null;
  }

  if (cameraVideo) {
    cameraVideo.pause();
    cameraVideo.srcObject = null;
  }

  resetPeerConnection();
}

function resetSession() {
  if (waitingFramePickerHost && framePicker && framePicker.parentElement !== waitingFramePickerHost) {
    waitingFramePickerHost.appendChild(framePicker);
  }

  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  if (state.cameraStream) {
    stopCameraStream(state.cameraStream);
    state.cameraStream = null;
  }

  if (state.rtcPeerConnection) {
    state.rtcPeerConnection.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.replaceTrack(null);
      }
    });
  }

  if (cameraVideo) {
    cameraVideo.pause();
    cameraVideo.srcObject = null;
    configureVideoElement(cameraVideo);
  }

  state.sessionId = null;
  state.role = null;
  state.sessionData = null;
  state.myPhoto = null;
  state.partnerPhoto = null;
  state.resultImage = null;
  state.availableFrames = [];
  state.frameSelectionInProgress = null;
  state.resultFramePickerOpen = false;
  state.resultBuildInProgress = false;
  state.resultBuildCompleted = false;
  state.paymentOrderId = null;
  state.paymentStatus = null;
  state.downloadCompleted = false;
  clearPaymentSession();
  if (state.paymentUnsubscribe) {
    state.paymentUnsubscribe();
    state.paymentUnsubscribe = null;
  }
  state.captureInProgress = false;
  state.captureNonce = null;
  state.countdownStartedAt = null;
  state.countdownValue = 0;
  state.sessionTimeLimitStartedAt = null;
  state.sessionTimeLimitExpired = false;
  state.sessionTimeLimitWarningShown = false;
  state.isCountingDown = false;
  state.lastTriggeredCountdownAt = null;
  setCaptureBusy(false);
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  if (state.sessionTimeLimitTimer) {
    clearInterval(state.sessionTimeLimitTimer);
    state.sessionTimeLimitTimer = null;
  }
  clearCountdownOverlay();
  hideProcessingOverlay();
  resetPeerConnection();

  roomCode.textContent = "------";
  joinCodeInput.value = "";
  captureStatusText.textContent = "Siap mengambil foto";
  if (sessionTimeLimitText) {
    sessionTimeLimitText.hidden = true;
    sessionTimeLimitText.textContent = formatSessionTimeLimit(SESSION_TIME_LIMIT_SECONDS);
    sessionTimeLimitText.classList.remove("warning");
  }
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
frameGrid.addEventListener("click", (event) => {
  const frameButton = event.target.closest("[data-frame-id]");
  if (frameButton) {
    void selectFrame(frameButton.dataset.frameId);
  }
});
joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

captureBtn.addEventListener("click", capturePhoto);
changeFrameBtn.addEventListener("click", () => {
  void toggleResultFramePicker();
});
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
  showToast("Buat sesi lalu bagikan kode ke pasangan. Mic dan kamera dibuka dalam satu izin browser, lalu hasil dapat diunduh langsung.");
});

cameraToggleBtn.addEventListener("click", async () => {
  if (!state.cameraStream) {
    await startCamera();
  }

  const videoTrack = state.cameraStream?.getVideoTracks()[0];
  if (!videoTrack) {
    showToast("Kamera belum tersedia. Coba buka izin kamera ulang.");
    return;
  }

  videoTrack.enabled = !videoTrack.enabled;
  setCameraButtonUi(videoTrack.enabled);
  showToast(videoTrack.enabled ? "Kamera aktif." : "Kamera dimatikan.");
});

micToggleBtn.addEventListener("click", async () => {
  if (!state.cameraStream) {
    await startCamera();
  }

  const audioTrack = state.cameraStream?.getAudioTracks()[0];
  if (!audioTrack) {
    showToast("Browser tidak mendeteksi mikrofon. Cek izin suara lalu coba lagi.");
    return;
  }

  state.micEnabled = !state.micEnabled;
  audioTrack.enabled = state.micEnabled;
  updateMicUi();

  if (state.micEnabled) {
    showToast("Mic aktif.");
  } else {
    showToast("Mic dimatikan.");
  }

  if (partnerVideo && partnerVideo.srcObject) {
    partnerVideo.muted = false;
    partnerVideo.play().catch(() => {
      showToast("Audio partner belum bisa diputar otomatis. Ketuk layar untuk mengaktifkan suara.");
    });
  }
});

downloadBtn.addEventListener("click", downloadPaidResult);

payBtn.addEventListener("click", createPayment);

roomCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode.textContent);
    showToast("Kode sesi berhasil disalin.");
  } catch (error) {
    showToast("Kode sesi: " + roomCode.textContent);
  }
});

$("cancelSessionBtn").addEventListener("click", async () => {
  if (isPaymentPaid() && !state.downloadCompleted) {
    showToast("Unduh hasil foto terlebih dahulu sebelum menutup sesi berbayar.");
    return;
  }

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
  if (isPaymentPaid() && !state.downloadCompleted) {
    showToast("Unduh hasil foto terlebih dahulu sebelum memulai sesi baru.");
    return;
  }

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

function restoreSessionFromStorageOrUrl() {
  const params = new URLSearchParams(window.location.search);
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(paymentStorageKey) || "null");
  } catch (error) {
    stored = null;
  }

  const sessionId = String(params.get("sessionId") || stored?.sessionId || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(sessionId)) {
    syncPaymentUi();
    return;
  }

  state.sessionId = sessionId;
  state.role = stored?.role || "user1";
  state.paymentOrderId = params.get("orderId") || stored?.paymentOrderId || null;
  roomCode.textContent = sessionId;
  savePaymentSession();
  showScreen(waitingScreen);
  listenSession();
  if (state.paymentOrderId) {
    listenPayment(state.paymentOrderId);
  }
  console.log("[LDR payment] Sesi dipulihkan dari URL/localStorage:", { sessionId, orderId: state.paymentOrderId });
  window.history.replaceState({}, "", window.location.pathname);
}

showScreen(startScreen);
restoreSessionFromStorageOrUrl();
