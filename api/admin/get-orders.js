import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';

if (!getApps().length) {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const firebaseMatch = envContent.match(/FIREBASE_SERVICE_ACCOUNT=['"]({[\s\S]*?})['"]/);
        if (firebaseMatch && firebaseMatch[1]) process.env.FIREBASE_SERVICE_ACCOUNT = firebaseMatch[1].trim();
    }

    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
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

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
    return list;
}

export default async function handler(req, res) {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionCookie = cookies.admin_session;

    if (!sessionCookie) {
        return res.status(401).json({ message: 'Unauthorized: Silakan login terlebih dahulu.' });
    }

    try {
        const auth = getAuth();
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        
        if (decodedClaims.email !== 'muhamadabelldeskiawan@gmail.com') {
            return res.status(403).json({ message: 'Forbidden: Anda bukan pemilik sistem.' });
        }

        const db = getFirestore();
        // Mengambil semua data photobox dari koleksi photobox_order
        const snapshot = await db.collection('photobox_order').get();
        
        const orders = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(order => order.createdAt && order.nama)
            .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

        return res.status(200).json({ success: true, data: orders });

    } catch (error) {
        return res.status(401).json({ message: 'Sesi habis atau tidak valid.', error: error.message });
    }
}