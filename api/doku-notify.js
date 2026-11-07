import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applyMarketplacePayment, releaseOrderStock, sendEmail } from './lib/marketplace-orders.js';

const DOKU_CLIENT_ID = String(process.env.DOKU_CLIENT_ID || '').trim();
const DOKU_SECRET_KEY = String(process.env.DOKU_SECRET_KEY || '').trim();
const SITE_URL = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');

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
    return new URL(rawUrl, 'http://localhost').pathname;
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

    const jasaOrderId = values.find((value) => (
        typeof value === 'string' && /^JS-\d{6}-[A-Z0-9]{6}(?:-B)?$/i.test(value.trim())
    ));
    if (jasaOrderId) {
        return jasaOrderId.trim().replace(/-B$/i, '');
    }

    const marketplaceOrderId = values.find((value) => (
        typeof value === 'string' && /^MM-\d{6}-[A-Z0-9]{6}$/i.test(value.trim())
    ));
    if (marketplaceOrderId) {
        return marketplaceOrderId.trim();
    }

    return '';
}

export default async function handler(req, res) {
    // Jika user klik tombol 'Go to Merchant' (Browser mengarah ke sini via GET)
    if (req.method === 'GET') {
        console.log('[DOKU return] RAW REQUEST:', { url: req.url, query: req.query });
        const orderId = getReturnOrderId(req);
        if (orderId.startsWith('JS-')) {
            return res.redirect(302, `/user/jasa/pesanan.html?orderId=${encodeURIComponent(orderId)}`);
        }
        if (orderId.startsWith('MM-')) {
    return res.redirect(302, `/user/marketplace/pesanan.html?orderId=${encodeURIComponent(orderId)}`);
}
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

        // ...dan di bagian akhir GET:
const targetUrl = '/';
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
        const orderInvoice = data.order?.invoice_number;
        const orderId = orderInvoice;
        const status = String(data.transaction?.status || data.target?.status || '').toUpperCase();
        const jasaInvoice = typeof orderInvoice === 'string'
            ? orderInvoice.match(/^(JS-\d{6}-[A-Z0-9]{6})(-B)?$/i)
            : null;

        if (jasaInvoice) {
            const orderId = jasaInvoice[1];
            const db = getFirestore();
            const orderRef = db.collection('jasa_orders').doc(orderId);
            try {
                const result = await db.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(orderRef);
                    if (!snapshot.exists) return { found: false };
                    const order = snapshot.data() || {};
                    const now = Date.now();
                    const payments = Array.isArray(order.payments) ? order.payments : [{
                        id: orderId,
                        kind: 'full',
                        amount: Number(order.totalAmount || 0),
                        method: 'DOKU',
                        status: order.paymentStatus === 'PAID' || ['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status) ? 'PAID' : 'UNPAID',
                        invoiceNumber: orderId,
                        paymentUrl: String(order.paymentUrl || ''),
                        expiresAt: Number(order.paymentExpiresAt || 0),
                        paidAt: Number(order.paidAt || 0)
                    }];
                    const invoiceNumber = String(orderInvoice);
                    const paymentIndex = payments.findIndex((payment) => payment.invoiceNumber === invoiceNumber);
                    if (paymentIndex < 0) return { found: true, ignored: true, missingPayment: true };
                    const payment = payments[paymentIndex];
                    if (['SUCCESS', 'PAID'].includes(status)) {
                        const amount = Number(data.order?.amount);
                        if (!Number.isSafeInteger(amount) || amount !== Number(payment.amount)) {
                            transaction.set(orderRef, {
                                needsAttention: true,
                                attentionReason: 'Nominal pembayaran DOKU tidak cocok dengan tagihan pembayaran.',
                                amountMismatch: { expected: Number(payment.amount), received: amount, invoiceNumber, at: now, source: 'doku-webhook' },
                                updatedAt: now
                            }, { merge: true });
                            return { found: true, amountMismatch: true };
                        }
                        if (payment.status === 'PAID') {
                            return { found: true, alreadyPaid: true };
                        }
                        const inactivePayment = ['CANCELLED', 'EXPIRED'].includes(payment.status);
                        if (payment.status !== 'UNPAID' && !inactivePayment) {
                            return { found: true, ignored: true };
                        }
                        payments[paymentIndex] = { ...payment, status: 'PAID', paidAt: now, requestId: signatureCheck.requestId };
                        const paidAmount = payments.filter((item) => item.status === 'PAID').reduce((sum, item) => sum + Number(item.amount || 0), 0);
                        const remainingAmount = Math.max(0, Number(order.totalAmount || 0) - paidAmount);
                        const paymentStatus = remainingAmount === 0 ? 'PAID' : 'PARTIAL';
                        if (['cancelled', 'expired'].includes(order.status)) {
                            transaction.update(orderRef, {
                                payments,
                                paidAmount,
                                remainingAmount,
                                paymentStatus: order.status === 'cancelled' ? 'CANCELLED' : 'EXPIRED',
                                webhookRequestId: signatureCheck.requestId,
                                needsAttention: true,
                                attentionReason: 'Pembayaran diterima setelah pesanan dibatalkan/kedaluwarsa; tinjau refund manual.',
                                updatedAt: now
                            });
                            return { found: true, paid: true, needsAttention: true, order, payment };
                        }
                        if (inactivePayment) {
                            transaction.update(orderRef, {
                                payments,
                                paidAmount,
                                remainingAmount,
                                paymentStatus,
                                webhookRequestId: signatureCheck.requestId,
                                needsAttention: true,
                                attentionReason: 'Pembayaran diterima untuk tagihan yang dibatalkan atau kedaluwarsa; periksa kemungkinan pembayaran ganda.',
                                statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'late_payment_received', at: now, by: 'doku-webhook' }],
                                updatedAt: now
                            });
                            return { found: true, paid: true, needsAttention: true, order, payment, paymentStatus };
                        }
                        if (payment.kind !== 'balance' && order.status !== 'awaiting_payment') return { found: true, ignored: true };
                        if (payment.kind === 'balance' && !['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status)) return { found: true, ignored: true };
                        transaction.update(orderRef, {
                            ...(payment.kind === 'balance' ? {} : { status: 'paid' }),
                            payments,
                            paidAmount,
                            remainingAmount,
                            paymentStatus,
                            paidAt: now,
                            webhookRequestId: signatureCheck.requestId,
                            statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: payment.kind === 'balance' ? 'balance_paid' : 'paid', at: now, by: 'doku-webhook' }],
                            updatedAt: now
                        });
                        return { found: true, paid: true, order, payment, paymentStatus };
                    }
                    if (['EXPIRED', 'FAILED', 'CANCELLED', 'DENIED'].includes(status) && payment.status === 'UNPAID') {
                        const nextStatus = status === 'EXPIRED' ? 'expired' : 'cancelled';
                        payments[paymentIndex] = { ...payment, status };
                        const primaryPayment = payment.kind !== 'balance';
                        transaction.update(orderRef, {
                            ...(primaryPayment && order.status === 'awaiting_payment' ? { status: nextStatus } : {}),
                            payments,
                            paymentStatus: primaryPayment ? status : 'PARTIAL',
                            statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), ...(primaryPayment ? [{ status: nextStatus, at: now, by: 'doku-webhook' }] : [])],
                            updatedAt: now
                        });
                        return { found: true, updated: true };
                    }
                    return { found: true, ignored: true };
                });
                if (!result.found) return res.status(404).send('Jasa Order Not Found');
                if (result.amountMismatch) {
                    console.error('[DOKU jasa] nominal pembayaran tidak cocok:', orderId);
                    return res.status(400).send('Amount Mismatch');
                }
                if (result.paid) {
                    try {
                        const order = result.order || {};
                        const staffName = String(order.assignedStaff?.name || '').slice(0, 120);
                        const staffText = staffName ? ` Petugas yang akan datang: ${staffName}.` : '';
                        const amountText = Number(result.payment?.amount || 0).toLocaleString('id-ID');
                        const staffHtml = staffName ? `<p>Petugas yang akan datang: ${staffName.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))}.</p>` : '';
                        await sendEmail({
                            to: order.buyerEmail,
                            subject: `Pembayaran diterima — Gamon Jasa ${orderId}`,
                            text: `Pembayaran Rp ${amountText} untuk ${String(order.serviceName || 'layanan jasa').slice(0, 120)} (${orderId}) berhasil diterima.${result.paymentStatus === 'PARTIAL' ? ` Sisa pembayaran masih Rp ${Math.max(0, Number(order.totalAmount || 0) - Number(result.payment?.amount || 0)).toLocaleString('id-ID')}.` : ''}${staffText}`,
                            html: `<p>Pembayaran sebesar <b>Rp ${amountText}</b> untuk <b>${String(order.serviceName || 'layanan jasa').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))}</b> (${orderId}) berhasil diterima.</p>${result.paymentStatus === 'PARTIAL' ? '<p>Masih ada sisa pembayaran yang perlu dilunasi.</p>' : ''}${staffHtml}<p>Kami akan mengabari Anda saat jadwal dikonfirmasi.</p>`
                        });
                    } catch (error) {
                        console.error('[DOKU jasa] email konfirmasi gagal:', { orderId, code: error.code || 'unknown', message: error.message });
                    }
                }
                return res.status(200).send('OK');
            } catch (error) {
                console.error('[DOKU jasa] gagal memproses webhook:', { orderId, code: error.code || 'unknown', message: error.message });
                return res.status(500).send('Jasa webhook processing failed');
            }
        }

        if (typeof orderId === 'string' && /^MM-\d{6}-[A-Z0-9]{6}$/i.test(orderId)) {
            try {
                if (['SUCCESS', 'PAID'].includes(status)) {
                    const result = await applyMarketplacePayment({
                        orderId,
                        amount: data.order?.amount,
                        requestId: signatureCheck.requestId,
                    });
                    if (!result.found) {
                        console.warn('[DOKU marketplace] order tidak ditemukan; event valid sudah diterima:', orderId);
                        return res.status(200).send('Marketplace Order Not Found');
                    }
                    if (result.ignored) {
                        console.warn('[DOKU marketplace] notifikasi pembayaran diabaikan untuk order COD:', orderId);
                        return res.status(200).send('COD Order Ignored');
                    }
                    if (result.amountMismatch || result.needsAttention) {
                        console.error('[DOKU marketplace] pembayaran perlu perhatian admin:', { orderId, amountMismatch: Boolean(result.amountMismatch) });
                    }
                    return res.status(200).send('OK');
                }

                if (status === 'EXPIRED') {
                    await releaseOrderStock(orderId, {
                        status: 'expired',
                        paymentStatus: 'EXPIRED',
                        by: 'doku',
                        reason: 'DOKU mengirim status EXPIRED.',
                    });
                    return res.status(200).send('OK');
                }

                if (['FAILED', 'CANCELLED', 'DENIED'].includes(status)) {
                    await releaseOrderStock(orderId, {
                        status: 'payment_failed',
                        paymentStatus: 'FAILED',
                        by: 'doku',
                        reason: `DOKU mengirim status ${status}.`,
                    });
                    return res.status(200).send('OK');
                }

                console.info('[DOKU marketplace] status event tidak mengubah order:', { orderId, status });
                return res.status(200).send('Not Processed');
            } catch (error) {
                console.error('[DOKU marketplace] gagal memproses webhook:', { orderId, code: error.code || 'unknown', message: error.message });
                return res.status(500).send('Marketplace webhook processing failed');
            }
        }

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