import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

// Load Environment secara manual untuk environment lokal development
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const envPath = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            
            const firebaseMatch = envContent.match(/FIREBASE_SERVICE_ACCOUNT=['"]({[\s\S]*?})['"]/);
            if (firebaseMatch && firebaseMatch[1]) {
                process.env.FIREBASE_SERVICE_ACCOUNT = firebaseMatch[1].trim();
            }
            
            const gmailMatch = envContent.match(/GMAIL_APP_PASSWORD=['"]?([^'"\s\n]+)['"]?/);
            if (gmailMatch && gmailMatch[1]) {
                process.env.GMAIL_APP_PASSWORD = gmailMatch[1].trim();
            }
        }
    } catch (err) {
        console.error("Gagal memuat konfigurasi lokal:", err.message);
    }
}

// Inisialisasi Firebase Admin
if (!getApps().length) {
    try {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
            throw new Error("Variabel FIREBASE_SERVICE_ACCOUNT tidak ditemukan.");
        }
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
    } catch (error) {
        console.error("Firebase Admin Error:", error.message);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // 1. Destructuring data dengan menyertakan input pengiriman merchandise baru
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
        showOnHome
    } = req.body;

    if (!email || !photoBase64 || !alamat || !whatsapp) {
        return res.status(400).json({ message: 'Informasi esensial atau data alamat pengiriman tidak lengkap.' });
    }

    try {
        const db = getFirestore();
        const timestamp = Date.now();
        const finalOrderId = orderId || 'GAMON-' + timestamp;

        // Ekstrak nilai latitude & longitude dari pin-point GPS jika tersedia
        let lat = -3.3167; // Default koordinat
        let lng = 114.5900;
        if (koordinat && koordinat.includes(',')) {
            const parts = koordinat.split(',');
            lat = parseFloat(parts[0].trim()) || lat;
            lng = parseFloat(parts[1].trim()) || lng;
        }

        // 2. Simpan ke koleksi 'gamon' untuk peta / index utama platform
        await db.collection('gamon').add({
            nama: nama || 'Anonim',       
            tujuan: tujuan || 'Seseorang', 
            pesan: pesan || '',           
            waktu: timestamp,             
            email: email,
            whatsapp: whatsapp,
            alamat: alamat,
            photoUrl: photoBase64,        
            audioUrl: audioUrl || null, 
            type: 'photobox',             
            latitude: lat,
            longitude: lng,
            showOnHome: showOnHome !== false,
            createdAt: new Date(timestamp)
        });

        // 3. Simpan atau perbarui log transaksi di doc 'orders' berdasarkan ID unik pembayaran/transaksi
        // Menggunakan doc(finalOrderId) agar tersinkronisasi dengan status PAID dari webhook payment gateway
        const orderRef = db.collection('orders').doc(finalOrderId);
        await orderRef.set({
            orderId: finalOrderId,
            nama: nama || 'Anonim',
            tujuan: tujuan || 'Seseorang',
            pesan: pesan || '',
            email: email,
            whatsapp: whatsapp,
            alamat: alamat,
            koordinat: koordinat || '',
            photoBase64: photoBase64, 
            audioBase64: audioUrl || null,
            showOnHome: showOnHome !== false,
            timestamp: new Date(timestamp).toISOString(),
            statusMerchandise: "PENDING_PRODUCTION" // Status alur kerja untuk diproses di panel Admin
        }, { merge: true });

        // 4. PROSES KIRIM EMAIL VIA NODEMAILER (GMAIL SMTP)
        const base64Content = photoBase64.replace(/^data:image\/[a-z]+;base64,/, "");

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'muhamadabelldeskiawan@gmail.com',
                pass: process.env.GMAIL_APP_PASSWORD     
            }
        });

        const mailOptions = {
            from: '"Gamon Tawing Booth" <muhamadabelldeskiawan@gmail.com>',
            to: email, 
            subject: `📸 Polaroid & Merchandise Gantungan Kunci Terdaftar! - ${nama || 'Kamu'}`,
            html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 25px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #fffafb; text-align: left;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #db2777; margin-bottom: 5px; font-weight: 700;">Gamon Booth 📸</h2>
                        <p style="font-size: 14px; color: #64748b; margin-top: 0;">Kenangan virtual & fisikmu telah aman tersimpan!</p>
                    </div>
                    
                    <div style="background: #ffffff; padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #f1f5f9;">
                        <p style="font-size: 13px; color: #475569; margin: 0 0 8px 0;"><strong>ID Pesanan:</strong> ${finalOrderId}</p>
                        <p style="font-size: 13px; color: #475569; margin: 0 0 8px 0;"><strong>Softfile Digital:</strong> Telah kami lampirkan di bawah ini.</p>
                        ${audioUrl ? '<p style="font-size: 13px; color: #db2777; font-weight: bold; margin: 0;">🎵 QR Code berisi pesan suara (VN) telah terintegrasi di dalam desain Polaroid!</p>' : ''}
                    </div>

                    <div style="background: #fff5f7; padding: 15px; border-radius: 12px; border: 1px solid #fce4ec; margin-bottom: 20px;">
                        <h4 style="color: #c2185b; margin: 0 0 8px 0; font-size: 14px;">📦 Info Pengiriman Gantungan Kunci Fisik:</h4>
                        <p style="font-size: 12px; color: #5c5c5c; margin: 0 0 4px 0;"><strong>Alamat Rumah:</strong> ${alamat}</p>
                        <p style="font-size: 12px; color: #5c5c5c; margin: 0;"><strong>No. WhatsApp:</strong> ${whatsapp}</p>
                    </div>
                    
                    <p style="font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5; margin: 0;">
                        Gantungan kunci fisik Polaroid Anda akan masuk antrean cetak dan segera dirakit oleh tim Admin kami. Terima kasih sudah mengabadikan ceritamu!
                    </p>
                </div>
            `,
            attachments: [
                {
                    filename: `polaroid-gamon-${timestamp}.jpg`,
                    content: base64Content,
                    encoding: 'base64' 
                }
            ]
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({ success: true, message: 'Sukses mendaftarkan pengiriman merchandise dan mengirim email softfile!' });

    } catch (error) {
        console.error("Internal Server Error:", error.message);
        return res.status(500).json({ message: 'Terjadi kegagalan server internal.', error: error.message });
    }
}