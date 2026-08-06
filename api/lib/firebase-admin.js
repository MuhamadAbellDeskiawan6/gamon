import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function loadServiceAccount() {
    const envPath = path.join(process.cwd(), '.env.local');

    if (!process.env.FIREBASE_SERVICE_ACCOUNT && fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const firebaseMatch = envContent.match(/FIREBASE_SERVICE_ACCOUNT=['"]({[\s\S]*?})['"]/);
        if (firebaseMatch && firebaseMatch[1]) {
            process.env.FIREBASE_SERVICE_ACCOUNT = firebaseMatch[1].trim();
        }
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        let envValue = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (envValue.startsWith('"') && envValue.endsWith('"')) {
            envValue = envValue.slice(1, -1);
        }
        return JSON.parse(envValue);
    }

    const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
    if (fs.existsSync(keyPath)) {
        return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    }

    throw new Error('Kredensial Firebase tidak ditemukan.');
}

function ensureApp() {
    if (!getApps().length) {
        initializeApp({ credential: cert(loadServiceAccount()) });
    }
}

export function getAdminDb() {
    ensureApp();
    return getFirestore();
}

export function getAdminAuth() {
    ensureApp();
    return getAuth();
}