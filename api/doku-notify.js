import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID || process.env.DOKU_PRODUCTION_CLIENT_ID || "BRN-0226-1781255193170";
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY || process.env.DOKU_PRODUCTION_SECRET_KEY || "SK-NgMsKzkHcLlY95v7wsju";

export const config = {
    api: {
        bodyParser: false,
    },
};

if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
}

function getHeader(req, name) {
    const expected = name.toLowerCase();
    const key = Object.keys(req.headers || {}).find((item) => item.toLowerCase() === expected);
    return key ? String(req.headers[key] || '') : '';
}

async function readRawBody(req) {
    if (Buffer.isBuffer(req.rawBody)) {
        return req.rawBody;
    }

    if (req && typeof req.on === 'function' && req.readable !== false) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(Buffer.from(chunk));
        }
        if (chunks.length) {
            return Buffer.concat(chunks);
        }
    }

    if (Buffer.isBuffer(req.body)) {
        return req.body;
    }

    if (typeof req.body === 'string') {
        return Buffer.from(req.body, 'utf8');
    }

    // Object body sudah kehilangan byte asli; jangan gunakan JSON.stringify untuk HMAC.
    return null;
}

function getRequestTarget(req) {
    const rawUrl = String(req.url || '/api/doku-notify');
    return new URL(rawUrl, 'https://gamon-tawing.vercel.app').pathname;
}

function verifyDokuSignature(req, rawBody, fallbackBody = null) {
    const clientId = getHeader(req, 'Client-Id');
    const requestId = getHeader(req, 'Request-Id');
    const requestTimestamp = getHeader(req, 'Request-Timestamp');
    const receivedSignature = getHeader(req, 'Signature');

    if (!clientId || clientId !== DOKU_CLIENT_ID || !requestId || !requestTimestamp || !receivedSignature) {
        return { valid: false, reason: 'Header signature DOKU tidak lengkap atau Client-Id tidak cocok.' };
    }

    const timestampMs = Date.parse(requestTimestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 15 * 60 * 1000) {
        return { valid: false, reason: 'Timestamp notifikasi DOKU kedaluwarsa atau tidak valid.' };
    }

    const receivedBuffer = Buffer.from(receivedSignature);
    const bodies = [{ body: rawBody, mode: 'raw' }];
    if (fallbackBody) {
        bodies.push({ body: Buffer.from(JSON.stringify(fallbackBody), 'utf8'), mode: 'reserialized-json' });
    }

    for (const candidate of bodies) {
        const digest = crypto.createHash('sha256').update(candidate.body).digest('base64');
        const component = [
            `Client-Id:${clientId}`,
            `Request-Id:${requestId}`,
            `Request-Timestamp:${requestTimestamp}`,
            `Request-Target:${getRequestTarget(req)}`,
            `Digest:${digest}`,
        ].join('\n');
        const expectedSignature = `HMACSHA256=${crypto.createHmac('sha256', DOKU_SECRET_KEY).update(component).digest('base64')}`;
        const expectedBuffer = Buffer.from(expectedSignature);
        const valid = expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
        if (valid) {
            return { valid: true, reason: '', requestId, matchMode: candidate.mode, digestPrefix: digest.slice(0, 20) };
        }
    }

    return { valid: false, reason: 'Signature notifikasi DOKU tidak cocok.', requestId, matchMode: null };
}

function getReturnOrderId(req) {
    const query = req.query || {};
    const values = Object.values(query).flatMap((value) => Array.isArray(value) ? value : [value]);
    const ldrOrderId = values.find((value) => (
        typeof value === 'string' && /^LDR-[A-Z0-9]{6}-\d+-[a-f0-9]+$/i.test(value.trim())
    ));

    if (ldrOrderId) {
        return ldrOrderId.trim();
    }

    const photoboxOrderId = values.find((value) => (
        typeof value === 'string' && /^GAMON-\d+$/i.test(value.trim())
    ));

    if (photoboxOrderId) {
        return photoboxOrderId.trim();
    }

    return '';
}

export default async function handler(req, res) {
    // Jika user klik tombol 'Go to Merchant' (Browser mengarah ke sini via GET)
    if (req.method === 'GET') {
        console.log('[DOKU return] RAW REQUEST:', { url: req.url, query: req.query });
        const orderId = getReturnOrderId(req);
        if (orderId.startsWith('LDR-')) {
            try {
                const orderSnapshot = await getFirestore().collection('ldr_order').doc(orderId).get();
                const orderData = orderSnapshot.exists ? orderSnapshot.data() || {} : {};
                const sessionId = typeof orderData.sessionId === 'string' ? orderData.sessionId.trim() : '';
                const params = new URLSearchParams({ orderId });
                if (sessionId) {
                    params.set('sessionId', sessionId);
                }

                const targetUrl = `/foto-ldr.html?${params.toString()}`;
                console.log('[DOKU return] Redirect target:', { targetUrl, orderId, sessionId });
                console.log('[DOKU return] Mengarahkan order LDR ke Foto LDR:', { orderId, sessionId });
                return res.redirect(302, targetUrl);
            } catch (error) {
                console.error('[DOKU return] Gagal mengambil sessionId order LDR:', { orderId, error: error.message });
                const targetUrl = `/foto-ldr.html?orderId=${encodeURIComponent(orderId)}`;
                console.log('[DOKU return] Redirect target:', { targetUrl, orderId, sessionId: null });
                return res.redirect(302, targetUrl);
            }
        }

        const targetUrl = '/photobox.html';
        console.log('[DOKU return] Redirect target:', { targetUrl, orderId: orderId || null });
        console.log('[DOKU return] Order bukan LDR atau identifier tidak tersedia, memakai halaman Photobox:', { orderId: orderId || null });
        return res.redirect(302, targetUrl);
    }

    // Jika DOKU mengirimkan status pembayaran riil (Server-to-Server via POST)
    if (req.method === 'POST') {
        console.log("=== HIT WEBHOOK DOKU VIA POST ===");
        const rawBody = await readRawBody(req);
        const bodyDigest = rawBody === null
            ? null
            : crypto.createHash('sha256').update(rawBody).digest('base64');
        let parsedBody = null;
        if (rawBody !== null) {
            try {
                parsedBody = JSON.parse(rawBody.toString('utf8'));
            } catch (error) {
                parsedBody = null;
            }
        }
        console.log('[DOKU webhook] Raw body diagnostics:', {
            bodyType: typeof req.body,
            rawBodyType: typeof req.rawBody,
            rawBodyLength: rawBody === null ? null : rawBody.length,
            digestPrefix: bodyDigest ? bodyDigest.slice(0, 20) : null,
        });
        if (rawBody === null) {
            console.error('[DOKU webhook] Body mentah tidak tersedia; signature tidak diverifikasi dari JSON hasil serialize ulang.');
            return res.status(400).send('Raw Body Required');
        }
        const signatureCheck = verifyDokuSignature(req, rawBody, parsedBody);
        console.log('[DOKU webhook] Signature verification:', {
            valid: signatureCheck.valid,
            reason: signatureCheck.reason || null,
            requestId: signatureCheck.requestId || null,
            matchMode: signatureCheck.matchMode || null,
            digestPrefix: signatureCheck.digestPrefix || bodyDigest?.slice(0, 20) || null,
        });
        if (!signatureCheck.valid) {
            console.error('[DOKU webhook] Notifikasi ditolak:', signatureCheck.reason);
            return res.status(401).send('Invalid Signature');
        }

        const data = parsedBody;
        if (!data) {
            console.error('[DOKU webhook] Body bukan JSON valid.');
            return res.status(400).send('Invalid JSON');
        }
        console.log("PAYLOAD:", JSON.stringify(data, null, 2));
        
        // Pengaman ekstra: fallback check jika penamaan properti di sandbox sedikit berbeda
        const orderId = data.order?.invoice_number;
        const status = data.transaction?.status || data.target?.status; 

        if (orderId && (status === 'SUCCESS' || status === 'PAID')) {
            const db = getFirestore();
            try {
                const paidAt = Date.now();
                if (String(orderId).startsWith('LDR-')) {
                    const orderRef = db.collection('ldr_order').doc(orderId);
                    const orderSnapshot = await orderRef.get();
                    if (!orderSnapshot.exists) {
                        console.error('[DOKU webhook] Order LDR tidak ditemukan:', orderId);
                        return res.status(404).send('LDR Order Not Found');
                    }

                    const orderData = orderSnapshot.data() || {};
                    const notifiedAmount = Number(data.order?.amount);
                    if (Number(orderData.amount) !== 2000 || notifiedAmount !== Number(orderData.amount)) {
                        console.error('[DOKU webhook] Nominal order LDR tidak cocok:', { orderId, stored: orderData.amount, notified: notifiedAmount });
                        return res.status(400).send('Amount Mismatch');
                    }

                    await orderRef.set({
                        status: "PAID",
                        paymentStatus: "PAID",
                        paidAt,
                        updatedAt: paidAt,
                        webhookRequestId: signatureCheck.requestId,
                    }, { merge: true });

                    if (orderData.sessionId) {
                        await db.collection('fotoLdrSessions').doc(orderData.sessionId).set({
                            paymentOrderId: orderId,
                            paymentStatus: "PAID",
                            updatedAt: paidAt,
                        }, { merge: true });
                    }
                } else {
                    await db.collection('orders').doc(orderId).set({
                        status: "PAID",
                        paymentStatus: "PAID",
                        paidAt,
                        updatedAt: paidAt,
                    }, { merge: true });

                    await db.collection('photobox_order').doc(orderId).set({
                        status: "PAID",
                        paymentStatus: "PAID",
                        paidAt,
                        updatedAt: paidAt,
                    }, { merge: true });
                }

                console.log(`Order ${orderId} berhasil diupdate ke PAID`);
                return res.status(200).send("OK");
            } catch (e) {
                console.error("Gagal update Firestore:", e);
                return res.status(500).send("Gagal Update DB");
            }
        }

        if (orderId && status === 'EXPIRED' && String(orderId).startsWith('LDR-')) {
            const db = getFirestore();
            const orderRef = db.collection('ldr_order').doc(orderId);
            const orderSnapshot = await orderRef.get();
            if (orderSnapshot.exists) {
                const orderData = orderSnapshot.data() || {};
                const expiredAt = Date.now();
                await orderRef.set({ status: 'EXPIRED', paymentStatus: 'EXPIRED', updatedAt: expiredAt, webhookRequestId: signatureCheck.requestId }, { merge: true });
                if (orderData.sessionId) {
                    await db.collection('fotoLdrSessions').doc(orderData.sessionId).set({ paymentStatus: 'EXPIRED', updatedAt: expiredAt }, { merge: true });
                }
            }
            return res.status(200).send('OK');
        }

        return res.status(200).send("Not Processed or Condition Not Met");
    }
    
    return res.status(405).send('Method Not Allowed');
}