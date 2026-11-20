import { getAdminAuth, getAdminDb } from '../lib/firebase-admin.js';
import { verifyAdminSession } from '../lib/admin-session.js';
import { FieldValue } from 'firebase-admin/firestore';
import { releaseExpiredReservations, sendEmail, updateMarketplaceOrderStatus } from '../lib/marketplace-orders.js';
import { createJasaDokuPayment, getDokuConfig } from '../marketplace.js';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const OWNER_EMAIL = 'muhamadabelldeskiawan@gmail.com';
const REDEEM_CODES_COLLECTION = 'photobox_redeem_codes';
const WEDDING_REQUESTS_COLLECTION = 'wedding_photobooth_requests';
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || OWNER_EMAIL;

function normalizeRedeemCode(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function normalizeWhatsapp(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('62')) return digits;
    return `62${digits}`;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function formatWeddingDate(value) {
    if (!value) return '-';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function loadLocalEnvIfNeeded() {
    if (process.env.GMAIL_APP_PASSWORD) return;

    try {
        const envPath = path.join(process.cwd(), '.env.local');
        if (!fs.existsSync(envPath)) return;

        const env = fs.readFileSync(envPath, 'utf8');
        const match = env.match(/GMAIL_APP_PASSWORD=['"]?([^'"\n\r]+)['"]?/);
        if (match?.[1]) {
            process.env.GMAIL_APP_PASSWORD = match[1].trim();
        }
    } catch (error) {
        console.warn('Load .env.local warning:', error.message);
    }
}

async function sendWeddingAdminNotificationEmail(payload) {
    if (!process.env.GMAIL_APP_PASSWORD) {
        console.warn('GMAIL_APP_PASSWORD belum diset, notifikasi email wedding dilewati.');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: OWNER_EMAIL,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });

    await transporter.sendMail({
        from: '"Notifier Gamon Wedding" <muhamadabelldeskiawan@gmail.com>',
        to: ADMIN_EMAIL,
        subject: `💍 Pengajuan Wedding Baru - ${payload.requestId}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
                <h2 style="margin-top:0;color:#111827">Ada pengajuan Wedding Photobooth baru 💍</h2>
                <p style="color:#374151">Data pengajuan baru masuk dari website.</p>
                <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
                    <tr><td style="padding:6px 0"><b>ID Pengajuan</b></td><td style="padding:6px 0">${payload.requestId}</td></tr>
                    <tr><td style="padding:6px 0"><b>Nama</b></td><td style="padding:6px 0">${payload.nama}</td></tr>
                    <tr><td style="padding:6px 0"><b>Email</b></td><td style="padding:6px 0">${payload.email}</td></tr>
                    <tr><td style="padding:6px 0"><b>WhatsApp</b></td><td style="padding:6px 0">${payload.whatsapp}</td></tr>
                    <tr><td style="padding:6px 0"><b>Tanggal Pernikahan</b></td><td style="padding:6px 0">${formatWeddingDate(payload.tanggalPernikahan)}</td></tr>
                    <tr><td style="padding:6px 0"><b>Lokasi</b></td><td style="padding:6px 0">${payload.lokasi || '-'}</td></tr>
                </table>
                <p style="margin:0 0 6px;"><b>Pesan Pengaju:</b></p>
                <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:13px;color:#334155;line-height:1.5;white-space:pre-wrap;">${payload.pesan || '-'}</div>
                <p style="font-size:12px;color:#64748b;margin-top:14px">Status awal: NEW</p>
            </div>
        `,
    });
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

async function handleGetLdrFrames(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('ldr_frames').orderBy('createdAt', 'desc').get();
        const frames = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ success: true, data: frames });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleSaveLdrFrame(req, res) {
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
            await db.collection('ldr_frames').doc(frameId).set(payload, { merge: true });
            return res.status(200).json({ success: true, message: 'Frame LDR berhasil diperbarui.', id: frameId });
        }

        const docRef = await db.collection('ldr_frames').add({
            ...payload,
            createdAt: timestamp,
            createdBy: authResult.claims?.email || OWNER_EMAIL
        });

        return res.status(200).json({ success: true, message: 'Frame LDR berhasil ditambahkan.', id: docRef.id });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleToggleLdrFrame(req, res) {
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
        await getAdminDb().collection('ldr_frames').doc(frameId).update({ isActive, updatedAt: Date.now() });
        return res.status(200).json({ success: true, message: 'Status frame LDR berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleDeleteLdrFrame(req, res) {
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
        await getAdminDb().collection('ldr_frames').doc(frameId).delete();
        return res.status(200).json({ success: true, message: 'Frame LDR berhasil dihapus.' });
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

async function handleSubmitWeddingRequest(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    loadLocalEnvIfNeeded();

    const nama = String(req.body?.nama || '').trim();
    const email = String(req.body?.email || '').trim();
    const whatsappRaw = String(req.body?.whatsapp || '').trim();
    const tanggalPernikahan = String(req.body?.tanggalPernikahan || '').trim();
    const lokasi = String(req.body?.lokasi || '').trim();
    const pesan = String(req.body?.pesan || '').trim();

    if (!nama || !email || !whatsappRaw || !tanggalPernikahan || !lokasi) {
        return res.status(400).json({ success: false, message: 'Data wajib belum lengkap.' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Format email tidak valid.' });
    }

    const whatsapp = normalizeWhatsapp(whatsappRaw);
    if (!whatsapp) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid.' });
    }

    const timestamp = Date.now();
    const requestId = `WED-${timestamp}`;

    try {
        await getAdminDb().collection(WEDDING_REQUESTS_COLLECTION).doc(requestId).set({
            requestId,
            nama,
            email,
            whatsapp,
            whatsappRaw,
            tanggalPernikahan,
            lokasi,
            pesan,
            status: 'NEW',
            source: 'wedding-photobooth-page',
            createdAt: timestamp,
            updatedAt: timestamp,
        });

        await sendWeddingAdminNotificationEmail({
            requestId,
            nama,
            email,
            whatsapp,
            tanggalPernikahan,
            lokasi,
            pesan,
        });

        return res.status(200).json({ success: true, message: 'Pengajuan berhasil dikirim.', requestId });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Terjadi kegagalan server internal.', error: error.message });
    }
}

async function handleGetWeddingRequests(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection(WEDDING_REQUESTS_COLLECTION).get();
        const requests = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        return res.status(200).json({ success: true, data: requests });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

function normalizeContactForWa(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('62')) return digits;
    return `62${digits}`;
}

async function handleGetMatchConfirmRequests(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const db = getAdminDb();
        const [requestsSnap, matchesSnap, contactsSnap, gamonSnap] = await Promise.all([
            db.collection('matchRequests').get(),
            db.collection('matches').get(),
            db.collection('matchContacts').get(),
            db.collection('gamon').get(),
        ]);

        const requestMap = new Map();
        const finalRequests = requestsSnap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((request) => request && (request.status === 'pending' || request.status === 'matched' || request.status === 'confirmed' || request.matchId || request.curhatId))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        for (const request of finalRequests) {
            requestMap.set(String(request.id), request);
        }

        const matchMap = new Map();
        for (const matchDoc of matchesSnap.docs) {
            matchMap.set(matchDoc.id, matchDoc.data() || {});
        }

        const contactMap = new Map();
        for (const contactDoc of contactsSnap.docs) {
            const data = contactDoc.data() || {};
            const key = String(data.requestId || '');
            if (!key) continue;
            const arr = contactMap.get(key) || [];
            arr.push({
                id: contactDoc.id,
                contactText: String(data.contactText || '').trim(),
                matchId: data.matchId || null,
                createdAt: data.createdAt || null,
            });
            contactMap.set(key, arr);
        }

        const gamonMap = new Map();
        for (const doc of gamonSnap.docs) {
            gamonMap.set(doc.id, doc.data() || {});
        }

        const rows = finalRequests.map((request) => {
            const requestId = String(request.id || request.requestId || '');
            const requestGamon = gamonMap.get(request.curhatId) || {};
            const matchDoc = request.matchId ? matchMap.get(request.matchId) || {} : {};
            const requestIds = Array.isArray(matchDoc.requestIds) ? matchDoc.requestIds.map(String) : [];
            const otherRequestId = requestIds.find((id) => id !== requestId) || request.matchedWithRequestId || null;
            const otherRequest = otherRequestId ? requestMap.get(String(otherRequestId)) || null : null;
            const otherGamon = otherRequest?.curhatId ? gamonMap.get(otherRequest.curhatId) || {} : {};

            const firstContact = (contactMap.get(requestId) || []).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
            const partnerContact = otherRequestId ? (contactMap.get(String(otherRequestId)) || []).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] : null;

            const confirmedBy = matchDoc.confirmedBy || {};
            const confirmedRequestIds = Array.isArray(matchDoc.requestIds) ? matchDoc.requestIds.map(String) : [];
            const confirmedCount = confirmedRequestIds.filter((id) => Boolean(confirmedBy[id])).length;
            const currentConfirmed = Boolean(confirmedBy[requestId]);
            const partnerConfirmed = otherRequestId ? Boolean(confirmedBy[String(otherRequestId)]) : false;

            let status = 'waiting';
            let statusLabel = 'Masih menunggu';

            if (request.status === 'matched' || request.status === 'confirmed' || request.status === 'pending_confirmation' || Boolean(request.matchId)) {
                status = 'matched';
                statusLabel = 'Sudah match';
            } else if (confirmedRequestIds.length > 0 && confirmedCount > 0) {
                status = 'partial_confirmed';
                statusLabel = 'Salah satu sudah konfirmasi';
            }

            const firstNumber = (firstContact?.contactText || '').trim();
            const secondNumber = (partnerContact?.contactText || '').trim();

            return {
                requestId,
                matchId: request.matchId || null,
                status,
                statusLabel,
                pairName: otherRequest ? `${requestGamon.nama || 'Anonim'} & ${otherGamon.nama || 'Anonim'}` : (requestGamon.nama || 'Anonim'),
                primaryName: requestGamon.nama || 'Anonim',
                primaryTarget: requestGamon.tujuan || 'Seseorang',
                partnerName: otherGamon.nama || null,
                partnerTarget: otherGamon.tujuan || null,
                primaryConfirmed: currentConfirmed,
                partnerConfirmed,
                primaryContact: firstNumber || 'Kontak belum diisi',
                partnerContact: secondNumber || 'Kontak belum diisi',
                primaryWa: normalizeContactForWa(firstNumber),
                partnerWa: normalizeContactForWa(secondNumber),
                createdAt: request.createdAt || null,
                matchStatus: matchDoc.status || request.status || 'pending',
                matchLabel: matchDoc.status ? String(matchDoc.status).replace(/_/g, ' ') : request.status || 'pending'
            };
        });

        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleGetMarketplaceItems(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('marketplace_items').get();
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return res.status(200).json({ success: true, data: items });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleGetMarketplaceOrders(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('marketplace_orders').get();
        const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return res.status(200).json({ success: true, data: orders });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleUpdateMarketplaceItemStatus(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { itemId, status } = req.body || {};
    if (!itemId || !status) {
        return res.status(400).json({ success: false, message: 'itemId dan status wajib diisi.' });
    }

    try {
        await getAdminDb().collection('marketplace_items').doc(String(itemId)).set({
            status: String(status),
            updatedAt: Date.now(),
            reviewedBy: authResult.claims?.email || OWNER_EMAIL,
        }, { merge: true });

        return res.status(200).json({ success: true, message: 'Status item marketplace berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleGetMarketplaceProducts(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('marketplace_products').get();
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return res.status(200).json({ success: true, data: items });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleSaveMarketplaceProduct(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const body = req.body || {};
    const productId = body.id ? String(body.id) : null;
    const name = String(body.name || '').trim();
       const isFree = body.isFree === true;
    const price = isFree ? 0 : Number(body.price);
    const stock = Number(body.stock);

    if (!name) {
        return res.status(400).json({ success: false, message: 'Nama produk wajib diisi.' });
    }
    if (!isFree && (!Number.isSafeInteger(price) || price < 1)) {
        return res.status(400).json({ success: false, message: 'Harga harus bilangan bulat rupiah minimal 1, atau centang Produk gratis.' });
    }
    if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ success: false, message: 'Stok harus berupa bilangan bulat minimal 0.' });
    }

    const productData = {
        name,
        category: body.category || 'barang',
        price,
                isFree,
        stock,
        sold: 0,
        condition: body.condition || 'Layak pakai',
        status: stock > 0 ? 'Tersedia' : 'Habis',
        description: String(body.description || '').trim(),
        city: body.city || body.address || 'Jakarta',
        address: body.address || body.city || 'Jakarta',
        storyType: body.storyType || 'barang-kenangan',
        storyNote: body.storyNote || '',
        latitude: body.latitude || '',
        longitude: body.longitude || '',
        imageUrl: body.imageUrl || body.image || '',
        images: Array.isArray(body.images) ? body.images : (body.imageUrl || body.image ? [body.imageUrl || body.image] : []),
        seller: 'Marketplace Mantan',
        sellerId: 'admin',
        ownerId: 'admin',
        updatedAt: Date.now(),
    };

    try {
        const db = getAdminDb();
        const collectionRef = db.collection('marketplace_products');
        if (productId) {
            const ref = collectionRef.doc(String(productId));
            const existing = await ref.get();
            const currentSold = Number(existing.data()?.sold);
            const sold = Number.isInteger(currentSold) && currentSold >= 0 ? currentSold : 0;
            await ref.set({ ...productData, sold, updatedAt: Date.now() }, { merge: true });
            return res.status(200).json({ success: true, message: 'Produk berhasil diperbarui.', id: productId });
        }

        const createdAt = Date.now();
        const ref = collectionRef.doc();
        await ref.set({ ...productData, createdAt, updatedAt: createdAt });
        return res.status(200).json({ success: true, message: 'Produk berhasil ditambahkan.', id: ref.id });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleDeleteMarketplaceProduct(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { id } = req.body || {};
    if (!id) {
        return res.status(400).json({ success: false, message: 'ID produk wajib diisi.' });
    }

    try {
        await getAdminDb().collection('marketplace_products').doc(String(id)).delete();
        return res.status(200).json({ success: true, message: 'Produk berhasil dihapus.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleUpdateMarketplaceOrderStatus(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { id, orderId, status, courier, trackingNumber, returnStock, note, codFailed } = req.body || {};
    const targetOrderId = String(orderId || id || '').trim();
    if (!targetOrderId || !status) {
        return res.status(400).json({ success: false, message: 'Kode order dan status wajib diisi.' });
    }

    try {
        const result = await updateMarketplaceOrderStatus({
            orderId: targetOrderId,
            status: String(status),
            by: authResult.claims?.email || OWNER_EMAIL,
            courier,
            trackingNumber,
            returnStock: returnStock === true,
            note: String(note || '').trim(),
            codFailed: codFailed === true
        });
        return res.status(200).json({ success: true, message: 'Status pesanan berhasil diperbarui.', data: result });
    } catch (error) {
        const statusCode = error.code === 'not-found' ? 404 : error.code === 'invalid-transition' ? 409 : 500;
        return res.status(statusCode).json({ success: false, code: error.code || 'order-update-failed', message: error.message });
    }
}

async function handleReleaseExpiredMarketplaceReservations(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    const authResult = await requireAdmin(req, res);
    if (!authResult) return;
    try {
        const result = await releaseExpiredReservations();
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, code: error.code || 'reservation-sweep-failed', message: error.message });
    }
}

async function handleMigrateMarketplaceStock(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    const authResult = await requireAdmin(req, res);
    if (!authResult) return;
    try {
        const db = getAdminDb();
        const snapshot = await db.collection('marketplace_products').get();
        let batch = db.batch();
        let batchCount = 0;
        let migrated = 0;
        const commitBatch = async () => {
            if (!batchCount) return;
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        };
        for (const productDoc of snapshot.docs) {
            const product = productDoc.data() || {};
            const stockValue = Number(product.stock);
            const soldValue = Number(product.sold);
            const stockValid = Number.isInteger(stockValue) && stockValue >= 0;
            const soldValid = Number.isInteger(soldValue) && soldValue >= 0;
            if (stockValid && soldValid) continue;
            const stock = stockValid ? stockValue : 1;
            const sold = soldValid ? soldValue : 0;
            batch.set(productDoc.ref, { stock, sold, status: stock > 0 ? 'Tersedia' : 'Habis', updatedAt: Date.now() }, { merge: true });
            batchCount += 1;
            migrated += 1;
            if (batchCount >= 450) await commitBatch();
        }
        await commitBatch();
        return res.status(200).json({ success: true, migrated, scanned: snapshot.size });
    } catch (error) {
        return res.status(500).json({ success: false, code: error.code || 'stock-migration-failed', message: error.message });
    }
}

async function handleGetMarketplaceChatThreads(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    try {
        const snapshot = await getAdminDb().collection('marketplace_chats').get();
        const threads = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => Number(b.lastMessageAt || b.updatedAt || 0) - Number(a.lastMessageAt || a.updatedAt || 0));
        return res.status(200).json({ success: true, data: threads });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleSendMarketplaceChatMessage(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { threadId, buyerId, buyerName, text } = req.body || {};
    const trimmed = String(text || '').trim();
    if (!threadId || !buyerId || String(threadId) !== String(buyerId) || !trimmed) {
        return res.status(400).json({ success: false, message: 'threadId harus sama dengan buyerId dan text wajib diisi.' });
    }

    try {
        const db = getAdminDb();
        const ref = db.collection('marketplace_chats').doc(String(buyerId));
        const messageRef = ref.collection('messages').doc();
        const createdAt = Date.now();
        const nextMessage = {
            id: messageRef.id,
            senderId: authResult.claims?.uid || 'admin',
            senderRole: 'admin',
            text: trimmed,
            createdAt,
        };

        const batch = db.batch();
        batch.set(messageRef, nextMessage);
        batch.set(ref, {
            buyerId: String(buyerId),
            buyerName: String(buyerName || 'Pembeli'),
            participantIds: [String(buyerId), 'admin'],
            lastMessage: trimmed,
            lastMessageAt: createdAt,
            lastSenderRole: 'admin',
            updatedAt: createdAt,
            unreadForUser: FieldValue.increment(1),
        }, { merge: true });
        await batch.commit();

        return res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.', data: nextMessage });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleUpdateWeddingRequestStatus(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    const { requestId, status } = req.body || {};
    if (!requestId || !status) {
        return res.status(400).json({ success: false, message: 'requestId dan status wajib diisi.' });
    }

    const allowedStatuses = ['NEW', 'CONTACTED', 'APPROVED', 'REJECTED', 'DONE'];
    if (!allowedStatuses.includes(String(status))) {
        return res.status(400).json({ success: false, message: 'Status tidak valid.' });
    }

    try {
        await getAdminDb().collection(WEDDING_REQUESTS_COLLECTION).doc(String(requestId)).set({
            status: String(status),
            updatedAt: Date.now(),
            updatedBy: authResult.claims?.email || OWNER_EMAIL,
        }, { merge: true });

        return res.status(200).json({ success: true, message: 'Status pengajuan wedding berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

function escapeMailHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

// Kirim email balasan chat ke pembeli.
// Prioritas: Gmail SMTP (bisa ke alamat mana pun). Jika gagal/tidak dikonfigurasi, pakai sendEmail() lama.
async function sendChatReplyEmail({ to, subject, html, text }) {
    loadLocalEnvIfNeeded();
    // App password Gmail sering disalin dengan spasi (xxxx xxxx xxxx xxxx); buang spasinya.
    const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    let gmailError = null;

    if (gmailPassword) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: OWNER_EMAIL, pass: gmailPassword },
            });
            await transporter.sendMail({
                from: `"Marketplace Mantan" <${OWNER_EMAIL}>`,
                to,
                replyTo: OWNER_EMAIL,
                subject,
                html,
                text,
            });
            return { via: 'gmail' };
        } catch (error) {
            gmailError = error;
            console.warn('[marketplace chat] Gmail SMTP gagal, mencoba sendEmail():', error.code || '', error.message);
        }
    }

    try {
        await sendEmail({ to, subject, html, text });
        return { via: 'fallback' };
    } catch (error) {
        const combined = new Error(
            gmailError
                ? `Gmail: ${gmailError.message} | Cadangan: ${error.message}`
                : error.message
        );
        combined.code = gmailError ? 'mail-gmail-failed' : (error.code || 'send-failed');
        throw combined;
    }
}

async function handleNotifyMarketplaceChatReply(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    loadLocalEnvIfNeeded();

    const threadId = String(req.body?.threadId || '').trim();
    const messageId = String(req.body?.messageId || '').trim();
    if (!threadId || !messageId || threadId.includes('/') || messageId.includes('/')) {
        return res.status(400).json({ success: false, message: 'threadId dan messageId wajib diisi.' });
    }

    try {
        const db = getAdminDb();
        const threadRef = db.collection('marketplace_chats').doc(threadId);
        const messageRef = threadRef.collection('messages').doc(messageId);
        const [threadSnap, messageSnap] = await Promise.all([threadRef.get(), messageRef.get()]);
        if (!threadSnap.exists || !messageSnap.exists) {
            return res.status(404).json({ success: false, message: 'Percakapan atau pesan tidak ditemukan.' });
        }

        const thread = threadSnap.data() || {};
        const message = messageSnap.data() || {};
        if (message.senderRole !== 'admin') {
            return res.status(400).json({ success: false, message: 'Hanya pesan admin yang dapat dinotifikasikan.' });
        }
        if (message.emailNotifiedAt) {
            return res.status(200).json({ success: true, sent: false, reason: 'already-notified' });
        }

        // Email pembeli: dari thread, atau fallback ke akun Firebase Auth.
        let buyerEmail = String(thread.buyerEmail || '').trim();
        if (!isValidEmail(buyerEmail) && thread.buyerId) {
            try {
                buyerEmail = String((await getAdminAuth().getUser(String(thread.buyerId))).email || '').trim();
            } catch (error) {
                buyerEmail = '';
            }
        }
        if (!isValidEmail(buyerEmail)) {
            return res.status(200).json({ success: true, sent: false, reason: 'buyer-email-missing' });
        }

        const siteUrl = (/^https:\/\//i.test(String(process.env.SITE_URL || '').trim())
            ? String(process.env.SITE_URL).trim()
            : 'https://gamon-space.vercel.app').replace(/\/$/, '');
        const params = new URLSearchParams();
        if (thread.productId) params.set('productId', String(thread.productId));
        else if (thread.orderId) params.set('orderId', String(thread.orderId));
        const link = `${siteUrl}/user/marketplace/chat.html${params.toString() ? `?${params}` : ''}`;
        const label = thread.productName
            ? `Produk: ${thread.productName}`
            : thread.orderId ? `Pesanan: ${thread.orderId}` : 'Pertanyaan umum';
        const body = String(message.text || '').slice(0, 1000);

        try {
            const result = await sendChatReplyEmail({
                to: buyerEmail,
                subject: '💬 Admin Marketplace Mantan membalas chat Anda',
                html: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
                    <h2 style="margin-top:0;color:#111827">Ada balasan baru dari admin 💬</h2>
                    <p style="color:#374151;margin:0 0 12px"><b>Topik:</b> ${escapeMailHtml(label)}</p>
                    <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:14px;color:#334155;line-height:1.5;white-space:pre-wrap;">${escapeMailHtml(body)}</div>
                    <p style="margin-top:18px"><a href="${escapeMailHtml(link)}" style="background:#db2777;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Buka chat</a></p>
                    <p style="font-size:12px;color:#64748b;margin-top:14px">Anda menerima email ini karena memiliki percakapan di Marketplace Mantan.</p>
                </div>`,
                text: `Balasan dari admin Marketplace Mantan (${label}):\n\n${body}\n\nBuka chat: ${link}`
            });
            console.log('[marketplace chat] email balasan terkirim via', result.via, 'ke', buyerEmail);
        } catch (mailError) {
            console.warn('[marketplace chat] email balasan gagal:', mailError.code || '', mailError.message);
            return res.status(200).json({
                success: true,
                sent: false,
                reason: mailError.code || 'send-failed',
                detail: String(mailError.message || '').slice(0, 300)
            });
        }

        await messageRef.set({ emailNotifiedAt: Date.now() }, { merge: true });
        return res.status(200).json({ success: true, sent: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

async function handleNotifyJasaChatReply(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const authResult = await requireAdmin(req, res);
    if (!authResult) return;

    loadLocalEnvIfNeeded();

    const threadId = String(req.body?.threadId || '').trim();
    const messageId = String(req.body?.messageId || '').trim();
    if (!threadId || !messageId || threadId.includes('/') || messageId.includes('/')) {
        return res.status(400).json({ success: false, message: 'threadId dan messageId wajib diisi.' });
    }

    try {
        const db = getAdminDb();
        const threadRef = db.collection('jasa_chats').doc(threadId);
        const messageRef = threadRef.collection('messages').doc(messageId);
        const [threadSnap, messageSnap] = await Promise.all([threadRef.get(), messageRef.get()]);
        if (!threadSnap.exists || !messageSnap.exists) {
            return res.status(404).json({ success: false, message: 'Percakapan atau pesan tidak ditemukan.' });
        }

        const thread = threadSnap.data() || {};
        const message = messageSnap.data() || {};
        if (message.senderRole !== 'admin') {
            return res.status(400).json({ success: false, message: 'Hanya pesan admin yang dapat dinotifikasikan.' });
        }
        if (message.emailNotifiedAt) {
            return res.status(200).json({ success: true, sent: false, reason: 'already-notified' });
        }

        let buyerEmail = String(thread.buyerEmail || '').trim();
        if (!isValidEmail(buyerEmail) && thread.buyerId) {
            try {
                buyerEmail = String((await getAdminAuth().getUser(String(thread.buyerId))).email || '').trim();
            } catch (error) {
                buyerEmail = '';
            }
        }
        if (!isValidEmail(buyerEmail)) {
            return res.status(200).json({ success: true, sent: false, reason: 'buyer-email-missing' });
        }

        const siteUrl = (/^https:\/\//i.test(String(process.env.SITE_URL || '').trim())
            ? String(process.env.SITE_URL).trim()
            : 'https://gamon-space.vercel.app').replace(/\/$/, '');
        const params = new URLSearchParams();
        if (thread.orderId) params.set('orderId', String(thread.orderId));
        else if (thread.serviceId) {
            params.set('serviceId', String(thread.serviceId));
            if (thread.serviceName) params.set('serviceName', String(thread.serviceName));
        }
        const link = `${siteUrl}/user/jasa/chat.html${params.toString() ? `?${params}` : ''}`;
        const label = thread.serviceName
            ? `Layanan: ${thread.serviceName}`
            : thread.orderId ? `Pesanan: ${thread.orderId}` : 'Pertanyaan umum';
        const body = String(message.text || '').slice(0, 1000);

        try {
            const result = await sendChatReplyEmail({
                to: buyerEmail,
                subject: '💬 Admin Gamon Jasa membalas chat Anda',
                html: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
                    <h2 style="margin-top:0;color:#111827">Ada balasan baru dari admin Gamon Jasa 💬</h2>
                    <p style="color:#374151;margin:0 0 12px"><b>Topik:</b> ${escapeMailHtml(label)}</p>
                    <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:14px;color:#334155;line-height:1.5;white-space:pre-wrap;">${escapeMailHtml(body)}</div>
                    <p style="margin-top:18px"><a href="${escapeMailHtml(link)}" style="background:#db2777;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Buka chat</a></p>
                    <p style="font-size:12px;color:#64748b;margin-top:14px">Anda menerima email ini karena memiliki percakapan di Gamon Jasa.</p>
                </div>`,
                text: `Balasan dari admin Gamon Jasa (${label}):\n\n${body}\n\nBuka chat: ${link}`
            });
            console.log('[jasa chat] email balasan terkirim via', result.via, 'ke', buyerEmail);
        } catch (mailError) {
            console.warn('[jasa chat] email balasan gagal:', mailError.code || '', mailError.message);
            return res.status(200).json({
                success: true,
                sent: false,
                reason: mailError.code || 'send-failed',
                detail: String(mailError.message || '').slice(0, 300)
            });
        }

        await messageRef.set({ emailNotifiedAt: Date.now() }, { merge: true });
        return res.status(200).json({ success: true, sent: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

function jasaAdminError(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

function jasaAdminText(value, maxLength, label, required = false) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
    if (required && !text) throw jasaAdminError(400, 'invalid-input', `${label} wajib diisi.`);
    return text;
}

function jasaAdminId(value, label) {
    const id = jasaAdminText(value, 120, label, true);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw jasaAdminError(400, 'invalid-id', `${label} tidak valid.`);
    return id;
}

function jasaAdminOrderCode() {
    const date = new Date();
    const prefix = [String(date.getUTCFullYear()).slice(-2), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('');
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const suffix = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    return `JS-${prefix}-${suffix}`;
}

async function jasaAdminSendEmail(message, context) {
    try {
        await sendEmail(message);
    } catch (error) {
        console.error('[jasa admin] email gagal:', { ...context, code: error.code || 'unknown', message: error.message });
    }
}

function jasaAdminEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function jasaAdminImage(value) {
    const image = jasaAdminText(value, 800, 'URL gambar');
    if (!image) return '';
    if (/^https:\/\/[^\s]+$/i.test(image) || /^\/(?!\/)[^\s]*$/.test(image)) return image;
    throw jasaAdminError(400, 'invalid-image', 'Gambar harus memakai URL HTTPS atau path relatif situs.');
}

function jasaAdminImageData(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 250000) {
        throw jasaAdminError(400, 'invalid-image-data', 'Data gambar tidak valid atau terlalu besar.');
    }
    const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw jasaAdminError(400, 'invalid-image-data', 'Format data gambar tidak valid.');
    return value;
}

function jasaAdminCategoryData(body) {
    if (body.active !== undefined && typeof body.active !== 'boolean') throw jasaAdminError(400, 'invalid-active', 'Status kategori harus berupa boolean.');
    const name = jasaAdminText(body.name, 100, 'Nama kategori', true);
    const slug = jasaAdminText(body.slug, 100, 'Slug', true).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw jasaAdminError(400, 'invalid-slug', 'Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung.');
    const order = Number(body.order ?? 0);
    if (!Number.isSafeInteger(order) || order < 0 || order > 10000) throw jasaAdminError(400, 'invalid-order', 'Urutan kategori harus berupa bilangan bulat 0 sampai 10000.');
    return {
        name,
        slug,
        icon: jasaAdminText(body.icon || 'handyman', 60, 'Ikon'),
        tagline: jasaAdminText(body.tagline, 200, 'Tagline'),
        description: jasaAdminText(body.description, 1200, 'Deskripsi'),
        active: body.active !== false,
        order,
        updatedAt: Date.now()
    };
}

function jasaAdminServiceData(body) {
    if (body.active !== undefined && typeof body.active !== 'boolean') throw jasaAdminError(400, 'invalid-active', 'Status layanan harus berupa boolean.');
    if (body.isFree !== undefined && typeof body.isFree !== 'boolean') throw jasaAdminError(400, 'invalid-is-free', 'Status layanan gratis harus berupa boolean.');
    const isFree = body.isFree === true;
    const categoryId = jasaAdminId(body.categoryId, 'Kategori');
    const name = jasaAdminText(body.name, 120, 'Nama layanan', true);
    const summary = jasaAdminText(body.summary, 300, 'Ringkasan', true);
    const description = jasaAdminText(body.description, 3000, 'Deskripsi');
    const disclaimer = jasaAdminText(body.disclaimer, 1500, 'Disclaimer');
    const pricingNote = jasaAdminText(body.pricingNote, 300, 'Catatan harga');
    const unit = jasaAdminText(body.unit, 40, 'Satuan');
    const scheduleMode = body.scheduleMode === undefined ? 'none' : jasaAdminText(body.scheduleMode, 20, 'Pengaturan jadwal', true);
    if (!['none', 'date', 'datetime', 'recurring'].includes(scheduleMode)) throw jasaAdminError(400, 'invalid-schedule-mode', 'Pengaturan jadwal layanan tidak valid.');
    const scheduleLabelInput = jasaAdminText(body.scheduleLabel, 80, 'Judul bagian jadwal');
    const recipientLabelInput = jasaAdminText(body.recipientLabel, 60, 'Sebutan penerima');
    const consentText = jasaAdminText(body.consentText, 300, 'Teks persetujuan');
    if (String(body.scheduleLabel ?? '').trim().length > 80) throw jasaAdminError(400, 'invalid-schedule-label', 'Judul bagian jadwal maksimal 80 karakter.');
    if (String(body.recipientLabel ?? '').trim().length > 60) throw jasaAdminError(400, 'invalid-recipient-label', 'Sebutan penerima maksimal 60 karakter.');
    if (String(body.consentText ?? '').trim().length > 300) throw jasaAdminError(400, 'invalid-consent-text', 'Teks persetujuan maksimal 300 karakter.');
    // Layanan gratis tidak memakai pembayaran, jadi dipaksa ['full'] agar katalog tetap valid.
    const paymentOptions = isFree ? ['full'] : (body.paymentOptions === undefined ? ['full'] : body.paymentOptions);
    if (!Array.isArray(paymentOptions) || !paymentOptions.length ||
        paymentOptions.some((option) => !['full', 'cash'].includes(option)) ||
        new Set(paymentOptions).size !== paymentOptions.length) {
        throw jasaAdminError(400, 'invalid-payment-options', 'Cara bayar yang ditawarkan harus berisi pilihan online atau tunai yang unik.');
    }
    if (!Array.isArray(body.packages) || body.packages.length > 20) throw jasaAdminError(400, 'invalid-packages', 'Paket wajib berupa daftar maksimal 20 item.');
    const packages = body.packages.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw jasaAdminError(400, 'invalid-package', `Paket ${index + 1} tidak valid.`);
        if (item.active !== undefined && typeof item.active !== 'boolean') throw jasaAdminError(400, 'invalid-active', `Status paket ${index + 1} harus berupa boolean.`);
        const id = jasaAdminId(item?.id, `ID paket ${index + 1}`);
        const packageName = jasaAdminText(item.name, 120, `Nama paket ${index + 1}`, true);
        const priceType = jasaAdminText(item.priceType, 20, `Jenis harga ${index + 1}`, true);
        const price = Number(item.price);
        const dpPercent = item.dpPercent === undefined ? 30 : Number(item.dpPercent);
        if (!['fixed', 'monthly', 'quote', 'free'].includes(priceType)) throw jasaAdminError(400, 'invalid-price-type', `Jenis harga paket ${packageName} tidak valid.`);
        if (!Number.isSafeInteger(price) || price < 0 || price > 1000000000 || (['quote', 'free'].includes(priceType) ? price !== 0 : price < 1)) {
            throw jasaAdminError(400, 'invalid-price', `Harga paket ${packageName} tidak valid.`);
        }
        if (!Number.isSafeInteger(dpPercent) || dpPercent < 10 || dpPercent > 90) throw jasaAdminError(400, 'invalid-dp-percent', `Persen DP paket ${packageName} harus berupa bilangan bulat 10 sampai 90.`);
        return {
            id,
            name: packageName,
            description: jasaAdminText(item.description, 500, `Deskripsi paket ${packageName}`),
            duration: jasaAdminText(item.duration, 80, `Durasi paket ${packageName}`),
            priceType,
            price,
            dpPercent,
            active: item.active !== false
        };
    });
    if (new Set(packages.map((item) => item.id)).size !== packages.length) throw jasaAdminError(400, 'duplicate-package-id', 'ID paket harus unik.');
    if (body.active !== false && !packages.some((item) => item.active)) throw jasaAdminError(400, 'no-active-package', 'Layanan aktif harus memiliki minimal satu paket aktif.');
    if (isFree) {
        if (packages.length !== 1 || packages[0].priceType !== 'free') {
            throw jasaAdminError(400, 'invalid-free-service', 'Layanan gratis harus memiliki tepat satu paket bertipe gratis.');
        }
    } else if (packages.some((item) => item.priceType === 'free')) {
        throw jasaAdminError(400, 'invalid-free-service', 'Paket bertipe gratis hanya boleh dipakai pada layanan yang ditandai gratis.');
    }
    if (packages.some((item) => item.priceType === 'monthly') && paymentOptions.some((option) => option !== 'full')) {
        throw jasaAdminError(400, 'monthly-full-only', 'Layanan dengan paket bulanan hanya boleh menawarkan pembayaran Full.');
    }

    const optionInput = body.options === undefined ? [] : body.options;
    if (!Array.isArray(optionInput) || optionInput.length > 30) throw jasaAdminError(400, 'invalid-options', 'Opsi harus berupa daftar maksimal 30 item.');
    const options = optionInput.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw jasaAdminError(400, 'invalid-option', `Opsi ${index + 1} tidak valid.`);
        return {
            id: jasaAdminId(item.id, `ID opsi ${index + 1}`),
            label: jasaAdminText(item.label, 150, `Label opsi ${index + 1}`, true)
        };
    });
    if (new Set(options.map((item) => item.id)).size !== options.length) throw jasaAdminError(400, 'duplicate-option-id', 'ID opsi harus unik.');

    const formFieldInput = body.formFields === undefined ? [] : body.formFields;
    if (!Array.isArray(formFieldInput) || formFieldInput.length > 20) throw jasaAdminError(400, 'invalid-form-fields', 'Field formulir harus berupa daftar maksimal 20 item.');
    const allowedTypes = new Set(['text', 'textarea', 'number', 'address', 'date', 'time', 'select']);
    const reservedFieldKeys = new Set(['packageId', 'paymentPlan', 'selectedOptions', 'scheduleDate', 'scheduleTime', 'scheduleRecurring', 'scheduleDays', 'buyerName', 'buyerPhone']);
    const formFields = formFieldInput.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw jasaAdminError(400, 'invalid-form-field', `Field ${index + 1} tidak valid.`);
        if (item.required !== undefined && typeof item.required !== 'boolean') throw jasaAdminError(400, 'invalid-required', `Status wajib field ${index + 1} harus berupa boolean.`);
        const key = jasaAdminText(item?.key, 60, `Key field ${index + 1}`, true);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw jasaAdminError(400, 'invalid-field-key', `Key field ${key} tidak valid.`);
        if (reservedFieldKeys.has(key)) throw jasaAdminError(400, 'reserved-field-key', `Key field ${key} dipakai oleh formulir pemesanan.`);
        const type = jasaAdminText(item.type, 20, `Tipe field ${key}`, true);
        if (!allowedTypes.has(type)) throw jasaAdminError(400, 'invalid-field-type', `Tipe field ${key} tidak valid.`);
        const field = {
            key,
            label: jasaAdminText(item.label, 120, `Label field ${key}`, true),
            type,
            required: item.required === true
        };
        if (type === 'select') {
            if (!Array.isArray(item.options) || !item.options.length || item.options.length > 30) throw jasaAdminError(400, 'invalid-field-options', `Pilihan field ${key} wajib diisi (maksimal 30).`);
            field.options = item.options.map((option) => jasaAdminText(option, 100, `Pilihan field ${key}`, true));
        }
        return field;
    });
    if (new Set(formFields.map((item) => item.key)).size !== formFields.length) throw jasaAdminError(400, 'duplicate-field-key', 'Key field formulir harus unik.');
    return {
        categoryId,
        name,
        summary,
        description,
        image: jasaAdminImage(body.image),
        active: body.active !== false,
        isFree,
        disclaimer,
        pricingNote,
        unit,
        paymentOptions,
        packages,
        options,
        formFields,
        needsParentProfile: false,
        askNote: body.askNote === true,
        scheduleMode,
        scheduleLabel: scheduleLabelInput || 'Preferensi jadwal',
        recipientLabel: recipientLabelInput || 'Penerima layanan',
        consentText,
        updatedAt: Date.now()
    };
}

function jasaAdminPayments(order) {
    if (Array.isArray(order.payments)) return order.payments;
    if (order.paymentMethod === 'CASH' && order.paymentStatus !== 'PAID') return [];
    const orderCode = order.orderCode || order.id;
    if (!orderCode) return [];
    const isPaid = order.paymentStatus === 'PAID' || ['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status);
    return [{
        id: orderCode,
        kind: 'full',
        amount: Number(order.totalAmount || 0),
        method: order.paymentMethod === 'CASH' ? 'CASH' : 'DOKU',
        status: isPaid ? 'PAID' : order.paymentStatus === 'EXPIRED' ? 'EXPIRED' : order.paymentStatus === 'CANCELLED' ? 'CANCELLED' : 'UNPAID',
        invoiceNumber: orderCode,
        paymentUrl: String(order.paymentUrl || ''),
        expiresAt: Number(order.paymentExpiresAt || 0),
        paidAt: Number(order.paidAt || 0)
    }];
}

function jasaAdminAmounts(order, payments = jasaAdminPayments(order)) {
    const total = Number(order.totalAmount || 0);
    const paidAmount = payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return { paidAmount, remainingAmount: Math.max(0, total - paidAmount) };
}

// Untuk dev lokal yang mengalami DNS/socket reset, jalankan dengan NODE_OPTIONS=--dns-result-order=ipv4first.
function jasaAdminIsRetryableNetworkError(error) {
    const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    return /unavailable|econnreset|socket hang up|econnrefused|etimedout|deadline exceeded/.test(message);
}

async function jasaAdminRetryNetworkQuery(query) {
    for (let retry = 0; ; retry += 1) {
        try {
            return await query();
        } catch (error) {
            if (retry >= 3 || !jasaAdminIsRetryableNetworkError(error)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
    }
}

async function jasaAdminAction(req, res, action) {
    const method = action === 'jasa-get-catalog' || action === 'jasa-get-orders' ? 'GET' : 'POST';
    if (req.method !== method) return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    const authResult = await requireAdmin(req, res);
    if (!authResult) return;
    const db = getAdminDb();
    const body = req.body || {};
    try {
        if (action === 'jasa-get-catalog') {
            const [categories, services] = await jasaAdminRetryNetworkQuery(() => Promise.all([
                db.collection('jasa_categories').get(),
                db.collection('jasa_services').get()
            ]));
            return res.status(200).json({
                success: true,
                categories: categories.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
                services: services.docs.map((item) => ({ id: item.id, ...item.data() }))
            });
        }
        if (action === 'jasa-save-category') {
            const data = jasaAdminCategoryData(body);
            const id = body.id ? jasaAdminId(body.id, 'ID kategori') : data.slug;
            const ref = db.collection('jasa_categories').doc(id);
            await ref.set({ ...data, ...(body.id ? {} : { createdAt: Date.now() }) }, { merge: true });
            return res.status(200).json({ success: true, id, message: 'Kategori jasa berhasil disimpan.' });
        }
        if (action === 'jasa-save-service') {
            const data = jasaAdminServiceData(body);
            const imageData = jasaAdminImageData(body.imageData);
            const category = await db.collection('jasa_categories').doc(data.categoryId).get();
            if (!category.exists) throw jasaAdminError(400, 'category-not-found', 'Kategori jasa tidak ditemukan.');
            const id = body.id ? jasaAdminId(body.id, 'ID layanan') : undefined;
            const ref = id ? db.collection('jasa_services').doc(id) : db.collection('jasa_services').doc();
            const imageRef = db.collection('jasa_service_images').doc(ref.id);
            const previousService = id ? await ref.get() : null;
            const keepsExistingImage = Boolean(data.image && data.image === previousService?.data()?.image);
            if (imageData) {
                const updatedAt = Date.now();
                await imageRef.set({ data: imageData, updatedAt });
                data.image = `/api/marketplace?action=jasa-image&id=${ref.id}&v=${updatedAt}`;
            }
            await ref.set({ ...data, ...(!id ? { createdAt: Date.now() } : {}) }, { merge: true });
            if (!imageData && !keepsExistingImage) await imageRef.delete();
            return res.status(200).json({ success: true, id: ref.id, message: 'Layanan jasa berhasil disimpan.' });
        }
        if (action === 'jasa-delete-service') {
            const id = jasaAdminId(body.id, 'ID layanan');
            await db.collection('jasa_services').doc(id).delete();
            await db.collection('jasa_service_images').doc(id).delete();
            return res.status(200).json({ success: true, message: 'Layanan berhasil dihapus.' });
        }
        if (action === 'jasa-toggle-active') {
            const id = jasaAdminId(body.id, 'ID');
            const collectionName = body.type === 'category' ? 'jasa_categories' : body.type === 'service' ? 'jasa_services' : '';
            if (!collectionName || typeof body.active !== 'boolean') throw jasaAdminError(400, 'invalid-toggle', 'Tipe dan status aktif wajib valid.');
            const ref = db.collection(collectionName).doc(id);
            const snapshot = await ref.get();
            if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Data jasa tidak ditemukan.');
            await ref.set({ active: body.active, updatedAt: Date.now() }, { merge: true });
            return res.status(200).json({ success: true, message: 'Status jasa berhasil diperbarui.' });
        }
        if (action === 'jasa-get-orders') {
            const snapshot = await jasaAdminRetryNetworkQuery(() => db.collection('jasa_orders').orderBy('createdAt', 'desc').limit(300).get());
            const orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            return res.status(200).json({ success: true, orders });
        }
        if (action === 'jasa-update-order-status') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const target = jasaAdminText(body.status, 30, 'Status', true);
            const transitions = {
                awaiting_quote: ['cancelled'],
                awaiting_payment: ['cancelled'],
                awaiting_confirmation: ['scheduled', 'cancelled'],
                paid: ['scheduled', 'cancelled'],
                scheduled: ['in_progress', 'cancelled'],
                in_progress: ['completed', 'cancelled']
            };
            const ref = db.collection('jasa_orders').doc(id);
            const result = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
                const order = snapshot.data() || {};
                if (!(transitions[order.status] || []).includes(target)) throw jasaAdminError(409, 'invalid-transition', `Status ${order.status} tidak dapat diubah menjadi ${target}.`);
                const note = jasaAdminText(body.note, 300, 'Catatan');
                const payments = jasaAdminPayments(order);
                const amounts = jasaAdminAmounts(order, payments);
                if (target === 'completed' && amounts.remainingAmount > 0) {
                    throw jasaAdminError(409, 'payment-incomplete', `Pesanan belum dapat diselesaikan. Masih ada sisa pembayaran ${amounts.remainingAmount.toLocaleString('id-ID')} rupiah.`);
                }
                if (target === 'cancelled' && amounts.paidAmount > 0 && !note) {
                    throw jasaAdminError(400, 'cancellation-note-required', 'Catatan wajib diisi saat membatalkan pesanan yang sudah menerima pembayaran.');
                }
                const now = Date.now();
                const updatedPayments = target === 'cancelled'
                    ? payments.map((payment) => payment.status === 'UNPAID' ? { ...payment, status: 'CANCELLED' } : payment)
                    : payments;
                transaction.update(ref, {
                    status: target,
                    ...(target === 'cancelled' ? { paymentStatus: 'CANCELLED', payments: updatedPayments } : {}),
                    ...(target === 'cancelled' && amounts.paidAmount > 0 ? { needsAttention: true, attentionReason: 'Refund perlu diproses manual; catatan pembatalan admin tersedia di riwayat.' } : {}),
                    ...amounts,
                    statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: target, at: now, by: authResult.claims?.email || OWNER_EMAIL, note }],
                    updatedAt: now
                });
                return { order, note };
            });
            if (target === 'scheduled') {
                await jasaAdminSendEmail({
                    to: result.order.buyerEmail,
                    subject: `Jadwal Gamon Jasa dikonfirmasi — ${id}`,
                    text: `Pesanan ${id} telah dijadwalkan untuk ${result.order.schedule?.date || '-'} pukul ${result.order.schedule?.time || '-'}.`,
                    html: `<p>Pesanan <b>${jasaAdminEscape(id)}</b> telah dijadwalkan untuk ${jasaAdminEscape(result.order.schedule?.date || '-')} pukul ${jasaAdminEscape(result.order.schedule?.time || '-')}.</p>`
                }, { orderId: id, emailType: 'scheduled' });
            }
            return res.status(200).json({ success: true, message: 'Status pesanan jasa diperbarui.' });
        }
        if (action === 'jasa-create-balance-invoice') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            let config;
            try { config = getDokuConfig(req); } catch (error) { throw jasaAdminError(503, error.code || 'doku-config-missing', error.message); }
            const orderRef = db.collection('jasa_orders').doc(id);
            const reservation = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(orderRef);
                if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
                const order = snapshot.data() || {};
                const payments = jasaAdminPayments(order);
                const amounts = jasaAdminAmounts(order, payments);
                if (order.paymentPlan !== 'dp' || amounts.remainingAmount < 1 ||
                    ['cancelled', 'expired', 'completed', 'awaiting_quote', 'awaiting_payment', 'awaiting_confirmation'].includes(order.status)) {
                    throw jasaAdminError(409, 'balance-not-available', 'Tagihan pelunasan hanya dapat dibuat untuk pesanan DP aktif yang sudah membayar DP.');
                }
                const now = Date.now();
                const index = payments.findIndex((payment) => payment.kind === 'balance' && payment.status === 'UNPAID' && Number(payment.expiresAt || 0) > now);
                if (index >= 0) return { order, payment: payments[index], existing: true, creating: !payments[index].paymentUrl };
                const invoiceNumber = `${id}-B`;
                const previousIndex = payments.findIndex((payment) => payment.kind === 'balance');
                const entry = {
                    ...(previousIndex >= 0 ? payments[previousIndex] : {}),
                    id: invoiceNumber,
                    kind: 'balance',
                    amount: amounts.remainingAmount,
                    method: 'DOKU',
                    status: 'UNPAID',
                    invoiceNumber,
                    paymentUrl: '',
                    expiresAt: now + 60 * 60 * 1000,
                    paidAt: 0
                };
                if (previousIndex >= 0) payments[previousIndex] = entry;
                else payments.push(entry);
                transaction.update(orderRef, {
                    payments,
                    ...amounts,
                    paymentStatus: 'PARTIAL',
                    statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'balance_invoice_created', at: now, by: authResult.claims?.email || OWNER_EMAIL }],
                    updatedAt: now
                });
                return { order: { ...order, ...amounts }, payment: entry, existing: false, creating: true };
            });
            if (reservation.existing && reservation.payment.paymentUrl) {
                return res.status(200).json({ success: true, paymentUrl: reservation.payment.paymentUrl, existing: true, message: 'Tagihan pelunasan aktif sudah tersedia.' });
            }
            if (reservation.existing && reservation.creating) {
                throw jasaAdminError(409, 'invoice-being-created', 'Tagihan pelunasan sedang disiapkan. Muat ulang beberapa saat lagi.');
            }
            let payment;
            try {
                payment = await createJasaDokuPayment({ ...reservation.order, orderCode: id }, config, reservation.payment);
            } catch (error) {
                await db.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(orderRef);
                    if (!snapshot.exists) return;
                    const order = snapshot.data() || {};
                    const payments = jasaAdminPayments(order).map((item) =>
                        item.invoiceNumber === reservation.payment.invoiceNumber ? { ...item, status: 'EXPIRED' } : item);
                    const failedAt = Date.now();
                    transaction.update(orderRef, {
                        payments,
                        statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'balance_invoice_failed', at: failedAt, by: authResult.claims?.email || OWNER_EMAIL }],
                        updatedAt: failedAt
                    });
                });
                console.error('[jasa admin] tagihan pelunasan DOKU gagal:', { orderId: id, code: error.code || 'unknown', message: error.message });
                throw jasaAdminError(502, 'balance-invoice-failed', 'Tagihan pelunasan belum dapat disiapkan. Silakan coba lagi.');
            }
            const now = Date.now();
            await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(orderRef);
                if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
                const order = snapshot.data() || {};
                const payments = jasaAdminPayments(order);
                const index = payments.findIndex((item) => item.invoiceNumber === reservation.payment.invoiceNumber && item.status === 'UNPAID');
                if (index < 0) throw jasaAdminError(409, 'payment-changed', 'Tagihan berubah saat tautan pembayaran dibuat.');
                payments[index] = { ...payments[index], paymentUrl: payment.paymentUrl, expiresAt: now + 60 * 60 * 1000 };
                transaction.update(orderRef, { payments, updatedAt: now });
            });
            const paymentUrl = payment.paymentUrl;
            await jasaAdminSendEmail({
                to: reservation.order.buyerEmail,
                subject: `Tagihan pelunasan Gamon Jasa — ${id}`,
                text: `Tagihan pelunasan untuk pesanan ${id} sebesar Rp ${reservation.payment.amount.toLocaleString('id-ID')}. Bayar dalam 60 menit: ${paymentUrl}`,
                html: `<p>Tagihan pelunasan untuk pesanan <b>${jasaAdminEscape(id)}</b> tersedia.</p><p>Sisa pembayaran: <b>Rp ${reservation.payment.amount.toLocaleString('id-ID')}</b>. Link berlaku 60 menit.</p><p><a href="${jasaAdminEscape(paymentUrl)}">Bayar sisa</a></p>`
            }, { orderId: id, emailType: 'balance-invoice' });
            return res.status(200).json({ success: true, paymentUrl, existing: false, message: 'Tagihan pelunasan dibuat dan dikirim ke email pembeli.' });
        }
        if (action === 'jasa-mark-cash-paid' || action === 'jasa-mark-balance-cash-paid') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const note = jasaAdminText(body.note, 300, 'Catatan');
            const ref = db.collection('jasa_orders').doc(id);
            const updated = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
                const order = snapshot.data() || {};
                const isBalance = action === 'jasa-mark-balance-cash-paid';
                if (order.status === 'cancelled' || order.status === 'expired' || order.status === 'completed') {
                    throw jasaAdminError(409, 'invalid-order-state', 'Pembayaran tunai tidak dapat dicatat untuk pesanan ini.');
                }
                if ((!isBalance && order.paymentPlan !== 'cash') || (isBalance && order.paymentPlan !== 'dp')) {
                    throw jasaAdminError(409, 'invalid-payment-plan', isBalance ? 'Pelunasan tunai hanya tersedia untuk pesanan DP.' : 'Aksi ini hanya tersedia untuk pesanan dengan cara bayar tunai.');
                }
                const payments = jasaAdminPayments(order);
                const amounts = jasaAdminAmounts(order, payments);
                if (amounts.remainingAmount < 1) throw jasaAdminError(409, 'already-paid', 'Pesanan sudah lunas.');
                const now = Date.now();
                if (isBalance) {
                    for (let index = 0; index < payments.length; index += 1) {
                        if (payments[index].kind === 'balance' && payments[index].status === 'UNPAID') {
                            payments[index] = { ...payments[index], status: 'CANCELLED' };
                        }
                    }
                }
                payments.push({
                    id: `CASH-${now}`,
                    kind: 'cash',
                    amount: amounts.remainingAmount,
                    method: 'CASH',
                    status: 'PAID',
                    invoiceNumber: '',
                    paymentUrl: '',
                    expiresAt: 0,
                    paidAt: now
                });
                const nextAmounts = jasaAdminAmounts(order, payments);
                transaction.update(ref, {
                    payments,
                    ...nextAmounts,
                    paymentStatus: 'PAID',
                    paidAt: now,
                    statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), {
                        status: isBalance ? 'balance_cash_paid' : 'cash_paid',
                        at: now,
                        by: authResult.claims?.email || OWNER_EMAIL,
                        ...(note ? { note } : {})
                    }],
                    updatedAt: now
                });
                return { order, amount: amounts.remainingAmount };
            });
            await jasaAdminSendEmail({
                to: updated.order.buyerEmail,
                subject: `Pembayaran tunai diterima — Gamon Jasa ${id}`,
                text: `Pembayaran tunai sebesar Rp ${updated.amount.toLocaleString('id-ID')} untuk pesanan ${id} telah dicatat.`,
                html: `<p>Pembayaran tunai sebesar <b>Rp ${updated.amount.toLocaleString('id-ID')}</b> untuk pesanan <b>${jasaAdminEscape(id)}</b> telah dicatat.</p>`
            }, { orderId: id, emailType: 'cash-payment' });
            return res.status(200).json({ success: true, message: 'Pembayaran tunai berhasil dicatat.' });
        }
        if (action === 'jasa-assign-staff') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const name = jasaAdminText(body.name, 120, 'Nama petugas', true);
            const note = jasaAdminText(body.note, 300, 'Catatan petugas');
            const ref = db.collection('jasa_orders').doc(id);
            const snapshot = await ref.get();
            if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
            await ref.set({ assignedStaff: { name, note, at: Date.now() }, updatedAt: Date.now() }, { merge: true });
            return res.status(200).json({ success: true, message: 'Petugas pesanan berhasil diperbarui.' });
        }
        if (action === 'jasa-create-next-invoice') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const orderRef = db.collection('jasa_orders').doc(id);
            const orderSnapshot = await orderRef.get();
            if (!orderSnapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
            const sourceOrder = orderSnapshot.data() || {};
            if (sourceOrder.status !== 'paid' || sourceOrder.paymentStatus !== 'PAID' || sourceOrder.subscription?.status !== 'active') {
                throw jasaAdminError(409, 'invalid-subscription', 'Tagihan berikutnya hanya dapat dibuat untuk langganan aktif yang sudah dibayar.');
            }
            const rootId = sourceOrder.parentOrderId || id;
            const rootRef = db.collection('jasa_orders').doc(rootId);
            const reservation = await db.runTransaction(async (transaction) => {
                const rootSnapshot = await transaction.get(rootRef);
                if (!rootSnapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan induk langganan tidak ditemukan.');
                const root = rootSnapshot.data() || {};
                if (root.status !== 'paid' || root.paymentStatus !== 'PAID' || root.subscription?.status !== 'active') {
                    throw jasaAdminError(409, 'invalid-subscription', 'Langganan induk tidak aktif atau belum dibayar.');
                }
                const pendingId = root.subscription.pendingInvoiceId;
                if (pendingId) {
                    const pendingRef = db.collection('jasa_orders').doc(pendingId);
                    const pendingSnapshot = await transaction.get(pendingRef);
                    if (pendingSnapshot.exists && pendingSnapshot.data()?.paymentStatus !== 'PAID') {
                        return { orderId: pendingId, order: pendingSnapshot.data(), root, existing: true };
                    }
                }
                const cycle = Number(root.subscription.cycle || 1) + 1;
                const invoiceId = jasaAdminOrderCode();
                const now = Date.now();
                const nextOrder = {
                    orderCode: invoiceId,
                    userId: root.userId,
                    buyerName: root.buyerName,
                    buyerEmail: root.buyerEmail,
                    buyerPhone: root.buyerPhone,
                    serviceId: root.serviceId,
                    serviceName: root.serviceName,
                    categoryId: root.categoryId,
                    disclaimer: root.disclaimer || '',
                    pricingNote: root.pricingNote || '',
                    ...(root.address ? { address: root.address } : {}),
                    ...(root.parent ? { parent: root.parent } : {}),
                    consentAt: root.consentAt || now,
                    package: root.package,
                    selectedOptions: root.selectedOptions || [],
                    formData: root.formData || {},
                    formFieldLabels: root.formFieldLabels || {},
                    schedule: root.schedule || {},
                    totalAmount: Number(root.totalAmount),
                    paymentMethod: 'DOKU',
                    paymentStatus: 'UNPAID',
                    status: 'awaiting_payment',
                    statusHistory: [{ status: 'awaiting_payment', at: now, by: authResult.claims?.email || OWNER_EMAIL }],
                    visits: [],
                    paymentUrl: '',
                    paymentExpiresAt: now + 60 * 60 * 1000,
                    parentOrderId: rootId,
                    orderType: 'subscription_cycle',
                    subscription: { status: 'active', startedAt: root.subscription.startedAt || root.createdAt || now, cycle },
                    createdAt: now,
                    updatedAt: now
                };
                const invoiceRef = db.collection('jasa_orders').doc(invoiceId);
                transaction.create(invoiceRef, nextOrder);
                transaction.update(rootRef, { subscription: { ...root.subscription, cycle, pendingInvoiceId: invoiceId }, updatedAt: now });
                return { orderId: invoiceId, order: nextOrder, root, existing: false };
            });
            let invoice = reservation.order || {};
            let paymentCreated = false;
            if (invoice.paymentStatus !== 'PAID' && (!/^https:\/\//i.test(String(invoice.paymentUrl || '')) || Number(invoice.paymentExpiresAt || 0) <= Date.now())) {
                let config;
                try { config = getDokuConfig(req); } catch (error) { throw jasaAdminError(503, error.code || 'doku-config-missing', error.message); }
                const now = Date.now();
                invoice = {
                    ...invoice,
                    orderCode: reservation.orderId,
                    status: 'awaiting_payment',
                    paymentStatus: 'UNPAID',
                    totalAmount: Number(invoice.totalAmount),
                    paymentExpiresAt: now + 60 * 60 * 1000
                };
                const payment = await createJasaDokuPayment(invoice, config);
                paymentCreated = true;
                await db.collection('jasa_orders').doc(reservation.orderId).set({
                    status: 'awaiting_payment',
                    paymentStatus: 'UNPAID',
                    paymentUrl: payment.paymentUrl,
                    dokuRequestId: payment.requestId,
                    paymentExpiresAt: now + 60 * 60 * 1000,
                    updatedAt: now
                }, { merge: true });
                invoice.paymentUrl = payment.paymentUrl;
                invoice.paymentExpiresAt = now + 60 * 60 * 1000;
            }
            if (invoice.paymentUrl && paymentCreated) {
                await jasaAdminSendEmail({
                    to: invoice.buyerEmail,
                    subject: `Tagihan langganan Gamon Jasa — siklus ${invoice.subscription?.cycle || ''}`,
                    text: `Tagihan siklus ${invoice.subscription?.cycle || ''} untuk pesanan ${invoice.orderCode || reservation.orderId} telah tersedia. Bayar dalam 60 menit: ${invoice.paymentUrl}`,
                    html: `<p>Tagihan siklus <b>${Number(invoice.subscription?.cycle || 0)}</b> untuk langganan Gamon Jasa sudah tersedia.</p><p><a href="${jasaAdminEscape(invoice.paymentUrl)}">Bayar tagihan</a> (berlaku 60 menit).</p>`
                }, { orderId: reservation.orderId, emailType: 'subscription-invoice' });
            }
            return res.status(200).json({ success: true, orderId: reservation.orderId, cycle: invoice.subscription?.cycle || 1, paymentUrl: invoice.paymentUrl || '', existing: reservation.existing, message: reservation.existing ? 'Tagihan siklus yang sama sudah tersedia.' : 'Tagihan siklus berikutnya berhasil dibuat.' });
        }
        if (action === 'jasa-end-subscription') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const ref = db.collection('jasa_orders').doc(id);
            const snapshot = await ref.get();
            if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
            const order = snapshot.data() || {};
            if (order.subscription?.status !== 'active') throw jasaAdminError(409, 'invalid-subscription', 'Langganan ini tidak aktif.');
            const rootId = order.parentOrderId || id;
            const endedAt = Date.now();
            await db.collection('jasa_orders').doc(rootId).set({ subscription: { ...order.subscription, status: 'ended', endedAt }, updatedAt: endedAt }, { merge: true });
            if (rootId !== id) await ref.set({ subscription: { ...order.subscription, status: 'ended', endedAt }, updatedAt: endedAt }, { merge: true });
            return res.status(200).json({ success: true, message: 'Langganan berhasil diakhiri.' });
        }
        if (action === 'jasa-set-quote') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const amount = Number(body.amount);
            if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) throw jasaAdminError(400, 'invalid-quote', 'Harga penawaran harus berupa bilangan bulat rupiah lebih dari nol.');
            const ref = db.collection('jasa_orders').doc(id);
            const snapshot = await ref.get();
            if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
            const order = snapshot.data() || {};
            if (order.status !== 'awaiting_quote' || order.package?.priceType !== 'quote') throw jasaAdminError(409, 'invalid-order-state', 'Pesanan ini tidak menunggu penawaran harga.');
            const paymentPlan = order.paymentPlan || 'full';
            const dpPercent = Number.isSafeInteger(order.package?.dpPercent) ? order.package.dpPercent : 30;
            if (!['full', 'dp', 'cash'].includes(paymentPlan)) throw jasaAdminError(409, 'invalid-payment-plan', 'Cara pembayaran penawaran tidak valid.');
            const dpAmount = paymentPlan === 'dp' ? Math.round(amount * dpPercent / 100) : amount;
            if (!Number.isSafeInteger(dpAmount) || dpAmount < 1 || dpAmount > amount || (paymentPlan === 'dp' && dpAmount >= amount)) {
                throw jasaAdminError(409, 'invalid-dp-amount', 'Nominal DP dari penawaran tidak valid.');
            }
            let payment = null;
            let paymentEntry = null;
            if (paymentPlan !== 'cash') {
                let config;
                try { config = getDokuConfig(req); } catch (error) {
                    if (error.code === 'doku-config-missing' || error.code === 'invalid-server-url') throw jasaAdminError(503, error.code, error.message);
                    throw error;
                }
                const now = Date.now();
                paymentEntry = {
                    id,
                    kind: paymentPlan,
                    amount: dpAmount,
                    method: 'DOKU',
                    status: 'UNPAID',
                    invoiceNumber: id,
                    paymentUrl: '',
                    expiresAt: now + 60 * 60 * 1000,
                    paidAt: 0
                };
                const quotedOrder = { ...order, orderCode: id, totalAmount: amount, package: { ...order.package, price: amount } };
                try { payment = await createJasaDokuPayment(quotedOrder, config, paymentEntry); }
                catch (error) {
                    console.error('[jasa admin] penawaran gagal:', { orderId: id, code: error.code || 'unknown', message: error.message });
                    throw jasaAdminError(502, error.code || 'quote-payment-failed', 'Penawaran belum dapat disiapkan. Periksa konfigurasi pembayaran lalu coba lagi.');
                }
                paymentEntry.paymentUrl = payment.paymentUrl;
            }
            const now = Date.now();
            const nextStatus = paymentPlan === 'cash' ? 'awaiting_confirmation' : 'awaiting_payment';
            const paymentStatus = paymentPlan === 'cash' ? 'CASH_PENDING' : 'UNPAID';
            const remainingAmount = amount - (paymentPlan === 'dp' ? dpAmount : 0);
            await db.runTransaction(async (transaction) => {
                const current = await transaction.get(ref);
                if (!current.exists || current.data()?.status !== 'awaiting_quote') throw jasaAdminError(409, 'invalid-order-state', 'Status pesanan berubah saat penawaran disiapkan.');
                const currentOrder = current.data() || {};
                if (paymentPlan === 'cash') {
                    const activeOrders = await transaction.get(db.collection('jasa_orders').where('userId', '==', currentOrder.userId));
                    const activeCashCount = activeOrders.docs.filter((item) => {
                        const active = item.data() || {};
                        return item.id !== id && active.paymentPlan === 'cash' && ['awaiting_confirmation', 'scheduled', 'in_progress'].includes(active.status);
                    }).length;
                    if (activeCashCount >= 2) throw jasaAdminError(409, 'cash-order-limit', 'Pembeli sudah memiliki dua pesanan jasa tunai aktif.');
                }
                transaction.update(ref, {
                    totalAmount: amount,
                    quoteAmount: amount,
                    package: { ...currentOrder.package, price: amount, dpPercent },
                    paymentPlan,
                    paymentMethod: paymentPlan === 'cash' ? 'CASH' : 'DOKU',
                    payments: paymentEntry ? [paymentEntry] : [],
                    paidAmount: 0,
                    remainingAmount,
                    status: nextStatus,
                    paymentStatus,
                    ...(payment ? {
                        paymentUrl: payment.paymentUrl,
                        dokuRequestId: payment.requestId,
                        paymentExpiresAt: now + 60 * 60 * 1000
                    } : {
                        confirmationExpiresAt: now + 24 * 60 * 60 * 1000
                    }),
                    statusHistory: [...(Array.isArray(currentOrder.statusHistory) ? currentOrder.statusHistory : []), { status: nextStatus, at: now, by: authResult.claims?.email || OWNER_EMAIL, note: `Penawaran ${amount}` }],
                    updatedAt: now
                });
            });
            const paymentDetails = payment
                ? ` DP ${dpAmount.toLocaleString('id-ID')} rupiah.` : ' Pembayaran dilakukan tunai setelah jadwal dikonfirmasi.';
            await jasaAdminSendEmail({
                to: order.buyerEmail,
                subject: `Penawaran Jasa Gamon ${id}`,
                text: payment
                    ? `Penawaran untuk pesanan ${id}: Rp ${amount.toLocaleString('id-ID')}.${paymentDetails} Bayar melalui ${payment.paymentUrl}. Link berlaku 60 menit.`
                    : `Penawaran untuk pesanan ${id}: Rp ${amount.toLocaleString('id-ID')}. Admin akan menghubungi untuk konfirmasi jadwal dan pembayaran tunai.`,
                html: payment
                    ? `<p>Penawaran untuk pesanan <b>${jasaAdminEscape(id)}</b> sudah tersedia.</p><p>Total: <b>Rp ${amount.toLocaleString('id-ID')}</b>. Bayar sekarang: <b>Rp ${dpAmount.toLocaleString('id-ID')}</b>${paymentPlan === 'dp' ? `, sisa Rp ${(amount - dpAmount).toLocaleString('id-ID')}` : ''}. Link berlaku 60 menit.</p><p><a href="${jasaAdminEscape(payment.paymentUrl)}">Lanjutkan pembayaran</a></p>`
                    : `<p>Penawaran untuk pesanan <b>${jasaAdminEscape(id)}</b> sudah tersedia.</p><p>Total: <b>Rp ${amount.toLocaleString('id-ID')}</b>. Admin akan menghubungi Anda untuk konfirmasi jadwal dan pembayaran tunai.</p>`
            }, { orderId: id, emailType: 'quote' });
            return res.status(200).json({ success: true, paymentUrl: payment?.paymentUrl || '', message: payment ? 'Penawaran tersimpan dan tagihan pembayaran berhasil dibuat.' : 'Penawaran tersimpan. Pesanan menunggu konfirmasi tunai.' });
        }
        if (action === 'jasa-add-visit-report') {
            const id = jasaAdminId(body.orderId || body.id, 'Kode pesanan');
            const note = jasaAdminText(body.note, 300, 'Ringkasan pembaruan', true);
            const reportText = jasaAdminText(body.reportText, 3000, 'Isi pembaruan', true);
            const staffName = jasaAdminText(body.staffName, 120, 'Nama petugas', true);
            const ref = db.collection('jasa_orders').doc(id);
            const visit = { at: Date.now(), by: jasaAdminText(authResult.claims?.email || OWNER_EMAIL, 180, 'Admin'), staffName, note, reportText };
            const snapshot = await ref.get();
            if (!snapshot.exists) throw jasaAdminError(404, 'not-found', 'Pesanan jasa tidak ditemukan.');
            const order = snapshot.data() || {};
            if (!['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status)) throw jasaAdminError(409, 'invalid-order-state', 'Laporan hanya dapat ditambahkan pada pesanan yang telah dibayar.');
            await db.runTransaction(async (transaction) => {
                const current = await transaction.get(ref);
                if (!current.exists || !['paid', 'scheduled', 'in_progress', 'completed'].includes(current.data()?.status)) throw jasaAdminError(409, 'invalid-order-state', 'Status pesanan berubah; laporan tidak dapat disimpan.');
                const currentOrder = current.data() || {};
                transaction.update(ref, { visits: [...(Array.isArray(currentOrder.visits) ? currentOrder.visits : []), visit], updatedAt: Date.now() });
            });
            try {
                await sendEmail({
                    to: order.buyerEmail,
                    subject: `Laporan pengerjaan ${id} — Gamon Jasa`,
                    text: `Penyedia jasa: ${staffName}\n${note}\n\n${reportText}`,
                    html: `<p>Penyedia jasa: <b>${jasaAdminEscape(staffName)}</b></p><p><b>${jasaAdminEscape(note)}</b></p><p style="white-space:pre-wrap">${jasaAdminEscape(reportText)}</p><p>Waktu: ${new Date(visit.at).toLocaleString('id-ID')}</p>`
                });
            } catch (error) {
                console.error('[jasa admin] email pembaruan layanan gagal:', { orderId: id, code: error.code || 'unknown', message: error.message });
            }
            return res.status(200).json({ success: true, message: 'Pembaruan layanan berhasil disimpan.' });
        }
        if (action === 'jasa-seed') {
            const now = Date.now();
            const categories = [
                { id: 'umum', name: 'Layanan Umum', slug: 'umum', icon: 'handyman', tagline: '', description: '', active: true, order: 0 }
            ].map((item) => ({ ...item, createdAt: now, updatedAt: now }));
            const services = [
                {
                    id: 'contoh-cuci-ac', data: {
                        categoryId: 'umum', name: 'Contoh: Cuci AC',
                        summary: 'Pembersihan AC di lokasi pelanggan.',
                        description: 'Pembersihan AC di lokasi pelanggan.',
                        image: '', active: true, disclaimer: '', pricingNote: '', unit: 'per unit',
                        needsParentProfile: false, scheduleMode: 'datetime', scheduleLabel: 'Waktu pengerjaan',
                        recipientLabel: 'Lokasi layanan', consentText: '',
                        paymentOptions: ['full', 'cash'],
                        packages: [
                            { id: 'default', name: 'Contoh: Cuci AC', description: '', duration: '', priceType: 'fixed', price: 75000, dpPercent: 30, active: true }
                        ],
                        options: [], formFields: []
                    }
                },
                {
                    id: 'contoh-perbaikan-ringan', data: {
                        categoryId: 'umum', name: 'Contoh: Perbaikan Ringan',
                        summary: 'Perbaikan ringan di lokasi pelanggan dengan harga yang disepakati.',
                        description: 'Perbaikan ringan di lokasi pelanggan dengan harga yang disepakati.',
                        image: '', active: true, disclaimer: '', pricingNote: '', unit: '',
                        needsParentProfile: false, scheduleMode: 'datetime', scheduleLabel: 'Waktu pengerjaan',
                        recipientLabel: 'Lokasi layanan', consentText: '',
                        paymentOptions: ['cash'],
                        packages: [
                            { id: 'default', name: 'Contoh: Perbaikan Ringan', description: '', duration: '', priceType: 'quote', price: 0, dpPercent: 30, active: true }
                        ],
                        options: [], formFields: []
                    }
                }
                            ,
                {
                    id: 'contoh-website-gratis', data: {
                        categoryId: 'umum', name: 'Contoh: Pembuatan Website Gratis',
                        summary: 'Pembuatan website sederhana tanpa biaya.',
                        description: 'Pembuatan website sederhana tanpa biaya. Admin akan menghubungi Anda untuk membahas kebutuhan website.',
                        image: '', active: true, isFree: true, disclaimer: 'Kuota layanan gratis terbatas dan dikonfirmasi admin.', pricingNote: '', unit: '',
                        needsParentProfile: false, scheduleMode: 'datetime', scheduleLabel: 'Waktu konsultasi',
                        recipientLabel: 'Lokasi layanan', consentText: '',
                        paymentOptions: ['full'],
                        packages: [
                            { id: 'default', name: 'Contoh: Pembuatan Website Gratis', description: '', duration: '', priceType: 'free', price: 0, dpPercent: 30, active: true }
                        ],
                        options: [], formFields: []
                    }
                }
            ].map((item) => ({ ...item, data: { ...item.data, createdAt: now, updatedAt: now } }));
            const categoryRefs = categories.map((item) => db.collection('jasa_categories').doc(item.id));
            const serviceRefs = services.map((item) => db.collection('jasa_services').doc(item.id));
            const result = await db.runTransaction(async (transaction) => {
                const snapshots = await Promise.all([...categoryRefs, ...serviceRefs].map((ref) => transaction.get(ref)));
                const createdCategories = [];
                const createdServices = [];
                categories.forEach((item, index) => {
                    if (!snapshots[index].exists) {
                        transaction.create(categoryRefs[index], item);
                        createdCategories.push(item.name);
                    }
                });
                services.forEach((item, index) => {
                    const snapshotIndex = categories.length + index;
                    if (!snapshots[snapshotIndex].exists) {
                        transaction.create(serviceRefs[index], item.data);
                        createdServices.push(item.data.name);
                    }
                });
                return { createdCategories, createdServices };
            });
            return res.status(200).json({
                success: true,
                ...result,
                message: result.createdServices.length || result.createdCategories.length
                    ? 'Contoh kategori dan layanan yang belum ada berhasil ditambahkan.'
                    : 'Semua contoh data sudah ada.'
            });
        }
        return res.status(404).json({ success: false, code: 'unknown-action', message: 'Aksi Gamon Jasa tidak dikenal.' });
    } catch (error) {
        console.error('[jasa admin] aksi gagal:', { action, code: error.code || 'unknown', message: error.message });
        return res.status(error.statusCode || 500).json({ success: false, code: error.code || 'jasa-admin-failed', message: error.message || 'Permintaan admin jasa gagal.' });
    }
}

/* =====================================================================
 * BAJU QR
 * Admin : qrbaju-list, qrbaju-generate, qrbaju-update, qrbaju-delete
 * Publik: qrbaju-view (scan QR depan), qrbaju-manage-get / qrbaju-manage-save (QR tersembunyi)
 * ===================================================================== */
const QRBAJU_TAGS = 'qrbaju_tags';
const QRBAJU_IMAGES = 'qrbaju_images';
const QRBAJU_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const QRBAJU_THEMES = ['sky', 'coral', 'sun', 'mint', 'ink'];
const QRBAJU_REPORTS = 'qrbaju_reports';
const QRBAJU_REPORT_REASONS = ['penipuan', 'berbahaya', 'tidak-pantas', 'identitas', 'spam', 'lainnya'];

function qrbajuError(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

function qrbajuRandom(length) {
    return Array.from({ length }, () => QRBAJU_ALPHABET[crypto.randomInt(QRBAJU_ALPHABET.length)]).join('');
}

function qrbajuLine(value, maxLength, label, required = false) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (required && !text) throw qrbajuError(400, 'invalid-input', `${label} wajib diisi.`);
    return text;
}

function qrbajuText(value, maxLength) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function qrbajuCode(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw qrbajuError(400, 'invalid-code', 'Kode QR tidak valid.');
    return code;
}

function qrbajuSecret(value) {
    const secret = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{16,40}$/.test(secret)) throw qrbajuError(400, 'invalid-secret', 'Kode rahasia tidak valid.');
    return secret;
}

function qrbajuUrl(value, label) {
    const raw = qrbajuLine(value, 500, label);
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try {
        parsed = new URL(candidate);
    } catch (error) {
        throw qrbajuError(400, 'invalid-url', `${label} bukan alamat yang valid.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
        throw qrbajuError(400, 'invalid-url', `${label} harus berupa alamat situs (http atau https).`);
    }
    return parsed.toString();
}

function qrbajuImage(value) {
    if (typeof value !== 'string' || value.length > 300000) {
        throw qrbajuError(400, 'invalid-image', 'Gambar terlalu besar. Pilih gambar yang lebih kecil.');
    }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        throw qrbajuError(400, 'invalid-image', 'Format gambar tidak valid.');
    }
    return value;
}

function qrbajuContent(body) {
    const mode = body.mode === 'redirect' ? 'redirect' : 'card';
    const theme = QRBAJU_THEMES.includes(body.theme) ? body.theme : 'sky';
    const title = qrbajuLine(body.title, 60, 'Judul', mode === 'card');
    const text = qrbajuText(body.text, 600);
    const redirectUrl = mode === 'redirect' ? qrbajuUrl(body.redirectUrl, 'Link tujuan') : '';
    if (mode === 'redirect' && !redirectUrl) throw qrbajuError(400, 'invalid-url', 'Link tujuan wajib diisi.');

    const linksInput = Array.isArray(body.links) ? body.links : [];
    if (linksInput.length > 5) throw qrbajuError(400, 'too-many-links', 'Maksimal 5 tombol link.');
    const links = linksInput
        .filter((item) => item && (String(item.label || '').trim() || String(item.url || '').trim()))
        .map((item, index) => {
            const label = qrbajuLine(item.label, 30, `Nama tombol ${index + 1}`, true);
            const url = qrbajuUrl(item.url, `Link tombol ${index + 1}`);
            if (!url) throw qrbajuError(400, 'invalid-url', `Link tombol ${index + 1} wajib diisi.`);
            return { label, url };
        });

    let whatsapp = '';
    if (String(body.whatsapp || '').trim()) {
        whatsapp = normalizeWhatsapp(body.whatsapp);
        if (!/^\d{9,15}$/.test(whatsapp)) throw qrbajuError(400, 'invalid-whatsapp', 'Nomor WhatsApp tidak valid.');
    }

    return { mode, theme, title, text, links, whatsapp, redirectUrl };
}

function qrbajuPublicData(tag, image) {
    return {
        code: tag.code,
        configured: tag.configured === true,
        mode: tag.mode || 'card',
        theme: tag.theme || 'sky',
        title: tag.title || '',
        text: tag.text || '',
        links: Array.isArray(tag.links) ? tag.links : [],
        whatsapp: tag.whatsapp || '',
        redirectUrl: tag.redirectUrl || '',
        scans: Number(tag.scans || 0),
        image: image || ''
    };
}

async function qrbajuReadImage(db, tag) {
    if (!tag.hasImage) return '';
    const snap = await db.collection(QRBAJU_IMAGES).doc(tag.code).get();
    return snap.exists ? String(snap.data()?.data || '') : '';
}

async function sendQrReportEmail(report) {
    loadLocalEnvIfNeeded();
    const pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    if (!pass) return;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: OWNER_EMAIL, pass } });
    await transporter.sendMail({
        from: '"Notifier Gamon Space" <' + OWNER_EMAIL + '>',
        to: ADMIN_EMAIL,
        subject: `🚩 Laporan Baju QR - ${report.code} (${report.reason})`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
                <h2 style="margin-top:0;color:#111827">Ada laporan halaman Baju QR 🚩</h2>
                <table style="width:100%;font-size:14px;border-collapse:collapse;margin:12px 0">
                    <tr><td style="padding:6px 0"><b>Kode QR</b></td><td>${escapeMailHtml(report.code)}</td></tr>
                    <tr><td style="padding:6px 0"><b>Alasan</b></td><td>${escapeMailHtml(report.reason)}</td></tr>
                    <tr><td style="padding:6px 0"><b>Judul halaman</b></td><td>${escapeMailHtml(report.tagTitle || '-')}</td></tr>
                    <tr><td style="padding:6px 0"><b>Link tujuan</b></td><td>${escapeMailHtml(report.tagRedirectUrl || '-')}</td></tr>
                    <tr><td style="padding:6px 0"><b>Kontak pelapor</b></td><td>${escapeMailHtml(report.contact || '-')}</td></tr>
                </table>
                <p style="margin:0 0 6px"><b>Penjelasan:</b></p>
                <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:13px;white-space:pre-wrap">${escapeMailHtml(report.detail || '-')}</div>
                <p style="font-size:12px;color:#64748b;margin-top:14px">Tinjau di Admin &gt; Kelola Baju QR &gt; Laporan halaman.</p>
            </div>`
    });
}

async function qrbajuAction(req, res, action) {
    const publicMethods = { 'qrbaju-view': 'GET', 'qrbaju-manage-get': 'GET', 'qrbaju-manage-save': 'POST', 'qrbaju-report': 'POST' };
const adminMethods = { 'qrbaju-list': 'GET', 'qrbaju-generate': 'POST', 'qrbaju-update': 'POST', 'qrbaju-delete': 'POST', 'qrbaju-reports-list': 'GET', 'qrbaju-report-update': 'POST' };
    const method = publicMethods[action] || adminMethods[action];
    if (req.method !== method) return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    let authResult = null;
    if (adminMethods[action]) {
        authResult = await requireAdmin(req, res);
        if (!authResult) return;
    }

    res.setHeader('Cache-Control', 'no-store');
    const db = getAdminDb();
    const body = req.body || {};
    const adminEmail = authResult?.claims?.email || OWNER_EMAIL;

    try {
        /* ---------- PUBLIK: scan QR depan ---------- */
        if (action === 'qrbaju-view') {
            const code = qrbajuCode(req.query?.c);
            const ref = db.collection(QRBAJU_TAGS).doc(code);
            const snap = await ref.get();
            if (!snap.exists) throw qrbajuError(404, 'not-found', 'Kode QR tidak ditemukan.');
            const tag = snap.data() || {};
            if (tag.active === false) throw qrbajuError(410, 'inactive', 'QR ini sedang dinonaktifkan.');
            try {
                await ref.update({ scans: FieldValue.increment(1), lastScanAt: Date.now() });
            } catch (error) {
                console.warn('[qrbaju] hitung scan gagal:', error.message);
            }
            if (!tag.configured) return res.status(200).json({ success: true, configured: false });
            const image = await qrbajuReadImage(db, tag);
            return res.status(200).json({ success: true, ...qrbajuPublicData(tag, image) });
        }

        /* ---------- PUBLIK: QR tersembunyi (baca + simpan) ---------- */
        if (action === 'qrbaju-manage-get' || action === 'qrbaju-manage-save') {
            const secret = qrbajuSecret(action === 'qrbaju-manage-get' ? req.query?.k : body.k);
            const found = await db.collection(QRBAJU_TAGS).where('secret', '==', secret).limit(1).get();
            if (found.empty) throw qrbajuError(404, 'not-found', 'QR tidak ditemukan.');
            const ref = found.docs[0].ref;
            const tag = found.docs[0].data() || {};

            if (action === 'qrbaju-manage-get') {
                const image = await qrbajuReadImage(db, tag);
                return res.status(200).json({ success: true, data: qrbajuPublicData(tag, image) });
            }

            if (tag.active === false) throw qrbajuError(403, 'inactive', 'QR ini sedang dinonaktifkan oleh admin.');
            const content = qrbajuContent(body);
            const now = Date.now();
            const imageRef = db.collection(QRBAJU_IMAGES).doc(tag.code);
            let hasImage = tag.hasImage === true;
            let imageVersion = Number(tag.imageVersion || 0);
            let image = '';

            if (body.imageData) {
                image = qrbajuImage(body.imageData);
                await imageRef.set({ data: image, updatedAt: now });
                hasImage = true;
                imageVersion = now;
            } else if (body.removeImage === true) {
                await imageRef.delete();
                hasImage = false;
                imageVersion = now;
            } else {
                image = await qrbajuReadImage(db, tag);
            }

            const next = {
                ...content,
                configured: true,
                hasImage,
                imageVersion,
                configuredAt: tag.configuredAt || now,
                updatedAt: now
            };
            await ref.set(next, { merge: true });
            return res.status(200).json({
                success: true,
                message: 'Tersimpan.',
                data: qrbajuPublicData({ ...tag, ...next }, hasImage ? image : '')
            });
        }

        /* ---------- ADMIN ---------- */
        if (action === 'qrbaju-list') {
            const snapshot = await db.collection(QRBAJU_TAGS).get();
            const tags = snapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, 1000);
            return res.status(200).json({ success: true, data: tags });
        }

        if (action === 'qrbaju-generate') {
            const count = Number.parseInt(body.count, 10);
            if (!Number.isInteger(count) || count < 1 || count > 50) {
                throw qrbajuError(400, 'invalid-count', 'Jumlah harus 1 sampai 50.');
            }
            const prefix = qrbajuLine(body.label, 60, 'Label');
            const now = Date.now();
            const created = await Promise.all(Array.from({ length: count }, async (_, index) => {
                for (let attempt = 0; attempt < 6; attempt += 1) {
                    const code = qrbajuRandom(8);
                    const data = {
                        code,
                        secret: qrbajuRandom(20),
                        label: count > 1 && prefix ? `${prefix} ${index + 1}` : prefix,
                        active: true,
                        configured: false,
                        mode: 'card',
                        theme: 'sky',
                        title: '',
                        text: '',
                        links: [],
                        whatsapp: '',
                        redirectUrl: '',
                        hasImage: false,
                        imageVersion: 0,
                        scans: 0,
                        lastScanAt: 0,
                        createdAt: now,
                        updatedAt: now,
                        createdBy: adminEmail
                    };
                    try {
                        await db.collection(QRBAJU_TAGS).doc(code).create(data);
                        return data;
                    } catch (error) {
                        if (error.code === 6 || /already exists/i.test(String(error.message))) continue;
                        throw error;
                    }
                }
                throw qrbajuError(500, 'code-collision', 'Gagal membuat kode unik. Coba lagi.');
            }));
            return res.status(200).json({ success: true, data: created, message: `${created.length} pasangan QR berhasil dibuat.` });
        }

        if (action === 'qrbaju-update') {
            const code = qrbajuCode(body.code);
            const ref = db.collection(QRBAJU_TAGS).doc(code);
            const snap = await ref.get();
            if (!snap.exists) throw qrbajuError(404, 'not-found', 'QR tidak ditemukan.');
            const patch = { updatedAt: Date.now() };

            if (body.active !== undefined) {
                if (typeof body.active !== 'boolean') throw qrbajuError(400, 'invalid-active', 'Status aktif harus boolean.');
                patch.active = body.active;
            }
            if (body.label !== undefined) patch.label = qrbajuLine(body.label, 60, 'Label');
            if (body.regenerateSecret === true) patch.secret = qrbajuRandom(20);
            if (body.resetContent === true) {
                Object.assign(patch, {
                    configured: false, mode: 'card', theme: 'sky', title: '', text: '',
                    links: [], whatsapp: '', redirectUrl: '', hasImage: false, imageVersion: Date.now()
                });
                await db.collection(QRBAJU_IMAGES).doc(code).delete();
            }
            await ref.set(patch, { merge: true });
            return res.status(200).json({ success: true, message: 'QR berhasil diperbarui.' });
        }

        if (action === 'qrbaju-delete') {
            const code = qrbajuCode(body.code);
            await db.collection(QRBAJU_TAGS).doc(code).delete();
            await db.collection(QRBAJU_IMAGES).doc(code).delete();
            return res.status(200).json({ success: true, message: 'QR berhasil dihapus.' });
        }
        /* ---------- PUBLIK: kirim laporan ---------- */
        if (action === 'qrbaju-report') {
            // Honeypot: bot mengisi kolom tersembunyi, pura-pura sukses agar tidak mencoba lagi.
            if (String(body.website || '').trim()) return res.status(200).json({ success: true, message: 'Laporan diterima.' });

            const code = qrbajuCode(body.c);
            const reason = String(body.reason || '');
            if (!QRBAJU_REPORT_REASONS.includes(reason)) throw qrbajuError(400, 'invalid-reason', 'Pilih alasan laporan.');
            const detail = qrbajuText(body.detail, 500);
            if (reason === 'lainnya' && detail.length < 10) throw qrbajuError(400, 'detail-required', 'Untuk alasan "Lainnya", tulis penjelasan minimal 10 huruf.');
            const contact = qrbajuLine(body.contact, 100, 'Kontak');

            const tagRef = db.collection(QRBAJU_TAGS).doc(code);
            const tagSnap = await tagRef.get();
            if (!tagSnap.exists) throw qrbajuError(404, 'not-found', 'Kode QR tidak ditemukan.');
            const tag = tagSnap.data() || {};

            // Batasi 3 laporan per jam per pengirim. IP disimpan sebagai hash, bukan IP asli.
            const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
            const ipHash = crypto.createHash('sha256').update(`${forwarded}:${process.env.QRBAJU_SALT || 'qrbaju'}`).digest('hex').slice(0, 32);
            const now = Date.now();
            const recent = await db.collection(QRBAJU_REPORTS).where('ipHash', '==', ipHash).limit(20).get();
            if (recent.docs.filter((d) => Number(d.data()?.createdAt || 0) > now - 60 * 60 * 1000).length >= 3) {
                throw qrbajuError(429, 'too-many-reports', 'Terlalu banyak laporan dari jaringanmu. Coba lagi satu jam lagi.');
            }

            const report = {
                code,
                reason,
                detail,
                contact,
                status: 'new',
                ipHash,
                tagTitle: String(tag.title || '').slice(0, 60),
                tagMode: tag.mode || 'card',
                tagRedirectUrl: String(tag.redirectUrl || '').slice(0, 500),
                createdAt: now
            };
            await db.collection(QRBAJU_REPORTS).doc().set(report);
            try {
                await tagRef.update({ reportCount: FieldValue.increment(1), lastReportAt: now });
            } catch (error) {
                console.warn('[qrbaju] hitung laporan gagal:', error.message);
            }
            try {
                await sendQrReportEmail(report);
            } catch (error) {
                console.warn('[qrbaju] email laporan gagal:', error.message);
            }
            return res.status(200).json({ success: true, message: 'Laporan diterima.' });
        }

        /* ---------- ADMIN: daftar & tindak lanjut laporan ---------- */
        if (action === 'qrbaju-reports-list') {
            const snapshot = await db.collection(QRBAJU_REPORTS).get();
            const reports = snapshot.docs
                .map((item) => {
                    const { ipHash, ...rest } = item.data() || {};
                    return { id: item.id, ...rest };
                })
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, 300);
            return res.status(200).json({ success: true, data: reports });
        }

        if (action === 'qrbaju-report-update') {
            const id = String(body.id || '').trim();
            if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw qrbajuError(400, 'invalid-id', 'ID laporan tidak valid.');
            const status = String(body.status || '');
            if (!['new', 'reviewed', 'dismissed'].includes(status)) throw qrbajuError(400, 'invalid-status', 'Status tidak valid.');
            const ref = db.collection(QRBAJU_REPORTS).doc(id);
            const snap = await ref.get();
            if (!snap.exists) throw qrbajuError(404, 'not-found', 'Laporan tidak ditemukan.');
            const now = Date.now();
            await ref.set({ status, reviewedAt: now, reviewedBy: adminEmail }, { merge: true });
            if (body.deactivateTag === true) {
                const tagRef = db.collection(QRBAJU_TAGS).doc(String(snap.data()?.code || ''));
                const tagSnap = await tagRef.get();
                if (tagSnap.exists) await tagRef.update({ active: false, updatedAt: now });
            }
            return res.status(200).json({ success: true, message: 'Laporan diperbarui.' });
        }

        return res.status(404).json({ success: false, code: 'unknown-action', message: 'Aksi Baju QR tidak dikenal.' });
    } catch (error) {
        if (!error.statusCode) console.error('[qrbaju] aksi gagal:', { action, code: error.code || 'unknown', message: error.message });
        return res.status(error.statusCode || 500).json({
            success: false,
            code: error.code || 'qrbaju-failed',
            message: error.statusCode ? error.message : 'Terjadi kesalahan server. Coba lagi.'
        });
    }
}

export default async function handler(req, res) {
    const action = String(req?.query?.action || '').toLowerCase();

    switch (action) {
        case 'submit-wedding-request':
            return handleSubmitWeddingRequest(req, res);
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
        case 'get-ldr-frames':
            return handleGetLdrFrames(req, res);
        case 'save-ldr-frame':
            return handleSaveLdrFrame(req, res);
        case 'toggle-ldr-frame':
            return handleToggleLdrFrame(req, res);
        case 'delete-ldr-frame':
            return handleDeleteLdrFrame(req, res);
        case 'get-redeem-codes':
            return handleGetRedeemCodes(req, res);
        case 'get-wedding-requests':
            return handleGetWeddingRequests(req, res);
        case 'get-match-confirm-requests':
            return handleGetMatchConfirmRequests(req, res);
        case 'get-marketplace-items':
            return handleGetMarketplaceItems(req, res);
        case 'get-marketplace-products':
            return handleGetMarketplaceProducts(req, res);
        case 'save-marketplace-product':
            return handleSaveMarketplaceProduct(req, res);
        case 'delete-marketplace-product':
            return handleDeleteMarketplaceProduct(req, res);
        case 'get-marketplace-orders':
            return handleGetMarketplaceOrders(req, res);
        case 'update-marketplace-order-status':
            return handleUpdateMarketplaceOrderStatus(req, res);
        case 'release-expired-reservations':
            return handleReleaseExpiredMarketplaceReservations(req, res);
        case 'migrate-marketplace-stock':
            return handleMigrateMarketplaceStock(req, res);
        case 'update-marketplace-item-status':
            return handleUpdateMarketplaceItemStatus(req, res);
        case 'get-marketplace-chat-threads':
            return handleGetMarketplaceChatThreads(req, res);
        case 'send-marketplace-chat-message':
            return handleSendMarketplaceChatMessage(req, res);
        case 'update-wedding-request-status':
            return handleUpdateWeddingRequestStatus(req, res);
        case 'save-redeem-code':
            return handleSaveRedeemCode(req, res);
        case 'toggle-redeem-code':
            return handleToggleRedeemCode(req, res);
        case 'delete-redeem-code':
            return handleDeleteRedeemCode(req, res);
        case 'notify-marketplace-chat-reply':
            return handleNotifyMarketplaceChatReply(req, res);
        case 'notify-jasa-chat-reply':
            return handleNotifyJasaChatReply(req, res);
        case 'qrbaju-view':
        case 'qrbaju-manage-get':
        case 'qrbaju-manage-save':
        case 'qrbaju-list':
        case 'qrbaju-generate':
        case 'qrbaju-update':
        case 'qrbaju-delete':
        case 'qrbaju-report':
        case 'qrbaju-reports-list':
        case 'qrbaju-report-update':
            return qrbajuAction(req, res, action);
        case 'jasa-get-catalog':
                    case 'jasa-save-category':
                    case 'jasa-save-service':
                    case 'jasa-delete-service':
                    case 'jasa-toggle-active':
                    case 'jasa-get-orders':
                    case 'jasa-update-order-status':
                    case 'jasa-assign-staff':
                    case 'jasa-create-balance-invoice':
                    case 'jasa-mark-cash-paid':
                    case 'jasa-mark-balance-cash-paid':
                    case 'jasa-create-next-invoice':
                    case 'jasa-end-subscription':
                    case 'jasa-set-quote':
                    case 'jasa-add-visit-report':
                    case 'jasa-seed':
                        return jasaAdminAction(req, res, action);
        default:
            return res.status(404).json({ success: false, message: 'Admin action tidak ditemukan.' });
    }
}