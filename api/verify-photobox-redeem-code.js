import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const REDEEM_CODES_COLLECTION = 'photobox_redeem_codes';

function normalizeRedeemCode(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

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
            const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
            if (fs.existsSync(keyPath)) {
                serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            }
        }

        if (!serviceAccount) {
            throw new Error('Kredensial Firebase tidak ditemukan.');
        }

        initializeApp({ credential: cert(serviceAccount) });
    }

    return getFirestore();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { code } = req.body || {};
    const normalizedCode = normalizeRedeemCode(code);

    if (!normalizedCode) {
        return res.status(400).json({ success: false, message: 'Kode redeem wajib diisi.' });
    }

    try {
        const db = getDb();
        const docRef = db.collection(REDEEM_CODES_COLLECTION).doc(normalizedCode);
        const timestamp = Date.now();

        const verification = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(docRef);

            if (!snapshot.exists) {
                return { success: false, status: 404, message: 'Kode redeem tidak ditemukan.' };
            }

            const data = snapshot.data() || {};
            const isActive = data.isActive !== false;
            if (!isActive) {
                return { success: false, status: 400, message: 'Kode redeem sudah nonaktif.' };
            }

            const expiresAt = Number(data.expiresAt || 0);
            if (expiresAt && timestamp > expiresAt) {
                return { success: false, status: 400, message: 'Kode redeem sudah kedaluwarsa.' };
            }

            const usedCount = Number(data.usedCount || 0);
            const hasLimit = Number.isFinite(Number(data.maxUses)) && Number(data.maxUses) > 0;
            const maxUses = hasLimit ? Number(data.maxUses) : null;
            if (hasLimit && usedCount >= maxUses) {
                return { success: false, status: 409, message: 'Kode redeem sudah mencapai batas penggunaan.' };
            }

            const nextUsedCount = usedCount + 1;
            transaction.update(docRef, {
                usedCount: nextUsedCount,
                lastRedeemedAt: timestamp,
                updatedAt: timestamp,
            });

            return {
                success: true,
                data: {
                    code: normalizedCode,
                    label: data.label || normalizedCode,
                    note: data.note || '',
                    usedCount: nextUsedCount,
                    maxUses,
                    remainingUses: hasLimit ? Math.max(maxUses - nextUsedCount, 0) : null,
                },
            };
        });

        if (!verification.success) {
            return res.status(verification.status || 400).json({ success: false, message: verification.message });
        }

        return res.status(200).json({
            success: true,
            message: 'Kode redeem berhasil ditukarkan. Silakan melakukan foto.',
            data: verification.data,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}