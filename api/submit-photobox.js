import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "muhamadabelldeskiawan@gmail.com";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const USE_FIREBASE_STORAGE = String(process.env.USE_FIREBASE_STORAGE || "").toLowerCase() === "true";
const PICKUP_LOCATION = "Jl. Kelayan A Gg. Sidodadi No.75 RT.009 RW.001, Kel. Murung Raya, Kec. Banjarmasin Selatan, Kota Banjarmasin";

async function sendTelegramNotification(messageText) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: messageText,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${text}`);
  }
}

async function uploadBase64ToStorage(dataUrl, folderName, fileNamePrefix) {
  if (!dataUrl || !USE_FIREBASE_STORAGE || !process.env.FIREBASE_STORAGE_BUCKET) {
    return null;
  }

  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) {
      return null;
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    const bucket = getStorage().bucket(bucketName);
    const buffer = Buffer.from(match[2], "base64");
    const safeFileName = `${folderName}/${fileNamePrefix}-${Date.now()}`;
    const file = bucket.file(safeFileName);

    await file.save(buffer, {
      metadata: {
        contentType: match[1],
      },
      public: true,
    });

    await file.makePublic();
    return `https://storage.googleapis.com/${bucketName}/${safeFileName}`;
  } catch (error) {
    console.warn(`Storage upload failed for ${folderName}:`, error.message);
    return null;
  }
}

/* ======================================
   LOAD .env.local (LOCAL ONLY)
====================================== */

const loadEnvValue = (envText, key) => {
  const match = envText.match(new RegExp(`${key}=['\"]?([^'\"\n\r]+)['\"]?`));
  return match ? match[1].trim() : null;
};

const envKeysToLoad = [
  "GMAIL_APP_PASSWORD",
  "ADMIN_NOTIFY_EMAIL",
  "BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_SERVICE_ACCOUNT",
];

for (const key of envKeysToLoad) {
  if (!process.env[key]) {
    try {
      const envPath = path.join(process.cwd(), ".env.local");
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, "utf8");
        const value = loadEnvValue(env, key);
        if (value) {
          process.env[key] = value;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
}

/* ======================================================
   FIREBASE ADMIN INIT
====================================================== */

if (!getApps().length) {
  try {
    let serviceAccount;

    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawServiceAccount) {
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch (jsonError) {
        const serviceAccountPath = path.join(
          process.cwd(),
          "server",
          "serviceAccountKey.json"
        );

        if (fs.existsSync(serviceAccountPath)) {
          serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
        } else {
          throw jsonError;
        }
      }
    } else {
      const serviceAccountPath = path.join(
        process.cwd(),
        "server",
        "serviceAccountKey.json"
      );

      serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
    }

    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

    initializeApp({
      credential: cert(serviceAccount),
      ...(storageBucket ? { storageBucket } : {}),
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
    countdownVideoBase64,
    countdownVideoMimeType,
    orderId,
    showOnHome,
    frameId,
    frameName,
    framePreviewImage,
    paymentAmount,
    paymentStatus,
    redeemCode,
    status,
    paidAt,
  } = req.body;

  const normalizedNama = String(nama || '').trim();
  const normalizedTujuan = String(tujuan || '').trim();
  const normalizedPesan = String(pesan || '').trim();
  const guestMode = !normalizedNama && !normalizedTujuan && !normalizedPesan;

  if (!photoBase64 || !alamat) {
    return res.status(400).json({
      success: false,
      message: "Foto dan lokasi pengambilan wajib ada.",
    });
  }

  const safeEmail = email || `guest-${Date.now()}@gamon-tawing.local`;
  const safeWhatsapp = whatsapp || "000000000000";

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

    const normalizedPaymentAmount = Number(paymentAmount) || 0;
    const normalizedPaymentStatus = paymentStatus || status || (normalizedPaymentAmount === 0 ? "PAID" : "PENDING_PAYMENT");

    const photoStorageUrl = await uploadBase64ToStorage(photoBase64, "photobox-softfile", "photo-final");
    const videoStorageUrl = await uploadBase64ToStorage(countdownVideoBase64, "photobox-softfile", "countdown-video");

    await db.collection("photobox_order").doc(finalOrderId).set({
      orderId: finalOrderId,
      nama: normalizedNama,
      tujuan: normalizedTujuan,
      pesan: normalizedPesan,
      email: safeEmail,
      whatsapp: safeWhatsapp,
      alamat,
      koordinat: koordinat || "",
      latitude: lat,
      longitude: lng,
      audioUrl: audioUrl || null,
      countdownVideoMimeType: countdownVideoMimeType || 'video/mp4',
      softfilePhotoUrl: photoStorageUrl || null,
      softfileVideoUrl: videoStorageUrl || null,
      frameId: frameId || null,
      frameName: frameName || null,
      framePreviewImage: framePreviewImage || null,
      showOnHome: showOnHome !== false && !guestMode && Boolean(photoStorageUrl),
      amount: normalizedPaymentAmount,
      paymentStatus: normalizedPaymentStatus,
      status: normalizedPaymentStatus,
      redeemCode: redeemCode || null,
      paidAt: paidAt || null,
      statusMerchandise: "PENDING_PRODUCTION",
      createdAt: timestamp,
    }, { merge: true });

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
        amount: normalizedPaymentAmount,
        paymentStatus: normalizedPaymentStatus,
        status: normalizedPaymentStatus,
        redeemCode: redeemCode || null,
        paidAt: paidAt || null,
        statusMerchandise: "PENDING_PRODUCTION",
        updatedAt: timestamp,
      },
      { merge: true }
    );

    /* ======================================================
       3. TAMPILKAN DI INDEX JIKA showOnHome = true
    ====================================================== */

    if (showOnHome !== false && !guestMode && photoStorageUrl) {
      await db.collection("gamon").add({
        nama: normalizedNama,
        tujuan: normalizedTujuan,
        pesan: normalizedPesan,
        photoUrl: photoStorageUrl,
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

      const decodeDataUrl = (dataUrl, fallbackExt = 'dat', fallbackMime = 'application/octet-stream') => {
        if (!dataUrl || typeof dataUrl !== 'string') return null;

        const normalized = dataUrl.trim();
        const base64Payload = normalized.startsWith('data:')
          ? normalized
          : `data:${fallbackMime};base64,${normalized.replace(/\s+/g, '')}`;

        const marker = ';base64,';
        const markerIndex = base64Payload.indexOf(marker);
        if (markerIndex === -1) {
          return null;
        }

        const header = base64Payload.slice(5, markerIndex);
        const mimeType = (header.split(';').find((part) => !part.includes('=')) || fallbackMime).trim();
        const content = base64Payload.slice(markerIndex + marker.length);

        if (!content) {
          return null;
        }

        let fileExt = fallbackExt;

        if (mimeType.includes('video')) {
          if (mimeType.includes('webm')) fileExt = 'webm';
          else if (mimeType.includes('mp4')) fileExt = 'mp4';
          else if (mimeType.includes('quicktime')) fileExt = 'mov';
          else if (mimeType.includes('x-matroska')) fileExt = 'mkv';
        } else if (mimeType.includes('image')) {
          fileExt = 'jpg';
        }

        return {
          mimeType,
          fileExt,
          content,
        };
      };

      const videoAttachmentPayload = decodeDataUrl(
        countdownVideoBase64,
        'mp4',
        countdownVideoMimeType || 'video/mp4'
      );

      console.log('PHOTOBOX_EMAIL_DEBUG', {
        hasPhoto: Boolean(photoBase64),
        hasVideo: Boolean(countdownVideoBase64),
        videoLength: String(countdownVideoBase64 || '').length,
        videoMime: countdownVideoMimeType || 'video/mp4',
        attachmentVideoAttached: Boolean(videoAttachmentPayload),
      });
      const finalPhotoDownloadUrl = photoStorageUrl || null;
      const countdownVideoDownloadUrl = videoStorageUrl || null;

      const baseUrl = process.env.BASE_URL || 'https://gamon-tawing.vercel.app';
      const successUrl = `${baseUrl}/photobox-success.html?orderId=${finalOrderId}`;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "muhamadabelldeskiawan@gmail.com",
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      const customerDisplayName = normalizedNama || (safeEmail ? safeEmail.split('@')[0] : 'Customer');

      await transporter.sendMail({
        from: '"Gamon Tawing Booth" <muhamadabelldeskiawan@gmail.com>',
        to: email,
        subject: `📸 Pesanan Photobox Berhasil - ${finalOrderId}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
            <h2 style="color:#6b5a60;margin-top:0">Pesanan Berhasil 🎉</h2>
            <p>Halo <b>${customerDisplayName}</b>,</p>
            <p>Pesanan photobox kamu berhasil diterima dan masuk antrean produksi.</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 0"><b>ID Pesanan</b></td><td style="padding:6px 0">${finalOrderId}</td></tr>
              <tr><td style="padding:6px 0"><b>Nama Pasangan</b></td><td style="padding:6px 0">${normalizedTujuan || "-"}</td></tr>
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

            <p style="color:#6d28d9;font-size:14px;margin-top:16px">
              📸 Softfile Anda sudah termasuk foto final dan video momen countdown 5 detik yang dibuat dengan frame photobox yang sama.
            </p>

            ${finalPhotoDownloadUrl ? `<p style="font-size:13px;margin-top:14px"><a href="${finalPhotoDownloadUrl}" style="color:#2563eb;text-decoration:none">Unduh foto final</a></p>` : ''}
            ${countdownVideoDownloadUrl ? `<p style="font-size:13px;margin-top:6px"><a href="${countdownVideoDownloadUrl}" style="color:#2563eb;text-decoration:none">Unduh video countdown 5 detik</a></p>` : ''}

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
          ...(videoAttachmentPayload
            ? [{
                filename: `photobox-${finalOrderId}-countdown.${videoAttachmentPayload.fileExt}`,
                content: videoAttachmentPayload.content,
                encoding: "base64",
              }]
            : []),
        ],
      });

      // Notifikasi khusus admin bahwa ada order baru yang perlu disiapkan.
      await transporter.sendMail({
        from: '"Notifier Gamon Booth" <muhamadabelldeskiawan@gmail.com>',
        to: ADMIN_EMAIL,
        subject: `🔔 Pesanan Masuk - ${finalOrderId}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
            <h2 style="margin-top:0;color:#111827">Halo Abell, ada pesanan masuk nihhhh 📸</h2>
            <p style="color:#374151">Segera siapkan merchandise photobox untuk pickup.</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 0"><b>Order ID</b></td><td style="padding:6px 0">${finalOrderId}</td></tr>
              <tr><td style="padding:6px 0"><b>Nama Kamu</b></td><td style="padding:6px 0">${normalizedNama || "-"}</td></tr>
              <tr><td style="padding:6px 0"><b>Nama Pasangan</b></td><td style="padding:6px 0">${normalizedTujuan || "-"}</td></tr>
              <tr><td style="padding:6px 0"><b>WhatsApp</b></td><td style="padding:6px 0">${whatsapp || "-"}</td></tr>
              <tr><td style="padding:6px 0"><b>Email</b></td><td style="padding:6px 0">${email || "-"}</td></tr>
              <tr><td style="padding:6px 0"><b>Frame</b></td><td style="padding:6px 0">${frameName || "Default"}</td></tr>
            </table>

            <p style="margin-bottom:6px"><b>Lokasi Pickup:</b></p>
            <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:13px;color:#334155;line-height:1.5">${PICKUP_LOCATION}</div>
            <p style="font-size:12px;color:#64748b;margin-top:14px">Masuk dari sistem Gamon Tawing otomatis.</p>
          </div>
        `,
      });
    }

    try {
      const telegramMessage = [
        "Halo Abell, ada pesanan masuk nihhhh 📸",
        `Order ID: ${finalOrderId}`,
        `Nama Kamu: ${normalizedNama || "-"}`,
        `Nama Pasangan: ${normalizedTujuan || "-"}`,
        `WA: ${whatsapp || "-"}`,
        `Frame: ${frameName || "Default"}`,
        "Status: PENDING PRODUCTION",
      ].join("\n");
      await sendTelegramNotification(telegramMessage);
    } catch (notifyError) {
      console.warn("Telegram notification failed:", notifyError.message);
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