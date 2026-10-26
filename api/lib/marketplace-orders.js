import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { getAdminDb } from './firebase-admin.js';

const DEFAULT_ADMIN_EMAIL = 'muhamadabelldeskiawan@gmail.com';
const DEFAULT_SITE_URL = 'https://gamon-tawing.vercel.app';
const DEFAULT_MAIL_FROM = 'Marketplace Mantan <onboarding@resend.dev>';

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

/* =========================================================================
 * EMAIL NOTIFIKASI ADMIN (Resend, gratis)
 * ========================================================================= */

// Di production (Vercel) variabel dibaca dari environment. Saat development lokal,
// jika belum ada di process.env, dibaca dari file .env.* di folder proyek.
function readEnv(name) {
  const direct = String(process.env[name] || '').trim();
  if (direct) return direct;
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return '';
  for (const file of ['.env.local', '.env.development.local', '.env.development', '.env']) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match || match[1] !== name) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (value) {
          process.env[name] = value;
          return value;
        }
      }
    } catch (error) {
      // file tidak ada: lanjut ke file berikutnya
    }
  }
  return '';
}

function mailEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function rupiah(value) {
  return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

/**
 * Pengirim email tunggal untuk seluruh marketplace.
 * Urutan: Resend (jika MAIL_FROM memakai domain terverifikasi) -> Gmail SMTP -> Resend onboarding.
 * Melempar error dengan `code` jika semua gagal / belum dikonfigurasi.
 */
export async function sendEmail({ to, subject, html, text }) {
  const recipient = String(to || '').trim();
  if (!recipient) throw makeError('Alamat email tujuan kosong.', 'mail-no-recipient');

  const resendKey = readEnv('RESEND_API_KEY');
  const resendFrom = readEnv('MAIL_FROM');
  const gmailPass = readEnv('GMAIL_APP_PASSWORD');
  const domainReady = Boolean(resendKey && resendFrom && !/resend\.dev/i.test(resendFrom));

  const viaResend = async (from) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [recipient], subject, html, text }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw makeError(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`, 'mail-resend-failed');
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const viaGmail = async () => {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: DEFAULT_ADMIN_EMAIL, pass: gmailPass }
    });
    await transporter.sendMail({
      from: `"Marketplace Mantan" <${DEFAULT_ADMIN_EMAIL}>`,
      to: recipient,
      subject,
      html,
      text
    });
  };

  if (domainReady) {
    try {
      await viaResend(resendFrom);
      return { provider: 'resend' };
    } catch (error) {
      if (!gmailPass) throw error;
      console.warn('[marketplace] Resend gagal, mencoba Gmail:', error.message);
    }
  }
  if (gmailPass) {
    await viaGmail();
    return { provider: 'gmail' };
  }
  if (resendKey) {
    // Catatan: tanpa domain terverifikasi, Resend hanya mau mengirim ke email pemilik akun Resend.
    await viaResend(resendFrom || DEFAULT_MAIL_FROM);
    return { provider: 'resend-onboarding' };
  }
  throw makeError('Email belum dikonfigurasi di server (isi RESEND_API_KEY + MAIL_FROM, atau GMAIL_APP_PASSWORD).', 'mail-not-configured');
}

function buildAdminEmail(order, siteUrl) {
  const code = order.orderCode || order.orderId || '-';
  const items = Array.isArray(order.items) ? order.items : [];
  const shipping = order.shippingAddress || {};
  const addressLine = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(', ');
  const lat = Number(shipping.latitude);
  const lng = Number(shipping.longitude);
  const mapsUrl = shipping.mapsUrl || (Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : '');
  const adminUrl = `${siteUrl}/admin/marketplace-orders.html`;

  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${mailEscape(item.name || 'Produk')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${Math.max(1, asInt(item.qty, 1))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${rupiah(item.unitPrice)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${rupiah(item.subtotal)}</td>
    </tr>`).join('');

  const attention = order.needsAttention
    ? `<p style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:10px;border-radius:8px;"><strong>Perlu dicek:</strong> ${mailEscape(order.attentionReason || 'Pesanan ditandai perlu perhatian.')}</p>`
    : '';

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#222;">
    <h2 style="margin:0 0 4px;">Pesanan baru sudah dibayar</h2>
    <p style="margin:0 0 16px;color:#555;">Segera siapkan dan kirim barangnya.</p>
    ${attention}
    <p style="margin:0 0 4px;"><strong>Kode pesanan:</strong> ${mailEscape(code)}</p>
    <p style="margin:0 0 16px;"><strong>Total dibayar:</strong> ${rupiah(order.totalAmount)}</p>

    <h3 style="margin:16px 0 6px;">Barang</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#f7f7f7;">
        <th style="padding:8px;text-align:left;">Produk</th>
        <th style="padding:8px;">Qty</th>
        <th style="padding:8px;text-align:right;">Harga</th>
        <th style="padding:8px;text-align:right;">Subtotal</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="text-align:right;margin:8px 0 0;">Ongkir: ${rupiah(order.shippingFee)} &nbsp;|&nbsp; <strong>Total: ${rupiah(order.totalAmount)}</strong></p>

    <h3 style="margin:20px 0 6px;">Pembeli</h3>
    <p style="margin:0;">${mailEscape(order.buyerName || '-')}<br>
      ${mailEscape(order.buyerEmail || '-')}<br>
      ${mailEscape(order.buyerPhone || shipping.phone || '-')}</p>

    <h3 style="margin:20px 0 6px;">Alamat pengiriman</h3>
    <p style="margin:0;"><strong>${mailEscape(shipping.recipientName || '-')}</strong> (${mailEscape(shipping.phone || '-')})<br>
      ${mailEscape(addressLine || '-')}
      ${shipping.note ? `<br><em>Catatan: ${mailEscape(shipping.note)}</em>` : ''}</p>
    ${mapsUrl ? `<p style="margin:6px 0 0;"><a href="${mailEscape(mapsUrl)}">Lihat titik di Google Maps</a></p>` : ''}

    <p style="margin:24px 0 0;">
      <a href="${mailEscape(adminUrl)}" style="background:#ec4f86;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block;">Buka halaman pesanan admin</a>
    </p>
  </div>`;

  const text = [
    `Pesanan baru sudah dibayar: ${code}`,
    `Total: ${rupiah(order.totalAmount)}`,
    '',
    'Barang:',
    ...items.map((item) => `- ${item.name || 'Produk'} x${Math.max(1, asInt(item.qty, 1))} = ${rupiah(item.subtotal)}`),
    '',
    `Pembeli: ${order.buyerName || '-'} | ${order.buyerEmail || '-'} | ${order.buyerPhone || shipping.phone || '-'}`,
    `Alamat: ${shipping.recipientName || '-'} (${shipping.phone || '-'}), ${addressLine || '-'}`,
    mapsUrl ? `Maps: ${mapsUrl}` : '',
    `Admin: ${adminUrl}`
  ].filter((line) => line !== undefined).join('\n');

  return { subject: `Pesanan baru dibayar ${code} - ${rupiah(order.totalAmount)}`, html, text };
}

/**
 * Kirim email ke admin untuk pesanan yang sudah dibayar. Maksimal SATU email per pesanan
 * (flag `adminEmailSent`). Tidak pernah melempar error: kegagalan email tidak boleh
 * menggagalkan pembayaran/stok.
 */
async function notifyAdminNewOrder(orderId) {
  try {
    const apiKey = readEnv('RESEND_API_KEY');
    if (!apiKey) {
      console.warn('[marketplace] RESEND_API_KEY belum diatur; email notifikasi admin dilewati.');
      return { sent: false, reason: 'no-api-key' };
    }

    const db = getAdminDb();
    const orderRef = db.collection('marketplace_orders').doc(String(orderId));

    // "Klaim" dulu supaya webhook & check-payment yang bersamaan tidak mengirim dobel.
    const order = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) return null;
      const data = snapshot.data() || {};
      if (data.adminEmailSent === true) return null;
      if (data.paymentStatus !== 'PAID') return null;
      const claimedAt = asInt(data.adminEmailClaimAt);
      if (claimedAt && Date.now() - claimedAt < 60 * 1000) return null;
      transaction.update(orderRef, { adminEmailClaimAt: Date.now() });
      return { id: snapshot.id, ...data };
    });
    if (!order) return { sent: false, reason: 'already-sent-or-not-paid' };

    const adminEmail = readEnv('ADMIN_NOTIFY_EMAIL') || DEFAULT_ADMIN_EMAIL;
    const from = readEnv('MAIL_FROM') || DEFAULT_MAIL_FROM;
    let siteUrl = readEnv('SITE_URL').replace(/\/$/, '');
    if (!/^https:\/\//i.test(siteUrl)) siteUrl = DEFAULT_SITE_URL;

    const email = buildAdminEmail(order, siteUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [adminEmail], subject: email.subject, html: email.html, text: email.text }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`Resend ${response.status}: ${detail}`);
      }
      await orderRef.update({ adminEmailSent: true, adminEmailSentAt: Date.now(), adminEmailError: '' });
      console.log('[marketplace] email notifikasi admin terkirim:', orderId);
      return { sent: true };
    } catch (error) {
      console.error('[marketplace] gagal kirim email admin:', orderId, error.message);
      await orderRef.update({ adminEmailError: String(error.message || '').slice(0, 500), adminEmailClaimAt: 0 }).catch(() => {});
      return { sent: false, reason: 'send-failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('[marketplace] notifikasi admin error:', error.message);
    return { sent: false, reason: 'error' };
  }
}

/* ========================================================================= */

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

/** Pesanan mode on_payment yang stoknya belum dipotong. */
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
 * Transaksi inti pembayaran sukses. Idempoten berdasarkan flag `stockDeducted`
 * (bukan `paymentStatus`), sehingga pesanan yang sudah PAID tetapi stoknya belum
 * terpotong tetap diperbaiki sekali.
 */
async function applyPaymentTransaction({ orderId, amount, requestId }) {
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
 * Dipanggil saat DOKU memastikan pembayaran SUKSES (webhook, check-payment, sync-cart).
 * Memotong stok, membersihkan keranjang, lalu mengirim email notifikasi ke admin.
 */
export async function applyMarketplacePayment(args) {
  const result = await applyPaymentTransaction(args);

  // Email admin: dicoba setelah transaksi selesai, dan tidak pernah menggagalkan pembayaran.
  try {
    if (result.paid) {
      await notifyAdminNewOrder(args.orderId);
    } else if (result.duplicate) {
      // Coba ulang jika email sebelumnya gagal, tapi hanya untuk pembayaran 2 jam terakhir.
      const order = result.order || {};
      const paidAt = toMillis(order.paidAt);
      if (order.adminEmailSent !== true && paidAt > 0 && Date.now() - paidAt < 2 * 60 * 60 * 1000) {
        await notifyAdminNewOrder(args.orderId);
      }
    }
  } catch (error) {
    console.error('[marketplace] notifikasi admin dilewati:', error.message);
  }

  return result;
}

/**
 * PERBAIKAN OTOMATIS: cari pesanan PAID yang stoknya belum dipotong, lalu potong sekali.
 * userId opsional: isi untuk membatasi ke satu pembeli.
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
 * keranjangnya belum dibersihkan. Memakai flag `cartSynced`; tiap pesanan diproses sekali.
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