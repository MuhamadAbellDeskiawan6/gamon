const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

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

function getEmailTransporter() {
  const emailUser = process.env.GMAIL_USER || process.env.ADMIN_NOTIFY_EMAIL;
  const emailPass = process.env.GMAIL_APP_PASSWORD;

  if (!emailUser || !emailPass) {
    throw new Error("Konfigurasi Gmail app password belum tersedia.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      body = JSON.parse(body);
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
    } = body;

    if (!code) {
      return res.status(400).json({ success: false, message: "Kode kosong." });
    }

    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const ref = db.collection("fotoLdrSessions").doc(code);
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
};