const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

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
      resultImage: null,
      rtcOffer: null,
      rtcAnswer: null,
      rtcCandidates: [],
      rtcCandidatesUser1: [],
      rtcCandidatesUser2: [],
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
      captureTriggerId,
      rtcOffer,
      rtcAnswer,
      rtcCandidates,
      rtcCandidatesUser1,
      rtcCandidatesUser2,
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

  if (action === "join-session" || action === "join") {
    return joinSessionHandler(req, res, body);
  }

  if (action === "update-session" || action === "update") {
    return updateSessionHandler(req, res, body);
  }

  const keyFields = ["code", "field", "photo", "imageDataUrl", "status", "action", "countdownStartedAt", "countdownFrom", "captureTriggerId"];
  if (keyFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    return updateSessionHandler(req, res, body);
  }

  return res.status(400).json({
    success: false,
    message: "Aksi foto LDR tidak valid. Gunakan action=create-session, join-session, atau update-session.",
  });
};
