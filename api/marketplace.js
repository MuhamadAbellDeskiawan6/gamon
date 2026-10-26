import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAdminAuth, getAdminDb } from './lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { applyMarketplacePayment, reconcilePaidOrdersStock, releaseExpiredReservations, releaseOrderStock, sendEmail, syncPaidOrdersCart } from './lib/marketplace-orders.js';

const PAYMENT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_SITE_URL = 'https://gamon-tawing.vercel.app';
const DEFAULT_DOKU_BASE_URL = 'https://api.doku.com';

function responseError(res, status, code, message, details) {
  return res.status(status).json({ success: false, code, message, ...(details ? { details } : {}) });
}

function readBearerToken(req) {
  const header = String(req.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function requireBuyer(req, res) {
  const token = readBearerToken(req);
  if (!token) {
    responseError(res, 401, 'unauthenticated', 'Silakan masuk kembali.');
    return null;
  }
  try {
        const claims = await getAdminAuth().verifyIdToken(token, true);
    if (claims.email_verified !== true) {
      responseError(res, 403, 'email-not-verified', 'Verifikasi email Anda terlebih dahulu. Cek inbox lalu masuk kembali.');
      return null;
    }
    return claims;
  } catch (error) {
    console.warn('[marketplace] bearer ID token invalid:', error.code || error.message);
    responseError(res, 401, 'unauthenticated', 'Sesi tidak valid. Silakan masuk kembali.');
    return null;
  }
}

// Fallback khusus development: baca variabel DOKU dari file env di folder proyek.
// Tidak berjalan di production (Vercel).
let localEnvLoaded = false;
function loadLocalEnvFallback() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return;

    const wanted = ['DOKU_CLIENT_ID', 'DOKU_SECRET_KEY', 'DOKU_BASE_URL', 'SITE_URL', 'DOKU_PAYMENT_METHODS', 'MARKETPLACE_SHIPPING_FEE', 'GMAIL_APP_PASSWORD', 'ADMIN_NOTIFY_EMAIL'];
  const files = ['.env.local', '.env.development.local', '.env.development', '.env'];
  const found = [];

  for (const file of files) {
    let content = '';
    try {
      content = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    } catch (error) {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || !wanted.includes(match[1])) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value && !String(process.env[match[1]] || '').trim()) {
        process.env[match[1]] = value;
        found.push(`${match[1]}<-${file}`);
      }
    }
  }
  console.log('[marketplace] env fallback:', found.length ? found.join(', ') : 'tidak ada variabel yang ditemukan di file env', '| cwd:', process.cwd());
}

function getDokuConfig(req) {
  loadLocalEnvFallback();
  const clientId = String(process.env.DOKU_CLIENT_ID || '').trim();
  const secretKey = String(process.env.DOKU_SECRET_KEY || '').trim();
  if (!clientId || !secretKey) {
    throw Object.assign(new Error('DOKU_CLIENT_ID dan DOKU_SECRET_KEY wajib diatur di environment server.'), { code: 'doku-config-missing' });
  }

  let baseUrl = String(process.env.DOKU_BASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    console.warn(`[marketplace] DOKU_BASE_URL kosong, memakai default ${DEFAULT_DOKU_BASE_URL}`);
    baseUrl = DEFAULT_DOKU_BASE_URL;
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    throw Object.assign(new Error('DOKU_BASE_URL harus berupa URL HTTPS.'), { code: 'invalid-server-url' });
  }

  // URL publik (HTTPS) untuk webhook DOKU. localhost tidak bisa dijangkau DOKU.
  let siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(siteUrl)) {
    if (siteUrl) console.warn(`[marketplace] SITE_URL "${siteUrl}" bukan HTTPS publik, webhook memakai ${DEFAULT_SITE_URL}`);
    siteUrl = DEFAULT_SITE_URL;
  }

  // URL tujuan redirect browser setelah bayar: kalau dites di localhost, kembali ke localhost.
  const host = String(req?.headers?.host || '');
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const returnBaseUrl = isLocalHost ? `http://${host}` : siteUrl;

  return { clientId, secretKey, baseUrl, siteUrl, returnBaseUrl };
}

function createDokuHeaders({ clientId, secretKey, requestId, timestamp, path, bodyText = '' }) {
  const digest = crypto.createHash('sha256').update(bodyText).digest('base64');
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`,
    `Digest:${digest}`
  ].join('\n');
  const signature = crypto.createHmac('sha256', secretKey).update(component).digest('base64');
  return {
    'Client-Id': clientId,
    'Request-Id': requestId,
    'Request-Timestamp': timestamp,
    'Request-Target': path,
    Digest: digest,
    Signature: `HMACSHA256=${signature}`,
    'Content-Type': 'application/json'
  };
}

function createOrderCode(now = new Date()) {
  const date = [String(now.getUTCFullYear()).slice(-2), String(now.getUTCMonth() + 1).padStart(2, '0'), String(now.getUTCDate()).padStart(2, '0')].join('');
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffix = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `MM-${date}-${suffix}`;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

// DOKU hanya menerima: a-z A-Z 0-9 spasi . - / + , = _ : ' @ % ( )
function dokuSafeText(value, maxLength = 100, fallback = '-') {
  const cleaned = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^A-Za-z0-9.\-\/+,=_:'@%() ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned || fallback;
}

function dokuSafePhone(value) {
  const phone = String(value ?? '').replace(/[^0-9+]/g, '').slice(0, 20);
  return phone || '0000000000';
}

function dokuSafeEmail(value) {
  const email = String(value ?? '').trim().replace(/[^A-Za-z0-9.\-+_@%]/g, '');
  return email.includes('@') ? email.slice(0, 120) : 'pembeli@gamon-tawing.vercel.app';
}

function readShippingAddress(profile) {
  const saved = profile?.shipping || {};
  const latitudeValue = saved.latitude ?? profile?.latitude;
  const longitudeValue = saved.longitude ?? profile?.longitude;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const fields = {
    recipientName: cleanText(saved.recipientName || profile?.name, 120),
    phone: cleanText(saved.phone || profile?.phone, 40),
    address: cleanText(saved.address || profile?.address || profile?.location, 300),
    city: cleanText(saved.city || profile?.city, 100),
    province: cleanText(saved.province, 100),
    postalCode: cleanText(saved.postalCode, 20),
    note: cleanText(saved.note, 500),
    latitude,
    longitude
  };
  const hasCoordinates = latitudeValue !== '' && latitudeValue !== null && latitudeValue !== undefined &&
    longitudeValue !== '' && longitudeValue !== null && longitudeValue !== undefined &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!fields.recipientName || !fields.phone || !fields.address || !hasCoordinates) {
    throw Object.assign(new Error('Lengkapi nama penerima, nomor HP, alamat tertulis, latitude, dan longitude di Profil.'), { code: 'shipping-address-incomplete' });
  }
  return {
    ...fields,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    outsideIndonesia: latitude < -11.2 || latitude > 6.2 || longitude < 95 || longitude > 141
  };
}

function getSafeThumbnail(value) {
  const imageUrl = String(value || '').trim();
  return /^https:\/\//i.test(imageUrl) ? imageUrl.slice(0, 1500) : '';
}

function getShippingFee() {
  const value = Number(process.env.MARKETPLACE_SHIPPING_FEE || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function createDokuPayment(order, config) {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';

  const lineItems = order.items.map((item) => ({
    name: dokuSafeText(item.name, 100, 'Produk'),
    price: item.unitPrice,
    quantity: item.qty
  }));
  if (order.shippingFee > 0) lineItems.push({ name: 'Ongkos kirim', price: order.shippingFee, quantity: 1 });

  // Default QRIS. DOKU_PAYMENT_METHODS=ALL membuka semua metode,
  // atau isi daftar dipisah koma, mis. "QRIS,VIRTUAL_ACCOUNT_BCA".
  const rawMethods = String(process.env.DOKU_PAYMENT_METHODS || 'QRIS').trim();
  const paymentMethods = rawMethods.toUpperCase() === 'ALL'
    ? []
    : rawMethods.split(',').map((value) => value.trim()).filter(Boolean);

  const returnUrl = `${config.returnBaseUrl}/user/marketplace/pesanan.html?orderId=${encodeURIComponent(order.orderId)}`;

  const payment = { payment_due_date: 60, return_url: returnUrl };
  if (paymentMethods.length) payment.payment_method_types = paymentMethods;

  const body = {
    order: {
      amount: order.totalAmount,
      invoice_number: order.orderId,
      callback_url: returnUrl,
      line_items: lineItems,
      currency: 'IDR'
    },
    payment,
    customer: {
      name: dokuSafeText(order.buyerName, 100, 'Pembeli'),
      email: dokuSafeEmail(order.buyerEmail),
      phone: dokuSafePhone(order.buyerPhone),
      address: dokuSafeText(order.shippingAddress.address, 200, 'Alamat pengiriman')
    },
    additional_info: {
      override_notification_url: `${config.siteUrl}/api/doku-notify`
    }
  };

  const path = '/checkout/v1/payment';
  const jsonBody = JSON.stringify(body);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: createDokuHeaders({ ...config, requestId, timestamp, path, bodyText: jsonBody }),
    body: jsonBody
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    payload = { raw: raw.slice(0, 1200) };
  }
  const paymentUrl = payload?.response?.payment?.url;
  if (!response.ok || typeof paymentUrl !== 'string' || !/^https:\/\//i.test(paymentUrl)) {
    console.error('[marketplace] respons DOKU:', response.status, JSON.stringify(payload).slice(0, 1500));
    console.error('[marketplace] body yang dikirim ke DOKU:', jsonBody.slice(0, 1500));
    throw Object.assign(new Error(payload?.error_messages?.join?.(', ') || payload?.message || payload?.error || `DOKU menolak checkout (${response.status}).`), {
      code: 'doku-checkout-failed',
      dokuRequestId: requestId
    });
  }
  return { paymentUrl, requestId };
}

// Tutup checkout lama milik pembeli yang belum dibayar, supaya tidak menumpuk.
async function cancelStaleAwaitingOrders(userId) {
  const snapshot = await getAdminDb()
    .collection('marketplace_orders')
    .where('userId', '==', userId)
    .where('status', '==', 'awaiting_payment')
    .get();

  for (const orderDoc of snapshot.docs) {
    try {
      await releaseOrderStock(orderDoc.id, {
        status: 'cancelled',
        paymentStatus: 'UNPAID',
        by: 'system',
        reason: 'Diganti checkout baru.'
      });
    } catch (error) {
      console.error('[marketplace] gagal menutup checkout lama:', orderDoc.id, error.message);
    }
  }
}

// Membuat pesanan "menunggu pembayaran".
// STOK TIDAK DIKURANGI DI SINI dan keranjang TIDAK dikosongkan.
// Stok baru dikurangi saat pembayaran sukses (applyMarketplacePayment).
async function createPendingOrder(claims) {
  const db = getAdminDb();
  const userId = String(claims.uid);
  const now = Date.now();
  const orderId = createOrderCode(new Date(now));
  const orderRef = db.collection('marketplace_orders').doc(orderId);
  const cartRef = db.collection('marketplace_carts').doc(userId);
  const profileRef = db.collection('marketplace_users').doc(userId);

  return db.runTransaction(async (transaction) => {
    const [cartSnapshot, profileSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(cartRef),
      transaction.get(profileRef),
      transaction.get(orderRef)
    ]);
    if (orderSnapshot.exists) throw Object.assign(new Error('Kode pesanan bentrok. Coba checkout sekali lagi.'), { code: 'order-code-collision' });
    if (!cartSnapshot.exists) throw Object.assign(new Error('Keranjang masih kosong.'), { code: 'cart-empty' });
    const cartItems = cartSnapshot.data()?.items;
    if (!Array.isArray(cartItems) || cartItems.length < 1 || cartItems.length > 30) {
      throw Object.assign(new Error('Isi keranjang tidak valid.'), { code: 'invalid-cart' });
    }
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    const shippingAddress = readShippingAddress(profile);
    const combined = new Map();
    for (const item of cartItems) {
      const productId = String(item?.productId || '').trim();
      const qty = Number(item?.qty);
      if (!productId || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw Object.assign(new Error('Isi keranjang tidak valid.'), { code: 'invalid-cart' });
      }
      combined.set(productId, (combined.get(productId) || 0) + qty);
    }
    if (combined.size > 30 || [...combined.values()].some((qty) => qty > 99)) {
      throw Object.assign(new Error('Keranjang melebihi batas 30 jenis barang atau jumlah 99 per barang.'), { code: 'invalid-cart' });
    }

    const productIds = [...combined.keys()];
    const productRefs = productIds.map((id) => db.collection('marketplace_products').doc(id));
    const productSnapshots = await Promise.all(productRefs.map((productRef) => transaction.get(productRef)));
    const conflicts = [];
    const lineItems = [];
    let subtotal = 0;

    productSnapshots.forEach((snapshot, index) => {
      const productId = productIds[index];
      const qty = combined.get(productId);
      if (!snapshot.exists) {
        conflicts.push({ productId, name: 'Produk tidak ditemukan', stock: 0, requested: qty });
        return;
      }
      const product = snapshot.data() || {};
      const stock = Number.isInteger(Number(product.stock)) && Number(product.stock) >= 0 ? Number(product.stock) : 1;
      const unitPrice = Number(product.price);
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
        conflicts.push({ productId, name: cleanText(product.name || 'Produk', 120), stock, requested: qty, reason: 'Harga produk tidak valid' });
        return;
      }
      if (qty > stock) {
        conflicts.push({ productId, name: cleanText(product.name || 'Produk', 120), stock, requested: qty });
        return;
      }
      const itemSubtotal = unitPrice * qty;
      if (!Number.isSafeInteger(itemSubtotal)) {
        conflicts.push({ productId, name: cleanText(product.name || 'Produk', 120), stock, requested: qty, reason: 'Nilai subtotal melewati batas' });
        return;
      }
      subtotal += itemSubtotal;
      lineItems.push({
        productId,
        name: cleanText(product.name || 'Produk', 120),
        image: getSafeThumbnail(product.imageUrl || product.image),
        unitPrice,
        qty,
        subtotal: itemSubtotal
      });
    });
    if (conflicts.length) {
      return { stockConflict: true, conflicts };
    }

    const shippingFee = getShippingFee();
    const totalAmount = subtotal + shippingFee;
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 1) {
      throw Object.assign(new Error('Total pembayaran tidak valid.'), { code: 'invalid-total' });
    }
    const buyerName = cleanText(profile.name || claims.name || shippingAddress.recipientName, 120);
    const buyerEmail = cleanText(claims.email || profile.email || '', 180);
    const buyerPhone = shippingAddress.phone;
    const paymentExpiresAt = now + PAYMENT_WINDOW_MS;
    const order = {
      orderId,
      orderCode: orderId,
      userId,
      buyerName,
      buyerEmail,
      buyerPhone,
      items: lineItems,
      subtotal,
      shippingFee,
      totalAmount,
      shippingAddress,
      status: 'awaiting_payment',
      paymentStatus: 'UNPAID',
      paymentUrl: '',
      paymentExpiresAt,
      paidAt: null,
      dokuRequestId: '',
      trackingNumber: '',
      courier: '',
      statusHistory: [{ status: 'awaiting_payment', at: now, by: userId }],
      // Penanda alur baru: stok baru dipotong ketika pembayaran sukses.
      stockMode: 'on_payment',
      stockDeducted: false,
      stockReleased: false,
      needsAttention: Boolean(shippingAddress.outsideIndonesia),
      ...(shippingAddress.outsideIndonesia ? { attentionReason: 'Alamat pengiriman berada di luar wilayah Indonesia; validasi biaya dan layanan kurir.' } : {}),
      createdAt: now,
      updatedAt: now
    };

    // TIDAK ADA transaction.update ke marketplace_products di sini.
    // TIDAK ADA pengosongan keranjang di sini.
    transaction.create(orderRef, order);
    return { order };
  });
}

async function checkout(req, res, claims) {
  let config;
  try {
    config = getDokuConfig(req);
  } catch (error) {
    return responseError(res, 503, error.code, error.message);
  }

  try {
    await releaseExpiredReservations();
    await cancelStaleAwaitingOrders(String(claims.uid));
    const reservation = await createPendingOrder(claims);
    if (reservation.stockConflict) {
      return responseError(res, 409, 'insufficient-stock', 'Sebagian barang tidak lagi memiliki stok yang cukup.', reservation.conflicts);
    }
    const order = reservation.order;
    console.log('[marketplace] pesanan dibuat tanpa memotong stok:', { orderId: order.orderId, stockMode: order.stockMode });
    try {
      const doku = await createDokuPayment(order, config);
      await getAdminDb().collection('marketplace_orders').doc(order.orderId).set({
        paymentUrl: doku.paymentUrl,
        dokuRequestId: doku.requestId,
        updatedAt: Date.now()
      }, { merge: true });
      return res.status(200).json({
        success: true,
        orderId: order.orderId,
        orderCode: order.orderCode,
        paymentUrl: doku.paymentUrl,
        stockMode: order.stockMode,
        warning: order.shippingAddress.outsideIndonesia ? 'Koordinat berada di luar Indonesia; konfirmasi layanan pengiriman.' : ''
      });
    } catch (error) {
      console.error('[marketplace] pembuatan pembayaran DOKU gagal:', { orderId: order.orderId, code: error.code || 'unknown', message: error.message });
      try {
        await getAdminDb().collection('marketplace_orders').doc(order.orderId).set({
          paymentError: cleanText(error.message, 500),
          dokuRequestId: String(error.dokuRequestId || ''),
          updatedAt: Date.now()
        }, { merge: true });
        await releaseOrderStock(order.orderId, {
          status: 'payment_failed',
          paymentStatus: 'FAILED',
          by: 'system',
          reason: 'DOKU gagal membuat invoice.'
        });
      } catch (releaseError) {
        console.error('[marketplace] gagal menutup pesanan setelah error DOKU:', releaseError);
      }
      return responseError(res, 502, error.code || 'doku-checkout-failed', `Pembayaran gagal disiapkan: ${cleanText(error.message, 300)}.`);
    }
  } catch (error) {
    console.error('[marketplace] checkout gagal:', { code: error.code || 'unknown', message: error.message });
    return responseError(res, error.code === 'insufficient-stock' ? 409 : 400, error.code || 'checkout-failed', error.message || 'Checkout gagal.', error.details);
  }
}

async function payAgain(req, res, claims) {
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return responseError(res, 400, 'order-id-required', 'Kode pesanan wajib diisi.');
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(orderId);
  const snapshot = await orderRef.get();
  if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) return responseError(res, 404, 'not-found', 'Pesanan tidak ditemukan.');
  const order = snapshot.data() || {};
  if (order.status !== 'awaiting_payment') return responseError(res, 409, 'invalid-order-state', 'Pesanan ini tidak menunggu pembayaran.');
  if (Number(order.paymentExpiresAt || 0) <= Date.now()) {
    await releaseOrderStock(orderId, { status: 'expired', paymentStatus: 'EXPIRED', by: 'system', reason: 'Batas pembayaran terlewati.' });
    return responseError(res, 409, 'payment-expired', 'Batas pembayaran telah lewat.');
  }
  if (!/^https:\/\//i.test(String(order.paymentUrl || ''))) return responseError(res, 409, 'payment-link-unavailable', 'Link pembayaran tidak tersedia. Hubungi admin.');
  return res.status(200).json({ success: true, orderId, paymentUrl: order.paymentUrl });
}

async function cancelOrder(req, res, claims) {
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return responseError(res, 400, 'order-id-required', 'Kode pesanan wajib diisi.');
  const orderRef = getAdminDb().collection('marketplace_orders').doc(orderId);
  const snapshot = await orderRef.get();
  if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) return responseError(res, 404, 'not-found', 'Pesanan tidak ditemukan.');
  if (snapshot.data()?.status !== 'awaiting_payment') return responseError(res, 409, 'invalid-order-state', 'Hanya pesanan yang menunggu pembayaran yang dapat dibatalkan.');
  const result = await releaseOrderStock(orderId, { status: 'cancelled', paymentStatus: 'UNPAID', by: claims.uid, reason: 'Dibatalkan pembeli.' });
  if (result.needsAttention) return responseError(res, 409, 'payment-raced-with-cancel', 'Pembayaran telah berubah status saat pembatalan; hubungi admin untuk pemeriksaan.');
  return res.status(200).json({ success: true, orderId, released: Boolean(result.released || result.alreadyReleased) });
}

// Tanya status ke DOKU lalu terapkan hasilnya (bayar sukses / expired / gagal).
async function queryDokuAndApply(req, orderId) {
  const config = getDokuConfig(req);
  const path = `/orders/v1/status/${encodeURIComponent(orderId)}`;
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  const requestId = crypto.randomUUID();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'GET',
    headers: createDokuHeaders({ ...config, requestId, timestamp, path })
  });
  const raw = await response.text();
  let payload = {};
  try { payload = JSON.parse(raw); } catch (error) { payload = { raw: raw.slice(0, 1000) }; }
  if (!response.ok) {
    throw Object.assign(new Error(payload.message || `DOKU status check gagal (${response.status}).`), { code: 'doku-status-failed' });
  }
  const status = String(payload.transaction?.status || payload.order?.status || payload.status || '').toUpperCase();
  // Hanya status SUCCESS/PAID dari DOKU yang boleh memotong stok.
  if (['SUCCESS', 'PAID'].includes(status)) {
    await applyMarketplacePayment({ orderId, amount: payload.order?.amount ?? payload.amount, requestId: payload.transaction?.request_id || requestId });
  } else if (status === 'EXPIRED') {
    await releaseOrderStock(orderId, { status: 'expired', paymentStatus: 'EXPIRED', by: 'doku-check', reason: 'DOKU mengembalikan status EXPIRED.' });
  } else if (['FAILED', 'CANCELLED', 'DENIED'].includes(status)) {
    await releaseOrderStock(orderId, { status: 'payment_failed', paymentStatus: 'FAILED', by: 'doku-check', reason: `DOKU mengembalikan status ${status}.` });
  }
  return status || 'PENDING';
}

async function checkPayment(req, res, claims) {
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return responseError(res, 400, 'order-id-required', 'Kode pesanan wajib diisi.');
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(orderId);
  let snapshot = await orderRef.get();
  if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) return responseError(res, 404, 'not-found', 'Pesanan tidak ditemukan.');
  let order = snapshot.data() || {};

  if (order.status === 'awaiting_payment' && Number(order.paymentExpiresAt || 0) <= Date.now()) {
    await releaseOrderStock(orderId, { status: 'expired', paymentStatus: 'EXPIRED', by: 'system', reason: 'Batas pembayaran terlewati.' });
    snapshot = await orderRef.get();
    return res.status(200).json({ success: true, order: { id: orderId, ...snapshot.data() } });
  }

  if (order.status !== 'awaiting_payment') {
    // Sudah dibayar (mis. lewat webhook): pastikan STOK terpotong dan keranjang bersih.
    await reconcilePaidOrdersStock(claims.uid).catch((error) => console.error('[marketplace] rekonsiliasi stok gagal:', error.message));
    await syncPaidOrdersCart(claims.uid).catch((error) => console.error('[marketplace] sync keranjang gagal:', error.message));
    snapshot = await orderRef.get();
    return res.status(200).json({ success: true, order: { id: orderId, ...(snapshot.data() || order) } });
  }

  try {
    const dokuStatus = await queryDokuAndApply(req, orderId);
    await reconcilePaidOrdersStock(claims.uid).catch((error) => console.error('[marketplace] rekonsiliasi stok gagal:', error.message));
    await syncPaidOrdersCart(claims.uid).catch((error) => console.error('[marketplace] sync keranjang gagal:', error.message));
    snapshot = await orderRef.get();
    order = snapshot.data() || {};
    return res.status(200).json({ success: true, order: { id: orderId, ...order }, dokuStatus });
  } catch (error) {
    console.error('[marketplace] pemeriksaan status DOKU gagal:', { orderId, code: error.code || 'unknown', message: error.message });
    return responseError(res, 502, error.code || 'doku-status-failed', 'Status pembayaran belum bisa diperiksa. Coba lagi sebentar.');
  }
}

// Dipanggil saat halaman keranjang/pesanan dibuka:
// 1) cek ke DOKU untuk pesanan yang masih menunggu bayar (webhook bisa terlambat / tidak sampai ke localhost),
// 2) bersihkan keranjang dari barang yang sudah dibayar.
async function syncCart(req, res, claims) {
  const uid = String(claims.uid);
  try {
    const pending = await getAdminDb()
      .collection('marketplace_orders')
      .where('userId', '==', uid)
      .where('status', '==', 'awaiting_payment')
      .get();
    const live = pending.docs
      .filter((document) => Number(document.data()?.paymentExpiresAt || 0) > Date.now())
      .slice(0, 3);
    for (const document of live) {
      try {
        await queryDokuAndApply(req, document.id);
      } catch (error) {
        console.warn('[marketplace] cek DOKU untuk sync-cart dilewati:', document.id, error.message);
      }
    }
  } catch (error) {
    console.warn('[marketplace] gagal membaca pesanan tertunda:', error.message);
  }
  // Perbaiki stok yang belum terpotong untuk pesanan yang sudah dibayar, lalu bersihkan keranjang.
  const stock = await reconcilePaidOrdersStock(uid).catch((error) => {
    console.error('[marketplace] rekonsiliasi stok gagal:', error.message);
    return { checked: 0, fixed: 0 };
  });
  const result = await syncPaidOrdersCart(uid);
  return res.status(200).json({ success: true, ...result, stockFixed: stock.fixed });
}

function maskBuyerName(name) {
  const parts = cleanText(name, 120).split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Pembeli';
  if (parts.length === 1) return parts[0].slice(0, 20);
  return `${parts[0].slice(0, 20)} ${parts[1].charAt(0).toUpperCase()}.`;
}

// Pembeli menekan "Pesanan Diterima". Hanya dari status 'shipped'.
async function confirmReceived(req, res, claims) {
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return responseError(res, 400, 'order-id-required', 'Kode pesanan wajib diisi.');
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(orderId);

  const outcome = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) {
      return { status: 404, code: 'not-found', message: 'Pesanan tidak ditemukan.' };
    }
    const order = snapshot.data() || {};
    if (order.status === 'completed') return { ok: true, already: true };
    if (order.status !== 'shipped') {
      return { status: 409, code: 'invalid-order-state', message: 'Pesanan baru bisa dikonfirmasi setelah berstatus Dikirim.' };
    }
    const now = Date.now();
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    transaction.update(orderRef, {
      status: 'completed',
      receivedAt: now,
      completedAt: now,
      updatedAt: now,
      updatedBy: claims.uid,
      statusHistory: [...history, { status: 'completed', at: now, by: claims.uid, note: 'Dikonfirmasi diterima oleh pembeli.' }]
    });
    return { ok: true };
  });

  if (!outcome.ok) return responseError(res, outcome.status, outcome.code, outcome.message);
  return res.status(200).json({ success: true, orderId, already: Boolean(outcome.already) });
}

// Pembeli mengirim ulasan untuk satu produk di pesanan yang sudah selesai.
async function submitReview(req, res, claims) {
  const orderId = String(req.body?.orderId || '').trim();
  const productId = String(req.body?.productId || '').trim();
  const rating = Number(req.body?.rating);
  const comment = cleanText(req.body?.comment, 500);
  if (!orderId || !productId) return responseError(res, 400, 'invalid-request', 'Kode pesanan dan produk wajib diisi.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return responseError(res, 400, 'invalid-rating', 'Rating harus 1 sampai 5 bintang.');
  }

  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(orderId);
  const reviewId = `${orderId}__${productId}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const reviewRef = db.collection('marketplace_reviews').doc(reviewId);
  const productRef = db.collection('marketplace_products').doc(productId);

  const outcome = await db.runTransaction(async (transaction) => {
    const [orderSnap, reviewSnap, productSnap] = await Promise.all([
      transaction.get(orderRef), transaction.get(reviewRef), transaction.get(productRef)
    ]);
    if (!orderSnap.exists || orderSnap.data()?.userId !== claims.uid) {
      return { status: 404, code: 'not-found', message: 'Pesanan tidak ditemukan.' };
    }
    const order = orderSnap.data() || {};
    if (order.status !== 'completed') {
      return { status: 409, code: 'order-not-completed', message: 'Ulasan hanya bisa dikirim setelah pesanan diterima.' };
    }
    const item = (Array.isArray(order.items) ? order.items : []).find((entry) => String(entry.productId) === productId);
    if (!item) return { status: 400, code: 'product-not-in-order', message: 'Produk ini tidak ada di pesanan.' };
    if (reviewSnap.exists) {
      return { status: 409, code: 'already-reviewed', message: 'Kamu sudah memberi ulasan untuk produk ini.' };
    }

    const now = Date.now();
    transaction.create(reviewRef, {
      reviewId,
      orderId,
      orderCode: String(order.orderCode || orderId),
      productId,
      productName: cleanText(item.name || 'Produk', 120),
      productImage: getSafeThumbnail(item.image),
      userId: claims.uid,
      buyerName: maskBuyerName(order.buyerName),
      rating,
      comment,
      createdAt: now,
      updatedAt: now
    });
    // Agregat rating di dokumen produk (opsional dipakai di halaman produk).
    if (productSnap.exists) {
      transaction.update(productRef, {
        ratingSum: FieldValue.increment(rating),
        ratingCount: FieldValue.increment(1)
      });
    }
    return { ok: true };
  });

  if (!outcome.ok) return responseError(res, outcome.status, outcome.code, outcome.message);
  return res.status(200).json({ success: true, reviewId });
}

/* =========================================================================
 * JUMLAH DILIHAT PRODUK (publik, tanpa login)
 * Disimpan di marketplace_product_stats/{productId}.views
 * ========================================================================= */
const VIEW_SERVER_WINDOW_MS = 5 * 60 * 1000;
const recentViewKeys = new Map(); // best-effort per instance serverless

function seenViewRecently(key) {
  const now = Date.now();
  const last = recentViewKeys.get(key);
  if (last && now - last < VIEW_SERVER_WINDOW_MS) return true;
  recentViewKeys.set(key, now);
  if (recentViewKeys.size > 5000) {
    for (const [storedKey, time] of recentViewKeys) {
      if (now - time >= VIEW_SERVER_WINDOW_MS) recentViewKeys.delete(storedKey);
    }
  }
  return false;
}

function getClientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

function readViewCount(statsSnapshot) {
  if (!statsSnapshot || !statsSnapshot.exists) return 0;
  const value = Number(statsSnapshot.data()?.views);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function viewProduct(req, res) {
  const productId = String(req.body?.productId || '').trim();
  if (!productId || productId.length > 200 || productId.includes('/')) {
    return responseError(res, 400, 'invalid-product', 'Produk tidak valid.');
  }

  const db = getAdminDb();
  const productSnapshot = await db.collection('marketplace_products').doc(productId).get();
  if (!productSnapshot.exists) return responseError(res, 404, 'not-found', 'Produk tidak ditemukan.');

  const statsRef = db.collection('marketplace_product_stats').doc(productId);

  // Pengaman tambahan: IP yang sama pada produk yang sama dalam 5 menit tidak dihitung lagi.
  if (seenViewRecently(`${getClientIp(req)}|${productId}`)) {
    const current = await statsRef.get();
    return res.status(200).json({ success: true, counted: false, views: readViewCount(current) });
  }

  const views = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(statsRef);
    const next = readViewCount(snapshot) + 1;
    transaction.set(statsRef, { productId, views: next, updatedAt: Date.now() }, { merge: true });
    return next;
  });

  return res.status(200).json({ success: true, counted: true, views });
}

/* =========================================================================
 * NOTIFIKASI EMAIL CHAT: pembeli kirim pesan -> email ke admin
 * ========================================================================= */
const MAIL_OWNER_EMAIL = 'muhamadabelldeskiawan@gmail.com';

function escapeMailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function getSiteUrl() {
  const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  return /^https:\/\//i.test(siteUrl) ? siteUrl : DEFAULT_SITE_URL;
}

async function notifyChat(req, res, claims) {
  const threadId = String(req.body?.threadId || '').trim();
  const messageId = String(req.body?.messageId || '').trim();
  if (!threadId || !messageId || threadId.includes('/') || messageId.includes('/')) {
    return responseError(res, 400, 'invalid-request', 'threadId dan messageId wajib diisi.');
  }

  const db = getAdminDb();
  const threadRef = db.collection('marketplace_chats').doc(threadId);
  const messageRef = threadRef.collection('messages').doc(messageId);
  const [threadSnap, messageSnap] = await Promise.all([threadRef.get(), messageRef.get()]);
  if (!threadSnap.exists || !messageSnap.exists) return responseError(res, 404, 'not-found', 'Percakapan atau pesan tidak ditemukan.');

  const thread = threadSnap.data() || {};
  const message = messageSnap.data() || {};
  if (String(thread.buyerId) !== String(claims.uid) || message.senderRole !== 'user' || String(message.senderId) !== String(claims.uid)) {
    return responseError(res, 403, 'forbidden', 'Tidak diizinkan.');
  }
  if (message.emailNotifiedAt) return res.status(200).json({ success: true, sent: false, reason: 'already-notified' });
  if (Date.now() - Number(message.createdAt || 0) > 10 * 60 * 1000) {
    return res.status(200).json({ success: true, sent: false, reason: 'message-too-old' });
  }

  const adminEmail = String(process.env.ADMIN_NOTIFY_EMAIL || MAIL_OWNER_EMAIL).trim();
  const buyerName = cleanText(thread.buyerName || claims.name || 'Pembeli', 120);
  const label = thread.productName
    ? `Produk: ${cleanText(thread.productName, 120)}`
    : thread.orderId ? `Pesanan: ${cleanText(thread.orderId, 60)}` : 'Pertanyaan umum';
  const link = `${getSiteUrl()}/admin/marketplace-chat.html?thread=${encodeURIComponent(threadId)}`;
  const body = cleanText(message.text, 1000);

  try {
    await sendEmail({
      to: adminEmail,
      subject: `💬 Pesan baru dari ${buyerName} - ${label}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
        <h2 style="margin-top:0;color:#111827">Ada pesan baru dari pembeli 💬</h2>
        <p style="color:#374151;margin:0 0 4px"><b>Pembeli:</b> ${escapeMailHtml(buyerName)}</p>
        <p style="color:#374151;margin:0 0 12px"><b>Topik:</b> ${escapeMailHtml(label)}</p>
        <div style="background:#f8fafc;padding:12px;border-radius:12px;font-size:14px;color:#334155;line-height:1.5;white-space:pre-wrap;">${escapeMailHtml(body)}</div>
        <p style="margin-top:18px"><a href="${escapeMailHtml(link)}" style="background:#db2777;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Buka & balas chat</a></p>
      </div>`,
      text: `Pesan baru dari ${buyerName} (${label}):\n\n${body}\n\nBalas: ${link}`
    });
  } catch (error) {
    console.warn('[marketplace] email notifikasi chat gagal:', error.code || '', error.message);
    return res.status(200).json({ success: true, sent: false, reason: error.code || 'send-failed' });
  }

  await messageRef.set({ emailNotifiedAt: Date.now() }, { merge: true });
  return res.status(200).json({ success: true, sent: true });
}

/* =========================================================================
 * EMAIL VERIFIKASI AKUN (dikirim dari server agar tidak masuk spam)
 * Boleh dipanggil oleh user yang BELUM terverifikasi (hanya ID token yang dicek).
 * ========================================================================= */
const verificationThrottle = new Map();

async function sendVerification(req, res) {
  const token = readBearerToken(req);
  if (!token) return responseError(res, 401, 'unauthenticated', 'Silakan masuk kembali.');

  let claims;
  try {
    claims = await getAdminAuth().verifyIdToken(token);
  } catch (error) {
    return responseError(res, 401, 'unauthenticated', 'Sesi tidak valid. Silakan masuk kembali.');
  }

  const email = String(claims.email || '').trim();
  if (!email) return responseError(res, 400, 'email-missing', 'Akun tidak memiliki email.');
  if (claims.email_verified === true) {
    return res.status(200).json({ success: true, sent: false, reason: 'already-verified' });
  }

  const last = verificationThrottle.get(claims.uid) || 0;
  if (Date.now() - last < 30 * 1000) {
    return responseError(res, 429, 'too-many-requests', 'Tunggu 30 detik sebelum meminta email verifikasi lagi.');
  }

  const host = String(req.headers?.host || '');
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const baseUrl = isLocalHost ? `http://${host}` : getSiteUrl();
  const continueUrl = `${baseUrl}/user/marketplace/login.html`;

  try {
    const adminAuth = getAdminAuth();
    let link;
    try {
      link = await adminAuth.generateEmailVerificationLink(email, { url: continueUrl });
    } catch (error) {
      // Domain belum masuk "Authorized domains": pakai link default Firebase.
      link = await adminAuth.generateEmailVerificationLink(email);
    }
    if (!/[?&]lang=/.test(link)) link += `${link.includes('?') ? '&' : '?'}lang=id`;

    const name = cleanText(claims.name || '', 80) || 'Pembeli';
    await sendEmail({
      to: email,
      subject: 'Verifikasi email akun Marketplace Mantan',
      html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px">
        <h2 style="margin-top:0;color:#111827">Verifikasi email Anda</h2>
        <p style="color:#374151">Halo ${escapeMailHtml(name)}, terima kasih sudah mendaftar di Marketplace Mantan. Klik tombol di bawah untuk mengaktifkan akun Anda.</p>
        <p style="margin:20px 0"><a href="${escapeMailHtml(link)}" style="background:#db2777;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Verifikasi email</a></p>
        <p style="font-size:12px;color:#64748b">Jika tombol tidak berfungsi, salin link ini ke browser:<br>${escapeMailHtml(link)}</p>
        <p style="font-size:12px;color:#64748b">Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
      </div>`,
      text: `Halo ${name},\n\nBuka link berikut untuk memverifikasi email Anda:\n${link}\n\nJika Anda tidak merasa mendaftar, abaikan email ini.`
    });
    verificationThrottle.set(claims.uid, Date.now());
    return res.status(200).json({ success: true, sent: true });
  } catch (error) {
    console.error('[marketplace] gagal mengirim email verifikasi:', { code: error.code || 'unknown', message: error.message });
    return responseError(res, 502, error.code || 'verification-mail-failed', `Email verifikasi gagal dikirim: ${cleanText(error.message, 200)}`);
  }
} 

export default async function handler(req, res) {
  if (req.method !== 'POST') return responseError(res, 405, 'method-not-allowed', 'Method not allowed.');
  const action = String(req.query?.action || '').trim().toLowerCase();

  // Aksi publik (tanpa login): mencatat jumlah dilihat produk.
  if (action === 'view-product') {
    try {
      return await viewProduct(req, res);
    } catch (error) {
      console.error('[marketplace] gagal mencatat view produk:', { code: error.code || 'unknown', message: error.message });
      return responseError(res, 500, error.code || 'view-failed', 'Jumlah dilihat gagal dicatat.');
    }
  }

    if (action === 'send-verification') {
    try {
      return await sendVerification(req, res);
    } catch (error) {
      console.error('[marketplace] send-verification gagal:', error.message);
      return responseError(res, 500, 'verification-failed', 'Email verifikasi gagal dikirim.');
    }
  }

  const claims = await requireBuyer(req, res);
  if (!claims) return;

  try {
    if (action === 'checkout') return await checkout(req, res, claims);
    if (action === 'pay-again') return await payAgain(req, res, claims);
    if (action === 'cancel-order') return await cancelOrder(req, res, claims);
    if (action === 'check-payment') return await checkPayment(req, res, claims);
    if (action === 'sync-cart') return await syncCart(req, res, claims);
    if (action === 'confirm-received') return await confirmReceived(req, res, claims);
    if (action === 'submit-review') return await submitReview(req, res, claims);
        if (action === 'notify-chat') return await notifyChat(req, res, claims);
    if (action === 'release-expired-reservations') {
      const result = await releaseExpiredReservations();
      return res.status(200).json({ success: true, ...result });
    }
    return responseError(res, 404, 'unknown-action', 'Aksi marketplace tidak dikenal.');
  } catch (error) {
    console.error('[marketplace] API gagal:', { action, uid: claims.uid, code: error.code || 'unknown', message: error.message });
    return responseError(res, 500, error.code || 'marketplace-api-failed', error.message || 'Permintaan marketplace gagal.');
  }
}