import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function getDb() {
    if (!getApps().length) {
        let serviceAccount;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            let envVal = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (envVal.startsWith('"') && envVal.endsWith('"')) {
                envVal = envVal.slice(1, -1);
            }
            serviceAccount = JSON.parse(envVal);
        } else {
            try {
                const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
                if (fs.existsSync(keyPath)) {
                    serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                }
            } catch (e) {
                console.error("Gagal membaca file serviceAccountKey.json lokal:", e.message);
            }
        }
        if (!serviceAccount) {
            throw new Error("Kredensial Firebase tidak ditemukan!");
        }
        initializeApp({ credential: cert(serviceAccount) });
    }
    return getFirestore();
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Nomor HP wajib diisi' });
    }

    try {
        const db = getDb();
        
        // Cari voucher berdasarkan customerPhone di Firestore
        const snapshot = await db.collection('cafe_vouchers')
            .where('customerPhone', '==', phone.trim())
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });
        }

        // Cari prioritas voucher yang statusnya PAID atau PENDING/REDEEMED terbaru
        let targetDoc = null;
        snapshot.forEach(doc => {
            const data = doc.data();
            // Ambil yang statusnya PAID atau yang aktif
            if (data.status === 'PAID' || data.status === 'PENDING' || data.status === 'REDEEMED') {
                targetDoc = data;
            }
        });

        if (!targetDoc) {
            targetDoc = snapshot.docs[0].data(); // Ambil data pertama jika tidak ada yang spesifik
        }

        return res.status(200).json({ 
            success: true, 
            orderId: targetDoc.orderId,
            data: targetDoc 
        });

    } catch (error) {
        console.error("Get voucher error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
}