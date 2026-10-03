import crypto from 'crypto';
import { getAdminAuth, getAdminDb } from './lib/firebase-admin.js';
import { applyMarketplacePayment, releaseExpiredReservations, releaseOrderStock } from './lib/marketplace-orders.js';

const PAYMENT_WINDOW_MS = 60 * 60 * 1000;

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
    return claims;
  } catch (error) {
    console.warn('[marketplace] bearer ID token invalid:', error.code || error.message);
    responseError(res, 401, 'unauthenticated', 'Sesi tidak valid. Silakan masuk kembali.');
    return null;
  }
}

function getDokuConfig() {
  const clientId = String(process.env.DOKU_CLIENT_ID || '').trim();
  const secretKey = String(process.env.DOKU_SECRET_KEY || '').trim();
  const baseUrl = String(process.env.DOKU_BASE_URL || '').trim().replace(/\/$/, '');
  const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (!clientId || !secretKey || !baseUrl || !siteUrl) {
    throw Object.assign(new Error('DOKU_CLIENT_ID, DOKU_SECRET_KEY, DOKU_BASE_URL, dan SITE_URL wajib diatur.'), { code: 'doku-config-missing' });
  }
  const localHttpSite = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(siteUrl);
  if (!/^https:\/\//i.test(baseUrl) || (!/^https:\/\//i.test(siteUrl) && !localHttpSite)) {
    throw Object.assign(new Error('DOKU_BASE_URL harus HTTPS; SITE_URL harus HTTPS kecuali localhost saat development.'), { code: 'invalid-server-url' });
  }
  return { clientId, secretKey, baseUrl, siteUrl };
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
  const lineItems = order.items.map((item) => ({ name: item.name.slice(0, 100), price: item.unitPrice, quantity: item.qty }));
  if (order.shippingFee > 0) lineItems.push({ name: 'Ongkos kirim', price: order.shippingFee, quantity: 1 });
  const paymentMethods = String(process.env.DOKU_PAYMENT_METHODS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const payment = { payment_due_date: 60 };
  if (paymentMethods.length) payment.payment_method_types = paymentMethods;
  const body = {
    order: {
      amount: order.totalAmount,
      invoice_number: order.orderId,
      callback_url: `${config.siteUrl}/api/doku-notify`,
      line_items: lineItems,
      currency: 'IDR'
    },
    payment,
    customer: {
      name: order.buyerName,
      email: order.buyerEmail,
      phone: order.buyerPhone,
      address: order.shippingAddress.address
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
    throw Object.assign(new Error(payload?.message || payload?.error || `DOKU menolak checkout (${response.status}).`), {
      code: 'doku-checkout-failed',
      dokuRequestId: requestId
    });
  }
  return { paymentUrl, requestId };
}

async function reserveOrderForBuyer(claims) {
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
      const rawStock = product.stock;
      const stock = Number.isInteger(Number(rawStock)) && Number(rawStock) >= 0 ? Number(rawStock) : 1;
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
      stockReleased: false,
      needsAttention: Boolean(shippingAddress.outsideIndonesia),
      ...(shippingAddress.outsideIndonesia ? { attentionReason: 'Alamat pengiriman berada di luar wilayah Indonesia; validasi biaya dan layanan kurir.' } : {}),
      createdAt: now,
      updatedAt: now
    };

    productSnapshots.forEach((snapshot, index) => {
      const product = snapshot.data() || {};
      const stock = Number.isInteger(Number(product.stock)) && Number(product.stock) >= 0 ? Number(product.stock) : 1;
      const nextStock = stock - combined.get(productIds[index]);
      transaction.update(productRefs[index], {
        stock: nextStock,
        status: nextStock > 0 ? 'Tersedia' : 'Habis',
        updatedAt: now
      });
    });
    transaction.create(orderRef, order);
    transaction.set(cartRef, { items: [], updatedAt: now });
    return { order };
  });
}

async function checkout(req, res, claims) {
  let config;
  try {
    config = getDokuConfig();
  } catch (error) {
    return responseError(res, 503, error.code, error.message);
  }

  try {
    await releaseExpiredReservations();
    const reservation = await reserveOrderForBuyer(claims);
    if (reservation.stockConflict) {
      return responseError(res, 409, 'insufficient-stock', 'Sebagian barang tidak lagi memiliki stok yang cukup.', reservation.conflicts);
    }
    const order = reservation.order;
    try {
      const doku = await createDokuPayment(order, config);
      await getAdminDb().collection('marketplace_orders').doc(order.orderId).set({
        paymentUrl: doku.paymentUrl,
        dokuRequestId: doku.requestId,
        updatedAt: Date.now()
      }, { merge: true });
      return res.status(200).json({ success: true, orderId: order.orderId, orderCode: order.orderCode, paymentUrl: doku.paymentUrl, warning: order.shippingAddress.outsideIndonesia ? 'Koordinat berada di luar Indonesia; konfirmasi layanan pengiriman.' : '' });
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
        console.error('[marketplace] gagal melepas reservasi setelah error DOKU:', releaseError);
      }
      return responseError(res, 502, error.code || 'doku-checkout-failed', 'Pembayaran gagal disiapkan. Stok telah dilepas jika reservasi sudah dibuat.');
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
    return responseError(res, 409, 'payment-expired', 'Batas pembayaran telah lewat dan stok sudah dilepas.');
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
  return res.status(200).json({ success: true, orderId, stockReleased: result.released || result.alreadyReleased });
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
  if (order.status !== 'awaiting_payment') return res.status(200).json({ success: true, order: { id: orderId, ...order } });

  try {
    const config = getDokuConfig();
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
    if (!response.ok) throw Object.assign(new Error(payload.message || `DOKU status check gagal (${response.status}).`), { code: 'doku-status-failed' });
    const status = String(payload.transaction?.status || payload.order?.status || payload.status || '').toUpperCase();
    if (['SUCCESS', 'PAID'].includes(status)) {
      await applyMarketplacePayment({ orderId, amount: payload.order?.amount ?? payload.amount, requestId: payload.transaction?.request_id || requestId });
    } else if (status === 'EXPIRED') {
      await releaseOrderStock(orderId, { status: 'expired', paymentStatus: 'EXPIRED', by: 'doku-check', reason: 'DOKU mengembalikan status EXPIRED.' });
    } else if (['FAILED', 'CANCELLED', 'DENIED'].includes(status)) {
      await releaseOrderStock(orderId, { status: 'payment_failed', paymentStatus: 'FAILED', by: 'doku-check', reason: `DOKU mengembalikan status ${status}.` });
    }
    snapshot = await orderRef.get();
    order = snapshot.data() || {};
    return res.status(200).json({ success: true, order: { id: orderId, ...order }, dokuStatus: status || 'PENDING' });
  } catch (error) {
    console.error('[marketplace] pemeriksaan status DOKU gagal:', { orderId, code: error.code || 'unknown', message: error.message });
    return responseError(res, 502, error.code || 'doku-status-failed', 'Status pembayaran belum bisa diperiksa. Coba lagi sebentar.');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return responseError(res, 405, 'method-not-allowed', 'Method not allowed.');
  const claims = await requireBuyer(req, res);
  if (!claims) return;
  const action = String(req.query?.action || '').trim().toLowerCase();

  try {
    if (action === 'checkout') return await checkout(req, res, claims);
    if (action === 'pay-again') return await payAgain(req, res, claims);
    if (action === 'cancel-order') return await cancelOrder(req, res, claims);
    if (action === 'check-payment') return await checkPayment(req, res, claims);
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
