import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  initializeFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* Project Firebase SAMA dengan Marketplace Mantan -> akun & sesi login ikut sama */
const app = initializeApp({
  apiKey: 'AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ',
  authDomain: 'gamon-tawing.firebaseapp.com',
  projectId: 'gamon-tawing',
  storageBucket: 'gamon-tawing.firebasestorage.app',
  messagingSenderId: '370162915989',
  appId: '1:370162915989:web:76779062da83aa0c5c999c',
  measurementId: 'G-DDRQKDZXV7'
});
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

const APP_KEY = 'splitbill';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const parseRp = (s) => Number(String(s ?? '').replace(/\D/g, '')) || 0;
const fmtDate = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/* Normalisasi nomor HP Indonesia ke format 62xxxxxxxxxx. Mengembalikan '' jika tidak valid. */
function normPhone(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^628\d{7,12}$/.test(d) ? d : '';
}

/* Foto: baca file lalu perkecil ke persegi (crop tengah) dan jadikan data URL JPEG */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Foto gagal dibaca.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function squareDataUrl(img, size, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}

/* Foto yang aman dikirim ke pasangan: https pendek atau data URL kecil */
function safePhoto(profile) {
  const p = String(profile?.photoThumbUrl || profile?.photoUrl || '');
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(p) && p.length <= 60000) return p;
  if (/^https:\/\//i.test(p) && p.length <= 500) return p;
  return '';
}

const avatarHtml = (name, photo, extra = '') =>
  `<div class="av ${extra}">${photo ? `<img src="${esc(photo)}" alt="${esc(name)}"/>` : esc((name || '?').charAt(0).toUpperCase())}</div>`;

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function setMsg(el, text, tone = '') {
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.className = 'msg' + (tone ? ' ' + tone : '');
}

function friendly(error) {
  const t = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  if (/invalid-credential|wrong-password|user-not-found/.test(t)) return 'Email atau password salah. Jika akunmu dibuat lewat Google, pakai tombol Google atau "Lupa password?".';
  if (t.includes('email-already-in-use')) return 'Email sudah terdaftar. Silakan masuk, atau pakai "Lupa password?".';
  if (t.includes('weak-password')) return 'Password terlalu lemah. Minimal 6 karakter.';
  if (t.includes('invalid-email')) return 'Format email tidak valid.';
  if (t.includes('too-many-requests')) return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
  if (t.includes('network')) return 'Koneksi gagal. Coba lagi sebentar lagi.';
  if (t.includes('popup-blocked')) return 'Popup diblokir browser. Izinkan popup lalu coba lagi.';
  if (t.includes('unauthorized-domain')) return 'Domain ini belum diizinkan di Firebase (Authentication > Settings > Authorized domains).';
  if (t.includes('permission-denied')) return 'Akses ditolak server. Pastikan emailmu sudah terverifikasi dan firestore.rules sudah dipublish.';
  return error?.message || 'Terjadi kesalahan.';
}

function waitUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); }, () => resolve(null));
  });
}

async function api(action, body, user) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const res = await fetch(`/api/marketplace?action=${encodeURIComponent(action)}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.message || 'Permintaan gagal.'), { code: data.code || `http-${res.status}` });
  return data;
}

/* Profil memakai dokumen yang sama dengan Marketplace: marketplace_users/{uid} */
async function ensureProfile(user) {
  const ref = doc(db, 'marketplace_users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const email = String(user.email || '').toLowerCase();
  const name = String(user.displayName || '').trim() || email.split('@')[0];
  const profile = {
    id: user.uid, name, email, phone: '',
    username: name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user',
    bio: 'Saya memakai Gamon Space.', city: 'Jakarta',
    photoUrl: /^https:\/\//i.test(user.photoURL || '') ? user.photoURL : ''
  };
  await setDoc(ref, profile);
  return profile;
}

async function googleLogin(button, msgEl) {
  button.disabled = true;
  window.__sbBusy = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await signInWithPopup(auth, provider);
    if (!user.emailVerified) {
      await signOut(auth);
      throw new Error('Akun Google ini tidak memiliki email yang terverifikasi.');
    }
    await ensureProfile(user);
    location.href = 'dashboard.html';
  } catch (error) {
    const code = String(error?.code || '');
    if (!/popup-closed-by-user|cancelled-popup-request/.test(code)) setMsg(msgEl, friendly(error), 'err');
    button.disabled = false;
  } finally {
    window.__sbBusy = false;
  }
}

/* ============================ HOME ============================ */
function initHome() {
  onAuthStateChanged(auth, (user) => {
    const loggedIn = Boolean(user && user.emailVerified);
    document.querySelectorAll('[data-cta]').forEach((el) => { el.textContent = loggedIn ? 'Buka dashboard' : (el.classList.contains('sun') ? 'Masuk' : 'Mulai sekarang'); });
    document.querySelectorAll('[data-guest]').forEach((el) => { el.hidden = loggedIn; });
  });
}

/* ============================ LOGIN ============================ */
function initLogin() {
  const form = $('#f'), msg = $('#msg'), submit = $('#submit');
  const q = new URLSearchParams(location.search);
  if (q.get('verified') === '1') setMsg(msg, 'Email berhasil diverifikasi. Silakan masuk.', 'ok');
  else if (q.get('verified')) setMsg(msg, 'Link verifikasi tidak valid atau kedaluwarsa. Klik "Kirim ulang email verifikasi".', 'err');
  if (q.get('reset') === '1') setMsg(msg, 'Password berhasil diganti. Silakan masuk dengan password baru.', 'ok');

  onAuthStateChanged(auth, (u) => { if (!window.__sbBusy && u && u.emailVerified) location.replace('dashboard.html'); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; submit.textContent = 'Masuk…';
    window.__sbBusy = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
      await cred.user.reload();
      if (!cred.user.emailVerified) {
        await signOut(auth);
        throw new Error('Email belum diverifikasi. Cek Kotak Masuk dan Spam, atau klik "Kirim ulang email verifikasi". Kamu juga bisa masuk dengan Google.');
      }
      await ensureProfile(cred.user);
      location.href = 'dashboard.html';
    } catch (error) {
      setMsg(msg, friendly(error), 'err');
      submit.disabled = false; submit.textContent = 'Masuk';
    } finally {
      window.__sbBusy = false;
    }
  });

  $('#google').addEventListener('click', (e) => googleLogin(e.currentTarget, msg));

  $('#forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    if (!email) { setMsg(msg, 'Isi email dulu untuk reset password.', 'err'); return; }
    try {
      await api('send-password-reset', { email, app: APP_KEY });
      setMsg(msg, `Jika ${email} terdaftar, link reset password sudah dikirim. Cek Kotak Masuk dan Spam. Link berlaku 1 jam.`, 'ok');
    } catch (error) { setMsg(msg, friendly(error), 'err'); }
  });

  $('#resend').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim(), password = $('#password').value;
    if (!email || !password) { setMsg(msg, 'Isi email dan password dulu, lalu klik kirim ulang.', 'err'); return; }
    window.__sbBusy = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await cred.user.reload();
      if (cred.user.emailVerified) { await signOut(auth); setMsg(msg, 'Email sudah terverifikasi. Silakan klik Masuk.', 'ok'); return; }
      await api('send-verification', { app: APP_KEY }, cred.user);
      await signOut(auth);
      setMsg(msg, `Link verifikasi dikirim ke ${email}. Cek Kotak Masuk dan Spam.`, 'ok');
    } catch (error) {
      setMsg(msg, friendly(error), 'err');
      await signOut(auth).catch(() => {});
    } finally { window.__sbBusy = false; }
  });
}

/* ============================ REGISTER ============================ */
function initRegister() {
  const form = $('#f'), msg = $('#msg'), submit = $('#submit');
  onAuthStateChanged(auth, (u) => { if (!window.__sbBusy && u && u.emailVerified) location.replace('dashboard.html'); });
  $('#google').addEventListener('click', (e) => googleLogin(e.currentTarget, msg));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; submit.textContent = 'Membuat akun…';
    window.__sbBusy = true;
    try {
      const email = $('#email').value.trim().toLowerCase();
      // cek domain email (gagal jaringan = tetap lanjut)
      try {
        const check = await fetch('/api/marketplace?action=check-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
        }).then((r) => r.json());
        if (check?.success === true && check.valid === false) throw Object.assign(new Error(check.message || 'Email tidak valid.'), { code: 'bad-email' });
      } catch (err) { if (err.code === 'bad-email') throw err; }

      const cred = await createUserWithEmailAndPassword(auth, email, $('#password').value);
      const first = $('#firstName').value.trim(), last = $('#lastName').value.trim();
      await setDoc(doc(db, 'marketplace_users', cred.user.uid), {
        id: cred.user.uid,
        name: `${first} ${last}`.trim() || 'Pengguna',
        email,
        phone: $('#phone').value.trim(),
        username: `${first}${last}`.toLowerCase().replace(/\s+/g, '') || 'user',
        bio: 'Saya memakai Gamon Space.',
        city: 'Jakarta'
      });

      let sent = true, why = '';
      try { await api('send-verification', { app: APP_KEY }, cred.user); }
      catch (error) { sent = false; why = error.message; }
      await signOut(auth);

      setMsg(msg, sent
        ? `Akun dibuat. Link verifikasi dikirim ke ${email}. Jika tidak ada di Kotak Masuk, cek Spam. Setelah itu silakan masuk.`
        : `Akun dibuat, tetapi email verifikasi gagal terkirim (${why}). Buka halaman Masuk lalu klik "Kirim ulang email verifikasi".`, sent ? 'ok' : 'err');
      submit.textContent = 'Akun dibuat';
      setTimeout(() => { location.href = 'login.html'; }, 6000);
    } catch (error) {
      setMsg(msg, friendly(error), 'err');
      submit.disabled = false; submit.textContent = 'Buat akun';
    } finally { window.__sbBusy = false; }
  });
}

/* ============================ DASHBOARD ============================ */
const CAT = { makan: '🍜', belanja: '🛍️', transport: '🛵', hiburan: '🎬', tagihan: '🧾', lain: '📦' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

async function initDashboard() {
  const user = await waitUser();
  if (!user || !user.emailVerified) { location.replace('login.html'); return; }
  const profile = await ensureProfile(user).catch(() => ({}));
  const uid = user.uid;
  const myName = String(profile.name || user.displayName || user.email.split('@')[0]).trim();
  const myPhone = normPhone(profile.phone);
  const myPhoto = safePhoto(profile);
  $('#who').textContent = '👤 ' + myName;
  $('#logout').onclick = async () => { await signOut(auth); location.href = 'index.html'; };

  /* ---------- POIN GAMON (satu saldo dengan Marketplace Mantan) ---------- */
  const pointsBar = $('#pointsBar');
  let points = null, pointsBusy = false, pointsFailed = false;

  function renderPoints() {
    if (!pointsBar) return;
    if (!points) {
      pointsBar.innerHTML = `<section class="card points">
        <div class="points-info"><span class="points-label">Poin Gamon</span>
        <small class="muted">${pointsFailed ? 'Poin belum bisa dimuat.' : 'Memuat poin…'}</small></div>
        ${pointsFailed ? '<button class="btn alt sm" type="button" data-pt="reload">Muat ulang</button>' : ''}
      </section>`;
      return;
    }
    const done = Boolean(points.checkedInToday);
    pointsBar.innerHTML = `<section class="card points">
      <div class="points-info">
        <span class="points-label">Poin Gamon</span>
        <strong class="points-value">${Number(points.balance || 0).toLocaleString('id-ID')}</strong>
        <small class="muted">Streak ${Number(points.streak || 0)} hari · Poin dipakai di Marketplace Mantan</small>
      </div>
      <button class="btn sun sm" type="button" data-pt="checkin" ${done || pointsBusy ? 'disabled' : ''}>
        ${pointsBusy ? 'Memproses…' : done ? 'Sudah check-in hari ini' : 'Check-in harian'}
      </button>
    </section>`;
  }

  async function loadPoints() {
    try {
      points = await api('points-info', {}, user);
      pointsFailed = false;
    } catch (error) {
      console.warn('[splitbill] poin gagal dimuat:', error);
      points = null;
      pointsFailed = true;
    }
    renderPoints();
  }

  async function doCheckin() {
    if (pointsBusy || !points || points.checkedInToday) return;
    pointsBusy = true; renderPoints();
    try {
      const r = await api('points-checkin', { source: 'splitbill' }, user);
      points = { ...points, balance: r.balance, streak: r.streak, checkedInToday: true };
      toast(`+${r.amount} poin`);
    } catch (error) {
      if (error.code === 'already-checked-in') {
        toast('Kamu sudah check-in hari ini.');
        pointsBusy = false;
        await loadPoints();
        return;
      }
      toast('Check-in gagal. Coba lagi.');
    } finally {
      pointsBusy = false;
      renderPoints();
    }
  }

  pointsBar?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pt]');
    if (!b) return;
    if (b.dataset.pt === 'checkin') doCheckin();
    else if (b.dataset.pt === 'reload') { pointsFailed = false; renderPoints(); loadPoints(); }
  });
  renderPoints();
  loadPoints();
  /* ---------- end poin ---------- */

  const root = $('#app'), gmsg = $('#gmsg');
  let couple = null, bills = [], settles = [], subFor = '', unsubBills = () => {}, unsubSet = () => {};
  let loaded = false;

  const partnerId = () => (couple?.members || []).find((m) => m !== uid) || '';
  const nameOf = (id) => id === uid ? 'Kamu' : (couple?.memberNames?.[id] || 'Pasangan');
  const partnerName = () => couple?.memberNames?.[partnerId()] || 'Pasangan';
  const partnerPhone = () => normPhone(couple?.memberPhones?.[partnerId()]);

  /* Salin nama & nomor profilku ke ruang pasangan (dot-path supaya tidak menimpa data pasangan) */
    let syncing = false;
  function syncMyContact() {
    if (!couple || couple.status !== 'active' || syncing) return;
    const sameName = couple.memberNames?.[uid] === myName;
    const samePhone = (couple.memberPhones?.[uid] || '') === myPhone;
    const samePhoto = (couple.memberPhotos?.[uid] || '') === myPhoto;
    if (sameName && samePhone && samePhoto) return;
    syncing = true;
    updateDoc(doc(db, 'splitbill_couples', couple.id), {
      [`memberNames.${uid}`]: myName,
      [`memberPhones.${uid}`]: myPhone,
      [`memberPhotos.${uid}`]: myPhoto,
      updatedAt: Date.now()
    }).catch((error) => console.warn('[splitbill] sinkron kontak gagal:', error))
      .finally(() => { syncing = false; });
  }

  /* ---- saldo: positif = pasangan berutang ke aku ---- */
  function balance() {
    const pid = partnerId();
    let me = 0;
    for (const b of bills) me += (b.paidBy === uid ? b.total : 0) - (b.shares?.[uid] || 0);
    for (const s of settles) {
      if (s.from === uid) me += s.amount;
      else if (s.from === pid) me -= s.amount;
    }
    return me;
  }

  /* ---- langganan data ---- */
  onSnapshot(query(collection(db, 'splitbill_couples'), where('members', 'array-contains', uid)), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    couple = list.find((c) => c.status === 'active') || list.find((c) => c.status === 'pending') || null;
    loaded = true;
    setMsg(gmsg, '');
    syncMyContact();
    const wantSub = couple?.status === 'active' ? couple.id : '';
    if (wantSub !== subFor) {
      unsubBills(); unsubSet();
      bills = []; settles = []; subFor = wantSub;
      if (wantSub) {
        unsubBills = onSnapshot(query(collection(db, 'splitbill_couples', wantSub, 'bills'), orderBy('date', 'desc')),
          (s) => { bills = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
          (e) => setMsg(gmsg, 'Tagihan gagal dimuat: ' + friendly(e), 'err'));
        unsubSet = onSnapshot(query(collection(db, 'splitbill_couples', wantSub, 'settlements'), orderBy('createdAt', 'desc')),
          (s) => { settles = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
          (e) => setMsg(gmsg, 'Pelunasan gagal dimuat: ' + friendly(e), 'err'));
      }
    }
    render();
  }, (error) => setMsg(gmsg, 'Gagal memuat ruang pasangan: ' + friendly(error), 'err'));

  /* ---- render ---- */
  function render() {
    if (!loaded) return;
    if (!couple) return renderConnect();
    if (couple.status === 'pending') return renderPending();
    renderMain();
  }

  function renderConnect() {
    root.innerHTML = `
      <section class="card"><h2>Hubungkan dengan pasanganmu</h2>
        <p style="margin:8px 0 18px">Hanya perlu sekali. Setelah terhubung, kalian berdua melihat catatan dan saldo yang sama.</p>
        <p class="msg err" id="cmsg" hidden></p>
        <div class="grid2">
          <div class="card"><h3>Aku yang mulai</h3><p style="margin-bottom:14px">Buat kode, lalu kirim ke pasanganmu.</p><button class="btn" data-act="create">Buat kode undangan</button></div>
          <div class="card"><h3>Pasangan sudah punya kode</h3><div class="field" style="margin-top:8px"><input id="joinCode" maxlength="6" placeholder="Contoh: ABC123" style="text-transform:uppercase;letter-spacing:.2em"/></div><button class="btn sun" data-act="join">Gabung</button></div>
        </div>
      </section>`;
  }

  function renderPending() {
    root.innerHTML = `
      <section class="card" style="text-align:center"><h2>Menunggu pasanganmu</h2>
        <p style="margin-top:8px">Kirim kode ini ke pasanganmu. Dia tinggal login lalu memasukkannya di halaman ini.</p>
        <div class="code">${esc(couple.id)}</div>
        <div class="actions">
          <button class="btn sun" data-act="copy">Salin kode</button>
          <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Yuk catat pengeluaran bareng di Split Bill Gamon Space! Buka ${location.origin}/user/splitbill/login.html lalu masukkan kode: ${couple.id}`)}">Kirim lewat WhatsApp</a>
          <button class="btn alt" data-act="cancel">Batalkan undangan</button>
        </div>
      </section>`;
  }

  function renderMain() {
    const bal = balance();
    const pn = partnerName();
    const tone = bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'zero';
    const headline = bal > 0 ? `${esc(pn)} berutang ke kamu` : bal < 0 ? `Kamu berutang ke ${esc(pn)}` : 'Kalian impas 🎉';
    const now = new Date();
    const monthTotal = bills.filter((b) => { const d = new Date(b.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
      .reduce((s, b) => s + b.total, 0);
    const myMonth = bills.filter((b) => { const d = new Date(b.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
      .reduce((s, b) => s + (b.shares?.[uid] || 0), 0);

    const pPhone = partnerPhone();
    const waBase = pPhone ? `https://wa.me/${pPhone}` : 'https://wa.me/';
    let remind = '';
    if (bal > 0) {
      const text = `Hai ${pn}, sisa split bill kita ${rp(bal)} ya (Gamon Split Bill)`;
      remind = `<a class="btn alt" target="_blank" rel="noopener" href="${waBase}?text=${encodeURIComponent(text)}">Ingatkan via WhatsApp</a>`;
    } else if (bal < 0) {
      const text = `Hai ${pn}, aku sudah transfer ${rp(-bal)} untuk split bill kita ya  (Gamon Split Bill)`;
      remind = `<a class="btn alt" target="_blank" rel="noopener" href="${waBase}?text=${encodeURIComponent(text)}">Kabari sudah bayar</a>`;
    }
    const phoneHint = !pPhone
      ? `<p class="muted" style="margin-top:10px;font-size:.85rem">Nomor ${esc(pn)} belum tersedia. Minta dia mengisi nomor HP di <a href="profile.html"><b>Profil</b></a> lalu membuka dashboard sekali.</p>` : '';
    const myPhoneHint = !myPhone
      ? `<p class="muted" style="margin-top:6px;font-size:.85rem">Nomor HP-mu belum diisi. <a href="profile.html"><b>Isi di Profil</b></a> agar pasangan bisa menghubungimu lewat WhatsApp.</p>` : '';

    const items = [
      ...bills.map((b) => ({ t: 'bill', at: b.date, b })),
      ...settles.map((s) => ({ t: 'set', at: s.createdAt, s }))
    ].sort((a, b) => b.at - a.at);

    const rows = items.map((it) => {
      if (it.t === 'bill') {
        const b = it.b;
        return `<div class="item"><div class="ico">${CAT[b.category] || '📦'}</div>
          <div><div class="t">${esc(b.title)}</div><div class="s">${esc(fmtDate(b.date))} · dibayar ${esc(nameOf(b.paidBy))}${b.note ? ' · ' + esc(b.note) : ''}</div></div>
          <div class="r">${rp(b.total)}<small>porsimu ${rp(b.shares?.[uid] || 0)}</small><button class="del" data-act="del-bill" data-id="${esc(b.id)}">hapus</button></div></div>`;
      }
      const s = it.s;
      return `<div class="item settle"><div class="ico">💸</div>
        <div><div class="t">${esc(nameOf(s.from))} melunasi ${esc(nameOf(s.to))}</div><div class="s">${esc(fmtDate(s.createdAt))}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
        <div class="r">${rp(s.amount)}<small>pelunasan</small><button class="del" data-act="del-set" data-id="${esc(s.id)}">hapus</button></div></div>`;
    }).join('') || '<p class="muted" style="margin-top:12px">Belum ada catatan. Tekan "Tambah tagihan" untuk mulai.</p>';

    root.innerHTML = `
      <section class="card balance ${tone}">
        <div class="avs">${avatarHtml(myName, myPhoto)}<span class="heart">💕</span>${avatarHtml(pn, couple.memberPhotos?.[partnerId()] || '')}</div>
        <p class="muted" style="color:var(--ink)">Kamu &amp; ${esc(pn)}</p>
        <div class="amount">${bal === 0 ? 'Rp 0' : rp(Math.abs(bal))}</div>
        <p style="color:var(--ink);font-weight:600">${headline}</p>
        <div class="actions">
          <button class="btn" data-act="add">+ Tambah tagihan</button>
          <button class="btn sun" data-act="settle" ${bal === 0 ? 'disabled' : ''}>Catat pelunasan</button>
          ${remind}
        </div>
        ${phoneHint}${myPhoneHint}
      </section>
      <section class="card"><div class="stat"><div><p class="muted">Pengeluaran bersama bulan ini</p><h3>${rp(monthTotal)}</h3></div><div><p class="muted">Porsimu bulan ini</p><h3>${rp(myMonth)}</h3></div></div></section>
      <section class="card"><h2>Riwayat</h2><div class="list">${rows}</div></section>`;
  }

  /* ---- aksi di halaman ---- */
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const cmsg = $('#cmsg');
    try {
      if (act === 'create') {
        btn.disabled = true;
        for (let i = 0; i < 6; i += 1) {
          const code = genCode(), now = Date.now();
          try {
            await setDoc(doc(db, 'splitbill_couples', code), {
              code, members: [uid], memberNames: { [uid]: myName },
              status: 'pending', createdBy: uid, createdAt: now, updatedAt: now
            });
            return;
          } catch (error) {
            if (i === 5) throw error;
          }
        }
      } else if (act === 'join') {
        const code = String($('#joinCode').value || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) { setMsg(cmsg, 'Kode terdiri dari 6 huruf/angka.', 'err'); return; }
        btn.disabled = true;
        const snap = await getDoc(doc(db, 'splitbill_couples', code)).catch(() => null);
        if (!snap || !snap.exists()) { setMsg(cmsg, 'Kode tidak ditemukan atau sudah dipakai.', 'err'); btn.disabled = false; return; }
        const data = snap.data();
        if (data.members.includes(uid)) { setMsg(cmsg, 'Ini kode undanganmu sendiri. Kirim ke pasanganmu.', 'err'); btn.disabled = false; return; }
        if (data.status !== 'pending' || data.members.length !== 1) { setMsg(cmsg, 'Kode ini sudah dipakai.', 'err'); btn.disabled = false; return; }
        await updateDoc(doc(db, 'splitbill_couples', code), {
          members: [...data.members, uid],
          memberNames: { ...data.memberNames, [uid]: myName },
          memberPhones: { [uid]: myPhone },
          status: 'active', joinedAt: Date.now(), updatedAt: Date.now()
        });
        toast('Terhubung dengan pasanganmu 💕');
      } else if (act === 'copy') {
        await navigator.clipboard.writeText(couple.id).catch(() => {});
        toast('Kode disalin');
      } else if (act === 'cancel') {
        if (confirm('Batalkan undangan ini?')) await deleteDoc(doc(db, 'splitbill_couples', couple.id));
      } else if (act === 'add') {
        openBill();
      } else if (act === 'settle') {
        openSettle();
      } else if (act === 'del-bill') {
        if (confirm('Hapus tagihan ini? Saldo akan dihitung ulang.')) await deleteDoc(doc(db, 'splitbill_couples', couple.id, 'bills', btn.dataset.id));
      } else if (act === 'del-set') {
        if (confirm('Hapus catatan pelunasan ini?')) await deleteDoc(doc(db, 'splitbill_couples', couple.id, 'settlements', btn.dataset.id));
      }
    } catch (error) {
      console.error('[splitbill]', error);
      if (cmsg) setMsg(cmsg, friendly(error), 'err'); else toast(friendly(error));
      btn.disabled = false;
    }
  });

  /* ---- dialog ---- */
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.close).close()));
  const moneyInput = (el) => el.addEventListener('input', () => { const n = parseRp(el.value); el.value = n ? rp(n) : ''; });
  moneyInput($('#bTotal')); moneyInput($('#bCustom')); moneyInput($('#sAmount'));

  const billDlg = $('#billDlg'), billForm = $('#billForm');
  function updateSplitRows() {
    const type = billForm.querySelector('input[name="split"]:checked')?.value;
    $('#pctRow').hidden = type !== 'percent';
    $('#customRow').hidden = type !== 'custom';
  }
  function openBill() {
    const pn = partnerName();
    $('#bPaidBy').innerHTML = `<option value="me">Aku (${esc(myName)})</option><option value="partner">${esc(pn)}</option>`;
    $('#splitRadios').innerHTML = `
      <label><input type="radio" name="split" value="equal" checked/> Dibagi rata 50:50</label>
      <label><input type="radio" name="split" value="percent"/> Persentase tertentu</label>
      <label><input type="radio" name="split" value="custom"/> Nominal sendiri</label>
      <label><input type="radio" name="split" value="mine"/> 100% punyaku (${esc(pn)} menalangi)</label>
      <label><input type="radio" name="split" value="theirs"/> 100% punya ${esc(pn)} (traktir/titip beli)</label>`;
    billForm.querySelectorAll('input[name="split"]').forEach((r) => r.addEventListener('change', updateSplitRows));
    billForm.reset();
    $('#bDate').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('#bPct').value = 50;
    setMsg($('#bMsg'), '');
    updateSplitRows();
    billDlg.showModal();
  }

  billForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bMsg = $('#bMsg'), btn = $('#bSubmit');
    const fail = (m) => setMsg(bMsg, m, 'err');
    const pid = partnerId();
    const title = $('#bTitle').value.trim();
    const total = parseRp($('#bTotal').value);
    if (!title) return fail('Isi keterangan tagihan.');
    if (total < 100 || total > 1000000000) return fail('Total harus antara Rp 100 dan Rp 1.000.000.000.');
    const paidBy = $('#bPaidBy').value === 'me' ? uid : pid;
    const type = billForm.querySelector('input[name="split"]:checked')?.value || 'equal';
    let myShare;
    if (type === 'equal') { const half = Math.floor(total / 2); myShare = half + (paidBy === uid ? total - half * 2 : 0); }
    else if (type === 'percent') {
      const pct = Number($('#bPct').value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail('Persentase harus 0 sampai 100.');
      myShare = Math.round(total * pct / 100);
    } else if (type === 'custom') {
      myShare = parseRp($('#bCustom').value);
      if (myShare > total) return fail('Porsimu tidak boleh melebihi total.');
    } else if (type === 'mine') myShare = total;
    else myShare = 0;

    const dateMs = new Date(`${$('#bDate').value}T12:00:00`).getTime();
    if (!Number.isFinite(dateMs)) return fail('Tanggal tidak valid.');

    btn.disabled = true; setMsg(bMsg, '');
    try {
      await addDoc(collection(db, 'splitbill_couples', couple.id, 'bills'), {
        title, total, paidBy,
        shares: { [uid]: myShare, [pid]: total - myShare },
        category: $('#bCat').value, note: $('#bNote').value.trim(),
        date: dateMs, createdBy: uid, createdAt: Date.now()
      });
      billDlg.close();
      toast('Tagihan tersimpan');
    } catch (error) { fail(friendly(error)); }
    finally { btn.disabled = false; }
  });

  const setDlg = $('#setDlg'), setForm = $('#setForm');
  function openSettle() {
    const bal = balance();
    if (bal === 0) return;
    const pn = partnerName();
    $('#setInfo').textContent = bal > 0
      ? `${pn} membayar utangnya ke kamu. Maksimal ${rp(bal)}.`
      : `Kamu membayar utang ke ${pn}. Maksimal ${rp(-bal)}.`;
    $('#sAmount').value = rp(Math.abs(bal));
    $('#sNote').value = '';
    setMsg($('#sMsg'), '');
    setDlg.showModal();
  }
  setForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sMsg = $('#sMsg'), btn = $('#sSubmit');
    const bal = balance(), amount = parseRp($('#sAmount').value);
    if (bal === 0) return setMsg(sMsg, 'Saldo sudah impas.', 'err');
    if (amount < 1 || amount > Math.abs(bal)) return setMsg(sMsg, `Jumlah harus antara Rp 1 dan ${rp(Math.abs(bal))}.`, 'err');
    const pid = partnerId();
    const from = bal < 0 ? uid : pid, to = bal < 0 ? pid : uid;
    btn.disabled = true;
    try {
      await addDoc(collection(db, 'splitbill_couples', couple.id, 'settlements'), {
        from, to, amount, note: $('#sNote').value.trim(), createdBy: uid, createdAt: Date.now()
      });
      setDlg.close();
      toast('Pelunasan dicatat');
    } catch (error) { setMsg(sMsg, friendly(error), 'err'); }
    finally { btn.disabled = false; }
  });
}

/* ============================ PROFIL ============================ */
async function initProfile() {
  const user = await waitUser();
  if (!user || !user.emailVerified) { location.replace('login.html'); return; }
  const profile = await ensureProfile(user).catch(() => ({}));
  const msg = $('#msg'), form = $('#f'), btn = $('#submit');
  const avatar = $('#pAvatar'), fileInput = $('#pPhoto'), removeBtn = $('#pPhotoRemove');

  let photoUrl = profile.photoUrl || '';
  let photoThumbUrl = profile.photoThumbUrl || '';
  let photoChanged = false;

  const showAvatar = () => {
    const src = photoThumbUrl || photoUrl;
    const name = $('#pName').value || profile.name || '?';
    avatar.innerHTML = src ? `<img src="${esc(src)}" alt="Foto profil"/>` : esc(name.charAt(0).toUpperCase());
    removeBtn.hidden = !src;
  };

  $('#pEmail').value = user.email || '';
  $('#pName').value = profile.name || user.displayName || '';
  $('#pPhone').value = profile.phone || '';
  $('#pName').addEventListener('input', () => { if (!photoUrl && !photoThumbUrl) showAvatar(); });
  showAvatar();
  $('#logout').onclick = async () => { await signOut(auth); location.href = 'index.html'; };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMsg(msg, 'Pilih foto JPG, PNG, atau WebP.', 'err'); fileInput.value = ''; return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMsg(msg, 'Ukuran foto maksimal 2 MB.', 'err'); fileInput.value = ''; return;
    }
    try {
      const img = await fileToImage(file);
      photoUrl = squareDataUrl(img, 400, 0.72);
      photoThumbUrl = squareDataUrl(img, 128, 0.75);
      photoChanged = true;
      setMsg(msg, '');
      showAvatar();
    } catch (error) {
      setMsg(msg, error.message, 'err');
    }
  });

  removeBtn.addEventListener('click', () => {
    photoUrl = ''; photoThumbUrl = ''; photoChanged = true;
    fileInput.value = '';
    showAvatar();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#pName').value.trim();
    const rawPhone = $('#pPhone').value.trim();
    const phone = normPhone(rawPhone);
    if (name.length < 2) return setMsg(msg, 'Nama minimal 2 huruf.', 'err');
    if (rawPhone && !phone) return setMsg(msg, 'Nomor HP tidak valid. Contoh: 08123456789.', 'err');

    btn.disabled = true; btn.textContent = 'Menyimpan…'; setMsg(msg, '');
    try {
      const data = {
        name,
        phone: rawPhone ? '0' + phone.slice(2) : '',
        updatedAt: Date.now()
      };
      if (photoChanged) { data.photoUrl = photoUrl; data.photoThumbUrl = photoThumbUrl; }
      await setDoc(doc(db, 'marketplace_users', user.uid), data, { merge: true });
      setMsg(msg, 'Profil tersimpan. Mengarahkan ke dashboard…', 'ok');
      setTimeout(() => { location.href = 'dashboard.html'; }, 900);
    } catch (error) {
      setMsg(msg, friendly(error), 'err');
      btn.disabled = false; btn.textContent = 'Simpan profil';
    }
  });
}

/* ============================ ROUTER ============================ */
const page = document.body.dataset.page;
if (page === 'sb-home') initHome();
else if (page === 'sb-login') initLogin();
else if (page === 'sb-register') initRegister();
else if (page === 'sb-dashboard') initDashboard();
else if (page === 'sb-profile') initProfile();