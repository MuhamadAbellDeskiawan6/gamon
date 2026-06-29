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
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
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
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    // 1. Cek Keamanan Admin via Cookie
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionCookie = cookies.admin_session;

    if (!sessionCookie) return res.status(401).json({ message: 'Unauthorized' });

    // ... (bagian atas tetap sama) ...

try {
    const auth = getAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    if (decodedClaims.email !== 'muhamadabelldeskiawan@gmail.com') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    // AMBIL orderId DARI BODY REQUEST
    const { orderId, statusBaru } = req.body;
    
    if (!orderId || !statusBaru) {
        return res.status(400).json({ message: 'Order ID dan Status Baru wajib diisi.' });
    }

    const db = getFirestore();
    
    // GANTI KE .doc(orderId) AGAR SESUAI DENGAN ID DOKUMEN FIRESTORE KAMU
    const orderRef = db.collection('orders').doc(orderId);
    
    await orderRef.update({
        statusMerchandise: statusBaru
    });

    return res.status(200).json({ success: true, message: 'Status berhasil diperbarui!' });

} catch (error) {
    // ...
        console.error("Error pada update-status:", error.message);
        // CRITICAL: Pastikan selalu me-return response di block catch agar tidak timeout 30s lagi
        return res.status(500).json({ message: 'Gagal memperbarui status.', error: error.message });
    }
}