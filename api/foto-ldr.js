const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const SESSION_TIME_LIMIT_SECONDS = 60;
const LDR_PAYMENT_AMOUNT = 2000;
const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID || process.env.DOKU_PRODUCTION_CLIENT_ID || "BRN-0226-1781255193170";
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY || process.env.DOKU_PRODUCTION_SECRET_KEY || "SK-NgMsKzkHcLlY95v7wsju";
const DOKU_NOTIFICATION_URL = process.env.DOKU_WEBHOOK_BASE_URL
  ? `${String(process.env.DOKU_WEBHOOK_BASE_URL).replace(/\/$/, "")}/api/doku-notify`
  : "https://gamon-tawing.vercel.app/api/doku-notify";
const DOKU_RETURN_ORIGIN = String(process.env.PUBLIC_APP_URL || "https://gamon-tawing.vercel.app").replace(/\/$/, "");

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount = null;

    if (raw) {
      try {
        serviceAccount = JSON.parse(raw);
      } catch (error) {
        console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON:", error);
      }
    }

    if (!serviceAccount) {
      const fallbackPath = path.join(process.cwd(), "server", "serviceAccountKey.json");
      if (fs.existsSync(fallbackPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
      }
    }

    if (!serviceAccount) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT belum diatur.");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin;
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizeAction(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase().replace(/_/g, "-");
}

async function getIceServersHandler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const appName = String(process.env.METERED_APP_NAME || "").trim();
  const apiKey = String(process.env.METERED_API_KEY || "").trim();

  if (!appName || !apiKey) {
    console.error("[LDR TURN] TIDAK AKTIF: METERED_APP_NAME atau METERED_API_KEY belum diatur.");
    return res.status(503).json({ success: false, turnConfigured: false, message: "TURN belum dikonfigurasi di server." });
  }

  try {
    const url = `https://${encodeURIComponent(appName)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    const rawBody = await response.text();
    console.log("[LDR TURN] Respons Metered:", {
      status: response.status,
      ok: response.ok,
      bodyLogged: !response.ok,
      body: response.ok ? "[disembunyikan untuk mencegah kebocoran kredensial TURN]" : rawBody.slice(0, 2000),
    });

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("[LDR TURN] Respons Metered bukan JSON valid.", {
        status: response.status,
        body: rawBody.slice(0, 2000),
      });
      return res.status(502).json({
        success: false,
        turnConfigured: false,
        message: "Respons provider TURN tidak valid.",
      });
    }

    const iceServers = Array.isArray(payload) ? payload : payload.iceServers;
    const hasTurn = Array.isArray(iceServers) && iceServers.some((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.some((value) => String(value || "").toLowerCase().startsWith("turn:"));
    });

    if (!response.ok || !hasTurn) {
      console.error("[LDR TURN] TIDAK AKTIF: respons Metered tidak berisi TURN.", {
        status: response.status,
        hasTurn,
      });
      return res.status(502).json({
        success: false,
        turnConfigured: false,
        message: response.ok ? "Provider TURN tidak mengembalikan server TURN." : "Provider TURN menolak permintaan.",
      });
    }

    console.log("[LDR TURN] AKTIF: kredensial TURN berhasil diambil dari Metered.");
    return res.status(200).json({ success: true, turnConfigured: true, iceServers });
  } catch (error) {
    console.error("[LDR TURN] TIDAK AKTIF: gagal mengambil kredensial Metered.", error.message);
    return res.status(502).json({ success: false, turnConfigured: false, message: "Gagal mengambil kredensial TURN." });
  }
}

async function listFramesHandler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const firebaseAdmin = getFirebaseAdmin();
    console.log("[LDR frames] Mengambil collection ldr_frames dengan orderBy createdAt desc.");
    const snapshot = await firebaseAdmin.firestore()
      .collection("ldr_frames")
      .orderBy("createdAt", "desc")
      .get();
    const rawFrames = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    console.log("[LDR frames] Jumlah dokumen mentah:", rawFrames.length);
    console.log("[LDR frames] Contoh dokumen mentah:", rawFrames.slice(0, 2).map((frame) => ({
      id: frame.id,
      fields: Object.keys(frame),
      values: Object.fromEntries(Object.entries(frame).map(([key, value]) => {
        if (typeof value === "string" && value.length > 200) {
          return [key, `${value.slice(0, 200)}... [${value.length} karakter]`];
        }
        return [key, value];
      })),
      fieldTypes: Object.fromEntries(Object.entries(frame).map(([key, value]) => [key, typeof value])),
    })));

    const frames = rawFrames
      .filter((frame) => frame.isActive)
      .map((frame) => ({
        id: frame.id,
        name: frame.name || "Frame",
        previewImage: frame.previewImage,
        frameImage: frame.frameImage,
      }));

    return res.status(200).json({ success: true, frames });
  } catch (error) {
    console.error("[LDR frames] Query photobox_frames gagal. Kemungkinan penyebab termasuk dokumen tanpa createdAt yang membuat orderBy gagal, atau kredensial/permission Firebase Admin.", error);
    return res.status(500).json({
      success: false,
      frames: [],
      message: error.message || "Gagal mengambil daftar frame.",
    });
  }
}

function generateLdrOrderId(sessionId) {
  return `LDR-${sessionId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function getDokuTimestamp() {
  return new Date().toISOString().split(".")[0] + "Z";
}

function createDokuSignature({ orderId, timestamp, digest }) {
  const component = [
    `Client-Id:${DOKU_CLIENT_ID}`,
    `Request-Id:${orderId}`,
    `Request-Timestamp:${timestamp}`,
    "Request-Target:/checkout/v1/payment",
    `Digest:${digest}`,
  ].join("\n");

  return crypto.createHmac("sha256", DOKU_SECRET_KEY).update(component).digest("base64");
}

async function createPaymentHandler(req, res, body = {}) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const sessionId = String(body.sessionId || body.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(sessionId)) {
      return res.status(400).json({ success: false, message: "Sesi Foto LDR tidak valid." });
    }

    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const sessionRef = db.collection("fotoLdrSessions").doc(sessionId);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
      return res.status(404).json({ success: false, message: "Sesi Foto LDR tidak ditemukan." });
    }

    const sessionData = sessionSnapshot.data() || {};
    if (!sessionData.resultImage) {
      return res.status(409).json({ success: false, message: "Hasil foto belum siap dibayar." });
    }
    if (sessionData.paymentStatus === "PAID") {
      return res.status(409).json({ success: false, message: "Sesi ini sudah dibayar." });
    }

    if (sessionData.paymentStatus === "PENDING" && sessionData.paymentOrderId) {
      const pendingOrderSnapshot = await db.collection("ldr_order").doc(sessionData.paymentOrderId).get();
      const pendingOrder = pendingOrderSnapshot.exists ? pendingOrderSnapshot.data() || {} : {};
      if (pendingOrder.checkoutUrl) {
        console.log("[LDR payment] Memakai ulang checkout PENDING:", { orderId: sessionData.paymentOrderId, sessionId });
        return res.status(200).json({
          success: true,
          orderId: sessionData.paymentOrderId,
          response: { payment: { url: pendingOrder.checkoutUrl } },
        });
      }
      return res.status(409).json({ success: false, message: "Pembayaran sedang diproses. Coba lagi sebentar." });
    }

    const orderId = generateLdrOrderId(sessionId);
    const now = Date.now();
      await db.runTransaction(async (transaction) => {
        const currentSessionSnapshot = await transaction.get(sessionRef);
        const currentSessionData = currentSessionSnapshot.data() || {};
        if (currentSessionData.paymentStatus === "PAID") {
          throw new Error("Sesi ini sudah dibayar.");
        }
        if (currentSessionData.paymentStatus === "PENDING" && currentSessionData.paymentOrderId) {
          throw new Error("Pembayaran sedang diproses di tab lain.");
        }

        transaction.set(db.collection("ldr_order").doc(orderId), {
          orderId,
          product: "foto-ldr",
          sessionId,
          amount: LDR_PAYMENT_AMOUNT,
          status: "PENDING",
          paymentStatus: "PENDING",
          paymentEnvironment: "production",
          resultImage: currentSessionData.resultImage || sessionData.resultImage,
          frameId: currentSessionData.selectedFrameId || sessionData.selectedFrameId || null,
          createdAt: now,
          updatedAt: now,
        });
        transaction.update(sessionRef, {
          paymentOrderId: orderId,
          paymentStatus: "PENDING",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

    const timestamp = getDokuTimestamp();
    const returnUrl = `${DOKU_RETURN_ORIGIN}/foto-ldr.html?sessionId=${encodeURIComponent(sessionId)}&orderId=${encodeURIComponent(orderId)}`;
    const requestBody = {
      order: {
        amount: LDR_PAYMENT_AMOUNT,
        invoice_number: orderId,
        callback_url: returnUrl,
      },
      payment: {
        payment_due_date: 60,
        return_url: returnUrl,
        payment_method_types: ["QRIS"],
      },
      additional_info: {
        override_notification_url: DOKU_NOTIFICATION_URL,
      },
    };
    const jsonBody = JSON.stringify(requestBody);
    const digest = crypto.createHash("sha256").update(jsonBody).digest("base64");
    const signature = createDokuSignature({ orderId, timestamp, digest });

    console.log("[LDR payment] Membuat checkout DOKU:", { orderId, sessionId, amount: LDR_PAYMENT_AMOUNT });
    const response = await fetch("https://api.doku.com/checkout/v1/payment", {
      method: "POST",
      headers: {
        "Client-Id": DOKU_CLIENT_ID,
        "Request-Id": orderId,
        "Request-Timestamp": timestamp,
        "Request-Target": "/checkout/v1/payment",
        Digest: digest,
        Signature: `HMACSHA256=${signature}`,
        "Content-Type": "application/json",
      },
      body: jsonBody,
    });
    const rawText = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      payload = { raw: rawText };
    }

    if (!response.ok || !payload.response?.payment?.url) {
      await db.collection("ldr_order").doc(orderId).set({
        status: "FAILED",
        paymentStatus: "FAILED",
        paymentError: payload.message || payload.error || "DOKU tidak mengembalikan URL checkout.",
        updatedAt: Date.now(),
      }, { merge: true });
      await sessionRef.set({ paymentStatus: "FAILED", updatedAt: Date.now() }, { merge: true });
      return res.status(response.status || 502).json(payload);
    }

    await db.collection("ldr_order").doc(orderId).set({
      checkoutUrl: payload.response.payment.url,
      updatedAt: Date.now(),
    }, { merge: true });
    return res.status(200).json({ success: true, orderId, response: payload.response });
  } catch (error) {
    console.error("[LDR payment] Gagal membuat pembayaran:", error);
    return res.status(500).json({ success: false, message: error.message || "Gagal membuat pembayaran Foto LDR." });
  }
}

async function downloadResultHandler(req, res, body = {}) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const orderId = String(req.query?.orderId || body.orderId || "").trim();
    if (!/^LDR-[A-Z0-9]{6}-\d+-[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ success: false, message: "Order Foto LDR tidak valid." });
    }

    const firebaseAdmin = getFirebaseAdmin();
    const snapshot = await firebaseAdmin.firestore().collection("ldr_order").doc(orderId).get();
    const order = snapshot.exists ? snapshot.data() || {} : null;
    if (!order || order.paymentStatus !== "PAID" || order.status !== "PAID") {
      return res.status(403).json({ success: false, message: "Pembayaran belum terkonfirmasi." });
    }
    if (!order.resultImage) {
      return res.status(404).json({ success: false, message: "Hasil foto tidak tersedia." });
    }

    return res.status(200).json({ success: true, resultImage: order.resultImage });
  } catch (error) {
    console.error("[LDR payment] Validasi download gagal:", error);
    return res.status(500).json({ success: false, message: "Gagal memvalidasi akses download." });
  }
}

function resolveAction(req, body = {}) {
  const candidates = [
    req?.query?.action,
    req?.query?.path,
    req?.body?.action,
    req?.body?.path,
    body?.action,
    body?.path,
    req?.headers?.["x-action"],
  ];

  for (const item of candidates) {
    const action = normalizeAction(item);
    if (action) {
      return action;
    }
  }

  const rawUrl = String(req?.url || "");
  const match = rawUrl.match(/\/foto-ldr(?:\/|%2F)?([^/?]+)/i);
  if (match && match[1]) {
    return normalizeAction(match[1]);
  }

  return "";
}

async function createSessionHandler(req, res, body = {}) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const code = generateCode();

    await db.collection("fotoLdrSessions").doc(code).set({
      code,
      status: "waiting",
      user1: true,
      user2: false,
      user1Photo: null,
      user2Photo: null,
      selectedFrameId: null,
      selectedFrameImage: null,
      resultImage: null,
      rtcOffer: null,
      rtcAnswer: null,
      rtcCandidates: [],
      rtcCandidatesUser1: [],
      rtcCandidatesUser2: [],
      sessionTimeLimitStartedAt: null,
      sessionTimeLimitSeconds: SESSION_TIME_LIMIT_SECONDS,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: Date.now() + (30 * 60 * 1000),
    });

    return res.status(200).json({ success: true, code });
  } catch (error) {
    console.error("Create foto LDR session failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal membuat sesi foto LDR.",
    });
  }
}

async function joinSessionHandler(req, res, body = {}) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    let payload = body || {};
    if (typeof payload === "string") {
      payload = JSON.parse(payload);
    }

    const code = String(payload.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Kode sesi tidak valid." });
    }

    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const ref = db.collection("fotoLdrSessions").doc(code);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return res.status(404).json({ success: false, message: "Sesi tidak ditemukan." });
    }

    const data = snapshot.data();
    if (data.user2) {
      return res.status(409).json({ success: false, message: "Sesi sudah penuh." });
    }

    await ref.update({
      user2: true,
      status: "connected",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, code });
  } catch (error) {
    console.error("Join foto LDR session failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal bergabung ke sesi foto LDR.",
    });
  }
}

async function updateSessionHandler(req, res, body = {}) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    let payload = body || {};
    if (typeof payload === "string") {
      payload = JSON.parse(payload);
    }

    const {
      code,
      field,
      photo,
      imageDataUrl,
      status,
      action,
      countdownStartedAt,
      countdownFrom,
      sessionTimeLimitStartedAt,
      sessionTimeLimitSeconds,
      captureTriggerId,
      rtcOffer,
      rtcAnswer,
      rtcCandidates,
      rtcCandidatesUser1,
      rtcCandidatesUser2,
      selectedFrameId,
      selectedFrameImage,
    } = payload;

    if (!code) {
      return res.status(400).json({ success: false, message: "Kode kosong." });
    }

    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const ref = db.collection("fotoLdrSessions").doc(code);
    const snapshot = await ref.get();
    const existing = snapshot.exists ? snapshot.data() || {} : {};
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (field && (field === "user1Photo" || field === "user2Photo")) {
      if (photo === null || typeof photo === "string") {
        updates[field] = photo || null;
      } else {
        return res.status(400).json({ success: false, message: "Format foto tidak valid." });
      }
    }

    if (typeof imageDataUrl === "string") {
      updates.resultImage = imageDataUrl;
    }

    if (typeof status === "string") {
      updates.status = status;
    }

    if (selectedFrameId === null || typeof selectedFrameId === "string") {
      updates.selectedFrameId = selectedFrameId || null;
    }

    if (selectedFrameImage === null || typeof selectedFrameImage === "string") {
      updates.selectedFrameImage = selectedFrameImage || null;
    }

    if (typeof action === "string") {
      updates.action = action;
    }

    if (rtcOffer && typeof rtcOffer === "object") {
      updates.rtcOffer = rtcOffer;
    }

    if (rtcAnswer && typeof rtcAnswer === "object") {
      updates.rtcAnswer = rtcAnswer;
    }

    const appendUniqueArray = (fieldName, incoming) => {
      if (!Array.isArray(incoming)) {
        return;
      }

      const base = Array.isArray(existing[fieldName]) ? existing[fieldName] : [];
      const seen = new Set(base.map((item) => JSON.stringify(item)));
      const merged = [...base];

      for (const item of incoming) {
        if (!item) {
          continue;
        }

        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }

      updates[fieldName] = merged;
    };

    if (Array.isArray(rtcCandidates)) {
      appendUniqueArray("rtcCandidates", rtcCandidates);
    }

    if (Array.isArray(rtcCandidatesUser1)) {
      appendUniqueArray("rtcCandidatesUser1", rtcCandidatesUser1);
    }

    if (Array.isArray(rtcCandidatesUser2)) {
      appendUniqueArray("rtcCandidatesUser2", rtcCandidatesUser2);
    }

    if (countdownStartedAt !== undefined && countdownStartedAt !== null) {
      updates.countdownStartedAt = Number(countdownStartedAt);
    }

    if (countdownFrom !== undefined && countdownFrom !== null) {
      updates.countdownFrom = Number(countdownFrom);
    }

    if (sessionTimeLimitStartedAt !== undefined && sessionTimeLimitStartedAt !== null) {
      updates.sessionTimeLimitStartedAt = Number(sessionTimeLimitStartedAt);
    }

    if (sessionTimeLimitSeconds !== undefined && sessionTimeLimitSeconds !== null) {
      updates.sessionTimeLimitSeconds = Number(sessionTimeLimitSeconds);
    }

    if (captureTriggerId !== undefined && captureTriggerId !== null) {
      updates.captureTriggerId = String(captureTriggerId);
    }

    await ref.update(updates);

    return res.status(200).json({ success: true, code });
  } catch (error) {
    console.error("Update foto LDR session failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal memperbarui sesi foto LDR.",
    });
  }
}

module.exports = async function handler(req, res) {
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      console.error("Failed parsing foto LDR body:", error);
      body = {};
    }
  }

  const action = resolveAction(req, body);

  if (action === "create-session" || action === "create") {
    return createSessionHandler(req, res, body);
  }

  if (action === "ice-servers" || action === "turn-credentials") {
    return getIceServersHandler(req, res);
  }

  if (action === "list-frames") {
    return listFramesHandler(req, res);
  }

  if (action === "create-payment" || action === "payment") {
    return createPaymentHandler(req, res, body);
  }

  if (action === "download-result" || action === "download") {
    return downloadResultHandler(req, res, body);
  }

  if (action === "join-session" || action === "join") {
    return joinSessionHandler(req, res, body);
  }

  if (action === "update-session" || action === "update") {
    return updateSessionHandler(req, res, body);
  }

  const keyFields = ["code", "field", "photo", "imageDataUrl", "status", "action", "countdownStartedAt", "countdownFrom", "sessionTimeLimitStartedAt", "sessionTimeLimitSeconds", "captureTriggerId", "selectedFrameId", "selectedFrameImage"];
  if (keyFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    return updateSessionHandler(req, res, body);
  }

  return res.status(400).json({
    success: false,
    message: "Aksi foto LDR tidak valid. Gunakan action=create-session, join-session, atau update-session.",
  });
};
