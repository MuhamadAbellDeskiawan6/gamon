import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import fs from 'fs';

// (Gunakan kode inisialisasi Firebase Admin yang sama seperti file submit-photobox.js kamu)
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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Token tidak ditemukan.' });

    // Set waktu kedaluwarsa sesi (contoh: 5 hari)
    const expiresIn = 60 * 60 * 24 * 5 * 1000;

    try {
        const auth = getAuth();
        const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
        
        // Atur cookie di browser (HttpOnly agar tidak bisa dicuri via Javascript/XSS)
        res.setHeader('Set-Cookie', `admin_session=${sessionCookie}; Max-Age=${expiresIn / 1000}; Path=/; HttpOnly; Secure; SameSite=Strict`);
        
        return res.status(200).json({ success: true, message: 'Login Berhasil' });
    } catch (error) {
        return res.status(401).json({ message: 'Akses ditolak / Token tidak valid', error: error.message });
    }
}