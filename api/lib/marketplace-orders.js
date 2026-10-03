import { FieldValue } from 'firebase-admin/firestore';
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

    const items = Array.isArray(order.items) ? order.items : [];
    const productRefs = items.map((item) => db.collection('marketplace_products').doc(String(item.productId)));
    const productSnapshots = await Promise.all(productRefs.map((productRef) => transaction.get(productRef)));
    const now = Date.now();
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

    let missingProduct = false;
    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        missingProduct = true;
        return;
      }
      const item = items[index];
      const quantity = Math.max(0, asInt(item.qty));
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
      updatedAt: now,
      statusHistory: nextHistory,
      ...(missingProduct ? { needsAttention: true, attentionReason: 'Produk tidak ditemukan saat pelepasan reservasi stok.' } : {}),
      ...(reason ? { cancellationNote: reason } : {})
    });
    return { released: true, order: { ...order, status, paymentStatus, stockReleased: true } };
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
      reason: 'Reservasi pembayaran melewati batas 60 menit.'
    });
    if (result.released) released += 1;
  }
  return { scanned: snapshot.size, expired: expired.length, released };
}

export async function applyMarketplacePayment({ orderId, amount, requestId, paymentStatus = 'PAID' }) {
  const db = getAdminDb();
  const orderRef = db.collection('marketplace_orders').doc(String(orderId));
  return db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return { found: false };
    const order = orderSnapshot.data() || {};
    const now = Date.now();
    const receivedAmount = Number(amount);
    const savedAmount = Number(order.totalAmount);

    if (!Number.isSafeInteger(receivedAmount) || receivedAmount !== savedAmount) {
      transaction.update(orderRef, {
        needsAttention: true,
        attentionReason: `Jumlah notifikasi DOKU (${String(amount)}) tidak cocok dengan total pesanan (${String(order.totalAmount)}).`,
        lastDokuRequestId: String(requestId || ''),
        updatedAt: now
      });
      return { found: true, amountMismatch: true, order };
    }

    if (order.paymentStatus === 'PAID') return { found: true, duplicate: true, order };

    if (['cancelled', 'expired'].includes(String(order.status || '').toLowerCase()) || order.stockReleased) {
      transaction.update(orderRef, {
        paymentStatus: 'PAID',
        paidAt: now,
        dokuRequestId: String(requestId || ''),
        needsAttention: true,
        attentionReason: 'Pembayaran diterima setelah pesanan dibatalkan/kedaluwarsa atau stok dilepas; tinjau refund manual.',
        updatedAt: now
      });
      return { found: true, needsAttention: true, order };
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const productRefs = items.map((item) => db.collection('marketplace_products').doc(String(item.productId)));
    const productSnapshots = await Promise.all(productRefs.map((productRef) => transaction.get(productRef)));
    let missingProduct = false;
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        missingProduct = true;
        return;
      }
      const quantity = Math.max(0, asInt(items[index].qty));
      if (!quantity) return;
      const sold = Math.max(0, asInt(snapshot.data()?.sold));
      transaction.update(productRefs[index], { sold: sold + quantity, updatedAt: now });
    });

    transaction.update(orderRef, {
      status: 'paid',
      paymentStatus: 'PAID',
      paidAt: now,
      dokuRequestId: String(requestId || ''),
      updatedAt: now,
      statusHistory: [...history, { status: 'paid', at: now, by: 'doku' }],
      ...(missingProduct ? {
        needsAttention: true,
        attentionReason: 'Produk pesanan tidak ditemukan saat pembayaran terkonfirmasi.'
      } : {})
    });
    return { found: true, paid: true, needsAttention: missingProduct, order };
  });
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
