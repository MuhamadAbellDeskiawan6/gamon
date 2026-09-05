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

module.exports = async (req, res) => {
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
};
