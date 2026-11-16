import crypto from 'crypto';
import { getAdminDb, getAdminAuth } from './lib/firebase-admin.js';
import { verifyAdminSession } from './lib/admin-session.js';
import { getDokuConfig } from './marketplace.js';

// bodyParser dimatikan supaya body mentah bisa dipakai verifikasi signature webhook Digiflazz.
export const config = { api: { bodyParser: false } };

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const httpErr = (status, code, message) => Object.assign(new Error(message), { status, code });
const clean = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const dokuSafe = (v, n = 100, fb = '-') =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9.\-\/+,=_:'@%() ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) || fb;
const SITE = () => String(process.env.SITE_URL || 'https://gamon-space.vercel.app').replace(/\/$/, '');

/* =========================================================================
 * DIGIFLAZZ
 * ========================================================================= */
function creds() {
  const username = String(process.env.DIGIFLAZZ_USERNAME || '').trim();
  const apiKey = String(process.env.DIGIFLAZZ_API_KEY || '').trim();
  if (!username || !apiKey) throw httpErr(503, 'digiflazz-config-missing', 'DIGIFLAZZ_USERNAME / DIGIFLAZZ_API_KEY belum diatur.');
  return { username, apiKey };
}

// Mode demo: aktif otomatis kalau username/API key belum diisi.
const isDemo = () => !String(process.env.DIGIFLAZZ_USERNAME || '').trim() || !String(process.env.DIGIFLAZZ_API_KEY || '').trim();
const isTesting = () => String(process.env.DIGIFLAZZ_TESTING).toLowerCase() === 'true';

const mk = (name, category, brand, type, price, sku, desc) => ({
  product_name: name, category, brand, type, price, buyer_sku_code: sku,
  buyer_product_status: true, seller_product_status: true, start_cut_off: '00:00', end_cut_off: '00:00', desc
});
const DEMO_LIST = [
  mk('Telkomsel 5.000', 'Pulsa', 'TELKOMSEL', 'Umum', 5100, 'demo-tsel5', 'Pulsa Telkomsel Rp 5.000'),
  mk('Telkomsel 10.000', 'Pulsa', 'TELKOMSEL', 'Umum', 10050, 'demo-tsel10', 'Pulsa Telkomsel Rp 10.000'),
  mk('XL 25.000', 'Pulsa', 'XL', 'Umum', 25000, 'demo-xl25', 'Pulsa XL Rp 25.000'),
  mk('Indosat 20.000', 'Pulsa', 'INDOSAT', 'Umum', 20300, 'demo-isat20', 'Pulsa Indosat Rp 20.000'),
  mk('Telkomsel Data 3GB', 'Data', 'TELKOMSEL', 'Internet', 18500, 'demo-tseldata3', 'Paket data 3GB'),
  mk('Mobile Legends 86 Diamond', 'Games', 'MOBILE LEGENDS', 'Diamond', 21000, 'demo-ml86', 'Top up ML 86 Diamond'),
  mk('Free Fire 100 Diamond', 'Games', 'FREE FIRE', 'Diamond', 14000, 'demo-ff100', 'Top up FF 100 Diamond'),
  mk('Dana 50.000', 'E-Money', 'DANA', 'Umum', 50500, 'demo-dana50', 'Saldo DANA Rp 50.000')
];

// Semua request ke Digiflazz lewat sini. Jika DIGIFLAZZ_BASE_URL diisi, lewat relay (IP tetap).
async function dzPost(path, body) {
  const base = String(process.env.DIGIFLAZZ_BASE_URL || 'https://api.digiflazz.com').replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.RELAY_KEY) headers['x-relay-key'] = process.env.RELAY_KEY;
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

// Cek jam cut-off (WIB). Format "HH:MM"; sama/kosong = tidak ada cut-off.
function inCutOff(p) {
  const s = p.cutStart, e = p.cutEnd;
  if (!s || !e || s === e) return false;
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 16);
  return s < e ? (now >= s && now < e) : (now >= s || now < e);
}

async function syncPrices() {
  let list;
  if (isDemo()) {
    list = DEMO_LIST;
  } else {
    const { username, apiKey } = creds();
    const { json } = await dzPost('/v1/price-list', { cmd: 'prepaid', username, sign: md5(username + apiKey + 'pricelist') });
    list = json?.data;
    if (!Array.isArray(list)) throw httpErr(502, 'pricelist-failed', json?.data?.message || 'Gagal ambil daftar harga Digiflazz.');
  }

  const margin = Number(process.env.TOPUP_MARGIN_PERCENT ?? 3);
  const minMargin = Number(process.env.TOPUP_MARGIN_MIN ?? 500);
  const db = getAdminDb();
  const now = Date.now();
  const categories = new Set();
  let batch = db.batch(), n = 0, total = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };

  for (const p of list) {
    const cost = Number(p.price);
    if (!p.buyer_sku_code || !Number.isFinite(cost) || cost <= 0) continue;
    const active = p.buyer_product_status === true && p.seller_product_status === true;
    const sell = Math.ceil((cost + Math.max(cost * margin / 100, minMargin)) / 100) * 100;
    categories.add(p.category);
    batch.set(db.collection('topup_products').doc(String(p.buyer_sku_code).replace(/\//g, '_')), {
      sku: String(p.buyer_sku_code), name: clean(p.product_name, 150), category: clean(p.category, 60),
      brand: clean(p.brand, 60), type: clean(p.type, 60), desc: clean(p.desc, 300),
      costPrice: cost, sellPrice: sell, active, cutStart: p.start_cut_off || '', cutEnd: p.end_cut_off || '',
      demo: isDemo(), syncedAt: now
    });
    n++; total++;
    if (n >= 400) await flush();
  }
  await flush();

  // Nonaktifkan produk yang sudah tidak ada di daftar terbaru.
  const old = await db.collection('topup_products').where('active', '==', true).get();
  for (const d of old.docs) {
    if (d.data().syncedAt !== now) { batch.update(d.ref, { active: false }); n++; if (n >= 400) await flush(); }
  }
  await flush();
  await db.collection('topup_meta').doc('catalog').set({ categories: [...categories].sort(), syncedAt: now });
  return { total, categories: [...categories].sort() };
}

// Kirim transaksi ke Digiflazz. ref_id yang sama = Digiflazz hanya mengecek status (tidak dobel).
async function callDigiflazz(order) {
  if (isDemo()) {
    return applyDigiflazzResult(order.id, { status: 'Pending', rc: '39', message: 'Mode demo: API Digiflazz belum terhubung' });
  }
  const { username, apiKey } = creds();
  const body = {
    username, buyer_sku_code: order.sku, customer_no: order.customerNo, ref_id: order.id,
    max_price: order.costPrice, sign: md5(username + apiKey + order.id)
  };
  if (isTesting()) body.testing = true;
  const ref = getAdminDb().collection('topup_orders').doc(order.id);
  try {
    const { json } = await dzPost('/v1/transaction', body);
    if (json?.data?.ref_id) return applyDigiflazzResult(order.id, json.data);
    await ref.update({
      dzError: clean(json?.data?.message || json?.message || JSON.stringify(json), 300), needsAttention: true,
      attentionReason: 'Respons Digiflazz tidak dikenali / auth gagal. Cek key, IP whitelist, saldo.',
      lastCheckAt: Date.now(), updatedAt: Date.now()
    });
  } catch (e) {
    console.error('[topup] panggil Digiflazz gagal:', order.id, e.message);
    await ref.update({ dzError: clean(e.message, 300), lastCheckAt: Date.now(), updatedAt: Date.now() }).catch(() => {});
  }
}

// Terapkan hasil Digiflazz (dari respons langsung atau webhook) ke order.
async function applyDigiflazzResult(orderId, data) {
  const db = getAdminDb();
  const ref = db.collection('topup_orders').doc(orderId);
  const st = String(data.status || '').toLowerCase();
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) return { found: false };
    const o = s.data();
    if (['success', 'refunded'].includes(o.status)) return { ignored: true };
    const now = Date.now();
    const base = {
      dzStatus: clean(data.status, 20), dzRc: clean(data.rc, 10), dzMessage: clean(data.message, 200),
      dzBalance: data.buyer_last_saldo ?? null, lastCheckAt: now, updatedAt: now, dzError: ''
    };
    if (st === 'sukses') {
      t.update(ref, { ...base, status: 'success', sn: clean(data.sn, 200), completedAt: now, needsAttention: false, needsRefund: false });
      return { status: 'success' };
    }
    if (st === 'gagal') {
      t.update(ref, {
        ...base, status: 'failed', needsRefund: true, needsAttention: true,
        attentionReason: 'Transaksi Digiflazz gagal; pembeli sudah bayar -> refund manual.', completedAt: now
      });
      return { status: 'failed' };
    }
    t.update(ref, { ...base, status: 'processing' });
    return { status: 'processing' };
  });
}

async function recheck(orderId, force = false) {
  const ref = getAdminDb().collection('topup_orders').doc(orderId);
  const s = await ref.get();
  if (!s.exists) return;
  const o = { id: s.id, ...s.data() };
  if (!['paid', 'processing'].includes(o.status)) return;
  if (!force && Date.now() - Number(o.lastCheckAt || 0) < 8000) return;
  if (o.status === 'paid') await ref.update({ status: 'processing', lastCheckAt: Date.now(), updatedAt: Date.now() });
  await callDigiflazz(o);
}

/* ---------- dipanggil dari api/doku-notify.js ---------- */
export async function applyTopupPayment({ orderId, amount, requestId }) {
  const db = getAdminDb();
  const ref = db.collection('topup_orders').doc(orderId);
  const r = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) return { found: false };
    const o = s.data(), now = Date.now();
    if (Number(amount) !== o.sellPrice) {
      t.update(ref, { needsAttention: true, attentionReason: `Nominal DOKU ${amount} != ${o.sellPrice}`, updatedAt: now });
      return { found: true, mismatch: true };
    }
    if (!['awaiting_payment', 'expired'].includes(o.status)) return { found: true, ignored: true };
    t.update(ref, { status: 'paid', paymentStatus: 'PAID', paidAt: now, webhookRequestId: clean(requestId, 120), updatedAt: now });
    return { found: true, paid: true };
  });
  if (r.paid) await recheck(orderId, true);
  return r;
}

export async function markTopupUnpaid(orderId, dokuStatus) {
  const ref = getAdminDb().collection('topup_orders').doc(orderId);
  const s = await ref.get();
  if (s.exists && s.data().status === 'awaiting_payment') {
    await ref.update({ status: dokuStatus === 'EXPIRED' ? 'expired' : 'payment_failed', paymentStatus: dokuStatus, updatedAt: Date.now() });
  }
}

/* =========================================================================
 * DOKU (pembayaran QRIS)
 * ========================================================================= */
async function createPayment(order, config, email) {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  const returnUrl = `${config.returnBaseUrl}/user/topup/index.html?orderId=${encodeURIComponent(order.id)}`;
  const methods = String(process.env.DOKU_PAYMENT_METHODS || 'QRIS').trim();
  const payment = { payment_due_date: 60, return_url: returnUrl };
  if (methods.toUpperCase() !== 'ALL') payment.payment_method_types = methods.split(',').map((x) => x.trim()).filter(Boolean);
  const body = JSON.stringify({
    order: {
      amount: order.sellPrice, invoice_number: order.id, callback_url: returnUrl, currency: 'IDR',
      line_items: [{ name: dokuSafe(order.productName, 100, 'Topup'), price: order.sellPrice, quantity: 1 }]
    },
    payment,
    customer: {
      name: dokuSafe(order.buyerName, 100, 'Pembeli'),
      email: /@/.test(email) ? String(email).slice(0, 120) : 'pembeli@gamon-space.vercel.app'
    },
    additional_info: { override_notification_url: `${config.siteUrl}/api/doku-notify` }
  });
  const path = '/checkout/v1/payment';
  const digest = crypto.createHash('sha256').update(body).digest('base64');
  const component = [`Client-Id:${config.clientId}`, `Request-Id:${requestId}`, `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`, `Digest:${digest}`].join('\n');
  const signature = crypto.createHmac('sha256', config.secretKey).update(component).digest('base64');
  const res = await fetch(config.baseUrl + path, {
    method: 'POST', body,
    headers: {
      'Client-Id': config.clientId, 'Request-Id': requestId, 'Request-Timestamp': timestamp,
      'Request-Target': path, Digest: digest, Signature: `HMACSHA256=${signature}`, 'Content-Type': 'application/json'
    }
  });
  const raw = await res.text();
  let json; try { json = JSON.parse(raw); } catch (e) { json = {}; }
  const url = json?.response?.payment?.url;
  if (!res.ok || !/^https:\/\//i.test(String(url))) {
    console.error('[topup] DOKU gagal:', res.status, raw.slice(0, 800));
    throw httpErr(502, 'doku-failed', 'Pembayaran gagal disiapkan. Coba lagi sebentar.');
  }
  return { paymentUrl: url, requestId };
}

/* =========================================================================
 * Helper
 * ========================================================================= */
async function requireUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpErr(401, 'unauthenticated', 'Silakan masuk dulu.');
  let c;
  try { c = await getAdminAuth().verifyIdToken(m[1].trim(), true); } catch (e) { throw httpErr(401, 'unauthenticated', 'Sesi tidak valid.'); }
  if (c.email_verified !== true) throw httpErr(403, 'email-not-verified', 'Verifikasi email dulu.');
  return c;
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

function orderCode() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const a = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rand = Array.from({ length: 6 }, () => a[crypto.randomInt(a.length)]).join('');
  return `TU-${String(d.getUTCFullYear()).slice(-2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${rand}`;
}

// Hanya field aman yang dikirim ke pembeli.
const pub = (o) => ({
  id: o.id, productName: o.productName, customerNo: o.customerNo, sellPrice: o.sellPrice, status: o.status,
  sn: o.sn || '', message: o.dzMessage || '', createdAt: o.createdAt,
  paymentUrl: o.status === 'awaiting_payment' ? o.paymentUrl : '', paymentExpiresAt: o.paymentExpiresAt
});

/* =========================================================================
 * Aksi pembeli
 * ========================================================================= */
async function checkout(req, res, claims, body) {
  const productId = clean(body.productId, 120);
  const customerNo = clean(body.customerNo, 40).replace(/[\s.]/g, '');
  if (!productId || productId.includes('/')) throw httpErr(400, 'bad-request', 'Produk tidak valid.');
  if (!/^[0-9A-Za-z@_-]{3,40}$/.test(customerNo)) throw httpErr(400, 'bad-customer', 'Nomor/ID tujuan tidak valid.');
  const db = getAdminDb();

  const ps = await db.collection('topup_products').doc(productId).get();
  if (!ps.exists || ps.data().active !== true) throw httpErr(409, 'product-unavailable', 'Produk sedang tidak tersedia.');
  const p = ps.data();
  if (inCutOff(p)) throw httpErr(409, 'cut-off', `Produk sedang cut-off (${p.cutStart}-${p.cutEnd} WIB).`);

  // Batasi pesanan yang belum dibayar supaya tidak menumpuk.
  const pending = await db.collection('topup_orders').where('userId', '==', claims.uid).where('status', '==', 'awaiting_payment').get();
  const live = pending.docs.filter((d) => Number(d.data().paymentExpiresAt || 0) > Date.now());
  if (live.length >= 3) throw httpErr(429, 'too-many-pending', 'Ada 3 pesanan belum dibayar. Bayar atau tunggu kedaluwarsa dulu.');

  const config = getDokuConfig(req);
  const now = Date.now();
  const order = {
    id: orderCode(), userId: claims.uid, buyerName: clean(claims.name || claims.email, 100), buyerEmail: clean(claims.email, 180),
    sku: p.sku, productName: p.name, customerNo, costPrice: p.costPrice, sellPrice: p.sellPrice, demo: p.demo === true,
    status: 'awaiting_payment', paymentStatus: 'UNPAID', paymentUrl: '', paymentExpiresAt: now + 60 * 60 * 1000,
    createdAt: now, updatedAt: now
  };
  const ref = db.collection('topup_orders').doc(order.id);
  await ref.create(order);
  try {
    const pay = await createPayment(order, config, order.buyerEmail);
    await ref.update({ paymentUrl: pay.paymentUrl, dokuRequestId: pay.requestId });
    return res.status(200).json({ success: true, orderId: order.id, paymentUrl: pay.paymentUrl });
  } catch (e) {
    await ref.update({ status: 'payment_failed', paymentStatus: 'FAILED', updatedAt: Date.now() });
    throw e;
  }
}

// Webhook dari Digiflazz (header X-Hub-Signature = sha1 HMAC dari body mentah, key = secret webhook).
async function digiflazzWebhook(req, res, raw) {
  const secret = String(process.env.DIGIFLAZZ_WEBHOOK_SECRET || '');
  const sig = String(req.headers['x-hub-signature'] || '');
  const expected = 'sha1=' + crypto.createHmac('sha1', secret).update(raw).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send('Invalid signature');
  let payload = {};
  try { payload = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).send('Bad JSON'); }
  const d = payload.data;
  if (d?.ref_id && /^TU-/.test(d.ref_id)) await applyDigiflazzResult(d.ref_id, d);
  return res.status(200).send('OK'); // ping & event lain tetap dibalas 200
}

/* =========================================================================
 * Router
 * ========================================================================= */
export default async function handler(req, res) {
  const action = String(req.query?.action || '').toLowerCase();
  try {
    const raw = req.method === 'POST' ? await readRaw(req) : Buffer.alloc(0);
    let body = {};
    try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (e) { body = {}; }
    const db = getAdminDb();

    /* ---- publik ---- */
    if (action === 'digiflazz-webhook') return await digiflazzWebhook(req, res, raw);

    if (action === 'categories') {
      const s = await db.collection('topup_meta').doc('catalog').get();
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ success: true, categories: s.exists ? s.data().categories : [] });
    }

    if (action === 'products') {
      const cat = clean(req.query.category, 60);
      const snap = await db.collection('topup_products').where('category', '==', cat).where('active', '==', true).get();
      const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !inCutOff(p))
        .map((p) => ({ id: p.id, name: p.name, brand: p.brand, type: p.type, desc: p.desc, sellPrice: p.sellPrice }))
        .sort((x, y) => x.sellPrice - y.sellPrice);
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ success: true, products });
    }

    /* ---- admin (cookie sesi admin) ---- */
    if (action.startsWith('admin-')) {
      if (req.method !== 'POST') throw httpErr(405, 'method-not-allowed', 'Gunakan POST.');
      const auth = await verifyAdminSession(req);
      if (!auth.ok) return res.status(auth.status).json(auth.body);

      if (action === 'admin-sync') return res.status(200).json({ success: true, ...(await syncPrices()) });

      if (action === 'admin-balance') {
        if (isDemo()) return res.status(200).json({ success: true, demo: true, result: { data: { deposit: 0 } } });
        const { username, apiKey } = creds();
        const { json } = await dzPost('/v1/cek-saldo', { cmd: 'deposit', username, sign: md5(username + apiKey + 'depo') });
        return res.status(200).json({ success: true, result: json });
      }

      if (action === 'admin-config') {
        return res.status(200).json({ success: true, config: {
          mode: isDemo() ? 'DEMO (API key belum diisi)' : (isTesting() ? 'TESTING' : 'PRODUCTION'),
          username: isDemo() ? '-' : String(process.env.DIGIFLAZZ_USERNAME).slice(0, 3) + '***',
          webhookSecret: process.env.DIGIFLAZZ_WEBHOOK_SECRET ? 'terisi' : 'belum diisi',
          relay: process.env.DIGIFLAZZ_BASE_URL ? 'aktif' : 'tidak dipakai',
          marginPercent: Number(process.env.TOPUP_MARGIN_PERCENT ?? 3),
          marginMin: Number(process.env.TOPUP_MARGIN_MIN ?? 500),
          webhookUrl: `${SITE()}/api/topup?action=digiflazz-webhook`
        } });
      }

      if (action === 'admin-products') {
        const snap = await db.collection('topup_products').get();
        const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((x, y) => (x.category + x.name).localeCompare(y.category + y.name));
        return res.status(200).json({ success: true, products });
      }

      if (action === 'admin-toggle-product') {
        const id = clean(body.id, 120);
        if (!id || id.includes('/')) throw httpErr(400, 'bad-request', 'ID produk tidak valid.');
        await db.collection('topup_products').doc(id).update({ active: body.active === true });
        return res.status(200).json({ success: true });
      }

      if (action === 'admin-stats') {
        const snap = await db.collection('topup_orders').get();
        const os = snap.docs.map((d) => d.data());
        const ok = os.filter((o) => o.status === 'success');
        const dayAgo = Date.now() - 864e5;
        return res.status(200).json({ success: true, stats: {
          total: os.length, success: ok.length,
          processing: os.filter((o) => ['paid', 'processing'].includes(o.status)).length,
          failed: os.filter((o) => o.status === 'failed').length,
          needsRefund: os.filter((o) => o.needsRefund).length,
          revenue: ok.reduce((s, o) => s + o.sellPrice, 0),
          profit: ok.reduce((s, o) => s + (o.sellPrice - o.costPrice), 0),
          today: os.filter((o) => o.createdAt > dayAgo).length
        } });
      }

      if (action === 'admin-orders') {
        const snap = await db.collection('topup_orders').get();
        const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((x, y) => y.createdAt - x.createdAt).slice(0, 100);
        return res.status(200).json({ success: true, orders });
      }

      if (action === 'admin-recheck') {
        await recheck(clean(body.orderId, 40), true);
        return res.status(200).json({ success: true });
      }

      if (action === 'admin-mark-refunded') {
        const id = clean(body.orderId, 40);
        const ref = db.collection('topup_orders').doc(id);
        const s = await ref.get();
        if (!s.exists || !s.data().needsRefund) throw httpErr(409, 'not-refundable', 'Pesanan tidak menunggu refund.');
        await ref.update({ status: 'refunded', needsRefund: false, needsAttention: false, refundedAt: Date.now(), updatedAt: Date.now() });
        return res.status(200).json({ success: true });
      }

      throw httpErr(404, 'unknown-action', 'Aksi admin tidak dikenal.');
    }

    /* ---- pembeli (butuh login) ---- */
    const claims = await requireUser(req);

    if (action === 'checkout') return await checkout(req, res, claims, body);

    if (action === 'my-orders') {
      const snap = await db.collection('topup_orders').where('userId', '==', claims.uid).get();
      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((x, y) => y.createdAt - x.createdAt).slice(0, 20).map(pub);
      return res.status(200).json({ success: true, orders });
    }

    if (action === 'order-status') {
      const id = clean(body.orderId, 40);
      if (!id || id.includes('/')) throw httpErr(400, 'bad-request', 'Kode pesanan tidak valid.');
      const ref = db.collection('topup_orders').doc(id);
      let s = await ref.get();
      if (!s.exists || s.data().userId !== claims.uid) throw httpErr(404, 'not-found', 'Pesanan tidak ditemukan.');
      const o = s.data();
      if (o.status === 'awaiting_payment' && Number(o.paymentExpiresAt || 0) <= Date.now()) {
        await ref.update({ status: 'expired', paymentStatus: 'EXPIRED', updatedAt: Date.now() });
      } else {
        await recheck(id);
      }
      s = await ref.get();
      return res.status(200).json({ success: true, order: pub({ id, ...s.data() }) });
    }

    throw httpErr(404, 'unknown-action', 'Aksi tidak dikenal.');
  } catch (e) {
    console.error('[topup]', action, e.code || '', e.message);
    return res.status(e.status || 500).json({ success: false, code: e.code || 'topup-failed', message: e.message || 'Gagal.' });
  }
}