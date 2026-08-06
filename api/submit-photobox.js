import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

/* ======================================
   LOAD .env.local (LOCAL ONLY)
====================================== */

if (!process.env.GMAIL_APP_PASSWORD) {
  try {

    const envPath = path.join(process.cwd(), ".env.local");

    if (fs.existsSync(envPath)) {

      const env = fs.readFileSync(envPath, "utf8");

      const match = env.match(
        /GMAIL_APP_PASSWORD=['"]?([^'"\n\r]+)['"]?/
      );

      if (match) {
        process.env.GMAIL_APP_PASSWORD = match[1].trim();
      }

    }

  } catch(err) {
    console.error(err);
  }
}

/* ======================================================
   FIREBASE ADMIN INIT
====================================================== */

if (!getApps().length) {
  try {
    let serviceAccount;

    // Production (Vercel)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      // Local Development
      const serviceAccountPath = path.join(
        process.cwd(),
        "server",
        "serviceAccountKey.json"
      );

      serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
    }

    initializeApp({
      credential: cert(serviceAccount),
    });

    console.log("Firebase Admin initialized");
  } catch (err) {
    console.error("Firebase Admin Error:", err);
  }
}

/* ======================================================
   API HANDLER
====================================================== */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const {
    nama,
    tujuan,
    pesan,
    email,
    whatsapp,
    alamat,
    koordinat,
    photoBase64,
    audioUrl,
    orderId,
    showOnHome,
    frameId,
    frameName,
    framePreviewImage,
  } = req.body;

  if (!email || !photoBase64 || !alamat || !whatsapp) {
    return res.status(400).json({
      success: false,
      message: "Data wajib belum lengkap.",
    });
  }

  try {
    if (!getApps().length) {
      throw new Error("Firebase belum terinisialisasi");
    }

    const db = getFirestore();

    const timestamp = Date.now();
    const finalOrderId = orderId || `GAMON-${timestamp}`;

    /* ======================================================
       PARSE KOORDINAT
    ====================================================== */

    let lat = -3.3167;
    let lng = 114.5900;

    if (koordinat && koordinat.includes(",")) {
      const parts = koordinat.split(",");
      lat = parseFloat(parts[0].trim()) || lat;
      lng = parseFloat(parts[1].trim()) || lng;
    }

    /* ======================================================
       1. SIMPAN KE photobox_order (WAJIB)
    ====================================================== */

    await db.collection("photobox_order").doc(finalOrderId).set({
      orderId: finalOrderId,
      nama: nama || "Anonim",
      tujuan: tujuan || "Seseorang",
      pesan: pesan || "",
      email,
      whatsapp,
      alamat,
      koordinat: koordinat || "",
      latitude: lat,
      longitude: lng,
      photoBase64,
      audioUrl: audioUrl || null,
      frameId: frameId || null,
      frameName: frameName || null,
      framePreviewImage: framePreviewImage || null,
      showOnHome: showOnHome !== false,
      statusMerchandise: "PENDING_PRODUCTION",
      createdAt: timestamp,
    });

    /* ======================================================
       2. UPDATE / MERGE KE orders
       Sinkron dengan webhook pembayaran
    ====================================================== */

    await db.collection("orders").doc(finalOrderId).set(
      {
        orderId: finalOrderId,
        email,
        whatsapp,
        alamat,
        frameId: frameId || null,
        frameName: frameName || null,
        statusMerchandise: "PENDING_PRODUCTION",
        updatedAt: timestamp,
      },
      { merge: true }
    );

    /* ======================================================
       3. TAMPILKAN DI INDEX JIKA showOnHome = true
    ====================================================== */

    if (showOnHome !== false) {
      await db.collection("gamon").add({
        nama: nama || "Anonim",
        tujuan: tujuan || "Seseorang",
        pesan: pesan || "",
        photoUrl: photoBase64,
        audioUrl: audioUrl || null,
        type: "photobox",
        likes: 0,
        waktu: timestamp,
        latitude: lat,
        longitude: lng,
        showOnHome: true,
        createdAt: timestamp,
      });
    }

    /* ======================================================
       4. KIRIM EMAIL
    ====================================================== */

    if (!process.env.GMAIL_APP_PASSWORD) {
      console.warn("GMAIL_APP_PASSWORD belum diset, email dilewati.");
    } else {
      const base64Content = photoBase64.replace(
        /^data:image\/[a-z]+;base64,/,
        ""
      );

      const baseUrl = process.env.BASE_URL || 'https://gamon-tawing.vercel.app';
      const successUrl = `${baseUrl}/photobox-success.html?orderId=${finalOrderId}`;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "muhamadabelldeskiawan@gmail.com",
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: '"Gamon Tawing Booth" <muhamadabelldeskiawan@gmail.com>',
        to: email,
        subject: `📸 Pesanan Photobox Berhasil - ${finalOrderId}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
            <h2 style="color:#6b5a60;margin-top:0">Pesanan Berhasil 🎉</h2>
            <p>Halo <b>${nama || "Anonim"}</b>,</p>
            <p>Pesanan photobox kamu berhasil diterima dan masuk antrean produksi.</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 0"><b>ID Pesanan</b></td><td style="padding:6px 0">${finalOrderId}</td></tr>
              <tr><td style="padding:6px 0"><b>Penerima</b></td><td style="padding:6px 0">${tujuan || "-"}</td></tr>
              <tr><td style="padding:6px 0"><b>WhatsApp</b></td><td style="padding:6px 0">${whatsapp}</td></tr>
              <tr><td style="padding:6px 0"><b>Frame</b></td><td style="padding:6px 0">${frameName || "Default"}</td></tr>
            </table>

            <p style="margin-bottom:6px"><b>Lokasi Ambil:</b></p>
            <div style="background:#f8f8f8;padding:12px;border-radius:12px;font-size:14px;white-space:pre-wrap">${alamat}</div>
            <p style="font-size:13px;color:#555;margin-top:10px">Silakan datang ke lokasi kami setelah pembayaran dikonfirmasi dengan menunjukkan bukti pesanan.</p>
            <p style="font-size:13px;color:#555;margin-top:10px">
              Jika halaman sukses tertutup, buka kembali tautan ini atau gunakan Order ID berikut:
              <br><a href="${successUrl}" style="color:#2563eb;text-decoration:none">${successUrl}</a>
            </p>

            ${
              audioUrl
                ? '<p style="color:#6d28d9;font-size:14px;margin-top:16px">🎵 Audio berhasil disimpan dan akan diintegrasikan ke QR Code pada desain photobox.</p>'
                : ""
            }

            <p style="font-size:13px;color:#666;margin-top:20px">
              Terima kasih sudah mengabadikan kenangan bersama Gamon Tawing 💜
            </p>
          </div>
        `,
        attachments: [
          {
            filename: `photobox-${finalOrderId}.jpg`,
            content: base64Content,
            encoding: "base64",
          },
        ],
      });
    }

    return res.status(200).json({
      success: true,
      orderId: finalOrderId,
      message: "Pesanan berhasil diproses.",
    });
  } catch (error) {
    console.error("Submit Photobox Error:", error);

    return res.status(500).json({
      success: false,
      message: "Terjadi kegagalan server internal.",
      error: error.message,
    });
  }
}