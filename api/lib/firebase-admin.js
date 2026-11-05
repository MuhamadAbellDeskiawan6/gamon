import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalize(account, source) {
  const projectId = String(account.project_id || account.projectId || '').trim();
  const clientEmail = String(account.client_email || account.clientEmail || '').trim();
  const privateKey = String(account.private_key || account.privateKey || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey.trim()) {
    throw fail('firebase-admin-config-missing', `Kredensial dari ${source} tidak lengkap.`);
  }
  return { projectId, clientEmail, privateKey };
}

function parseJson(text, source) {
  try {
    return normalize(JSON.parse(text), source);
  } catch (error) {
    if (error.code) throw error;
    throw fail('firebase-admin-config-invalid', `${source} bukan JSON valid.`);
  }
}

function getServiceAccount() {
  const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    return parseJson(fs.readFileSync(keyPath, 'utf8'), 'server/serviceAccountKey.json');
  }
  const b64 = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (b64) return parseJson(Buffer.from(b64, 'base64').toString('utf8'), 'FIREBASE_SERVICE_ACCOUNT_BASE64');
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) return parseJson(raw, 'FIREBASE_SERVICE_ACCOUNT');
  return normalize({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY
  }, 'variabel FIREBASE_*');
}

function ensureApp() {
  return getApps().length ? getApp() : initializeApp({ credential: cert(getServiceAccount()) });
}

let dbInstance = null;
export function getAdminDb() {
  if (!dbInstance) {
    dbInstance = getFirestore(ensureApp());
    dbInstance.settings({ preferRest: true });
  }
  return dbInstance;
}

export function getAdminAuth() {
  return getAuth(ensureApp());
}