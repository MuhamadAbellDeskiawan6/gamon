import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inisialisasi Firebase Admin dengan aman
if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
   // Izinkan GET jika DOKU mengirim notifikasi melalui GET
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).send('Method Not Allowed');
    }

    // Jika metode GET, biasanya DOKU hanya memanggil URL untuk konfirmasi 
    // atau mengirim data via query params.
    // Jika data ada di body (POST), gunakan req.body.
    // Jika data ada di query (GET), gunakan req.query.
    const data = req.method === 'POST' ? req.body : req.query;
    
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