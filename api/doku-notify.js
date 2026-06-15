import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inisialisasi Firebase Admin dengan aman
if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const data = req.body;
    const orderId = data.order?.invoice_number;
    const status = data.transaction?.status;

    if (status === 'SUCCESS') {
        const db = getFirestore();
        try {
            // Di doku-notify.js
await db.collection('orders').doc(orderId).update({
    status: "PAID"
});
            return res.status(200).send("OK");
        } catch (e) {
            return res.status(500).send("Gagal Update DB");
        }
    }
    return res.status(200).send("NOT_PAID");
}