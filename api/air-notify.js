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
    if (req.method === 'GET') {
        const orderId = req.query.orderId;
        return res.redirect(302, `/air-success.html?orderId=${orderId}`);
    }

    if (req.method === 'POST') {
        const data = req.body;
        const orderId = data.order?.invoice_number;
        const status = data.transaction?.status || data.target?.status; 

        if (orderId && (status === 'SUCCESS' || status === 'PAID')) {
            try {
                const db = getDb();
                await db.collection('air_vouchers').doc(orderId).update({ 
                    status: "PAID",
                    redeemCode: `AIR-${orderId}-${Math.floor(1000 + Math.random() * 9000)}`,
                    updatedAt: new Date() 
                });
                console.log(`Voucher Air Mineral ${orderId} berhasil diupdate ke PAID`);
                return res.status(200).send("OK");
            } catch (e) {
                console.error("Gagal update Firestore Air:", e);
                return res.status(500).send("Gagal Update DB");
            }
        }

        return res.status(200).send("Not Processed");
    }
    
    return res.status(405).send('Method Not Allowed');
}