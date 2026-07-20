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

    const { orderId } = req.query;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Order ID required' });
    }

    try {
        const db = getDb();
        const doc = await db.collection('cafe_vouchers').doc(orderId).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan di database' });
        }

        return res.status(200).json({ success: true, data: doc.data() });
    } catch (error) {
        console.error("Get voucher error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
}