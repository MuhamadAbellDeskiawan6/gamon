import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inisialisasi Firebase Admin dengan aman
if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const data = req.body;
    
    // Pastikan data yang diperlukan ada
    if (!data.order || !data.transaction) {
        return res.status(400).send('Invalid Notification Format');
    }

    const orderId = data.order.invoice_number;
    const status = data.transaction.status;

    if (status === 'SUCCESS') {
        const db = getFirestore();
        try {
            await db.collection('orders').doc(orderId).update({
                status: "PAID"
            });
            return res.status(200).send("OK");
        } catch (e) {
            console.error("Firebase Update Error:", e);
            return res.status(500).send("Gagal Update DB");
        }
    }

    return res.status(200).send("Transaction not successful");
}