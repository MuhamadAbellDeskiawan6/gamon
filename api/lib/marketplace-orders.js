import { getAdminDb } from './firebase-admin.js';

function makeError(message, code = 'marketplace-order-error') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

// Firestore bisa menyimpan waktu sebagai angka, Timestamp, atau string.
function toMillis(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Apakah pesanan ini SAAT INI memegang stok (stok sudah terpotong dari produk)?
 * - Pesanan baru (stockMode 'on_payment'): stok terpotong setelah pembayaran sukses.
 * - Pesanan lama (tanpa stockMode): stok terpotong sejak checkout.
 */
function holdsStock(order) {
  if (order.stockMode === 'on_payment') {
    return order.stockDeducted === true && !order.stockReleased;
  }
  return !order.stockReleased;
}

/** Pesanan berstatus bayar, mode on_payment, tetapi stok belum dipotong. */
function needsStockDeduction(order) {
  return order.stockMode === 'on_payment'
    && order.stockDeducted !== true
    && !order.stockReleased;
}

/**
 * Kurangi isi keranjang sebanyak jumlah yang sudah dibayar.
 * Sisa (jika user menambah barang yang sama lagi) tetap ada.
 */
function subtractPaidItemsFromCart(cartItems, paidItems) {
  const paidQty = new Map();
  for (const item of paidItems) {
    const id = String(item.productId);
    paidQty.set(id, (paidQty.get(id) || 0) + Math.max(0, asInt(item.qty)));
  }
  return (Array.isArray(cartItems) ? cartItems : [])
    .map((cartItem) => {
      const id = String(cartItem.productId);
      const remaining = Math.max(0, asInt(cartItem.qty) - (paidQty.get(id) || 0));
      return { productId: id, qty: remaining };
    })
    .filter((cartItem) => cartItem.qty > 0);
}

/**
 * Menutup pesanan (batal / kedaluwarsa / gagal).
 * Stok produk hanya dikembalikan bila pesanan memang memegang stok.
 */
export async function releaseOrderStock(orderId, {
  status = 'expired',
  paymentStatus = 'EXPIRED',
  by = 'system',
  reason = '',
  allowPaid = false
} = {}) {
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(String(orderId));
  return db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw makeError('Pesanan tidak ditemukan.', 'not-found');
    const order = orderSnapshot.data() || {};

    if (order.stockReleased) return { released: false, alreadyReleased: true, order };
    if (order.paymentStatus === 'PAID' && !allowPaid) {
      return { released: false, needsAttention: true, order };
    }

    const restoreStock = holdsStock(order);
    const items = Array.isArray(order.items) ? order.items : [];
    const productRefs = restoreStock
      ? items.map((item) => db.collection('marketplace_products').doc(String(item.productId)))
      : [];
    const productSnapshots = await Promise.all(productRefs.map((productRef) => transaction.get(productRef)));
    const now = Date.now();
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

    let missingProduct = false;
    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        missingProduct = true;
        return;
      }
      const quantity = Math.max(0, asInt(items[index].qty));
      if (!quantity) return;
      const product = snapshot.data() || {};
      const stock = Math.max(0, asInt(product.stock, 1));
      const sold = Math.max(0, asInt(product.sold));
      transaction.update(productRefs[index], {
        stock: stock + quantity,
        ...(allowPaid ? { sold: Math.max(0, sold - quantity) } : {}),
        status: stock + quantity > 0 ? 'Tersedia' : 'Habis',
        updatedAt: now
      });
    });

    const nextHistory = [...history, { status, at: now, by, ...(reason ? { note: reason } : {}) }];
    transaction.update(orderRef, {
      status,
      paymentStatus,
      stockReleased: true,
      stockDeducted: false,
      updatedAt: now,
      statusHistory: nextHistory,
      ...(missingProduct ? { needsAttention: true, attentionReason: 'Produk tidak ditemukan saat pengembalian stok.' } : {}),
      ...(reason ? { cancellationNote: reason } : {})
    });
    return { released: true, stockRestored: restoreStock, order: { ...order, status, paymentStatus, stockReleased: true } };
  });
}

export async function releaseExpiredReservations() {
  const db = getAdminDb();
  const snapshot = await db.collection('marketplace_orders')
    .where('status', '==', 'awaiting_payment')
    .get();
  const now = Date.now();
  const expired = snapshot.docs.filter((document) => asInt(document.data()?.paymentExpiresAt) > 0 && asInt(document.data().paymentExpiresAt) <= now);
  let released = 0;
  for (const document of expired) {
    const result = await releaseOrderStock(document.id, {
      status: 'expired',
      paymentStatus: 'EXPIRED',
      by: 'system',
      reason: 'Batas waktu pembayaran 60 menit terlewati.'
    });
    if (result.released) released += 1;
  }
  return { scanned: snapshot.size, expired: expired.length, released };
}

/**
 * Dipanggil saat DOKU memastikan pembayaran SUKSES (webhook atau check-payment).
 * - Memotong stok (pesanan stockMode 'on_payment') dan menambah "terjual".
 * - Membersihkan keranjang.
 *
 * IDEMPOTEN BERDASARKAN FLAG `stockDeducted`, BUKAN `paymentStatus`.
 * Jadi walaupun pesanan sudah berstatus PAID (mis. ditandai oleh webhook versi lama
 * yang tidak memotong stok), pemanggilan ini tetap memotong stok sekali saja.
 */
export async function applyMarketplacePayment({ orderId, amount, requestId, paymentStatus = 'PAID' }) {
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(String(orderId));
  return db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return { found: false };
    const order = orderSnapshot.data() || {};
    const now = Date.now();
    const savedAmount = Number(order.totalAmount);
    const alreadyPaid = order.paymentStatus === 'PAID';

    // Nominal hanya dicek bila DOKU mengirimnya (webhook selalu kirim, status-check kadang tidak).
    const amountProvided = amount !== undefined && amount !== null && amount !== '';
    if (amountProvided && !alreadyPaid) {
      const receivedAmount = Number(amount);
      if (!Number.isSafeInteger(receivedAmount) || receivedAmount !== savedAmount) {
        transaction.update(orderRef, {
          needsAttention: true,
          attentionReason: `Jumlah notifikasi DOKU (${String(amount)}) tidak cocok dengan total pesanan (${String(order.totalAmount)}).`,
          lastDokuRequestId: String(requestId || ''),
          updatedAt: now
        });
        return { found: true, amountMismatch: true, order };
      }
    }

    const mustDeduct = needsStockDeduction(order);

    // Sudah dibayar DAN stok sudah beres: benar-benar duplikat.
    if (alreadyPaid && !mustDeduct) return { found: true, duplicate: true, order };

    // Dibayar setelah pesanan ditutup: jangan potong stok, minta admin periksa.
    if (!alreadyPaid && (['cancelled', 'expired', 'payment_failed'].includes(String(order.status || '').toLowerCase()) || order.stockReleased)) {
      transaction.update(orderRef, {
        paymentStatus: 'PAID',
        paidAt: now,
        dokuRequestId: String(requestId || ''),
        needsAttention: true,
        attentionReason: 'Pembayaran diterima setelah pesanan dibatalkan/kedaluwarsa; tinjau refund manual.',
        updatedAt: now
      });
      return { found: true, needsAttention: true, order };
    }

    const deductNow = order.stockMode === 'on_payment';
    const items = Array.isArray(order.items) ? order.items : [];
    const productRefs = items.map((item) => db.collection('marketplace_products').doc(String(item.productId)));
    const cartRef = order.userId ? db.collection('marketplace_carts').doc(String(order.userId)) : null;
    // Keranjang hanya disentuh bila belum pernah disinkronkan untuk pesanan ini.
    const touchCart = Boolean(cartRef) && order.cartSynced !== true;

    // SEMUA READ DULU
    const [productSnapshots, cartSnapshot] = await Promise.all([
      Promise.all(productRefs.map((productRef) => transaction.get(productRef))),
      touchCart ? transaction.get(cartRef) : Promise.resolve(null)
    ]);

    // LALU WRITE
    let missingProduct = false;
    let shortage = false;
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        missingProduct = true;
        return;
      }
      const quantity = Math.max(0, asInt(items[index].qty));
      if (!quantity) return;
      const product = snapshot.data() || {};
      const stock = Math.max(0, asInt(product.stock, 1));
      const sold = Math.max(0, asInt(product.sold));

      if (!deductNow) {
        // Pesanan lama: stok sudah terpotong saat checkout, tinggal tambah "terjual".
        transaction.update(productRefs[index], { sold: sold + quantity, updatedAt: now });
        return;
      }

      const take = Math.min(stock, quantity);
      if (take < quantity) shortage = true;
      const nextStock = stock - take;
      transaction.update(productRefs[index], {
        stock: nextStock,
        sold: sold + take,
        status: nextStock > 0 ? 'Tersedia' : 'Habis',
        updatedAt: now
      });
    });

    if (touchCart) {
      const cartItems = cartSnapshot && cartSnapshot.exists ? cartSnapshot.data()?.items : [];
      transaction.set(cartRef, { items: subtractPaidItemsFromCart(cartItems, items), updatedAt: now });
    }

    const attentionReasons = [];
    if (missingProduct) attentionReasons.push('Produk pesanan tidak ditemukan saat pembayaran terkonfirmasi.');
    if (shortage) attentionReasons.push('Stok tidak cukup saat pembayaran diterima (sudah dibeli orang lain). Hubungi pembeli atau refund.');

    // Jangan mundurkan status jika admin sudah memproses/mengirim pesanan.
    const currentStatus = String(order.status || '').toLowerCase();
    const becomePaid = currentStatus === 'awaiting_payment' || !currentStatus;

    transaction.update(orderRef, {
      paymentStatus: 'PAID',
      updatedAt: now,
      cartCleared: true,
      cartSynced: true,
      ...(alreadyPaid ? {} : { paidAt: now, dokuRequestId: String(requestId || '') }),
      ...(becomePaid ? {
        status: 'paid',
        statusHistory: [...history, { status: 'paid', at: now, by: 'doku' }]
      } : {}),
      ...(deductNow ? { stockDeducted: true } : {}),
      ...(attentionReasons.length ? { needsAttention: true, attentionReason: attentionReasons.join(' ') } : {})
    });
    return { found: true, paid: true, stockDeducted: deductNow, repaired: alreadyPaid, needsAttention: attentionReasons.length > 0, order };
  });
}

/**
 * PERBAIKAN OTOMATIS: cari pesanan yang sudah PAID tetapi stoknya belum dipotong
 * (mis. ditandai paid oleh webhook versi lama), lalu potong stoknya sekali.
 * Aman dipanggil berulang karena applyMarketplacePayment idempoten lewat `stockDeducted`.
 * userId opsional: isi untuk membatasi ke satu pembeli, kosongkan untuk semua pembeli.
 */
export async function reconcilePaidOrdersStock(userId = '') {
  const db = getAdminDb();
  let query = db.collection('marketplace_orders').where('paymentStatus', '==', 'PAID');
  const uid = String(userId || '');
  if (uid) query = query.where('userId', '==', uid);
  const snapshot = await query.get();

  const targets = snapshot.docs.filter((document) => {
    const order = document.data() || {};
    return needsStockDeduction(order)
      && ['paid', 'processing', 'shipped', 'completed'].includes(String(order.status || '').toLowerCase());
  });

  let fixed = 0;
  for (const target of targets) {
    try {
      const result = await applyMarketplacePayment({ orderId: target.id, requestId: 'reconcile' });
      if (result.paid) fixed += 1;
    } catch (error) {
      console.error('[marketplace] gagal memperbaiki stok pesanan:', target.id, error.message);
    }
  }
  return { checked: snapshot.size, fixed };
}

/**
 * Jaring pengaman: bersihkan keranjang untuk pesanan yang SUDAH DIBAYAR tetapi
 * keranjangnya belum dibersihkan (dibayar lewat webhook versi lama, webhook gagal, dll).
 * Memakai flag `cartSynced`. Tiap pesanan hanya diproses sekali.
 */
export async function syncPaidOrdersCart(userId) {
  const db = getAdminDb();
  const uid = String(userId || '');
  if (!uid) return { checked: 0, cleared: 0 };

  const snapshot = await db.collection('marketplace_orders')
    .where('userId', '==', uid)
    .where('paymentStatus', '==', 'PAID')
    .get();

  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const paidAtOf = (order) => toMillis(order.paidAt) || toMillis(order.updatedAt) || toMillis(order.createdAt);

  const targets = snapshot.docs
    .filter((document) => {
      const order = document.data() || {};
      if (order.cartSynced === true) return false;
      if (!['paid', 'processing', 'shipped', 'completed'].includes(String(order.status || '').toLowerCase())) return false;
      const paidAt = paidAtOf(order);
      return paidAt > 0 && now - paidAt < windowMs;
    })
    .sort((a, b) => paidAtOf(a.data()) - paidAtOf(b.data()));

  let cleared = 0;
  for (const target of targets) {
    try {
      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection('marketplace_orders').doc(target.id);
        const cartRef = db.collection('marketplace_carts').doc(uid);
        const [orderSnapshot, cartSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(cartRef)]);
        if (!orderSnapshot.exists) return;
        const order = orderSnapshot.data() || {};
        if (order.cartSynced === true) return;

        const items = Array.isArray(order.items) ? order.items : [];
        if (cartSnapshot.exists) {
          transaction.set(cartRef, {
            items: subtractPaidItemsFromCart(cartSnapshot.data()?.items, items),
            updatedAt: Date.now()
          });
        }
        transaction.update(orderRef, { cartCleared: true, cartSynced: true, updatedAt: Date.now() });
        cleared += 1;
      });
    } catch (error) {
      console.error('[marketplace] gagal membersihkan keranjang untuk pesanan:', target.id, error.message);
    }
  }
  return { checked: snapshot.size, cleared };
}

export async function updateMarketplaceOrderStatus({
  orderId,
  status,
  by,
  courier,
  trackingNumber,
  returnStock = false,
  note = ''
}) {
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(String(orderId));
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) throw makeError('Pesanan tidak ditemukan.', 'not-found');
  const order = orderSnapshot.data() || {};
  const current = String(order.status || '');
  const next = String(status || '');
  const transitions = {
    paid: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['completed', 'cancelled'],
    awaiting_payment: ['cancelled']
  };
  if (!transitions[current]?.includes(next)) throw makeError(`Transisi status ${current} ke ${next} tidak diizinkan.`, 'invalid-transition');

  if (next === 'cancelled' && order.paymentStatus !== 'PAID') {
    return releaseOrderStock(orderId, {
      status: 'cancelled',
      paymentStatus: 'UNPAID',
      by,
      reason: note || 'Dibatalkan oleh admin.'
    });
  }

  const now = Date.now();
  if (next === 'cancelled' && order.paymentStatus === 'PAID' && returnStock) {
    return releaseOrderStock(orderId, {
      status: 'cancelled',
      paymentStatus: 'PAID',
      by,
      reason: note || 'Stok dikembalikan oleh admin; refund pembayaran diproses manual di DOKU.',
      allowPaid: true
    });
  }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const update = {
    status: next,
    updatedAt: now,
    updatedBy: by,
    statusHistory: [...history, { status: next, at: now, by, ...(note ? { note } : {}) }]
  };
  if (next === 'shipped') {
    update.courier = String(courier || '').trim();
    update.trackingNumber = String(trackingNumber || '').trim();
  }
  if (next === 'cancelled' && order.paymentStatus === 'PAID') {
    update.needsAttention = true;
    update.attentionReason = 'Pesanan yang sudah dibayar dibatalkan; refund perlu diproses manual lewat dashboard DOKU.';
  }
  await orderRef.update(update);
  return { released: false, order: { ...order, ...update } };
}