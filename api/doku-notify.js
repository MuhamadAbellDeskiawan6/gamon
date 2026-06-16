import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
    // Jika user klik tombol 'Go to Merchant' (Browser mengarah ke sini via GET)
    if (req.method === 'GET') {
        return res.redirect(302, '/photobox.html');
    }

    // Jika DOKU mengirimkan status pembayaran riil (Server-to-Server via POST)
    if (req.method === 'POST') {
        console.log("=== HIT WEBHOOK DOKU VIA POST ===");
        console.log("PAYLOAD:", JSON.stringify(req.body, null, 2));

        const data = req.body;
        
        // Pengaman ekstra: fallback check jika penamaan properti di sandbox sedikit berbeda
        const orderId = data.order?.invoice_number;
        const status = data.transaction?.status || data.target?.status; 

        if (orderId && (status === 'SUCCESS' || status === 'PAID')) {
            const db = getFirestore();
            try {
                // Update status menjadi PAID
                await db.collection('orders').doc(orderId).update({ 
                    status: "PAID",
                    updatedAt: new Date() 
                });
                console.log(`Order ${orderId} berhasil diupdate ke PAID`);
                return res.status(200).send("OK");
            } catch (e) {
                console.error("Gagal update Firestore:", e);
                return res.status(500).send("Gagal Update DB");
            }
        }

        return res.status(200).send("Not Processed or Condition Not Met");
    }
    
    return res.status(405).send('Method Not Allowed');
}