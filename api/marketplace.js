import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import { getAdminAuth, getAdminDb } from './lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { applyMarketplacePayment, notifyAdminNewCodOrder, reconcilePaidOrdersStock, releaseExpiredReservations, releaseOrderStock, sendEmail, syncPaidOrdersCart } from './lib/marketplace-orders.js';

const PAYMENT_WINDOW_MS = 60 * 60 * 1000;
const COD_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SITE_URL = 'https://gamon-space.vercel.app';
const DEFAULT_DOKU_BASE_URL = 'https://api.doku.com';
const KALSEL_CITIES = new Set([
  'Kota Banjarmasin', 'Kota Banjarbaru', 'Kabupaten Banjar', 'Kabupaten Barito Kuala',
  'Kabupaten Tanah Laut', 'Kabupaten Tapin', 'Kabupaten Hulu Sungai Selatan',
  'Kabupaten Hulu Sungai Tengah', 'Kabupaten Hulu Sungai Utara', 'Kabupaten Tabalong',
  'Kabupaten Tanah Bumbu', 'Kabupaten Balangan', 'Kabupaten Kotabaru'
]);

function responseError(res, status, code, message, details) {
  return res.status(status).json({ success: false, code, message, ...(details ? { details } : {}) });
}

function withFirestoreTimeout(operation, label, timeoutMs = 15000) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(Object.assign(new Error(`Firestore timeout saat ${label} setelah ${timeoutMs / 1000} detik.`), {
        code: 'firestore-timeout'
      }));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve().then(operation), timeout])
    .finally(() => clearTimeout(timeoutId));
}

function isRetryableNetworkError(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return /socket hang up|econnreset|etimedout|unavailable|deadline exceeded|firestore-timeout/.test(message);
}

async function retryNetwork(operation) {
  const delays = [400, 800];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === '6' || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS';
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

  const wanted = ['DOKU_CLIENT_ID', 'DOKU_SECRET_KEY', 'DOKU_BASE_URL', 'SITE_URL', 'DOKU_PAYMENT_METHODS', 'MARKETPLACE_SHIPPING_FEE', 'MARKETPLACE_COD_MAX_AMOUNT', 'MARKETPLACE_COD_MAX_ACTIVE', 'MARKETPLACE_COD_MAX_FAIL', 'MARKETPLACE_COD_FEE', 'GMAIL_APP_PASSWORD', 'ADMIN_NOTIFY_EMAIL', 'EMAIL_VERIFY_SECRET', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
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
  return email.includes('@') ? email.slice(0, 120) : 'pembeli@gamon-space.vercel.app';
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
    district: cleanText(saved.district, 100),
    village: cleanText(saved.village, 100),
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
  loadLocalEnvFallback();
  const value = Number(process.env.MARKETPLACE_SHIPPING_FEE || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function getCodSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function getCodLimits() {
  loadLocalEnvFallback();
  return {
    maxAmount: getCodSetting('MARKETPLACE_COD_MAX_AMOUNT', 500000),
    maxActive: getCodSetting('MARKETPLACE_COD_MAX_ACTIVE', 2),
    maxFail: getCodSetting('MARKETPLACE_COD_MAX_FAIL', 2),
    fee: getCodSetting('MARKETPLACE_COD_FEE', 0)
  };
}

function validateCodArea(shippingAddress) {
  return KALSEL_CITIES.has(shippingAddress.city) &&
    Boolean(shippingAddress.district) &&
    shippingAddress.latitude >= -4.3 && shippingAddress.latitude <= -1.2 &&
    shippingAddress.longitude >= 114.3 && shippingAddress.longitude <= 116.8;
}

function isValidCodPhone(value) {
  const phone = String(value || '').replace(/[\s().-]/g, '');
  return /^(\+62|62|0)8\d{7,12}$/.test(phone);
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
        paymentStatus: selectedPackage.priceType !== 'quote' && paymentPlan === 'cash' ? 'CASH_PENDING' : 'UNPAID',
        by: 'system',
        reason: 'Diganti checkout baru.'
      });
    } catch (error) {
      console.error('[marketplace] gagal menutup checkout lama:', orderDoc.id, error.message);
    }
  }
}

// Membuat reservasi DOKU tanpa memotong stok; COD memotong stok dan
// mengosongkan keranjang dalam transaksi yang sama dengan pembuatan order.
async function createPendingOrder(claims, paymentMethod = 'DOKU') {
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
    const codStatsRef = db.collection('marketplace_cod_stats').doc(userId);
    const [productSnapshots, activeOrdersSnapshot, codStatsSnapshot] = await Promise.all([
      Promise.all(productRefs.map((productRef) => transaction.get(productRef))),
      paymentMethod === 'COD'
        ? transaction.get(db.collection('marketplace_orders').where('userId', '==', userId))
        : Promise.resolve(null),
      paymentMethod === 'COD' ? transaction.get(codStatsRef) : Promise.resolve(null)
    ]);
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
      if (product.active === false) {
        conflicts.push({ productId, name: cleanText(product.name || 'Produk', 120), stock: 0, requested: qty, reason: 'Produk sedang tidak dijual' });
        return;
      }
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
    const codLimits = getCodLimits();
    const codFee = paymentMethod === 'COD' ? codLimits.fee : 0;
    const totalAmount = subtotal + shippingFee + codFee;
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 1) {
      throw Object.assign(new Error('Total pembayaran tidak valid.'), { code: 'invalid-total' });
    }
    if (paymentMethod === 'COD') {
      if (!validateCodArea(shippingAddress)) {
        throw Object.assign(new Error('COD hanya tersedia untuk alamat lengkap di wilayah Kalimantan Selatan.'), { code: 'cod-not-available-area' });
      }
      if (!isValidCodPhone(shippingAddress.phone)) {
        throw Object.assign(new Error('Nomor HP penerima belum valid. Gunakan nomor Indonesia yang diawali 08, 62, atau +62.'), { code: 'cod-invalid-phone' });
      }
      if (totalAmount > codLimits.maxAmount) {
        throw Object.assign(new Error(`Total pesanan COD melebihi batas ${new Intl.NumberFormat('id-ID').format(codLimits.maxAmount)}.`), { code: 'cod-amount-exceeded' });
      }
      const activeCount = (activeOrdersSnapshot?.docs || []).filter((document) => {
        const activeOrder = document.data() || {};
        return activeOrder.paymentMethod === 'COD' &&
          ['awaiting_confirmation', 'processing', 'shipped'].includes(String(activeOrder.status || '').toLowerCase());
      }).length;
      if (activeCount >= codLimits.maxActive) {
        throw Object.assign(new Error(`Anda memiliki ${codLimits.maxActive} pesanan COD aktif. Selesaikan atau batalkan pesanan sebelumnya terlebih dahulu.`), { code: 'cod-too-many-active' });
      }
      const failCount = Number(codStatsSnapshot?.data()?.failCount || 0);
      if (failCount >= codLimits.maxFail) {
        throw Object.assign(new Error('Fitur COD sementara tidak tersedia untuk akun Anda. Silakan pilih pembayaran DOKU.'), { code: 'cod-blocked' });
      }
    }
    const buyerName = cleanText(profile.name || claims.name || shippingAddress.recipientName, 120);
    const buyerEmail = cleanText(claims.email || profile.email || '', 180);
    const buyerPhone = shippingAddress.phone;
    const isCod = paymentMethod === 'COD';
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
      ...(isCod && codFee ? { codFee } : {}),
      totalAmount,
      shippingAddress,
      paymentMethod,
      status: isCod ? 'awaiting_confirmation' : 'awaiting_payment',
      paymentStatus: isCod ? 'COD_PENDING' : 'UNPAID',
      paymentUrl: '',
      ...(!isCod ? { paymentExpiresAt: now + PAYMENT_WINDOW_MS } : { codConfirmExpiresAt: now + COD_CONFIRM_WINDOW_MS }),
      paidAt: null,
      dokuRequestId: '',
      trackingNumber: '',
      courier: '',
      statusHistory: [{ status: isCod ? 'awaiting_confirmation' : 'awaiting_payment', at: now, by: userId }],
      stockMode: isCod ? 'on_order' : 'on_payment',
      stockDeducted: isCod,
      stockReleased: false,
      ...(isCod ? { cartSynced: true } : {}),
      needsAttention: Boolean(shippingAddress.outsideIndonesia),
      ...(shippingAddress.outsideIndonesia ? { attentionReason: 'Alamat pengiriman berada di luar wilayah Indonesia; validasi biaya dan layanan kurir.' } : {}),
      createdAt: now,
      updatedAt: now
    };

    if (isCod) {
      productSnapshots.forEach((snapshot, index) => {
        const product = snapshot.data() || {};
        const qty = combined.get(productIds[index]);
        const stock = Number.isInteger(Number(product.stock)) && Number(product.stock) >= 0 ? Number(product.stock) : 1;
        const nextStock = stock - qty;
        transaction.update(productRefs[index], {
          stock: nextStock,
          status: nextStock > 0 ? 'Tersedia' : 'Habis',
          updatedAt: now
        });
      });
      transaction.set(cartRef, { items: [], updatedAt: now });
    }
    transaction.create(orderRef, order);
    return { order };
  });
}

async function codEligibility(req, res, claims) {
  const db = getAdminDb();
  const userId = String(claims.uid);
  const limits = getCodLimits();
  const [ordersSnapshot, statsSnapshot] = await Promise.all([
    db.collection('marketplace_orders').where('userId', '==', userId).get(),
    db.collection('marketplace_cod_stats').doc(userId).get()
  ]);
  const activeCount = ordersSnapshot.docs.filter((document) => {
    const order = document.data() || {};
    return order.paymentMethod === 'COD' &&
      ['awaiting_confirmation', 'processing', 'shipped'].includes(String(order.status || '').toLowerCase());
  }).length;
  const blocked = Number(statsSnapshot.data()?.failCount || 0) >= limits.maxFail;
  return res.status(200).json({
    success: true,
    maxAmount: limits.maxAmount,
    maxActive: limits.maxActive,
    fee: limits.fee,
    shippingFee: getShippingFee(),
    blocked,
    activeCount,
    reason: blocked
      ? 'COD sementara tidak tersedia untuk akun Anda.'
      : activeCount >= limits.maxActive
        ? 'Selesaikan atau batalkan pesanan COD aktif terlebih dahulu.'
        : ''
  });
}

async function checkout(req, res, claims) {
  const requestedMethod = req.body?.paymentMethod;
  if (requestedMethod !== undefined && !['DOKU', 'COD'].includes(requestedMethod)) {
    return responseError(res, 400, 'invalid-payment-method', 'Pilih metode pembayaran DOKU atau COD.');
  }
  const paymentMethod = requestedMethod || 'DOKU';
  let config = null;
  if (paymentMethod === 'DOKU') {
    try {
      config = getDokuConfig(req);
    } catch (error) {
      return responseError(res, 503, error.code, error.message);
    }
  }

  try {
    await releaseExpiredReservations();
    await cancelStaleAwaitingOrders(String(claims.uid));
    const reservation = await createPendingOrder(claims, paymentMethod);
    if (reservation.stockConflict) {
      return responseError(res, 409, 'insufficient-stock', 'Sebagian barang tidak lagi memiliki stok yang cukup.', reservation.conflicts);
    }
    const order = reservation.order;
    if (paymentMethod === 'COD') {
      try {
        await notifyAdminNewCodOrder(order.orderId);
      } catch (error) {
        console.error('[marketplace] email COD dilewati:', { orderId: order.orderId, message: error.message });
      }
      return res.status(200).json({
        success: true,
        orderId: order.orderId,
        orderCode: order.orderCode,
        paymentMethod: 'COD'
      });
    }
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
  if (order.paymentMethod === 'COD') {
    return responseError(res, 409, 'invalid-order-state', 'Pesanan COD tidak memiliki pembayaran ulang melalui DOKU.');
  }
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
  const order = snapshot.data() || {};
  const isCod = order.paymentMethod === 'COD';
  const canCancel = isCod
    ? ['awaiting_confirmation', 'processing'].includes(order.status)
    : order.status === 'awaiting_payment';
  if (!canCancel) return responseError(res, 409, 'invalid-order-state', isCod ? 'Pesanan COD tidak dapat dibatalkan setelah dikirim.' : 'Hanya pesanan yang menunggu pembayaran yang dapat dibatalkan.');
  const result = await releaseOrderStock(orderId, { status: 'cancelled', paymentStatus: 'UNPAID', by: claims.uid, reason: 'Dibatalkan pembeli.' });
  if (result.needsAttention) return responseError(res, 409, 'payment-raced-with-cancel', 'Pembayaran telah berubah status saat pembatalan; hubungi admin untuk pemeriksaan.');
  return res.status(200).json({ success: true, orderId, released: Boolean(result.released || result.alreadyReleased) });
}

// Tanya status ke DOKU lalu terapkan hasilnya (bayar sukses / expired / gagal).
async function queryDokuAndApply(req, orderId) {
  const orderSnapshot = await getAdminDb().collection('marketplace_orders').doc(String(orderId)).get();
  if (!orderSnapshot.exists || orderSnapshot.data()?.paymentMethod === 'COD' || orderSnapshot.data()?.status !== 'awaiting_payment') {
    return 'IGNORED';
  }
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

  if (order.paymentMethod === 'COD') {
    return res.status(200).json({ success: true, order: { id: orderId, ...order }, dokuStatus: 'IGNORED' });
  }

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
    if (order.paymentMethod === 'COD') {
      return { status: 409, code: 'cod-admin-only', message: 'Pesanan COD ditutup admin setelah uang diterima.' };
    }
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

// Foto profil untuk testimoni: hanya URL https pendek atau data URL kecil,
// supaya dokumen ulasan dan beranda tidak berat.
function getReviewAvatar(value) {
  const url = String(value || '').trim();
  if (/^https:\/\//i.test(url) && url.length <= 1500) return url;
  if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(url) && url.length <= 60000) return url;
  return '';
}

// Foto profil terbaru untuk testimoni: pakai thumbnail kecil (photoThumbUrl) bila ada,
// kalau tidak ada pakai photoUrl selama ukurannya masih kecil.
function pickProfileAvatar(profile) {
  return getReviewAvatar(profile?.photoThumbUrl) || getReviewAvatar(profile?.photoUrl);
}

// PUBLIK (tanpa login): daftar testimoni beranda.
// Foto pembeli SELALU diambil dari profil terbaru (marketplace_users), bukan dari salinan
// yang tersimpan di dokumen ulasan, sehingga ganti foto profil langsung ikut berubah.
// Hanya field yang aman dikirim (tidak ada email/HP/alamat).
async function publicReviews(req, res) {
  const db = getAdminDb();
  const snapshot = await db.collection('marketplace_reviews').orderBy('createdAt', 'desc').limit(30).get();
  const reviews = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

  const userIds = [...new Set(reviews.map((review) => String(review.userId || '').trim()).filter((id) => id && !id.includes('/')))];
  const profiles = new Map();
  if (userIds.length) {
    const profileSnaps = await db.getAll(...userIds.map((id) => db.collection('marketplace_users').doc(id)));
    profileSnaps.forEach((profileSnap) => {
      if (profileSnap.exists) profiles.set(profileSnap.id, profileSnap.data() || {});
    });
  }

  const result = reviews.map((review) => {
    const userId = String(review.userId || '').trim();
    const profile = profiles.get(userId);
    return {
      id: review.id,
      productId: review.productId || '',
      productName: review.productName || '',
      productImage: review.productImage || '',
      // Nama lengkap dari profil terbaru; ulasan lama menyimpan nama yang disingkat ("Muhammad A.").
      buyerName: cleanText((profile && profile.name) || review.buyerName || 'Pembeli', 120),
      // Profil ada -> pakai fotonya yang sekarang (boleh kosong bila memang tak punya foto).
      // Profil sudah tidak ada -> pakai salinan lama di ulasan.
      buyerPhotoUrl: profile ? pickProfileAvatar(profile) : getReviewAvatar(review.buyerPhotoUrl),
      rating: review.rating,
      comment: review.comment || '',
      createdAt: review.createdAt || 0
    };
  });

  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  return res.status(200).json({ success: true, reviews: result });
}

async function publicProducts(req, res) {
  const db = getAdminDb();
  const snapshot = await db.collection('marketplace_products').get();
  const products = snapshot.docs
    .map((document) => {
      const data = document.data() || {};
      if (data.active === false) return null;

      return {
        id: document.id,
        name: data.name,
        category: data.category,
        price: data.price,
        stock: data.stock,
        sold: data.sold,
        active: data.active,
        condition: data.condition,
        label: data.label,
        city: data.city,
        address: data.address,
        createdAt: data.createdAt,
        imageUrl: data.thumbUrl || data.imageUrl || (Array.isArray(data.images) ? data.images[0] : '') || data.image || ''
      };
    })
    .filter(Boolean);

  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  const payload = { success: true, products };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 3 * 1024 * 1024) {
    console.warn('[marketplace] payload public-products melebihi 3 MB.');
  }
  return res.status(200).json(payload);
}

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
  const profileRef = db.collection('marketplace_users').doc(String(claims.uid));

  const outcome = await db.runTransaction(async (transaction) => {
    const [orderSnap, reviewSnap, productSnap, profileSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(reviewRef),
      transaction.get(productRef),
      transaction.get(profileRef)
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
      buyerName: cleanText(order.buyerName || (profileSnap.exists ? profileSnap.data()?.name : '') || 'Pembeli', 120),
      buyerPhotoUrl: profileSnap.exists ? pickProfileAvatar(profileSnap.data()) : '',
      rating,
      comment,
      createdAt: now,
      updatedAt: now
    });
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
 * EMAIL VERIFIKASI AKUN (token HMAC buatan sendiri, tidak memakai oobCode Firebase)
 * ========================================================================= */
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_RESEND_INTERVAL_MS = 30 * 1000;

function getVerifySecret() {
  loadLocalEnvFallback();
  const secret = String(process.env.EMAIL_VERIFY_SECRET || '').trim();
  if (secret.length < 16) {
    throw Object.assign(new Error('EMAIL_VERIFY_SECRET belum diatur (minimal 16 karakter) di environment server.'), { code: 'verify-secret-missing' });
  }
  return secret;
}

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signVerifyPayload(payloadB64, secret) {
  return base64Url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

function normalizeAuthApp(value) {
  return value === 'jasa' ? 'jasa' : 'marketplace';
}

function authBrand(app) {
  return normalizeAuthApp(app) === 'jasa' ? 'Gamon Jasa' : 'Marketplace Mantan';
}

function authLoginPath(app) {
  return normalizeAuthApp(app) === 'jasa' ? '/user/jasa/masuk.html' : '/user/marketplace/login.html';
}

function createVerifyToken(uid, email, app = 'marketplace') {
  const secret = getVerifySecret();
  const payloadB64 = base64Url(JSON.stringify({ uid, email: String(email).toLowerCase(), app: normalizeAuthApp(app), exp: Date.now() + VERIFY_TOKEN_TTL_MS }));
  return `${payloadB64}.${signVerifyPayload(payloadB64, secret)}`;
}

function readVerifyToken(token) {
  const secret = getVerifySecret();
  const [payloadB64, signature] = String(token || '').split('.');
  if (!payloadB64 || !signature) return null;
  const expected = signVerifyPayload(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload?.uid || !payload?.email || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

/* =========================================================================
 * CEK EMAIL (publik): format + MX domain + email sekali pakai + saran salah ketik
 * Gratis, tanpa API pihak ketiga. Hanya membuktikan DOMAIN bisa menerima email,
 * bukan bahwa mailbox-nya ada. Verifikasi link tetap jadi bukti akhir.
 * ========================================================================= */
const EMAIL_FORMAT_RE = /^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,}$/;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
  'tempmailo.com', 'tempail.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'trashmail.com', 'trashmail.net', 'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com',
  'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'burnermail.io', 'moakt.com',
  'mailnesia.com', 'spamgourmet.com', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'discard.email',
  'inboxkitten.com', 'mail.tm', 'tempinbox.com', 'mailcatch.com', 'spambox.us', 'grr.la',
  'harakirimail.com', 'luxusmail.org', 'mail7.io', 'emailfake.com', 'fakemail.net', 'tempr.email',
  'fexpost.com', 'dropmail.me', '1secmail.com', '1secmail.net', 'wegwerfmail.de', 'cs.email'
]);

const DOMAIN_TYPO_FIXES = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gmaill.com': 'gmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com'
};

const emailCheckHits = new Map(); // best-effort per instance serverless
function tooManyEmailChecks(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (emailCheckHits.get(ip) || []).filter((time) => now - time < windowMs);
  hits.push(now);
  emailCheckHits.set(ip, hits);
  if (emailCheckHits.size > 3000) {
    for (const [key, list] of emailCheckHits) {
      if (!list.some((time) => now - time < windowMs)) emailCheckHits.delete(key);
    }
  }
  return hits.length > 30;
}

function withDnsTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('dns-timeout'), { code: 'ETIMEOUT' })), ms))
  ]);
}

// 'ok' = domain bisa menerima email, 'no' = pasti tidak bisa, 'unknown' = DNS bermasalah (jangan menolak).
async function domainMailStatus(domain) {
  try {
    const records = await withDnsTimeout(dns.resolveMx(domain));
    const usable = records.some((record) => record.exchange && record.exchange !== '.');
    return usable ? 'ok' : 'no';
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      try {
        const addresses = await withDnsTimeout(dns.resolve4(domain));
        return addresses.length ? 'ok' : 'no';
      } catch (fallbackError) {
        return fallbackError.code === 'ENOTFOUND' || fallbackError.code === 'ENODATA' ? 'no' : 'unknown';
      }
    }
    return 'unknown';
  }
}

async function checkEmail(req, res) {
  if (tooManyEmailChecks(getClientIp(req))) {
    return res.status(200).json({ success: true, valid: true, reason: 'rate-limited' }); // fail-open
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_FORMAT_RE.test(email) || email.length > 254 || email.includes('..')) {
    return res.status(200).json({ success: true, valid: false, reason: 'format', message: 'Format email tidak valid.' });
  }

  const domain = email.split('@')[1];
  if (DOMAIN_TYPO_FIXES[domain]) {
    const suggestion = `${email.split('@')[0]}@${DOMAIN_TYPO_FIXES[domain]}`;
    return res.status(200).json({ success: true, valid: false, reason: 'typo', suggestion, message: `Apakah maksud Anda ${suggestion}?` });
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(200).json({ success: true, valid: false, reason: 'disposable', message: 'Email sementara (disposable) tidak diperbolehkan. Gunakan email aktif Anda.' });
  }

  const status = await domainMailStatus(domain);
  if (status === 'no') {
    return res.status(200).json({ success: true, valid: false, reason: 'no-mx', message: `Domain "${domain}" tidak dapat menerima email. Periksa penulisan email Anda.` });
  }
  return res.status(200).json({ success: true, valid: true, reason: status });
}

/* =========================================================================
 * RESET PASSWORD (token HMAC buatan sendiri, dikirim lewat sendEmail seperti email verifikasi)
 * Alur: POST send-password-reset -> email berisi link -> GET reset-password (form)
 *       -> POST confirm-password-reset (ganti password via Admin SDK)
 * ========================================================================= */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 jam
const RESET_RESEND_INTERVAL_MS = 30 * 1000;
const resetRequestHits = new Map(); // best-effort per instance serverless

function createResetToken(uid, email, passwordHash, app = 'marketplace') {
  const secret = getVerifySecret();
  // "ph" = potongan hash password saat ini: token otomatis hangus begitu password diganti (sekali pakai).
  const ph = crypto.createHash('sha256').update(String(passwordHash || 'no-password')).digest('hex').slice(0, 16);
  const payloadB64 = base64Url(JSON.stringify({ t: 'reset', uid, email: String(email).toLowerCase(), ph, app: normalizeAuthApp(app), exp: Date.now() + RESET_TOKEN_TTL_MS }));
  return `${payloadB64}.${signVerifyPayload(payloadB64, secret)}`;
}

function readResetToken(token) {
  const secret = getVerifySecret();
  const [payloadB64, signature] = String(token || '').split('.');
  if (!payloadB64 || !signature) return null;
  const expected = signVerifyPayload(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload?.t !== 'reset' || !payload?.uid || !payload?.email || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function tooManyResetRequests(key) {
  const now = Date.now();
  const hits = (resetRequestHits.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  hits.push(now);
  resetRequestHits.set(key, hits);
  if (resetRequestHits.size > 3000) {
    for (const [storedKey, list] of resetRequestHits) {
      if (!list.some((time) => now - time < 10 * 60 * 1000)) resetRequestHits.delete(storedKey);
    }
  }
  return hits.length > 5;
}

// Publik. Selalu membalas sukses agar tidak membocorkan email mana yang terdaftar.
async function sendPasswordReset(req, res) {
  const app = normalizeAuthApp(req.body?.app);
  const brand = authBrand(app);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_FORMAT_RE.test(email) || email.length > 254) {
    return responseError(res, 400, 'invalid-email', 'Format email tidak valid.');
  }
  if (tooManyResetRequests(`${getClientIp(req)}|${email}`)) {
    return responseError(res, 429, 'too-many-requests', 'Terlalu banyak permintaan. Tunggu beberapa menit lalu coba lagi.');
  }

  const genericOk = () => res.status(200).json({ success: true, sent: true });

  try {
    const adminAuth = getAdminAuth();
    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') return genericOk();
      throw error;
    }
    if (String(user.email || '').toLowerCase() === MAIL_OWNER_EMAIL) return genericOk(); // akun admin tidak lewat jalur ini

    // Throttle per akun disimpan di Firestore (berlaku antar instance serverless).
    const db = getAdminDb();
    const profileRef = db.collection('marketplace_users').doc(user.uid);
    const profileSnap = await profileRef.get();
    const lastSent = Number(profileSnap.exists ? profileSnap.data()?.resetSentAt || 0 : 0);
    if (Date.now() - lastSent < RESET_RESEND_INTERVAL_MS) return genericOk();

    const host = String(req.headers?.host || '');
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const baseUrl = isLocalHost ? `http://${host}` : getSiteUrl();
    const appQuery = app === 'jasa' ? '&app=jasa' : '';
    const link = `${baseUrl}/api/marketplace?action=reset-password&token=${encodeURIComponent(createResetToken(user.uid, email, user.passwordHash, app))}${appQuery}`;

    const name = cleanText(profileSnap.exists ? profileSnap.data()?.name : '', 80) || 'Pembeli';
    const safeLink = escapeMailHtml(link);
    await sendEmail({
      to: email,
      subject: `Atur ulang password akun ${brand}`,
      html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:28px;color:#111827;line-height:1.6;border:1px solid #eee;border-radius:16px">
        <h2 style="margin:0 0 12px;color:#2a1f3d">Atur ulang password</h2>
        <p>Halo ${escapeMailHtml(name)},</p>
        <p>Kami menerima permintaan untuk mengatur ulang password akun ${escapeMailHtml(brand)} Anda. Klik tombol di bawah untuk membuat password baru.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0">
          <tr>
            <td align="center" bgcolor="#ec4f86" style="border-radius:10px">
              <a href="${safeLink}" target="_blank"
                 style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">
                Atur Ulang Password
              </a>
            </td>
          </tr>
        </table>
        <p style="font-size:13px;color:#6b6078">Jika tombol tidak bisa diklik, salin dan tempel link berikut ke browser:</p>
        <p style="font-size:12px;word-break:break-all;color:#374151">${safeLink}</p>
        <p style="font-size:13px;color:#6b6078">Link berlaku 1 jam dan hanya bisa dipakai sekali. Jika Anda tidak meminta ini, abaikan email ini; password Anda tidak berubah.</p>
      </div>`,
      text: `Halo ${name},\n\nKlik link berikut untuk mengatur ulang password akun ${brand} Anda:\n\n${link}\n\nLink berlaku 1 jam dan hanya bisa dipakai sekali. Jika Anda tidak meminta ini, abaikan email ini.\n\n${brand}`
    });
    await profileRef.set({ resetSentAt: Date.now() }, { merge: true });
    return genericOk();
  } catch (error) {
    console.error('[marketplace] gagal mengirim email reset password:', { code: error.code || 'unknown', message: error.message });
    return responseError(res, 502, error.code || 'reset-mail-failed', 'Email reset password gagal dikirim. Coba lagi sebentar.');
  }
}

function renderResetPage(res, { token = '', error = '', app = 'marketplace' } = {}) {
  const brand = authBrand(app);
  const loginUrl = `${authLoginPath(app)}?reset=1`;
  res.statusCode = error ? 400 : 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const form = error ? '' : `
    <form id="f" autocomplete="off">
      <label for="p1">Password baru</label>
      <input id="p1" type="password" minlength="6" autocomplete="new-password" required />
      <label for="p2">Ulangi password baru</label>
      <input id="p2" type="password" minlength="6" autocomplete="new-password" required />
      <p id="msg" role="status"></p>
      <button id="btn" type="submit">Simpan password</button>
    </form>
    <script>
      const token = ${JSON.stringify(token)};
      const form = document.getElementById('f');
      const msg = document.getElementById('msg');
      const btn = document.getElementById('btn');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const p1 = document.getElementById('p1').value;
        const p2 = document.getElementById('p2').value;
        msg.className = '';
        if (p1.length < 6) { msg.textContent = 'Password minimal 6 karakter.'; msg.className = 'err'; return; }
        if (p1 !== p2) { msg.textContent = 'Kedua password tidak sama.'; msg.className = 'err'; return; }
        btn.disabled = true; btn.textContent = 'Menyimpan...';
        try {
          const response = await fetch('/api/marketplace?action=confirm-password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password: p1 })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.success === false) throw new Error(result.message || 'Password gagal disimpan.');
          msg.textContent = 'Password berhasil diganti. Mengarahkan ke halaman masuk...'; msg.className = 'ok';
          setTimeout(() => { location.href = ${JSON.stringify(loginUrl)}; }, 1500);
        } catch (err) {
          msg.textContent = err.message; msg.className = 'err';
          btn.disabled = false; btn.textContent = 'Simpan password';
        }
      });
    </script>`;
  res.end(`<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Atur ulang password — ${escapeMailHtml(brand)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff5f9;font-family:Arial,Helvetica,sans-serif;color:#2a1f3d}
  .card{width:min(420px,92vw);background:#fff;border-radius:20px;padding:28px;box-shadow:0 18px 50px rgba(0,0,0,.1)}
  h1{margin:0 0 6px;font-size:1.4rem} p.sub{margin:0 0 18px;color:#6b6078;font-size:.95rem}
  label{display:block;margin:14px 0 6px;font-weight:600;font-size:.9rem}
  input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #e5d9e2;border-radius:10px;font-size:1rem}
  button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#ec4f86;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}
  button:disabled{opacity:.6;cursor:default} #msg{min-height:20px;margin:12px 0 0;font-size:.9rem}
  .err{color:#b91c1c}.ok{color:#15803d}.error-box{background:#fff1f2;border:1px solid #fecdd3;color:#991b1b;padding:12px;border-radius:10px;margin-bottom:12px}
  a{color:#ec4f86;font-weight:700}
</style></head><body><div class="card">
  <h1>Atur ulang password</h1>
  <p class="sub">Buat password baru untuk akun ${escapeMailHtml(brand)} Anda.</p>
  ${error ? `<div class="error-box">${escapeMailHtml(error)}</div><p><a href="${loginUrl}">Kembali ke halaman masuk</a></p>` : form}
</div></body></html>`);
}

// Dibuka dari link di email (GET): tampilkan form password baru.
async function showResetPage(req, res) {
  const requestedApp = normalizeAuthApp(req.query?.app);
  try {
    const payload = readResetToken(req.query?.token);
    if (!payload) return renderResetPage(res, { error: 'Link tidak valid atau sudah kedaluwarsa. Minta link baru dari halaman masuk.', app: requestedApp });
    const user = await getAdminAuth().getUser(payload.uid);
    const ph = crypto.createHash('sha256').update(String(user.passwordHash || 'no-password')).digest('hex').slice(0, 16);
    if (String(user.email || '').toLowerCase() !== payload.email || ph !== payload.ph) {
      return renderResetPage(res, { error: 'Link ini sudah dipakai atau tidak berlaku lagi. Minta link baru dari halaman masuk.', app: payload.app });
    }
    return renderResetPage(res, { token: String(req.query.token), app: payload.app });
  } catch (error) {
    console.error('[marketplace] reset-password gagal:', { code: error.code || 'unknown', message: error.message });
    return renderResetPage(res, { error: 'Terjadi kesalahan. Silakan minta link baru.', app: requestedApp });
  }
}

// Publik (dilindungi token): ganti password lewat Admin SDK.
async function confirmPasswordReset(req, res) {
  const password = String(req.body?.password || '');
  if (password.length < 6 || password.length > 128) {
    return responseError(res, 400, 'weak-password', 'Password harus 6 sampai 128 karakter.');
  }
  const payload = readResetToken(req.body?.token);
  if (!payload) return responseError(res, 400, 'invalid-token', 'Link tidak valid atau sudah kedaluwarsa. Minta link baru dari halaman masuk.');

  const adminAuth = getAdminAuth();
  const user = await adminAuth.getUser(payload.uid);
  const ph = crypto.createHash('sha256').update(String(user.passwordHash || 'no-password')).digest('hex').slice(0, 16);
  if (String(user.email || '').toLowerCase() !== payload.email || ph !== payload.ph) {
    return responseError(res, 400, 'token-used', 'Link ini sudah dipakai. Minta link baru dari halaman masuk.');
  }

  // Email terbukti milik pengguna karena link dikirim ke sana, jadi sekalian ditandai terverifikasi
  // (membantu akun Google yang belum punya password).
  await adminAuth.updateUser(payload.uid, { password, emailVerified: true });
  await adminAuth.revokeRefreshTokens(payload.uid).catch(() => {});
  return res.status(200).json({ success: true });
}

async function sendVerification(req, res) {
  const app = normalizeAuthApp(req.body?.app);
  const brand = authBrand(app);
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

  // Throttle disimpan di Firestore supaya tetap berlaku antar instance serverless.
  const db = getAdminDb();
  const profileRef = db.collection('marketplace_users').doc(String(claims.uid));
  const profileSnap = await profileRef.get();
  const lastSent = Number(profileSnap.exists ? profileSnap.data()?.verificationSentAt || 0 : 0);
  if (Date.now() - lastSent < VERIFY_RESEND_INTERVAL_MS) {
    return responseError(res, 429, 'too-many-requests', 'Tunggu 30 detik sebelum meminta email verifikasi lagi.');
  }

  try {
    const host = String(req.headers?.host || '');
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const baseUrl = isLocalHost ? `http://${host}` : getSiteUrl();
    const appQuery = app === 'jasa' ? '&app=jasa' : '';
    const link = `${baseUrl}/api/marketplace?action=verify-email&token=${encodeURIComponent(createVerifyToken(claims.uid, email, app))}${appQuery}`;

             const name = cleanText(claims.name || profileSnap.data()?.name || '', 80) || 'Pembeli';
    const safeLink = escapeMailHtml(link);
    await sendEmail({
      to: email,
      subject: `Verifikasi email akun ${brand}`,
      html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:28px;color:#111827;line-height:1.6;border:1px solid #eee;border-radius:16px">
        <h2 style="margin:0 0 12px;color:#2a1f3d">Verifikasi email Anda</h2>
        <p>Halo ${escapeMailHtml(name)},</p>
        <p>Terima kasih sudah mendaftar di ${escapeMailHtml(brand)}. Klik tombol di bawah untuk mengaktifkan akun Anda.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0">
          <tr>
            <td align="center" bgcolor="#ec4f86" style="border-radius:10px">
              <a href="${safeLink}" target="_blank"
                 style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">
                Verifikasi Email
              </a>
            </td>
          </tr>
        </table>
        <p style="font-size:13px;color:#6b6078">Jika tombol tidak bisa diklik, salin dan tempel link berikut ke browser:</p>
        <p style="font-size:12px;word-break:break-all;color:#374151">${safeLink}</p>
        <p style="font-size:13px;color:#6b6078">Link berlaku 24 jam. Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
      </div>`,
      text: `Halo ${name},\n\nKlik link berikut untuk memverifikasi email Anda di ${brand}:\n\n${link}\n\nLink berlaku 24 jam. Jika Anda tidak merasa mendaftar, abaikan email ini.\n\n${brand}`
    });
    await profileRef.set({ verificationSentAt: Date.now() }, { merge: true });
    return res.status(200).json({ success: true, sent: true });
  } catch (error) {
    console.error('[marketplace] gagal mengirim email verifikasi:', { code: error.code || 'unknown', message: error.message });
    return responseError(res, 502, error.code || 'verification-mail-failed', `Email verifikasi gagal dikirim: ${cleanText(error.message, 200)}`);
  }
}

// Dibuka dari link di email (GET). Menandai email terverifikasi lalu mengarahkan ke halaman login.
async function verifyEmail(req, res) {
  let app = normalizeAuthApp(req.query?.app);
  const redirect = (flag) => {
    res.statusCode = 302;
    res.setHeader('Location', `${authLoginPath(app)}?verified=${flag}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  };

  try {
    const payload = readVerifyToken(req.query?.token);
    if (payload?.app) app = normalizeAuthApp(payload.app);
    if (!payload) return redirect('invalid');

    const adminAuth = getAdminAuth();
    const user = await adminAuth.getUser(payload.uid);
    if (String(user.email || '').toLowerCase() !== payload.email) return redirect('invalid');
    if (!user.emailVerified) await adminAuth.updateUser(payload.uid, { emailVerified: true });
    return redirect('1');
  } catch (error) {
    console.error('[marketplace] verify-email gagal:', { code: error.code || 'unknown', message: error.message });
    return redirect('error');
  }
}

function jasaFailure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function jasaOrderCode() {
  const now = new Date();
  const date = [String(now.getUTCFullYear()).slice(-2), String(now.getUTCMonth() + 1).padStart(2, '0'), String(now.getUTCDate()).padStart(2, '0')].join('');
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffix = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `JS-${date}-${suffix}`;
}

function jasaHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function jasaImageUrl(value) {
  const image = cleanText(value, 800);
  if (!image) return '';
  if (/^https:\/\/[^\s]+$/i.test(image)) return image;
  return /^\/(?!\/)[^\s]*$/.test(image) ? image : '';
}

function jasaValidateId(value, label = 'ID') {
  const id = cleanText(value, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw jasaFailure(400, 'invalid-id', `${label} tidak valid.`);
  return id;
}

async function jasaPublicCatalog(req, res) {
  const db = getAdminDb();
  const [categorySnapshot, serviceSnapshot] = await retryNetwork(() => Promise.all([
    db.collection('jasa_categories').get(),
    db.collection('jasa_services').get()
  ]));
  const categories = categorySnapshot.docs
    .map((item) => {
      const data = item.data() || {};
      return {
        id: item.id,
        name: cleanText(data.name, 100),
        slug: cleanText(data.slug, 100),
        icon: cleanText(data.icon, 60),
        tagline: cleanText(data.tagline, 200),
        description: cleanText(data.description, 1200),
        active: data.active === true,
        order: Number(data.order || 0)
      };
    })
    .filter((item) => item.active === true)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const activeCategoryIds = new Set(categories.map((item) => item.id));
  const services = serviceSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.active === true && activeCategoryIds.has(item.categoryId) &&
      Array.isArray(item.packages) && item.packages.some((packageItem) => packageItem?.active !== false))
    .map((item) => ({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      summary: cleanText(item.summary, 300),
      description: cleanText(item.description, 3000),
      image: jasaImageUrl(item.image),
      disclaimer: cleanText(item.disclaimer, 1500),
      pricingNote: cleanText(item.pricingNote, 300),
      paymentOptions: Array.isArray(item.paymentOptions)
        ? item.paymentOptions.filter((option) => ['full', 'dp', 'cash'].includes(option))
        : ['full'],
      needsParentProfile: item.needsParentProfile === true,
      scheduleMode: ['none', 'date', 'datetime', 'recurring'].includes(item.scheduleMode) ? item.scheduleMode : 'recurring',
      scheduleLabel: cleanText(item.scheduleLabel, 80) || 'Preferensi jadwal',
      recipientLabel: cleanText(item.recipientLabel, 60) || 'Penerima layanan',
      consentText: cleanText(item.consentText, 300) || 'Saya memahami batas layanan dan menyetujui ketentuan pemesanan.',
      packages: Array.isArray(item.packages) ? item.packages.filter((packageItem) => packageItem?.active !== false).map((packageItem) => ({
        id: cleanText(packageItem.id, 120),
        name: cleanText(packageItem.name, 120),
        description: cleanText(packageItem.description, 500),
        duration: cleanText(packageItem.duration, 80),
        priceType: cleanText(packageItem.priceType, 20),
        price: Number(packageItem.price || 0),
        dpPercent: Number.isSafeInteger(packageItem.dpPercent) ? packageItem.dpPercent : 30
      })) : [],
      options: Array.isArray(item.options) ? item.options.map((option) => ({
        id: cleanText(option.id, 120),
        label: cleanText(option.label, 150)
      })) : [],
      formFields: Array.isArray(item.formFields) ? item.formFields.map((field) => ({
        key: cleanText(field.key, 60),
        label: cleanText(field.label, 120),
        type: cleanText(field.type, 20),
        required: field.required === true,
        ...(field.type === 'select' ? { options: Array.isArray(field.options) ? field.options.slice(0, 30).map((option) => cleanText(option, 100)) : [] } : {})
      })) : []
    }));
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  return res.status(200).json({ success: true, categories, services });
}

async function createJasaDokuPayment(order, config, paymentEntry = {}) {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  const returnUrl = `${config.returnBaseUrl}/user/jasa/pesanan.html?orderId=${encodeURIComponent(order.orderCode)}`;
  const amount = paymentEntry.amount ?? order.totalAmount;
  const invoiceNumber = paymentEntry.invoiceNumber || order.orderCode;
  const paymentMethodsRaw = String(process.env.DOKU_PAYMENT_METHODS || 'QRIS').trim();
  const paymentMethods = paymentMethodsRaw.toUpperCase() === 'ALL'
    ? []
    : paymentMethodsRaw.split(',').map((value) => value.trim()).filter(Boolean);
  const payment = { payment_due_date: 60, return_url: returnUrl };
  if (paymentMethods.length) payment.payment_method_types = paymentMethods;
  const body = {
    order: {
      amount,
      invoice_number: invoiceNumber,
      callback_url: returnUrl,
      line_items: [{
        name: dokuSafeText(order.serviceName, 100, 'Jasa Gamon'),
        price: amount,
        quantity: 1
      }],
      currency: 'IDR'
    },
    payment,
    customer: {
      name: dokuSafeText(order.buyerName, 100, 'Pembeli'),
      email: dokuSafeEmail(order.buyerEmail),
      phone: dokuSafePhone(order.buyerPhone),
      address: dokuSafeText(order.parent?.address || order.buyerName, 200, 'Pemesanan jasa')
    },
    additional_info: { override_notification_url: `${config.siteUrl}/api/doku-notify` }
  };
  const path = '/checkout/v1/payment';
  const bodyText = JSON.stringify(body);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: createDokuHeaders({ ...config, requestId, timestamp, path, bodyText }),
    body: bodyText
  });
  const raw = await response.text();
  let payload = {};
  try { payload = JSON.parse(raw); } catch (error) { payload = { raw: raw.slice(0, 1000) }; }
  const paymentUrl = payload?.response?.payment?.url;
  if (!response.ok || typeof paymentUrl !== 'string' || !/^https:\/\//i.test(paymentUrl)) {
    console.error('[jasa] respons DOKU:', response.status, JSON.stringify(payload).slice(0, 1200));
    throw Object.assign(new Error(payload?.error_messages?.join?.(', ') || payload?.message || `DOKU menolak checkout (${response.status}).`), {
      code: 'doku-checkout-failed',
      dokuRequestId: requestId
    });
  }
  return { paymentUrl, requestId };
}

function jasaPaymentEntries(order) {
  if (Array.isArray(order.payments)) return order.payments;
  if ((order.paymentPlan === 'cash' || order.paymentMethod === 'CASH') && order.paymentStatus !== 'PAID') return [];
  if (!order.orderCode && !order.id) return [];
  const orderCode = order.orderCode || order.id;
  const isPaid = order.paymentStatus === 'PAID' || ['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status);
  return [{
    id: orderCode,
    kind: 'full',
    amount: Number(order.totalAmount || 0),
    method: order.paymentMethod === 'CASH' ? 'CASH' : 'DOKU',
    status: isPaid ? 'PAID' : order.paymentStatus === 'EXPIRED' ? 'EXPIRED' : order.paymentStatus === 'CANCELLED' ? 'CANCELLED' : 'UNPAID',
    invoiceNumber: orderCode,
    paymentUrl: cleanText(order.paymentUrl, 1000),
    expiresAt: Number(order.paymentExpiresAt || 0),
    paidAt: Number(order.paidAt || 0)
  }];
}

function jasaAmounts(order, payments = jasaPaymentEntries(order)) {
  const total = Number(order.totalAmount || 0);
  const paidAmount = payments.filter((payment) => payment.status === 'PAID')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { paidAmount, remainingAmount: Math.max(0, total - paidAmount) };
}

function jasaPaymentStatus(order, payments, remainingAmount) {
  if (order.status === 'cancelled') return 'CANCELLED';
  if (order.status === 'expired' && remainingAmount > 0) return 'EXPIRED';
  if (remainingAmount === 0) return 'PAID';
  if (payments.some((payment) => payment.status === 'PAID')) return 'PARTIAL';
  if (order.paymentPlan === 'cash' && order.status !== 'awaiting_quote') return 'CASH_PENDING';
  return 'UNPAID';
}

function jasaDpAmount(total, percent) {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(percent) || percent < 10 || percent > 90) {
    throw jasaFailure(409, 'invalid-dp-config', 'Persentase DP layanan tidak valid. Hubungi admin.');
  }
  const amount = Math.round(total * percent / 100);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount >= total) {
    throw jasaFailure(409, 'invalid-dp-amount', 'Nominal DP layanan tidak valid. Hubungi admin.');
  }
  return amount;
}

function jasaCleanFormData(service, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw jasaFailure(400, 'invalid-form', 'Data formulir jasa tidak valid.');
  }
  const fields = Array.isArray(service.formFields) ? service.formFields.slice(0, 20) : [];
  const values = {};
  for (const field of fields) {
    const key = cleanText(field.key, 60);
    const value = cleanText(input[key], 1000);
    if (field.required && !value) throw jasaFailure(400, 'required-field', `${cleanText(field.label, 100) || key} wajib diisi.`);
    if (field.type === 'select' && value && !((field.options || []).map((option) => cleanText(option, 100)).includes(value))) {
      throw jasaFailure(400, 'invalid-field-option', `Pilihan ${cleanText(field.label, 100) || key} tidak valid.`);
    }
    if (field.type === 'number' && value && !/^[0-9.,]{1,20}$/.test(value)) {
      throw jasaFailure(400, 'invalid-field-value', `${cleanText(field.label, 100) || key} hanya boleh berisi angka, titik, atau koma (maksimal 20 karakter).`);
    }
    if (value) values[key] = value;
  }
  return values;
}

function jasaCleanSchedule(input, mode = 'recurring') {
  const schedule = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (!['none', 'date', 'datetime', 'recurring'].includes(mode)) throw jasaFailure(400, 'invalid-schedule', 'Pengaturan jadwal layanan tidak valid.');
  if (mode === 'none') return { mode, date: '', time: '', recurring: false, days: [] };
  if (schedule.recurring !== undefined && typeof schedule.recurring !== 'boolean') throw jasaFailure(400, 'invalid-schedule', 'Pilihan jadwal rutin tidak valid.');
  if (schedule.days !== undefined && !Array.isArray(schedule.days)) throw jasaFailure(400, 'invalid-schedule', 'Hari jadwal rutin tidak valid.');
  const date = cleanText(schedule.date, 10);
  const time = cleanText(schedule.time, 5);
  const dateParts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateObject = dateParts ? new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))) : null;
  if (!dateObject || dateObject.getUTCFullYear() !== Number(dateParts[1]) || dateObject.getUTCMonth() !== Number(dateParts[2]) - 1 || dateObject.getUTCDate() !== Number(dateParts[3])) {
    throw jasaFailure(400, 'invalid-schedule', 'Pilih tanggal yang valid.');
  }
  if (date < new Date().toISOString().slice(0, 10)) throw jasaFailure(400, 'invalid-schedule', 'Tanggal tidak boleh sudah lewat.');
  if (mode === 'datetime' || mode === 'recurring') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw jasaFailure(400, 'invalid-schedule', 'Pilih jam yang valid.');
  }
  const recurring = mode === 'recurring' && schedule.recurring === true;
  const allowedDays = new Set(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']);
  const days = Array.isArray(schedule.days)
    ? [...new Set(schedule.days.map((day) => cleanText(day, 12)).filter((day) => allowedDays.has(day)))].slice(0, 7)
    : [];
  if (recurring && !days.length) throw jasaFailure(400, 'invalid-schedule', 'Pilih minimal satu hari untuk jadwal rutin.');
  return { mode, date, time: mode === 'date' ? '' : time, recurring, days: recurring ? days : [] };
}

function jasaValidPhone(value) {
  const phone = cleanText(value, 30);
  return /^\+?[0-9][0-9\s().-]{6,23}$/.test(phone) && phone.replace(/\D/g, '').length >= 8;
}

function jasaCleanParents(input, existingParents = []) {
  if (!Array.isArray(input) || input.length > 5) throw jasaFailure(400, 'invalid-parent-profiles', 'Simpan maksimal 5 data penerima layanan.');
  if (input.some((item) => item?.isSelf !== undefined && typeof item.isSelf !== 'boolean')) {
    throw jasaFailure(400, 'invalid-parent-profile', 'Penanda diri sendiri harus berupa boolean.');
  }
  if (input.filter((item) => item?.isSelf === true).length > 1) {
    throw jasaFailure(400, 'duplicate-self-profile', 'Simpan maksimal satu data diri sendiri.');
  }
  const ids = new Set();
  const existingById = new Map((Array.isArray(existingParents) ? existingParents : [])
    .filter((item) => item && typeof item === 'object' && item.id)
    .map((item) => [String(item.id), item]));
  return input.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw jasaFailure(400, 'invalid-parent-profile', `Data penerima layanan nomor ${index + 1} tidak valid.`);
    const id = jasaValidateId(item.id, 'ID data penerima');
    const isSelf = item.isSelf === true;
    if (ids.has(id)) throw jasaFailure(400, 'duplicate-parent-id', 'ID data penerima harus unik.');
    ids.add(id);
    const name = cleanText(item.name, 120);
    const address = cleanText(item.address, 500);
    const city = cleanText(item.city, 120);
    const district = cleanText(item.district, 100);
    const village = cleanText(item.village, 100);
    const postalCode = cleanText(item.postalCode, 20);
    const latitudeText = String(item.latitude ?? '').trim();
    const longitudeText = String(item.longitude ?? '').trim();
    const latitude = latitudeText ? Number(latitudeText) : NaN;
    const longitude = longitudeText ? Number(longitudeText) : NaN;
    const emergencyContactName = cleanText(item.emergencyContactName, 120);
    const emergencyContactPhone = cleanText(item.emergencyContactPhone, 30);
    const notes = cleanText(item.notes, 700);
    if (!name || !address || (emergencyContactPhone && !jasaValidPhone(emergencyContactPhone))) {
      throw jasaFailure(400, 'invalid-parent-profile', `Nama dan alamat wajib diisi untuk data penerima layanan nomor ${index + 1}; nomor telepon harus valid jika diisi.`);
    }
    const existing = existingById.get(id);
    const sameText = (submitted, stored, maxLength) => cleanText(submitted, maxLength) === cleanText(stored, maxLength);
    const sameCoordinate = (submitted, stored) => {
      const submittedText = String(submitted ?? '').trim();
      const storedText = String(stored ?? '').trim();
      if (!submittedText || !storedText) return !submittedText && !storedText;
      const submittedNumber = Number(submittedText);
      const storedNumber = Number(storedText);
      return Number.isFinite(submittedNumber) && Number.isFinite(storedNumber)
        ? submittedNumber === storedNumber
        : submittedText === storedText;
    };
    const existingLatitudeText = String(existing?.latitude ?? '').trim();
    const existingLongitudeText = String(existing?.longitude ?? '').trim();
    const existingLatitude = existingLatitudeText ? Number(existingLatitudeText) : NaN;
    const existingLongitude = existingLongitudeText ? Number(existingLongitudeText) : NaN;
    const existingHasCompleteRegion = Boolean(
      KALSEL_CITIES.has(cleanText(existing?.city, 120)) &&
      cleanText(existing?.district, 100) &&
      cleanText(existing?.village, 100) &&
      Number.isFinite(existingLatitude) && existingLatitude >= -90 && existingLatitude <= 90 &&
      Number.isFinite(existingLongitude) && existingLongitude >= -180 && existingLongitude <= 180
    );
    const isLegacyUnchanged = Boolean(existing && !existingHasCompleteRegion &&
      sameText(item.city, existing.city, 120) &&
      sameText(item.district, existing.district, 100) &&
      sameText(item.village, existing.village, 100) &&
      sameCoordinate(item.latitude, existing.latitude) &&
      sameCoordinate(item.longitude, existing.longitude));
    if (isLegacyUnchanged) {
      return {
        id, name, address,
        isSelf,
        province: cleanText(item.province, 100),
        city, district, village, postalCode,
        latitude: latitudeText ? (Number.isFinite(latitude) ? latitude : cleanText(item.latitude, 30)) : null,
        longitude: longitudeText ? (Number.isFinite(longitude) ? longitude : cleanText(item.longitude, 30)) : null,
        mapsUrl: cleanText(item.mapsUrl, 500),
        emergencyContactName, emergencyContactPhone, notes
      };
    }
    const parentLabel = `data penerima "${name}"`;
    if (!KALSEL_CITIES.has(city) || !district || !village ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw jasaFailure(400, 'invalid-parent-profile', `Lengkapi kota/kabupaten, kecamatan, kelurahan, dan titik peta untuk ${parentLabel}.`);
    }
    if (latitude < -4.3 || latitude > -1.2 || longitude < 114.3 || longitude > 116.8) {
      throw jasaFailure(400, 'invalid-parent-profile', `Titik peta ${parentLabel} harus berada di wilayah Kalimantan Selatan.`);
    }
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    return { id, name, address, isSelf, province: 'Kalimantan Selatan', city, district, village, postalCode, latitude, longitude, mapsUrl, emergencyContactName, emergencyContactPhone, notes };
  });
}

async function jasaGetProfile(req, res, claims) {
  const ref = getAdminDb().collection('jasa_profiles').doc(claims.uid);
  const snapshot = await retryNetwork(() => ref.get());
  const data = snapshot.exists ? snapshot.data() || {} : {};
  return res.status(200).json({ success: true, profile: { parents: Array.isArray(data.parents) ? data.parents : [] } });
}

async function jasaSaveProfile(req, res, claims) {
  const ref = getAdminDb().collection('jasa_profiles').doc(claims.uid);
  const snapshot = await retryNetwork(() => ref.get());
  const data = snapshot.exists ? snapshot.data() || {} : {};
  const existingParents = Array.isArray(data.parents) ? data.parents : [];
  const parents = jasaCleanParents(req.body?.parents, existingParents);
  await retryNetwork(() => ref.set({ parents, updatedAt: Date.now() }));
  return res.status(200).json({ success: true, profile: { parents }, message: 'Data penerima layanan berhasil disimpan.' });
}

async function jasaSendBuyerEmail(order, subject, text, html) {
  try {
    await sendEmail({ to: cleanText(order.buyerEmail, 180), subject, text, html });
  } catch (error) {
    console.error('[jasa] email pembeli gagal:', { orderCode: order.orderCode, code: error.code || 'unknown', message: error.message });
  }
}

async function jasaSendPaymentConfirmation(order) {
  const assigned = order.assignedStaff?.name ? ` Petugas yang ditugaskan: ${cleanText(order.assignedStaff.name, 120)}.` : '';
  await jasaSendBuyerEmail(
    order,
    `Pembayaran diterima — Gamon Jasa ${order.orderCode}`,
    `Pembayaran untuk ${order.serviceName} (${order.orderCode}) berhasil diterima.${assigned}`,
    `<p>Pembayaran untuk <b>${jasaHtml(order.serviceName)}</b> (${jasaHtml(order.orderCode)}) berhasil diterima.</p>${assigned ? `<p>${jasaHtml(assigned.trim())}</p>` : ''}<p>Kami akan mengabari Anda saat jadwal dikonfirmasi.</p>`
  );
}

async function jasaNotifyAdmin(order) {
  const to = String(process.env.ADMIN_NOTIFY_EMAIL || 'muhamadabelldeskiawan@gmail.com').trim();
  const adminUrl = `${String(process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '')}/admin/jasa-orders.html`;
  const subject = `Pesanan Jasa Baru ${order.orderCode}`;
  const text = `Pesanan ${order.orderCode}\nJasa: ${order.serviceName}\nPaket: ${order.package.name}\nPembeli: ${order.buyerName} (${order.buyerEmail})\nStatus: ${order.status}`;
  const html = `<p>Pesanan jasa baru masuk.</p><p><b>${jasaHtml(order.orderCode)}</b> — ${jasaHtml(order.serviceName)}</p><p>Paket: ${jasaHtml(order.package.name)}<br>Pembeli: ${jasaHtml(order.buyerName)} (${jasaHtml(order.buyerEmail)})<br>Status: ${jasaHtml(order.status)}</p><p><a href="${jasaHtml(adminUrl)}">Buka panel pesanan jasa</a></p>`;
  try {
    await sendEmail({ to, subject, html, text });
  } catch (error) {
    console.error('[jasa] email pesanan admin gagal:', { orderCode: order.orderCode, code: error.code || 'unknown', message: error.message });
  }
}

async function jasaCheckout(req, res, claims) {
  const body = req.body || {};
  const serviceId = jasaValidateId(body.serviceId, 'Layanan');
  const packageId = jasaValidateId(body.packageId, 'Paket');
  const requestedCategoryId = jasaValidateId(body.categoryId, 'Kategori');
  const db = getAdminDb();
  const serviceRef = db.collection('jasa_services').doc(serviceId);
  const categoryRef = db.collection('jasa_categories').doc(requestedCategoryId);
  const profileRef = db.collection('jasa_profiles').doc(claims.uid);
  const [serviceSnapshot, categorySnapshot, profileSnapshot] = await retryNetwork(() =>
    db.getAll(serviceRef, categoryRef, profileRef));
  if (!serviceSnapshot.exists || serviceSnapshot.data()?.active !== true) throw jasaFailure(404, 'service-unavailable', 'Layanan tidak ditemukan atau sedang tidak tersedia.');
  const service = serviceSnapshot.data() || {};
  if (String(service.categoryId || '') !== requestedCategoryId) throw jasaFailure(400, 'invalid-category', 'Kategori layanan tidak cocok.');
  const packages = Array.isArray(service.packages) ? service.packages : [];
  const selectedPackage = packages.find((item) => item.id === packageId && item.active !== false);
  if (!selectedPackage || !['fixed', 'monthly', 'quote'].includes(selectedPackage.priceType)) throw jasaFailure(400, 'package-unavailable', 'Paket tidak tersedia.');
  const paymentOptions = service.paymentOptions === undefined ? ['full'] : service.paymentOptions;
  if (!Array.isArray(paymentOptions) || !paymentOptions.length ||
      paymentOptions.some((option) => !['full', 'dp', 'cash'].includes(option)) ||
      new Set(paymentOptions).size !== paymentOptions.length) {
    throw jasaFailure(409, 'invalid-payment-options', 'Pilihan pembayaran layanan tidak valid. Hubungi admin.');
  }
  const paymentPlan = body.paymentPlan === undefined ? 'full' : cleanText(body.paymentPlan, 10);
  if (!['full', 'dp', 'cash'].includes(paymentPlan) || !paymentOptions.includes(paymentPlan)) {
    throw jasaFailure(400, 'invalid-payment-plan', 'Pilih cara pembayaran yang tersedia untuk layanan ini.');
  }
  if (selectedPackage.priceType === 'monthly' && paymentPlan !== 'full') {
    throw jasaFailure(400, 'monthly-full-only', 'Paket bulanan hanya dapat dibayar penuh.');
  }
  const price = Number(selectedPackage.price);
  if (!Number.isSafeInteger(price) || price < 0 || (selectedPackage.priceType !== 'quote' && price < 1) || (selectedPackage.priceType === 'quote' && price !== 0)) {
    throw jasaFailure(409, 'invalid-service-price', 'Harga paket tidak valid. Hubungi admin.');
  }
  if (!categorySnapshot.exists || categorySnapshot.data()?.active !== true) throw jasaFailure(404, 'service-unavailable', 'Kategori layanan sedang tidak tersedia.');

  const buyerName = cleanText(body.buyerName || claims.name, 120);
  const buyerPhone = cleanText(body.buyerPhone, 40);
  const buyerEmail = cleanText(claims.email, 180).toLowerCase();
  if (!buyerName) throw jasaFailure(400, 'buyer-name-required', 'Nama pemesan wajib diisi.');
  if (!/^\+?[0-9\s().-]{8,24}$/.test(buyerPhone)) throw jasaFailure(400, 'buyer-phone-invalid', 'Nomor telepon pemesan belum valid.');
  if (!buyerEmail) throw jasaFailure(400, 'buyer-email-required', 'Email akun tidak tersedia.');

  if (body.selectedOptions !== undefined && !Array.isArray(body.selectedOptions)) throw jasaFailure(400, 'invalid-option', 'Pilihan kebutuhan tidak valid.');
  const selectedOptions = Array.isArray(body.selectedOptions) ? [...new Set(body.selectedOptions.map((item) => jasaValidateId(item, 'Opsi')))] : [];
  const availableOptions = Array.isArray(service.options) ? service.options : [];
  if (selectedOptions.some((id) => !availableOptions.some((option) => option.id === id))) throw jasaFailure(400, 'invalid-option', 'Pilihan kebutuhan tidak valid.');
  if (selectedOptions.length > 20) throw jasaFailure(400, 'too-many-options', 'Pilihan kebutuhan terlalu banyak.');
  const formData = jasaCleanFormData(service, body.formData);
  let parent = null;
  if (service.needsParentProfile === true) {
    if (body.parentConsent !== true) throw jasaFailure(400, 'parent-consent-required', 'Setujui ketentuan layanan sebelum melanjutkan.');
    const parentId = jasaValidateId(body.parentId, 'Profil penerima layanan');
    const parentEntry = (profileSnapshot.data()?.parents || []).find((item) => item.id === parentId);
    if (!parentEntry) throw jasaFailure(400, 'parent-profile-required', 'Pilih profil penerima layanan yang tersimpan sebelum memesan.');
    const parentLatitude = parentEntry.latitude === null || parentEntry.latitude === undefined || parentEntry.latitude === '' ? null : Number(parentEntry.latitude);
    const parentLongitude = parentEntry.longitude === null || parentEntry.longitude === undefined || parentEntry.longitude === '' ? null : Number(parentEntry.longitude);
    parent = {
      id: jasaValidateId(parentEntry.id, 'ID data penerima'),
      name: cleanText(parentEntry.name, 120),
      isSelf: parentEntry.isSelf === true,
      address: cleanText(parentEntry.address, 500),
      province: cleanText(parentEntry.province, 100),
      city: cleanText(parentEntry.city, 120),
      district: cleanText(parentEntry.district, 100),
      village: cleanText(parentEntry.village, 100),
      postalCode: cleanText(parentEntry.postalCode, 20),
      latitude: Number.isFinite(parentLatitude) ? parentLatitude : null,
      longitude: Number.isFinite(parentLongitude) ? parentLongitude : null,
      mapsUrl: cleanText(parentEntry.mapsUrl, 500),
      emergencyContactName: cleanText(parentEntry.emergencyContactName, 120),
      emergencyContactPhone: cleanText(parentEntry.emergencyContactPhone, 30),
      notes: cleanText(parentEntry.notes, 700)
    };
  } else if (body.parentConsent !== true) {
    throw jasaFailure(400, 'parent-consent-required', 'Konfirmasi persetujuan layanan dan penggunaan data sebelum melanjutkan.');
  }
  const scheduleMode = ['none', 'date', 'datetime', 'recurring'].includes(service.scheduleMode) ? service.scheduleMode : 'recurring';
  const schedule = jasaCleanSchedule(body.schedule, scheduleMode);
  const now = Date.now();
  const orderCode = jasaOrderCode();
  const order = {
    orderCode,
    userId: claims.uid,
    buyerName,
    buyerEmail,
    buyerPhone,
    serviceId,
    serviceName: cleanText(service.name, 120),
    serviceImage: jasaImageUrl(service.image),
    categoryId: cleanText(service.categoryId, 120),
    scheduleMode,
    scheduleLabel: cleanText(service.scheduleLabel, 80) || 'Preferensi jadwal',
    recipientLabel: cleanText(service.recipientLabel, 60) || 'Penerima layanan',
    consentText: cleanText(service.consentText, 300) || 'Saya memahami batas layanan dan menyetujui ketentuan pemesanan.',
    disclaimer: cleanText(service.disclaimer, 1500),
    pricingNote: cleanText(service.pricingNote, 300),
    formFieldLabels: Object.fromEntries((Array.isArray(service.formFields) ? service.formFields : []).map((field) => [cleanText(field.key, 60), cleanText(field.label, 120)])),
    ...(parent ? { parent } : {}),
    consentAt: now,
    package: {
      id: selectedPackage.id,
      name: cleanText(selectedPackage.name, 120),
      description: cleanText(selectedPackage.description, 500),
      duration: cleanText(selectedPackage.duration, 80),
      priceType: selectedPackage.priceType,
      price,
      dpPercent: Number.isSafeInteger(selectedPackage.dpPercent) ? selectedPackage.dpPercent : 30
    },
    selectedOptions,
    formData,
    schedule,
    totalAmount: selectedPackage.priceType === 'quote' ? 0 : price,
    paymentPlan,
    payments: [],
    paidAmount: 0,
    remainingAmount: selectedPackage.priceType === 'quote' ? 0 : price,
    paymentMethod: paymentPlan === 'cash' ? 'CASH' : 'DOKU',
    paymentStatus: 'UNPAID',
    status: selectedPackage.priceType === 'quote' ? 'awaiting_quote' : paymentPlan === 'cash' ? 'awaiting_confirmation' : 'awaiting_payment',
    statusHistory: [{ status: selectedPackage.priceType === 'quote' ? 'awaiting_quote' : paymentPlan === 'cash' ? 'awaiting_confirmation' : 'awaiting_payment', at: now, by: claims.uid }],
    visits: [],
    paymentUrl: '',
    createdAt: now,
    updatedAt: now,
    ...(selectedPackage.priceType === 'quote' ? {} : paymentPlan === 'cash'
      ? { confirmationExpiresAt: now + 24 * 60 * 60 * 1000 }
      : { paymentExpiresAt: now + PAYMENT_WINDOW_MS })
  };
  if (selectedPackage.priceType === 'monthly') {
    order.subscription = { status: 'active', startedAt: now, cycle: 1 };
    order.orderType = 'subscription_start';
  }
  if (selectedPackage.priceType !== 'quote' && paymentPlan !== 'cash') {
    const firstAmount = paymentPlan === 'dp' ? jasaDpAmount(price, order.package.dpPercent) : price;
    const paymentEntry = {
      id: orderCode,
      kind: paymentPlan,
      amount: firstAmount,
      method: 'DOKU',
      status: 'UNPAID',
      invoiceNumber: orderCode,
      paymentUrl: '',
      expiresAt: now + PAYMENT_WINDOW_MS,
      paidAt: 0
    };
    let config;
    try { config = getDokuConfig(req); } catch (error) { throw jasaFailure(503, error.code || 'doku-config-missing', error.message); }
    try {
      const payment = await createJasaDokuPayment(order, config, paymentEntry);
      order.paymentUrl = payment.paymentUrl;
      order.dokuRequestId = payment.requestId;
      paymentEntry.paymentUrl = payment.paymentUrl;
      order.payments = [paymentEntry];
    } catch (error) {
      console.error('[jasa] pembayaran gagal disiapkan:', { orderCode, code: error.code || 'unknown', message: error.message });
      throw jasaFailure(502, 'doku-checkout-failed', 'Pembayaran belum dapat disiapkan. Silakan coba beberapa saat lagi.');
    }
  }
  const orderRef = db.collection('jasa_orders').doc(orderCode);
  try {
    if (paymentPlan === 'cash' && selectedPackage.priceType !== 'quote') {
      await retryNetwork(() => db.runTransaction(async (transaction) => {
        const activeQuery = db.collection('jasa_orders').where('userId', '==', claims.uid);
        const activeOrders = await transaction.get(activeQuery);
        const activeCashCount = activeOrders.docs.filter((item) => {
          const current = item.data() || {};
          return current.paymentPlan === 'cash' && ['awaiting_confirmation', 'scheduled', 'in_progress'].includes(current.status);
        }).length;
        if (activeCashCount >= 2) throw jasaFailure(409, 'cash-order-limit', 'Maksimal dua pesanan jasa tunai aktif per akun. Selesaikan atau hubungi admin untuk pesanan yang sedang berjalan.');
        transaction.create(orderRef, order);
      }));
    } else {
      await retryNetwork(() => orderRef.create(order));
    }
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const existing = await retryNetwork(() => orderRef.get());
    const existingOrder = existing.data() || {};
    if (!existing.exists || existingOrder.userId !== claims.uid || existingOrder.createdAt !== now || existingOrder.serviceId !== serviceId) throw error;
  }
  await jasaNotifyAdmin(order);
  return res.status(200).json({ success: true, orderId: orderCode, orderCode, status: order.status, paymentUrl: order.paymentUrl || '' });
}

async function jasaMyOrders(req, res, claims) {
  const db = getAdminDb();
  const snapshot = await retryNetwork(() => db.collection('jasa_orders').where('userId', '==', claims.uid).get());
  const now = Date.now();
  for (const item of snapshot.docs) {
    const order = item.data() || {};
    const expiresAt = Number(order.confirmationExpiresAt || (Number(order.createdAt || 0) + 24 * 60 * 60 * 1000));
    if (order.status === 'awaiting_confirmation' && expiresAt <= now) {
      const ref = item.ref;
      await retryNetwork(() => db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists && current.data()?.status === 'awaiting_confirmation') {
          const currentOrder = current.data() || {};
          transaction.update(ref, {
            status: 'expired',
            paymentStatus: 'EXPIRED',
            statusHistory: [...(Array.isArray(currentOrder.statusHistory) ? currentOrder.statusHistory : []), { status: 'expired', at: now, by: 'system', note: 'Batas konfirmasi pembayaran tunai 24 jam telah lewat.' }],
            updatedAt: now
          });
        }
      }));
    }
  }
  const refreshed = await retryNetwork(() => db.collection('jasa_orders').where('userId', '==', claims.uid).get());
  const orders = refreshed.docs
    .map((item) => {
      const order = { id: item.id, ...item.data() };
      const payments = jasaPaymentEntries(order);
      const amounts = jasaAmounts(order, payments);
      return {
        ...order,
        paymentPlan: order.paymentPlan || 'full',
        payments,
        paidAmount: Number.isSafeInteger(order.paidAmount) ? order.paidAmount : amounts.paidAmount,
        remainingAmount: Number.isSafeInteger(order.remainingAmount) ? order.remainingAmount : amounts.remainingAmount
      };
    })
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 100);
  return res.status(200).json({ success: true, orders });
}

async function jasaCancelOrder(req, res, claims) {
  const orderId = jasaValidateId(req.body?.orderId, 'Kode pesanan');
  const ref = getAdminDb().collection('jasa_orders').doc(orderId);
  const result = await retryNetwork(() => getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) throw jasaFailure(404, 'not-found', 'Pesanan tidak ditemukan.');
    const order = snapshot.data() || {};
    if (!['awaiting_quote', 'awaiting_payment', 'awaiting_confirmation'].includes(order.status)) throw jasaFailure(409, 'invalid-order-state', 'Pesanan ini tidak dapat dibatalkan pada tahap sekarang.');
    const payments = jasaPaymentEntries(order);
    if (payments.some((payment) => payment.status === 'PAID')) throw jasaFailure(409, 'already-paid', 'Pesanan yang sudah menerima pembayaran hanya dapat dibatalkan oleh admin.');
    const now = Date.now();
    const cancelledPayments = payments.map((payment) => payment.status === 'UNPAID' ? { ...payment, status: 'CANCELLED' } : payment);
    transaction.update(ref, {
      status: 'cancelled',
      paymentStatus: 'CANCELLED',
      payments: cancelledPayments,
      statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'cancelled', at: now, by: claims.uid }],
      updatedAt: now
    });
    return { success: true, orderId };
  }));
  return res.status(200).json(result);
}

async function jasaPayAgain(req, res, claims) {
  const orderId = jasaValidateId(req.body?.orderId, 'Kode pesanan');
  const db = getAdminDb();
  const ref = db.collection('jasa_orders').doc(orderId);
  const snapshot = await retryNetwork(() => ref.get());
  if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) throw jasaFailure(404, 'not-found', 'Pesanan tidak ditemukan.');
  const order = snapshot.data() || {};
  const kind = req.body?.paymentKind === 'balance' ? 'balance' : '';
  const payments = jasaPaymentEntries(order);
  const entry = kind === 'balance'
    ? payments.find((payment) => payment.kind === 'balance' && payment.status === 'UNPAID')
    : payments.find((payment) => ['full', 'dp'].includes(payment.kind) && payment.status === 'UNPAID');
  if (kind === 'balance') {
    if (!entry || Number(entry.expiresAt || 0) <= Date.now()) throw jasaFailure(409, 'balance-invoice-unavailable', 'Tagihan pelunasan belum tersedia atau sudah kedaluwarsa. Hubungi admin untuk membuat tagihan baru.');
    if (/^https:\/\//i.test(String(entry.paymentUrl || ''))) return res.status(200).json({ success: true, orderId, paymentUrl: entry.paymentUrl });
    throw jasaFailure(409, 'balance-invoice-pending', 'Tagihan pelunasan sedang disiapkan. Muat ulang halaman beberapa saat lagi.');
  } else {
    if (order.status !== 'awaiting_payment' || !entry) throw jasaFailure(409, 'invalid-order-state', 'Pesanan ini tidak menunggu pembayaran.');
    if (Number(entry.expiresAt || order.paymentExpiresAt || 0) <= Date.now()) {
      const now = Date.now();
      await retryNetwork(() => db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists && current.data()?.status === 'awaiting_payment') {
          const currentOrder = current.data() || {};
          const currentPayments = jasaPaymentEntries(currentOrder).map((payment) =>
            payment.invoiceNumber === entry.invoiceNumber ? { ...payment, status: 'EXPIRED' } : payment);
          transaction.update(ref, {
            status: 'expired',
            paymentStatus: 'EXPIRED',
            payments: currentPayments,
            statusHistory: [...(currentOrder.statusHistory || []), { status: 'expired', at: now, by: 'system' }],
            updatedAt: now
          });
        }
      }));
      throw jasaFailure(409, 'payment-expired', 'Batas pembayaran 60 menit telah lewat.');
    }
    if (/^https:\/\//i.test(String(entry.paymentUrl || order.paymentUrl || ''))) {
      return res.status(200).json({ success: true, orderId, paymentUrl: entry.paymentUrl || order.paymentUrl });
    }
  }
  let config;
  try { config = getDokuConfig(req); } catch (error) { throw jasaFailure(503, error.code || 'doku-config-missing', error.message); }
  let payment;
  try { payment = await createJasaDokuPayment(order, config, entry); } catch (error) {
    console.error('[jasa] pembayaran ulang gagal disiapkan:', { orderId, code: error.code || 'unknown', message: error.message });
    throw jasaFailure(502, 'doku-payment-failed', 'Pembayaran belum dapat disiapkan. Silakan coba beberapa saat lagi.');
  }
  const now = Date.now();
  await retryNetwork(() => db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists || current.data()?.userId !== claims.uid) throw jasaFailure(404, 'not-found', 'Pesanan tidak ditemukan.');
    const currentOrder = current.data() || {};
    const currentPayments = jasaPaymentEntries(currentOrder);
    const index = currentPayments.findIndex((item) => item.invoiceNumber === entry.invoiceNumber);
    if (index < 0 || currentPayments[index].status !== 'UNPAID') throw jasaFailure(409, 'payment-changed', 'Tagihan berubah saat pembayaran disiapkan. Muat ulang pesanan.');
    currentPayments[index] = { ...currentPayments[index], paymentUrl: payment.paymentUrl, expiresAt: now + PAYMENT_WINDOW_MS };
    transaction.update(ref, {
      payments: currentPayments,
      ...(entry.kind !== 'balance' ? { paymentUrl: payment.paymentUrl, dokuRequestId: payment.requestId, paymentExpiresAt: now + PAYMENT_WINDOW_MS } : {}),
      updatedAt: now
    });
  }));
  return res.status(200).json({ success: true, orderId, paymentUrl: payment.paymentUrl });
}

async function jasaApplyPayment(orderId, invoiceNumber, amount, requestId, source) {
  const db = getAdminDb();
  const ref = db.collection('jasa_orders').doc(orderId);
  return retryNetwork(() => db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { found: false };
    const order = snapshot.data() || {};
    const now = Date.now();
    const payments = jasaPaymentEntries(order);
    const index = payments.findIndex((payment) => payment.invoiceNumber === invoiceNumber);
    if (index < 0) return { found: true, ignored: true, missingPayment: true };
    const paymentEntry = payments[index];
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) !== Number(paymentEntry.amount)) {
      transaction.set(ref, {
        needsAttention: true,
        attentionReason: 'Nominal pembayaran DOKU tidak cocok dengan tagihan pembayaran.',
        amountMismatch: { expected: Number(paymentEntry.amount), received: Number(amount), invoiceNumber, at: now, source },
        updatedAt: Date.now()
      }, { merge: true });
      return { found: true, amountMismatch: true };
    }
    if (paymentEntry.status === 'PAID') return { found: true, alreadyPaid: true };
    const inactivePayment = ['CANCELLED', 'EXPIRED'].includes(paymentEntry.status);
    if (paymentEntry.status !== 'UNPAID' && !inactivePayment) return { found: true, ignored: true };
    payments[index] = { ...paymentEntry, status: 'PAID', paidAt: now, requestId: cleanText(requestId, 120) };
    const amounts = jasaAmounts(order, payments);
    const paymentStatus = jasaPaymentStatus(order, payments, amounts.remainingAmount);
    if (['cancelled', 'expired'].includes(order.status)) {
      transaction.update(ref, {
        payments,
        ...amounts,
        paymentStatus,
        webhookRequestId: cleanText(requestId, 120),
        needsAttention: true,
        attentionReason: 'Pembayaran diterima setelah pesanan dibatalkan/kedaluwarsa; tinjau refund manual.',
        updatedAt: now
      });
      return { found: true, paid: true, needsAttention: true, order };
    }
    if (inactivePayment) {
      transaction.update(ref, {
        payments,
        ...amounts,
        paymentStatus,
        webhookRequestId: cleanText(requestId, 120),
        needsAttention: true,
        attentionReason: 'Pembayaran diterima untuk tagihan yang dibatalkan atau kedaluwarsa; periksa kemungkinan pembayaran ganda.',
        statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'late_payment_received', at: now, by: source }],
        updatedAt: now
      });
      return { found: true, paid: true, needsAttention: true, order };
    }
    if (paymentEntry.kind !== 'balance' && order.status !== 'awaiting_payment') return { found: true, ignored: true };
    if (paymentEntry.kind === 'balance' && !['paid', 'scheduled', 'in_progress', 'completed'].includes(order.status)) return { found: true, ignored: true };
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    transaction.update(ref, {
      ...(paymentEntry.kind === 'balance' ? {} : { status: 'paid' }),
      payments,
      ...amounts,
      paymentStatus,
      paidAt: amounts.remainingAmount === 0 ? now : order.paidAt || now,
      webhookRequestId: cleanText(requestId, 120),
      statusHistory: [...history, { status: paymentEntry.kind === 'balance' ? 'balance_paid' : 'paid', at: now, by: source }],
      updatedAt: now
    });
    return { found: true, paid: true, order, paymentEntry, paymentStatus };
  }));
}

async function jasaCheckPayment(req, res, claims) {
  const orderId = jasaValidateId(req.body?.orderId, 'Kode pesanan');
  const db = getAdminDb();
  const ref = db.collection('jasa_orders').doc(orderId);
  let snapshot = await retryNetwork(() => ref.get());
  if (!snapshot.exists || snapshot.data()?.userId !== claims.uid) throw jasaFailure(404, 'not-found', 'Pesanan tidak ditemukan.');
  let order = snapshot.data() || {};
  let dokuStatus = 'IGNORED';
  const payments = jasaPaymentEntries(order);
  const requestedInvoice = cleanText(req.body?.invoiceNumber, 80);
  const entry = requestedInvoice
    ? payments.find((payment) => payment.invoiceNumber === requestedInvoice && payment.status === 'UNPAID')
    : payments.find((payment) => payment.status === 'UNPAID');
  if (requestedInvoice && !entry) throw jasaFailure(400, 'invalid-payment-invoice', 'Tagihan pembayaran tidak ditemukan atau sudah tidak aktif.');
  if (entry?.method === 'DOKU' && entry.status === 'UNPAID') {
    const invoiceMatch = String(entry.invoiceNumber || '').match(/^(JS-\d{6}-[A-Z0-9]{6})(?:-B)?$/i);
    if (!invoiceMatch || invoiceMatch[1] !== orderId) throw jasaFailure(409, 'invalid-payment-invoice', 'Nomor tagihan pembayaran tidak cocok dengan pesanan.');
    if (Number(entry.expiresAt || order.paymentExpiresAt || 0) <= Date.now()) {
      const now = Date.now();
      await retryNetwork(() => db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists) {
          const currentOrder = current.data() || {};
          const currentPayments = jasaPaymentEntries(currentOrder).map((payment) =>
            payment.invoiceNumber === entry.invoiceNumber ? { ...payment, status: 'EXPIRED' } : payment);
          const initialPayment = entry.kind !== 'balance';
          transaction.update(ref, {
            ...(initialPayment && currentOrder.status === 'awaiting_payment' ? { status: 'expired' } : {}),
            payments: currentPayments,
            paymentStatus: initialPayment ? 'EXPIRED' : jasaPaymentStatus(currentOrder, currentPayments, jasaAmounts(currentOrder, currentPayments).remainingAmount),
            statusHistory: [...(Array.isArray(currentOrder.statusHistory) ? currentOrder.statusHistory : []), { status: initialPayment ? 'expired' : 'balance_expired', at: now, by: 'system' }],
            updatedAt: now
          });
        }
      }));
      dokuStatus = 'EXPIRED';
    } else {
      let config;
      try { config = getDokuConfig(req); } catch (error) { throw jasaFailure(503, error.code || 'doku-config-missing', error.message); }
      const path = `/orders/v1/status/${encodeURIComponent(entry.invoiceNumber)}`;
      const timestamp = new Date().toISOString().split('.')[0] + 'Z';
      const requestId = crypto.randomUUID();
      const response = await fetch(`${config.baseUrl}${path}`, { method: 'GET', headers: createDokuHeaders({ ...config, requestId, timestamp, path }) });
      const raw = await response.text();
      let payload = {};
      try { payload = JSON.parse(raw); } catch (error) { payload = {}; }
      if (!response.ok) throw jasaFailure(502, 'doku-status-failed', 'Status pembayaran belum dapat diperiksa. Coba lagi sebentar.');
      dokuStatus = String(payload.transaction?.status || payload.order?.status || payload.status || 'PENDING').toUpperCase();
      if (['SUCCESS', 'PAID'].includes(dokuStatus)) {
        const result = await jasaApplyPayment(orderId, entry.invoiceNumber, payload.order?.amount ?? payload.amount, payload.transaction?.request_id || requestId, 'doku-check');
        if (result.amountMismatch) throw jasaFailure(409, 'amount-mismatch', 'Nominal pembayaran tidak cocok. Admin akan memeriksa pesanan ini.');
        if (result.paid) await jasaSendPaymentConfirmation({ ...order, orderCode: orderId });
      } else if (dokuStatus === 'EXPIRED' || ['FAILED', 'CANCELLED', 'DENIED'].includes(dokuStatus)) {
        const now = Date.now();
        await retryNetwork(() => db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (current.exists) {
            const currentOrder = current.data() || {};
            const currentPayments = jasaPaymentEntries(currentOrder).map((payment) =>
              payment.invoiceNumber === entry.invoiceNumber ? { ...payment, status: dokuStatus } : payment);
            const initialPayment = entry.kind !== 'balance';
            const status = dokuStatus === 'EXPIRED' ? 'expired' : 'cancelled';
            transaction.update(ref, {
              ...(initialPayment && currentOrder.status === 'awaiting_payment' ? { status } : {}),
              payments: currentPayments,
              paymentStatus: initialPayment ? dokuStatus : jasaPaymentStatus(currentOrder, currentPayments, jasaAmounts(currentOrder, currentPayments).remainingAmount),
              statusHistory: [...(Array.isArray(currentOrder.statusHistory) ? currentOrder.statusHistory : []), { status: initialPayment ? status : `balance_${dokuStatus.toLowerCase()}`, at: now, by: 'doku-check' }],
              updatedAt: now
            });
          }
        }));
      }
    }
  }
  snapshot = await retryNetwork(() => ref.get());
  order = snapshot.data() || order;
  return res.status(200).json({ success: true, order: { id: orderId, ...order }, dokuStatus });
}

async function handleJasaBuyerAction(action, req, res, claims) {
  if (action === 'jasa-checkout') return jasaCheckout(req, res, claims);
  if (action === 'jasa-get-profile') return jasaGetProfile(req, res, claims);
  if (action === 'jasa-save-profile') return jasaSaveProfile(req, res, claims);
  if (action === 'jasa-my-orders') return jasaMyOrders(req, res, claims);
  if (action === 'jasa-cancel-order') return jasaCancelOrder(req, res, claims);
  if (action === 'jasa-pay-again') return jasaPayAgain(req, res, claims);
  if (action === 'jasa-check-payment') return jasaCheckPayment(req, res, claims);
  return responseError(res, 404, 'unknown-action', 'Aksi Gamon Jasa tidak dikenal.');
}

export { createJasaDokuPayment, getDokuConfig };

export default async function handler(req, res) {
 loadLocalEnvFallback();
 const action = String(req.query?.action || '').trim().toLowerCase();

   // Link dari email dibuka lewat GET.
  if (req.method === 'GET' && action === 'verify-email') {
    return verifyEmail(req, res);
  }
  if (req.method === 'GET' && action === 'reset-password') {
    return showResetPage(req, res);
  }

  if (action === 'jasa-image') {
    if (req.method !== 'GET') return responseError(res, 405, 'method-not-allowed', 'Method not allowed.');
    try {
      const id = jasaValidateId(req.query?.id, 'Layanan');
      const snapshot = await withFirestoreTimeout(
        () => getAdminDb().collection('jasa_service_images').doc(id).get(),
        'memuat gambar jasa'
      );
      if (!snapshot.exists) return responseError(res, 404, 'image-not-found', 'Gambar layanan tidak ditemukan.');
      const dataUrl = snapshot.data()?.data;
      const match = typeof dataUrl === 'string'
        ? dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
        : null;
      if (!match) return responseError(res, 404, 'image-not-found', 'Gambar layanan tidak ditemukan.');
      res.setHeader('Content-Type', `image/${match[1]}`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).end(Buffer.from(match[2], 'base64'));
    } catch (error) {
      console.error('[jasa] gambar layanan gagal dimuat:', { code: error.code || 'unknown', message: error.message });
      return responseError(res, error.statusCode || 500, error.code || 'jasa-image-failed', error.message || 'Gambar layanan gagal dimuat.');
    }
  }

  if (action === 'jasa-public-catalog' && (req.method === 'GET' || req.method === 'POST')) {
    try {
      return await withFirestoreTimeout(() => jasaPublicCatalog(req, res), 'memuat katalog jasa');
    } catch (error) {
      console.error('[jasa] katalog publik gagal:', { code: error.code || 'unknown', message: error.message });
      if (isRetryableNetworkError(error) || error?.code === 'firestore-timeout') {
        return responseError(res, 503, 'network-error', 'Koneksi ke database terputus. Coba lagi.');
      }
      return responseError(res, 500, 'jasa-catalog-failed', 'Katalog jasa gagal dimuat.');
    }
  }

  if (action.startsWith('jasa-')) {
    if (req.method !== 'POST') return responseError(res, 405, 'method-not-allowed', 'Method not allowed.');
    const jasaClaims = await requireBuyer(req, res);
    if (!jasaClaims) return;
    try {
      return await handleJasaBuyerAction(action, req, res, jasaClaims);
    } catch (error) {
      console.error('[jasa] aksi pembeli gagal:', { action, uid: jasaClaims.uid, code: error.code || 'unknown', message: error.message });
      if (isRetryableNetworkError(error) || error?.code === 'firestore-timeout') {
        return responseError(res, 503, 'network-error', 'Koneksi ke database terputus. Coba lagi.');
      }
      return responseError(res, error.statusCode || 500, error.code || 'jasa-request-failed', error.message || 'Permintaan jasa gagal diproses.');
    }
  }

  // Endpoint publik katalog menerima GET agar dapat di-cache CDN.
  if (action === 'public-products' && (req.method === 'GET' || req.method === 'POST')) {
    try {
      return await withFirestoreTimeout(
        () => publicProducts(req, res),
        'memuat katalog produk'
      );
    } catch (error) {
      console.error('[marketplace] public-products gagal:', { code: error.code || 'unknown', message: error.message });
      return responseError(
        res,
        500,
        error.code || 'products-failed',
        'Katalog gagal dimuat.',
        process.env.NODE_ENV !== 'production'
          ? { message: error.message, code: error.code || 'unknown' }
          : undefined
      );
    }
  }

  if (req.method !== 'POST') return responseError(res, 405, 'method-not-allowed', 'Method not allowed.');

  // Aksi publik (tanpa login): mencatat jumlah dilihat produk.
  if (action === 'view-product') {
    try {
      return await viewProduct(req, res);
    } catch (error) {
      console.error('[marketplace] gagal mencatat view produk:', { code: error.code || 'unknown', message: error.message });
      return responseError(res, 500, error.code || 'view-failed', 'Jumlah dilihat gagal dicatat.');
    }
  }

  // Aksi publik (tanpa login): testimoni beranda dengan foto profil terbaru.
  if (action === 'public-reviews') {
    try {
      return await withFirestoreTimeout(
        () => publicReviews(req, res),
        'memuat ulasan publik'
      );
    } catch (error) {
      console.error('[marketplace] public-reviews gagal:', { code: error.code || 'unknown', message: error.message });
      return responseError(
        res,
        500,
        error.code || 'reviews-failed',
        'Testimoni gagal dimuat.',
        process.env.NODE_ENV !== 'production'
          ? { message: error.message, code: error.code || 'unknown' }
          : undefined
      );
    }
  }

    if (action === 'check-email') {
    try {
      return await checkEmail(req, res);
    } catch (error) {
      console.error('[marketplace] check-email gagal:', error.message);
      return res.status(200).json({ success: true, valid: true, reason: 'check-failed' }); // fail-open
    }
  }

    if (action === 'send-password-reset') {
    try {
      return await sendPasswordReset(req, res);
    } catch (error) {
      console.error('[marketplace] send-password-reset gagal:', error.message);
      return responseError(res, 500, 'reset-failed', 'Email reset password gagal dikirim.');
    }
  }

  if (action === 'confirm-password-reset') {
    try {
      return await confirmPasswordReset(req, res);
    } catch (error) {
      console.error('[marketplace] confirm-password-reset gagal:', error.message);
      return responseError(res, 500, 'reset-failed', 'Password gagal diganti. Coba lagi.');
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
    if (action === 'cod-eligibility') return await codEligibility(req, res, claims);
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