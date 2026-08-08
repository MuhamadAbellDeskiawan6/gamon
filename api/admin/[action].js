import { getAdminAuth, getAdminDb } from '../lib/firebase-admin.js';
import { verifyAdminSession } from '../lib/admin-session.js';

const OWNER_EMAIL = 'muhamadabelldeskiawan@gmail.com';
const REDEEM_CODES_COLLECTION = 'photobox_redeem_codes';

function normalizeRedeemCode(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function shouldUseSecureCookie(req) {
    const host = String(req?.headers?.host || '');
    return !host.includes('localhost') && !host.includes('127.0.0.1');
}

function buildSessionCookie(name, value, req, maxAgeSeconds) {
    const securePart = shouldUseSecureCookie(req) ? '; Secure' : '';
    return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${securePart}`;
}

async function requireAdmin(req, res) {
    const authResult = await verifyAdminSession(req);
    if (!authResult.ok) {
        res.status(authResult.status).json(authResult.body);
        return null;
    }
    return authResult;
}

async function handleLogin(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { idToken } = req.body || {};
    if (!idToken) {
        return res.status(400).json({ success: false, message: 'Token tidak ditemukan.' });
    }

    try {
        const auth = getAdminAuth();
        const expiresInMs = 60 * 60 * 24 * 5 * 1000;
        const expiresInSec = Math.floor(expiresInMs / 1000);
        const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: expiresInMs });

        res.setHeader('Set-Cookie', buildSessionCookie('admin_session', sessionCookie, req, expiresInSec));
        return res.status(200).json({ success: true, message: 'Login berhasil.' });
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Akses ditolak / Token tidak valid', error: error.message });
    }
}

async function handleSession(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    return res.status(200).json({
        success: true,
        email: authResult.claims?.email || null,
        uid: authResult.claims?.uid || null
    });
}

async function handleLogout(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    res.setHeader('Set-Cookie', buildSessionCookie('admin_session', '', req, 0));
    return res.status(200).json({ success: true, message: 'Logout berhasil.' });
}

async function handleGetOrders(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('photobox_order').get();
        const orders = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((order) => order.createdAt && order.nama)
            .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

        return res.status(200).json({ success: true, data: orders });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleUpdateStatus(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { orderId, statusBaru } = req.body || {};
    if (!orderId || !statusBaru) {
        return res.status(400).json({ success: false, message: 'Order ID dan Status Baru wajib diisi.' });
    }

    try {
        await getAdminDb().collection('orders').doc(orderId).update({ statusMerchandise: statusBaru });
        return res.status(200).json({ success: true, message: 'Status berhasil diperbarui!' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal memperbarui status.', error: error.message });
    }
}

async function handleRedeemPhotobox(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { orderId } = req.body || {};
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Order ID wajib diisi.' });
    }

    try {
        const db = getAdminDb();
        const docRef = db.collection('photobox_order').doc(orderId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return res.status(404).json({ success: false, message: 'Order Photobox tidak ditemukan.' });
        }

        const data = snapshot.data();
        if (data.statusMerchandise === 'PICKED_UP') {
            return res.status(200).json({
                success: true,
                message: `Order ${orderId} sudah ditandai sebagai sudah diambil sebelumnya.`,
                data: {
                    orderId,
                    nama: data.nama,
                    tujuan: data.tujuan,
                    statusMerchandise: data.statusMerchandise
                }
            });
        }

        await docRef.update({
            statusMerchandise: 'PICKED_UP',
            pickedUpAt: new Date()
        });

        return res.status(200).json({
            success: true,
            message: `Order ${orderId} berhasil ditandai sebagai sudah diambil.`,
            data: {
                orderId,
                nama: data.nama,
                tujuan: data.tujuan,
                statusMerchandise: 'PICKED_UP'
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleGetFrames(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('photobox_frames').orderBy('createdAt', 'desc').get();
        const frames = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ success: true, data: frames });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleSaveFrame(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { frameId, name, previewImage, frameImage, isActive } = req.body || {};

    const isImageDataUrl = (value) => typeof value === 'string' && /^data:image\/(png|webp);base64,/.test(value);
    if (!name || !isImageDataUrl(previewImage) || !isImageDataUrl(frameImage)) {
        return res.status(400).json({
            success: false,
            message: 'Nama frame, gambar preview, dan gambar frame utama wajib diisi dalam format gambar valid.'
        });
    }

    const MAX_SINGLE_DATA_URL_LENGTH = 700000;
    const MAX_TOTAL_DATA_URL_LENGTH = 950000;
    if (
        previewImage.length > MAX_SINGLE_DATA_URL_LENGTH ||
        frameImage.length > MAX_SINGLE_DATA_URL_LENGTH ||
        previewImage.length + frameImage.length > MAX_TOTAL_DATA_URL_LENGTH
    ) {
        return res.status(400).json({
            success: false,
            message: 'Ukuran gabungan frame terlalu besar untuk Firestore. Coba gambar yang lebih ringan atau area transparan yang lebih bersih.'
        });
    }

    try {
        const db = getAdminDb();
        const timestamp = Date.now();
        const payload = {
            name: String(name).trim(),
            previewImage,
            frameImage,
            isActive: isActive !== false,
            updatedAt: timestamp
        };

        if (frameId) {
            await db.collection('photobox_frames').doc(frameId).set(payload, { merge: true });
            return res.status(200).json({ success: true, message: 'Frame berhasil diperbarui.', id: frameId });
        }

        const docRef = await db.collection('photobox_frames').add({
            ...payload,
            createdAt: timestamp,
            createdBy: authResult.claims?.email || OWNER_EMAIL
        });

        return res.status(200).json({ success: true, message: 'Frame berhasil ditambahkan.', id: docRef.id });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleToggleFrame(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { frameId, isActive } = req.body || {};
    if (!frameId || typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'frameId dan isActive wajib diisi.' });
    }

    try {
        await getAdminDb().collection('photobox_frames').doc(frameId).update({
            isActive,
            updatedAt: Date.now()
        });
        return res.status(200).json({ success: true, message: 'Status frame berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleDeleteFrame(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { frameId } = req.body || {};
    if (!frameId) {
        return res.status(400).json({ success: false, message: 'frameId wajib diisi.' });
    }

    try {
        await getAdminDb().collection('photobox_frames').doc(frameId).delete();
        return res.status(200).json({ success: true, message: 'Frame berhasil dihapus.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleGetRedeemCodes(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection(REDEEM_CODES_COLLECTION).get();
        const codes = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        return res.status(200).json({ success: true, data: codes });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleSaveRedeemCode(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { code, label, maxUses, isActive, note } = req.body || {};
    const normalizedCode = normalizeRedeemCode(code);

    if (!normalizedCode) {
        return res.status(400).json({ success: false, message: 'Kode redeem wajib diisi.' });
    }

    const hasMaxUses = String(maxUses ?? '').trim() !== '';
    const parsedMaxUses = Number.parseInt(maxUses, 10);
    const safeMaxUses = hasMaxUses && Number.isFinite(parsedMaxUses) && parsedMaxUses > 0 ? parsedMaxUses : null;
    const timestamp = Date.now();

    try {
        const db = getAdminDb();
        const docRef = db.collection(REDEEM_CODES_COLLECTION).doc(normalizedCode);
        const snapshot = await docRef.get();
        const existing = snapshot.exists ? snapshot.data() : null;

        const payload = {
            code: normalizedCode,
            label: String(label || '').trim() || normalizedCode,
            note: String(note || '').trim(),
            maxUses: safeMaxUses,
            isActive: isActive !== false,
            updatedAt: timestamp,
            updatedBy: authResult.claims?.email || OWNER_EMAIL,
        };

        if (existing) {
            payload.createdAt = existing.createdAt || timestamp;
            payload.createdBy = existing.createdBy || authResult.claims?.email || OWNER_EMAIL;
            payload.usedCount = Number(existing.usedCount || 0);
            payload.lastRedeemedAt = existing.lastRedeemedAt || null;
        } else {
            payload.createdAt = timestamp;
            payload.createdBy = authResult.claims?.email || OWNER_EMAIL;
            payload.usedCount = 0;
            payload.lastRedeemedAt = null;
        }

        await docRef.set(payload, { merge: true });

        return res.status(200).json({
            success: true,
            message: existing ? 'Kode redeem berhasil diperbarui.' : 'Kode redeem berhasil ditambahkan.',
            data: payload,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleToggleRedeemCode(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { code, isActive } = req.body || {};
    const normalizedCode = normalizeRedeemCode(code);

    if (!normalizedCode || typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Kode dan status aktif wajib diisi.' });
    }

    try {
        const docRef = getAdminDb().collection(REDEEM_CODES_COLLECTION).doc(normalizedCode);
        await docRef.update({
            isActive,
            updatedAt: Date.now(),
            updatedBy: authResult.claims?.email || OWNER_EMAIL,
        });

        return res.status(200).json({ success: true, message: 'Status kode berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleDeleteRedeemCode(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { code } = req.body || {};
    const normalizedCode = normalizeRedeemCode(code);

    if (!normalizedCode) {
        return res.status(400).json({ success: false, message: 'Kode redeem wajib diisi.' });
    }

    try {
        await getAdminDb().collection(REDEEM_CODES_COLLECTION).doc(normalizedCode).delete();
        return res.status(200).json({ success: true, message: 'Kode redeem berhasil dihapus.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

export default async function handler(req, res) {
    const action = String(req?.query?.action || '').toLowerCase();

    switch (action) {
        case 'login':
            return handleLogin(req, res);
        case 'session':
            return handleSession(req, res);
        case 'logout':
            return handleLogout(req, res);
        case 'get-orders':
            return handleGetOrders(req, res);
        case 'update-status':
            return handleUpdateStatus(req, res);
        case 'redeem-photobox':
            return handleRedeemPhotobox(req, res);
        case 'get-frames':
            return handleGetFrames(req, res);
        case 'save-frame':
            return handleSaveFrame(req, res);
        case 'toggle-frame':
            return handleToggleFrame(req, res);
        case 'delete-frame':
            return handleDeleteFrame(req, res);
        case 'get-redeem-codes':
            return handleGetRedeemCodes(req, res);
        case 'save-redeem-code':
            return handleSaveRedeemCode(req, res);
        case 'toggle-redeem-code':
            return handleToggleRedeemCode(req, res);
        case 'delete-redeem-code':
            return handleDeleteRedeemCode(req, res);
        default:
            return res.status(404).json({ success: false, message: 'Admin action tidak ditemukan.' });
    }
}