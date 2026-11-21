import crypto from 'crypto';
import { getAdminDb } from './firebase-admin.js';
import { verifyAdminSession } from './admin-session.js';

const PAY_WINDOW_MS = 60 * 60 * 1000;
const VALID_DAYS = 7;
const MAX_PER_USER_DAY = 2;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const failHits = new Map();

// Alamat situs untuk return/callback DOKU. Tidak pernah memakai localhost.
const LC_SITE_URL = (() => {
  const s = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[A-Za-z0-9.-]+$/.test(s) && !/localhost|127\.0\.0\.1/.test(s) ? s : 'https://gamon-space.vercel.app';
})();

const fail = (status, code, message) => Object.assign(new Error(message), { statusCode: status, code });
const rand = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const num = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : 0);
const dayKey = (t = Date.now()) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
const isHeld = (o, now) => o.status === 'paid' || (o.status === 'awaiting_payment' && Number(o.paymentExpiresAt || 0) > now);
const dokuSafe = (v, max, fb) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9.\-\/+,=_:'@%() ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || fb;

function newOrderCode() {
  const d = new Date();
  const ymd = String(d.getUTCFullYear()).slice(-2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  return `LC-${ymd}-${rand(6)}`;
}

function normCode(v) {
  const code = clean(v, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^LC[A-Z0-9]{8}$/.test(code)) throw fail(400, 'invalid-code', 'Kode voucher tidak valid.');
  return code;
}

/* ---------------- PRODUK ---------------- */
async function listProducts(db, onlyActive) {
  const [ps, os] = await Promise.all([
    db.collection('lc_products').get(),
    db.collection('lc_orders').where('dayKey', '==', dayKey()).get()
  ]);
  const now = Date.now();
  const used = new Map();
  os.docs.forEach((d) => {
    const o = d.data();
    if (o.status === 'paid') used.set(o.productId, (used.get(o.productId) || 0) + 1);
  });
  return ps.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !onlyActive || p.active !== false)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .map((p) => {
      const u = used.get(p.id) || 0;
      return {
        id: p.id, name: p.name, description: p.description || '', normalPrice: num(p.normalPrice),
        sellPrice: num(p.sellPrice), dailyQuota: num(p.dailyQuota), active: p.active !== false,
        used: u, remaining: Math.max(0, num(p.dailyQuota) - u)
      };
    });
}

async function saveProduct(db, b, adminEmail) {
  const name = clean(b.name, 80);
  const normalPrice = Number(b.normalPrice), sellPrice = Number(b.sellPrice), dailyQuota = Number(b.dailyQuota);
  if (name.length < 2) throw fail(400, 'invalid-name', 'Nama produk minimal 2 huruf.');
  if (!Number.isSafeInteger(normalPrice) || normalPrice < 1000) throw fail(400, 'invalid-normal', 'Harga normal minimal Rp 1.000.');
  if (!Number.isSafeInteger(sellPrice) || sellPrice < 1000 || sellPrice > normalPrice) throw fail(400, 'invalid-sell', 'Harga jual minimal Rp 1.000 dan tidak boleh di atas harga normal.');
  if (!Number.isInteger(dailyQuota) || dailyQuota < 0 || dailyQuota > 1000) throw fail(400, 'invalid-quota', 'Kuota harian harus 0 sampai 1000.');
  const now = Date.now();
  const data = { name, description: clean(b.description, 300), normalPrice, sellPrice, dailyQuota, active: b.active !== false, updatedAt: now, updatedBy: adminEmail };
  if (b.id) {
    const id = clean(b.id, 120);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw fail(400, 'invalid-id', 'ID tidak valid.');
    await db.collection('lc_products').doc(id).set(data, { merge: true });
    return id;
  }
  const ref = db.collection('lc_products').doc();
  await ref.set({ ...data, createdAt: now });
  return ref.id;
}

/* ---------------- DOKU ---------------- */
async function createPayment(order, config, deps, profile) {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  const returnUrl = `${LC_SITE_URL}/user/marketplace/lapar-chicken.html?orderId=${encodeURIComponent(order.orderId)}`;
  const raw = String(process.env.DOKU_PAYMENT_METHODS || 'QRIS').trim();
  const methods = raw.toUpperCase() === 'ALL' ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);
  const payment = { payment_due_date: 60, return_url: returnUrl };
  if (methods.length) payment.payment_method_types = methods;
  const email = String(order.buyerEmail || '').replace(/[^A-Za-z0-9.\-+_@%]/g, '');
  const body = {
    order: {
      amount: order.sellPrice, invoice_number: order.orderId, callback_url: returnUrl,
      line_items: [{ name: dokuSafe('Voucher ' + order.productName, 100, 'Voucher Lapar Chicken'), price: order.sellPrice, quantity: 1 }],
      currency: 'IDR'
    },
    payment,
    customer: {
      name: dokuSafe(order.buyerName, 100, 'Pembeli'),
      email: email.includes('@') ? email.slice(0, 120) : 'pembeli@gamon-space.vercel.app',
      phone: String(profile?.phone || '').replace(/[^0-9+]/g, '').slice(0, 20) || '0000000000',
      address: 'Voucher digital'
    },
    additional_info: { override_notification_url: `${LC_SITE_URL}/api/doku-notify` }
  };
  const path = '/checkout/v1/payment';
  const bodyText = JSON.stringify(body);
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: deps.createDokuHeaders({ ...config, requestId, timestamp, path, bodyText }),
    body: bodyText
  });
  const text = await res.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch (e) { payload = { raw: text.slice(0, 500) }; }
  const paymentUrl = payload?.response?.payment?.url;
  if (!res.ok || typeof paymentUrl !== 'string' || !/^https:\/\//i.test(paymentUrl)) {
    console.error('[lc] respons DOKU:', res.status, JSON.stringify(payload).slice(0, 800));
    throw new Error('DOKU menolak checkout.');
  }
  return { paymentUrl, requestId };
}

export async function applyLcPayment({ orderId, amount, requestId }) {
  const db = getAdminDb();
  const oRef = db.collection('lc_orders').doc(orderId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = 'LC' + rand(8);
    const vRef = db.collection('lc_vouchers').doc(code);
    try {
      return await db.runTransaction(async (t) => {
        const [oSnap, vSnap] = await Promise.all([t.get(oRef), t.get(vRef)]);
        if (!oSnap.exists) return { found: false };
        const o = oSnap.data();
        if (o.status === 'paid' || o.voucherCode) return { found: true, already: true };

        const [paidSnap, pSnap] = await Promise.all([
          t.get(db.collection('lc_orders').where('productId', '==', o.productId).where('dayKey', '==', o.dayKey)),
          t.get(db.collection('lc_products').doc(o.productId))
        ]);
        const now = Date.now();

        // Jika DOKU tidak menyertakan amount, percaya status SUCCESS dari DOKU.
        const hasAmount = amount !== undefined && amount !== null && amount !== '';
        if (hasAmount && Math.round(Number(amount)) !== Number(o.sellPrice)) {
          t.update(oRef, { needsAttention: true, attentionReason: `Nominal DOKU (${amount}) tidak cocok dengan harga voucher (${o.sellPrice}).`, updatedAt: now });
          return { found: true, amountMismatch: true };
        }
        if (vSnap.exists) throw Object.assign(new Error('collision'), { retry: true });

        const paidCount = paidSnap.docs.filter((d) => d.data().status === 'paid').length;
        const quota = num(pSnap.exists ? pSnap.data().dailyQuota : 0);
        const reasons = [];
        if (o.status !== 'awaiting_payment') reasons.push('Dibayar setelah order kedaluwarsa.');
        if (paidCount >= quota) reasons.push('Kuota harian sudah penuh saat pembayaran masuk.');

        t.create(vRef, {
          code, orderId, userId: o.userId, buyerName: o.buyerName, productId: o.productId, productName: o.productName,
          normalPrice: o.normalPrice, sellPrice: o.sellPrice, status: 'ACTIVE', settled: false, redeemedAt: 0,
          createdAt: now, validUntil: now + VALID_DAYS * 86400000
        });
        t.update(oRef, {
          status: 'paid', paidAt: now, voucherCode: code, updatedAt: now, webhookRequestId: clean(requestId, 120),
          ...(reasons.length ? { needsAttention: true, attentionReason: reasons.join(' ') } : {})
        });
        return { found: true, paid: true, code };
      });
    } catch (e) {
      if (e.retry) continue;
      throw e;
    }
  }
  throw new Error('Gagal membuat kode voucher unik.');
}

export async function markLcFailed(orderId, dokuStatus, final = false) {
  const db = getAdminDb();
  const ref = db.collection('lc_orders').doc(orderId);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists || s.data().status !== 'awaiting_payment') return;
    t.update(ref, {
      status: dokuStatus === 'EXPIRED' ? 'expired' : 'payment_failed',
      updatedAt: Date.now(),
      ...(final ? { dokuFinal: true } : {})
    });
  });
}

async function syncPending(req, order, deps) {
  const out = { dokuStatus: '', applied: false, error: '' };
  try {
    const config = deps.getDokuConfig(req);
    const path = `/orders/v1/status/${encodeURIComponent(order.id)}`;
    const timestamp = new Date().toISOString().split('.')[0] + 'Z';
    const requestId = crypto.randomUUID();
    const res = await fetch(`${config.baseUrl}${path}`, { method: 'GET', headers: deps.createDokuHeaders({ ...config, requestId, timestamp, path }) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[lc] cek status DOKU gagal:', order.id, res.status, JSON.stringify(payload).slice(0, 500));
      out.error = `DOKU menjawab HTTP ${res.status}`;
      return out;
    }
    const status = String(payload.transaction?.status || payload.order?.status || payload.status || '').toUpperCase();
    out.dokuStatus = status || 'TIDAK-DIKETAHUI';
    console.log('[lc] status DOKU', order.id, out.dokuStatus, status ? '' : JSON.stringify(payload).slice(0, 500));
    if (['SUCCESS', 'PAID'].includes(status)) {
      const result = await applyLcPayment({ orderId: order.id, amount: payload.order?.amount ?? payload.amount, requestId: payload.transaction?.request_id || requestId });
      console.log('[lc] hasil apply:', order.id, JSON.stringify(result));
      out.applied = Boolean(result.paid || result.already);
      if (result.amountMismatch) out.error = 'Nominal pembayaran tidak cocok dengan harga voucher. Hubungi admin.';
      if (result.found === false) out.error = 'Order tidak ditemukan.';
    } else if (['EXPIRED', 'FAILED', 'CANCELLED', 'DENIED'].includes(status)) {
      await markLcFailed(order.id, status, true);
    }
  } catch (e) {
    console.error('[lc] syncPending error:', order.id, e);
    out.error = e.message || 'Gagal memeriksa pembayaran.';
  }
  return out;
}

/* ---------------- PEMBELI ---------------- */
async function checkout(req, res, claims, deps) {
  const productId = clean(req.body?.productId, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(productId)) throw fail(400, 'invalid-product', 'Produk tidak valid.');
  const db = getAdminDb();
  const now = Date.now();
  const pRef = db.collection('lc_products').doc(productId);
  const q = db.collection('lc_orders').where('productId', '==', productId).where('dayKey', '==', dayKey(now));
  const profSnap = await db.collection('marketplace_users').doc(claims.uid).get();
  const profile = profSnap.exists ? profSnap.data() : {};
  const orderId = newOrderCode();
  const oRef = db.collection('lc_orders').doc(orderId);

    const result = await db.runTransaction(async (t) => {
    const [pSnap, qSnap] = await Promise.all([t.get(pRef), t.get(q)]);
    if (!pSnap.exists || pSnap.data().active === false) throw fail(404, 'product-unavailable', 'Voucher ini sedang tidak dijual.');
    const p = pSnap.data();
    const all = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const paid = all.filter((o) => o.status === 'paid');
    const mine = all.filter((o) => o.userId === claims.uid);
    // Pakai ulang checkout yang belum dibayar dan belum kedaluwarsa (tidak membuat order ganda).
    const pending = mine.find((o) => o.status === 'awaiting_payment' && Number(o.paymentExpiresAt || 0) > now && /^https:\/\//i.test(o.paymentUrl || ''));
    if (pending) return { existing: pending };
    if (mine.filter((o) => o.status === 'paid').length >= MAX_PER_USER_DAY) throw fail(409, 'user-limit', `Maksimal ${MAX_PER_USER_DAY} voucher per produk per hari untuk satu akun.`);
    if (paid.length >= num(p.dailyQuota)) throw fail(409, 'quota-full', 'Kuota voucher hari ini sudah habis. Coba lagi besok.');
    const order = {
      orderId, userId: claims.uid, buyerName: clean(profile.name || claims.name || 'Pembeli', 120),
      buyerEmail: clean(claims.email, 180), productId, productName: clean(p.name, 80),
      normalPrice: num(p.normalPrice), sellPrice: num(p.sellPrice), dayKey: dayKey(now),
      status: 'awaiting_payment', paymentUrl: '', paymentExpiresAt: now + PAY_WINDOW_MS, voucherCode: '',
      createdAt: now, updatedAt: now
    };
    t.create(oRef, order);
    return { order };
  });

  if (result.existing) return res.status(200).json({ success: true, orderId: result.existing.id, paymentUrl: result.existing.paymentUrl, existing: true });
  try {
    const config = deps.getDokuConfig(req);
    const pay = await createPayment(result.order, config, deps, profile);
    await oRef.set({ paymentUrl: pay.paymentUrl, dokuRequestId: pay.requestId, updatedAt: Date.now() }, { merge: true });
    return res.status(200).json({ success: true, orderId, paymentUrl: pay.paymentUrl });
  } catch (e) {
    console.error('[lc] pembayaran gagal disiapkan:', e.message);
    await oRef.set({ status: 'payment_failed', updatedAt: Date.now() }, { merge: true });
    throw fail(502, 'payment-failed', 'Pembayaran belum bisa disiapkan. Coba lagi sebentar.');
  }
}

async function myVouchers(req, res, claims, deps) {
  const db = getAdminDb();
  const fetchAll = () => Promise.all([
    db.collection('lc_orders').where('userId', '==', claims.uid).get(),
    db.collection('lc_vouchers').where('userId', '==', claims.uid).get()
  ]);
  let [os, vs] = await fetchAll();
  const now = Date.now();

  // Cek ke DOKU: order menunggu bayar + order yang baru kedaluwarsa/gagal (siapa tahu sebenarnya sudah dibayar).
  const toCheck = os.docs.filter((d) => {
    const o = d.data();
    if (o.dokuFinal) return false;
    if (o.status === 'awaiting_payment') return true;
    return (o.status === 'expired' || o.status === 'payment_failed') && now - Number(o.createdAt || 0) < 24 * 3600000;
  }).slice(0, 5);

  const checks = [];
  for (const d of toCheck) {
    const r = await syncPending(req, { id: d.id }, deps);
    checks.push({ orderId: d.id, ...r });
    const o = d.data();
    if (o.status === 'awaiting_payment' && Number(o.paymentExpiresAt || 0) <= now && !r.applied) {
      try { await markLcFailed(d.id, 'EXPIRED'); } catch (e) { console.warn('[lc] tandai kedaluwarsa gagal:', d.id, e.message); }
    }
  }
  if (toCheck.length) [os, vs] = await fetchAll();

  const vouchers = vs.docs.map((d) => d.data())
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
    .map((v) => ({
      code: v.code, productName: v.productName, normalPrice: v.normalPrice, sellPrice: v.sellPrice,
      status: v.status, createdAt: v.createdAt, validUntil: v.validUntil, redeemedAt: v.redeemedAt || 0,
      expired: v.status === 'ACTIVE' && v.validUntil < now
    }));
  const pendingOrders = os.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((o) => o.status === 'awaiting_payment' && o.paymentExpiresAt > now && /^https:\/\//i.test(o.paymentUrl || ''))
    .map((o) => ({ orderId: o.id, productName: o.productName, sellPrice: o.sellPrice, paymentUrl: o.paymentUrl, paymentExpiresAt: o.paymentExpiresAt }));
  return res.status(200).json({ success: true, vouchers, pending: pendingOrders, checks });
}

/* ---------------- KASIR ---------------- */
function checkPin(req) {
  const pin = String(process.env.LC_CASHIER_PIN || '').trim();
  if (pin.length < 4) throw fail(503, 'pin-missing', 'PIN kasir belum diatur di server (LC_CASHIER_PIN).');
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hits = (failHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 8) throw fail(429, 'too-many', 'Terlalu banyak percobaan. Tunggu 10 menit.');
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!crypto.timingSafeEqual(h(req.headers?.['x-lc-pin'] || ''), h(pin))) {
    hits.push(now);
    failHits.set(ip, hits);
    throw fail(401, 'bad-pin', 'PIN salah.');
  }
}

function voucherView(v, now = Date.now()) {
  return {
    code: v.code, productName: v.productName, normalPrice: v.normalPrice, status: v.status,
    redeemedAt: v.redeemedAt || 0, validUntil: v.validUntil, expired: v.status === 'ACTIVE' && v.validUntil < now
  };
}

async function redeem(db, code) {
  const ref = db.collection('lc_vouchers').doc(code);
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw fail(404, 'not-found', 'Voucher tidak ditemukan.');
    const v = s.data();
    const now = Date.now();
    if (v.status === 'REDEEMED') throw fail(409, 'already-redeemed', `Voucher SUDAH DIPAKAI pada ${new Date(v.redeemedAt).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}.`);
    if (v.validUntil < now) throw fail(409, 'expired', 'Voucher sudah kedaluwarsa.');
    t.update(ref, { status: 'REDEEMED', redeemedAt: now });
    return voucherView({ ...v, status: 'REDEEMED', redeemedAt: now }, now);
  });
}

async function summary(db) {
  const snap = await db.collection('lc_vouchers').where('status', '==', 'REDEEMED').where('settled', '==', false).get();
  const items = snap.docs.map((d) => d.data()).sort((a, b) => b.redeemedAt - a.redeemedAt);
  const by = {};
  let total = 0;
  items.forEach((v) => {
    total += num(v.normalPrice);
    const k = v.productName || '-';
    by[k] = by[k] || { name: k, count: 0, total: 0 };
    by[k].count += 1;
    by[k].total += num(v.normalPrice);
  });
  return {
    count: items.length, total, byProduct: Object.values(by),
    recent: items.slice(0, 15).map((v) => ({ code: v.code, productName: v.productName, normalPrice: v.normalPrice, redeemedAt: v.redeemedAt }))
  };
}

async function settle(db, note, adminEmail) {
  const snap = await db.collection('lc_vouchers').where('status', '==', 'REDEEMED').where('settled', '==', false).limit(450).get();
  if (snap.empty) throw fail(409, 'nothing', 'Tidak ada voucher yang perlu dilunasi.');
  const total = snap.docs.reduce((s, d) => s + num(d.data().normalPrice), 0);
  const now = Date.now();
  const sRef = db.collection('lc_settlements').doc();
  const batch = db.batch();
  batch.set(sRef, { count: snap.size, total, note: clean(note, 200), createdAt: now, createdBy: adminEmail });
  snap.docs.forEach((d) => batch.update(d.ref, { settled: true, settlementId: sRef.id, settledAt: now }));
  await batch.commit();
  return { count: snap.size, total };
}

/* ---------------- DISPATCHER ---------------- */
export async function handleLcAction(action, req, res, deps) {
  res.setHeader('Cache-Control', 'no-store');
  const m = req.method;
  const need = (method) => { if (m !== method) throw fail(405, 'method-not-allowed', 'Method Not Allowed'); };
  try {
    const db = getAdminDb();
    const body = req.body || {};

    if (action === 'lc-products') {
      need('GET');
      return res.status(200).json({ success: true, today: dayKey(), products: await listProducts(db, true) });
    }

    if (action.startsWith('lc-admin-')) {
      const auth = await verifyAdminSession(req);
      if (!auth.ok) return res.status(auth.status).json(auth.body);
      const email = auth.claims?.email || 'admin';
      if (action === 'lc-admin-products') { need('GET'); return res.status(200).json({ success: true, products: await listProducts(db, false) }); }
      if (action === 'lc-admin-summary') {
        need('GET');
        const [sum, st] = await Promise.all([summary(db), db.collection('lc_settlements').get()]);
        const settlements = st.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
        return res.status(200).json({ success: true, ...sum, settlements });
      }
      if (action === 'lc-admin-save-product') { need('POST'); const id = await saveProduct(db, body, email); return res.status(200).json({ success: true, id, message: 'Produk tersimpan.' }); }
      if (action === 'lc-admin-settle') { need('POST'); const r = await settle(db, body.note, email); return res.status(200).json({ success: true, ...r, message: 'Periode ditandai lunas.' }); }
      throw fail(404, 'unknown-action', 'Aksi tidak dikenal.');
    }

    if (action.startsWith('lc-cashier-')) {
      need('POST');
      checkPin(req);
      if (action === 'lc-cashier-login') return res.status(200).json({ success: true });
      if (action === 'lc-cashier-summary') return res.status(200).json({ success: true, ...(await summary(db)) });
      if (action === 'lc-cashier-lookup') {
        const s = await db.collection('lc_vouchers').doc(normCode(body.code)).get();
        if (!s.exists) throw fail(404, 'not-found', 'Voucher tidak ditemukan.');
        return res.status(200).json({ success: true, voucher: voucherView(s.data()) });
      }
      if (action === 'lc-cashier-redeem') return res.status(200).json({ success: true, voucher: await redeem(db, normCode(body.code)) });
      throw fail(404, 'unknown-action', 'Aksi tidak dikenal.');
    }

    need('POST');
    const claims = await deps.requireBuyer(req, res);
    if (!claims) return;
    if (action === 'lc-checkout') return await checkout(req, res, claims, deps);
    if (action === 'lc-my-vouchers') return await myVouchers(req, res, claims, deps);
    throw fail(404, 'unknown-action', 'Aksi tidak dikenal.');
  } catch (e) {
    if (!e.statusCode) console.error('[lc] gagal:', action, e);
    return res.status(e.statusCode || 500).json({ success: false, code: e.code || 'lc-failed', message: e.statusCode ? e.message : 'Terjadi kesalahan server.' });
  }
}