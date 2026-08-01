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
            const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
            if (fs.existsSync(keyPath)) {
                serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            }
        }
        if (!serviceAccount) {
            throw new Error('Kredensial Firebase tidak ditemukan!');
        }
        initializeApp({ credential: cert(serviceAccount) });
    }
    return getFirestore();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { orderId } = req.body;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Order ID wajib diisi.' });
    }

    try {
        const db = getDb();
        const docRef = db.collection('photobox_order').doc(orderId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Order Photobox tidak ditemukan.' });
        }

        const data = doc.data();
        if (data.statusMerchandise === 'PICKED_UP') {
            return res.status(200).json({
                success: true,
                message: `Order ${orderId} sudah ditandai sebagai sudah diambil sebelumnya.`,
                data: {
                    orderId,
                    nama: data.nama,
                    tujuan: data.tujuan,
                    statusMerchandise: data.statusMerchandise
                }
            });
        }

        const newStatus = 'PICKED_UP';

        await docRef.update({
            statusMerchandise: newStatus,
            pickedUpAt: new Date()
        });

        return res.status(200).json({
            success: true,
            message: `Order ${orderId} berhasil ditandai sebagai sudah diambil.`,
            data: {
                orderId,
                nama: data.nama,
                tujuan: data.tujuan,
                statusMerchandise: newStatus
            }
        });
    } catch (error) {
        console.error('Redeem Photobox Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
}
