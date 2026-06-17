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
            
            // Mengubah pencarian env menjadi GMAIL_APP_PASSWORD untuk lokal testing
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

    const { nama, tujuan, pesan, email, photoBase64, orderId } = req.body;

    if (!email || !photoBase64) {
        return res.status(400).json({ message: 'Informasi data esensial tidak lengkap.' });
    }

    try {
        const db = getFirestore();
        const timestamp = Date.now();

        // 1. Simpan ke koleksi 'gamon' untuk peta/index utama
        await db.collection('gamon').add({
            nama: nama || 'Anonim',       
            tujuan: tujuan || 'Seseorang', 
            pesan: pesan || '',           
            waktu: timestamp,             
            email: email,
            photoUrl: photoBase64,        
            type: 'photobox',             
            latitude: -3.3167,
            longitude: 114.5900,
            createdAt: new Date(timestamp)
        });

        // 2. REKAPAN BACKUP: Simpan transaksi log ke photobox_order
        await db.collection('photobox_order').add({
            orderId: orderId || 'GAMON-MANUAL',
            nama: nama || '',
            tujuan: tujuan || '',
            pesan: pesan || '',
            email: email,
            photoBase64: photoBase64, 
            waktu: timestamp,
            isPrinted: false 
        });

        // 3. PROSES KIRIM EMAIL VIA NODEMAILER (GMAIL SMTP)
        // Isolasi Base64 untuk lampiran file
        const base64Content = photoBase64.replace(/^data:image\/[a-z]+;base64,/, "");

        // Konfigurasi Transporter SMTP Gmail
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'muhamadabelldeskiawan@gmail.com', // Email Gmail kamu
                pass: process.env.GMAIL_APP_PASSWORD     // 16 digit App Password (wajib diset di Vercel & .env.local)
            }
        });

        // Set Konten dan Target Pengiriman Email
        const mailOptions = {
            from: '"Gamon Tawing Photobox" <muhamadabelldeskiawan@gmail.com>',
            to: email, 
            subject: `📸 Polaroid Gamon Tawing - Softfile Cetak Digital untuk ${nama || 'Kamu'}`,
            html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 25px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #fffafb; text-align: center;">
                    <h2 style="color: #db2777; margin-bottom: 5px; font-weight: 700;">Gamon Tawing Photobox 📸</h2>
                    <p style="font-size: 14px; color: #64748b; margin-top: 0;">Hai kak! Ini hasil cetak digital Polaroid eksklusif kamu 💌</p>
                    <div style="background: #ffffff; padding: 12px; border-radius: 12px; margin: 20px 0; border: 1px solid #f1f5f9;">
                        <p style="font-size: 13px; color: #475569; font-style: italic;">"Foto Polaroid Premium Kamu Telah Terlampir di Email Ini"</p>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">Softfile kamu juga otomatis terbit di peta index utama Gamon Tawing.</p>
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

        // Eksekusi Kirim Email
        await transporter.sendMail(mailOptions);

        return res.status(200).json({ success: true, message: 'Sukses menerbitkan data dan mengirim softfile email!' });

    } catch (error) {
        console.error("Internal Server Error:", error.message);
        return res.status(500).json({ message: 'Terjadi kegagalan server internal.', error: error.message });
    }
}