import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

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
            
            const resendMatch = envContent.match(/RESEND_API_KEY=['"]?([^'"\s\n]+)['"]?/);
            if (resendMatch && resendMatch[1]) {
                process.env.RESEND_API_KEY = resendMatch[1].trim();
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

        // FIX UTAMA: Menyesuaikan nama field agar dibaca dengan benar oleh index.html bawaan Anda
        // index.html membaca data menggunakan properti: nama, tujuan, pesan, dan waktu.
        await db.collection('gamon').add({
            nama: nama || 'Anonim',       // Menggunakan 'nama' bukan 'senderName'
            tujuan: tujuan || 'Seseorang', // Menggunakan 'tujuan' bukan 'receiverName'
            pesan: pesan || '',           // Menggunakan 'pesan' bukan 'messageContent'
            waktu: timestamp,             // Format timestamp milidetik yang dibutuhkan Firebase manual di index.html Anda
            email: email,
            photoUrl: photoBase64,        // Tetap disimpan sebagai arsip/data pelengkap photobox
            type: 'photobox',             // Sebagai marker jenis kiriman
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
    photoBase64: photoBase64, // Data gambar utama yang akan diambil script printer
    waktu: timestamp,
    isPrinted: false // Penanda bahwa foto ini mengantre untuk dicetak fisik
});

        // Isolasi Base64 untuk attachment email platform Resend
        const base64Content = photoBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error("RESEND_API_KEY bermasalah di Server.");
        }

        // 3. KIRIM SOFTFILE VIA RESEND
        const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'onboarding@resend.dev', 
                to: [email],
                subject: `📸 Polaroid Gamon Tawing - Softfile Cetak Digital untuk ${nama || 'Kamu'}`,
                html: `
                    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 25px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #fffafb; text-align: center;">
                        <h2 style="color: #db2777; margin-bottom: 5px; font-weight: 700; tracking-tight">Gamon Tawing Photobox 📸</h2>
                        <p style="font-size: 14px; color: #64748b; margin-top: 0;">Hai kak! Ini hasil cetak digital Polaroid eksklusif kamu 💌</p>
                        
                        <div style="background: #ffffff; padding: 12px; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); margin: 20px 0; border: 1px solid #f1f5f9;">
                            <img src="data:image/jpeg;base64,${base64Content}" alt="Polaroid Gamon" style="width: 100%; display: block; border-radius: 4px;" />
                        </div>
                        
                        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">Softfile lembaran utuh di atas telah otomatis terbit di peta index utama Gamon Tawing. Simpan file lampiran email ini untuk dicetak ulang menjadi fisik kapan saja!</p>
                    </div>
                `,
                attachments: [
                    {
                        filename: `polaroid-gamon-${timestamp}.jpg`,
                        content: base64Content
                    }
                ]
            })
        });

        const rawResponseText = await emailResponse.text();
        let resendData;
        try {
            resendData = JSON.parse(rawResponseText);
        } catch (e) {
            return res.status(emailResponse.status).json({ message: 'Resend response format invalid.', error: rawResponseText });
        }

        if (!emailResponse.ok) {
            return res.status(emailResponse.status).json({ message: 'Resend API service failure.', error: resendData });
        }

        return res.status(200).json({ success: true, message: 'Sukses menerbitkan data ke index beranda dan mengirim softfile email!' });

    } catch (error) {
        console.error("Internal Server Error:", error.message);
        return res.status(500).json({ message: 'Terjadi kegagalan server internal.', error: error.message });
    }
}