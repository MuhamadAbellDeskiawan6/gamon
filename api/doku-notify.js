import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
    // 1. Izinkan POST untuk Webhook (Update DB)
    // 2. Izinkan GET untuk Redirect dari DOKU
    
    // Jika ada request GET dari DOKU, langsung redirect ke photobox
    if (req.method === 'GET') {
        return res.redirect(302, '/photobox.html');
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Logika Update Database (hanya untuk POST)
    const data = req.body;
    const orderId = data.order?.invoice_number;
    const status = data.transaction?.status;

    if (status === 'SUCCESS' && orderId) {
        const db = getFirestore();
        try {
            await db.collection('orders').doc(orderId).update({ status: "PAID" });
            return res.status(200).send("OK");
        } catch (e) {
            return res.status(500).send("Gagal Update DB");
        }
    }
    
    return res.status(200).send("Not Processed");
}