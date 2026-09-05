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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const code = String(body.code || "").trim().toUpperCase();
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
};
