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
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { redeemCode } = req.body;

    try {
        const db = getDb();
        const snapshot = await db.collection('cafe_vouchers').where('redeemCode', '==', redeemCode).get();
        
        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: '❌ Voucher tidak ditemukan atau kode salah!' });
        }

        const docRef = snapshot.docs[0].ref;
        const data = snapshot.docs[0].data();

        if (data.status === 'REDEEMED') {
            return res.status(400).json({ 
                success: false, 
                message: `⚠️ PERINGATAN: Voucher ini sudah pernah digunakan sebelumnya!` 
            });
        }

        if (data.status !== 'PAID') {
            return res.status(400).json({ success: false, message: '⚠️ Voucher belum dibayar lunas.' });
        }

        await docRef.update({
            status: 'REDEEMED',
            redeemedAt: new Date()
        });

        return res.status(200).json({
            success: true,
            message: '✅ Voucher Valid! Silakan berikan menu ke pelanggan.',
            data: {
                cafeName: data.cafeName,
                voucherName: data.voucherName,
                customerName: data.customerName
            }
        });

    } catch (error) {
        console.error("Redeem error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
}