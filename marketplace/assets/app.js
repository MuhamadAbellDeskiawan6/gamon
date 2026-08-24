import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, orderBy, where, onSnapshot, updateDoc, deleteDoc, serverTimestamp, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ',
  authDomain: 'gamon-tawing.firebaseapp.com',
  projectId: 'gamon-tawing',
  storageBucket: 'gamon-tawing.appspot.com',
  messagingSenderId: '370162915989',
  appId: '1:370162915989:web:76779062da83aa0c5c999c',
  measurementId: 'G-DDRQKDZXV7'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const STORAGE_KEYS = {
  USERS: 'gamon_marketplace_users',
  PRODUCTS: 'gamon_marketplace_products',
  USER: 'gamon_marketplace_current_user',
  CHATS: 'gamon_marketplace_chats',
  LOGIN_ATTEMPTS: 'gamon_marketplace_login_attempts'
};

const productSeed = [];

const demoUsers = [];

const chatSeed = {};

const moneyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});

function formatRupiahInputValue(value) {
  if (value === null || value === undefined || value === '') return '';

  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';

  return `Rp ${Number(digits).toLocaleString('id-ID')}`;
}

function bindPriceFieldFormatting(form) {
  if (!form) return;

  const priceInput = form.querySelector('[name="price"]');
  if (!priceInput) return;

  const applyFormat = () => {
    const rawDigits = String(priceInput.value ?? '').replace(/\D/g, '');
    if (!rawDigits) {
      priceInput.value = '';
      return;
    }

    priceInput.value = `Rp ${Number(rawDigits).toLocaleString('id-ID')}`;
  };

  priceInput.addEventListener('input', applyFormat);
  priceInput.addEventListener('blur', applyFormat);
}

const BASE_DOCUMENT_TITLE = document.title;

const FILE_UPLOAD_TIMEOUT_MS = 120000;

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function setButtonLoading(button, isLoading, loadingText = 'Menyimpan...') {
  if (!button) return;

  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent || '';
    button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
    return;
  }

  button.disabled = false;
  const originalText = button.dataset.originalText || 'Publish iklan';
  button.textContent = originalText;
  delete button.dataset.originalText;
}

function showPopup(message, title = 'Info', tone = 'info') {
  let overlay = document.querySelector('[data-popup-overlay]');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.setAttribute('data-popup-overlay', '');
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 data-popup-title></h3>
        <p data-popup-message></p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" data-popup-close>Oke</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const titleEl = overlay.querySelector('[data-popup-title]');
  const messageEl = overlay.querySelector('[data-popup-message]');
  const card = overlay.querySelector('.modal-card');
  const closeBtn = overlay.querySelector('[data-popup-close]');

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  card.dataset.tone = tone;
  card.style.borderColor = tone === 'error' ? '#f6c0c0' : tone === 'success' ? '#c8f0d2' : '#dce7ff';
  card.style.boxShadow = tone === 'error' ? '0 18px 50px rgba(177, 54, 54, 0.14)' : tone === 'success' ? '0 18px 50px rgba(40, 133, 79, 0.14)' : '0 18px 50px rgba(0,0,0,0.16)';

  const close = () => {
    overlay.classList.remove('show');
  };

  closeBtn.onclick = close;
  overlay.onclick = (event) => {
    if (event.target === overlay) close();
  };

  overlay.classList.add('show');
  showToast(message, tone);
}

function showConfirm({
  message = 'Apakah Anda yakin?',
  title = 'Konfirmasi',
  confirmText = 'Ya, lanjutkan',
  cancelText = 'Batal',
  tone = 'warning',
  onConfirm,
  onCancel
} = {}) {
  const existing = document.querySelector('[data-confirm-overlay]');
  let overlay = existing;

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.setAttribute('data-confirm-overlay', '');
    overlay.innerHTML = `
      <div class="modal-card modal-card-confirm" role="dialog" aria-modal="true">
        <div class="modal-icon" data-confirm-icon>⚠️</div>
        <h3 data-confirm-title></h3>
        <p data-confirm-message></p>
        <div class="modal-actions modal-actions-split">
          <button class="btn btn-secondary" type="button" data-confirm-cancel></button>
          <button class="btn btn-danger" type="button" data-confirm-ok></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const titleEl = overlay.querySelector('[data-confirm-title]');
  const messageEl = overlay.querySelector('[data-confirm-message]');
  const cancelBtn = overlay.querySelector('[data-confirm-cancel]');
  const confirmBtn = overlay.querySelector('[data-confirm-ok]');
  const card = overlay.querySelector('.modal-card');
  const iconEl = overlay.querySelector('[data-confirm-icon]');

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  if (cancelBtn) cancelBtn.textContent = cancelText;
  if (confirmBtn) confirmBtn.textContent = confirmText;

  card.dataset.tone = tone;
  card.style.borderColor = tone === 'error' ? '#f6c0c0' : tone === 'warning' ? '#f5d7ae' : '#dce7ff';
  card.style.boxShadow = tone === 'error' ? '0 18px 50px rgba(177, 54, 54, 0.14)' : tone === 'warning' ? '0 18px 50px rgba(210, 129, 36, 0.14)' : '0 18px 50px rgba(0,0,0,0.16)';
  if (iconEl) {
    iconEl.textContent = tone === 'error' ? '🗑️' : tone === 'success' ? '✅' : '⚠️';
  }

  const close = () => {
    overlay.classList.remove('show');
  };

  cancelBtn.onclick = () => {
    close();
    onCancel?.();
  };

  confirmBtn.onclick = () => {
    close();
    onConfirm?.();
  };

  overlay.onclick = (event) => {
    if (event.target === overlay) {
      close();
      onCancel?.();
    }
  };

  overlay.classList.add('show');
}

function showToast(message, tone = 'info') {
  if (!document.body) return;

  let stack = document.querySelector('[data-toast-stack]');
  if (!stack) {
    stack = document.createElement('div');
    stack.setAttribute('data-toast-stack', '');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function bindKineticHero() {
  const shell = document.querySelector('[data-kinetic-grid]');
  if (!shell) return;
  if (shell.dataset.bound === 'true') return;
  shell.dataset.bound = 'true';

  const canvas = shell.querySelector('canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const mouse = { x: -9999, y: -9999 };
  const targetMouse = { x: -9999, y: -9999 };
  const ripples = [];

  const lerp = (a, b, t) => a + (b - a) * t;
  const cellSize = 55;
  const influenceRadius = 260;
  const maxWarp = 24;
  const dotSpacing = 28;
  const lerpSpeed = 0.08;
  const lineBase = { r: 255, g: 255, b: 255, a: 0.13 };
  const nodeBaseRadius = 1.8;
  const nodeActiveRadius = 3.2;

  const theme = {
    bg: '#171a1e',
    lineActive: { r: 255, g: 255, b: 255, a: 0.9 },
    nodeActive: { r: 255, g: 122, b: 162, a: 1 },
    glow: '255,122,162',
    ripple: '255,122,162'
  };

  const lerpColor = (base, active, t) => {
    const r = Math.round(lerp(base.r, active.r, t));
    const g = Math.round(lerp(base.g, active.g, t));
    const b = Math.round(lerp(base.b, active.b, t));
    const a = lerp(base.a, active.a, t);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  };

  const getWarpedPoint = (gx, gy, col, row, cols, rows) => {
    const edgeMargin = 1.5;
    const colPin = Math.min(col / edgeMargin, (cols - 1 - col) / edgeMargin, 1);
    const rowPin = Math.min(row / edgeMargin, (rows - 1 - row) / edgeMargin, 1);
    const pinFactor = colPin * colPin * rowPin * rowPin;

    const dx = gx - mouse.x;
    const dy = gy - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const proximity = Math.max(0, 1 - dist / influenceRadius) * pinFactor;

    let rx = 0;
    let ry = 0;

    for (const ripple of ripples) {
      const rdx = gx - ripple.x;
      const rdy = gy - ripple.y;
      const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
      const waveWidth = 55;
      const diff = rdist - ripple.radius;
      if (Math.abs(diff) < waveWidth) {
        const strength = (1 - Math.abs(diff) / waveWidth) * ripple.opacity * 18 * pinFactor;
        const angle = Math.atan2(rdy, rdx);
        const sign = diff < 0 ? -1 : 1;
        rx += Math.cos(angle) * strength * sign * -1;
        ry += Math.sin(angle) * strength * sign * -1;
      }
    }

    if (dist < influenceRadius && dist > 0 && pinFactor > 0) {
      const t = dist / influenceRadius;
      const eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
      const warpAmt = eased * maxWarp * pinFactor;
      const angle = Math.atan2(dy, dx);
      return {
        x: gx - Math.cos(angle) * warpAmt + rx,
        y: gy - Math.sin(angle) * warpAmt + ry,
        proximity
      };
    }

    return { x: gx + rx, y: gy + ry, proximity };
  };

  const draw = (now) => {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = dotSpacing / 2; x < W; x += dotSpacing) {
      for (let y = dotSpacing / 2; y < H; y += dotSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const age = (now - r.born) / 1000;
      r.radius = Math.max(0, age * 400);
      r.opacity = Math.max(0, 1 - age * 1.2);
      if (r.opacity <= 0) ripples.splice(i, 1);
    }

    const cols = Math.max(2, Math.ceil(W / cellSize)) + 1;
    const rows = Math.max(2, Math.ceil(H / cellSize)) + 1;
    const cellW = W / (cols - 1);
    const cellH = H / (rows - 1);

    const pts = [];
    const prox = [];

    for (let row = 0; row < rows; row++) {
      pts[row] = [];
      prox[row] = [];
      for (let col = 0; col < cols; col++) {
        const warped = getWarpedPoint(col * cellW, row * cellH, col, row, cols, rows);
        pts[row][col] = { x: warped.x, y: warped.y };
        prox[row][col] = warped.proximity;
      }
    }

    const drawSegment = (p1, p2, pr1, pr2) => {
      const avg = (pr1 + pr2) / 2;
      const t = avg * avg * (3 - 2 * avg);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = lerpColor(lineBase, theme.lineActive, t);
      ctx.lineWidth = lerp(0.8, 1.5, t);
      ctx.stroke();
    };

    ctx.lineCap = 'butt';

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols - 1; col++) {
        drawSegment(pts[row][col], pts[row][col + 1], prox[row][col], prox[row][col + 1]);
      }
    }

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows - 1; row++) {
        drawSegment(pts[row][col], pts[row + 1][col], prox[row][col], prox[row + 1][col]);
      }
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const p = pts[row][col];
        const pr = prox[row][col];
        const t = pr * pr * (3 - 2 * pr);
        const radius = lerp(nodeBaseRadius, nodeActiveRadius, t);

        if (t > 0.3) {
          const glowRadius = radius + lerp(0, 6, (t - 0.3) / 0.7);
          const glow = ctx.createRadialGradient(p.x, p.y, radius * 0.5, p.x, p.y, glowRadius);
          glow.addColorStop(0, `rgba(${theme.glow},${(t * 0.3).toFixed(3)})`);
          glow.addColorStop(1, `rgba(${theme.glow},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = lerpColor({ r: 255, g: 255, b: 255, a: 0.2 }, theme.nodeActive, t);
        ctx.fill();
      }
    }

    for (const ripple of ripples) {
      const safeRadius = Math.max(0, ripple.radius);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, safeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${theme.ripple},${(ripple.opacity * 0.28).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  const animate = (now) => {
    mouse.x = lerp(mouse.x, targetMouse.x, lerpSpeed);
    mouse.y = lerp(mouse.y, targetMouse.y, lerpSpeed);
    draw(now);
    requestAnimationFrame(animate);
  };

  const resize = () => {
    const rect = shell.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  resize();
  window.addEventListener('resize', resize);

  const onMouseMove = (event) => {
    const rect = shell.getBoundingClientRect();
    targetMouse.x = event.clientX - rect.left;
    targetMouse.y = event.clientY - rect.top;
  };

  const onClick = (event) => {
    const rect = shell.getBoundingClientRect();
    ripples.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      radius: 0,
      opacity: 1,
      born: performance.now()
    });
  };

  shell.addEventListener('mousemove', onMouseMove);
  shell.addEventListener('click', onClick);
  requestAnimationFrame(animate);

  shell._kineticCleanup = () => {
    window.removeEventListener('resize', resize);
    shell.removeEventListener('mousemove', onMouseMove);
    shell.removeEventListener('click', onClick);
  };
}

function bindKineticHeroIfNeeded() {
  if (document.body.dataset.page !== 'home') return;
  bindKineticHero();
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} terlalu lama atau gagal terhubung.`)), timeoutMs);
    })
  ]);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca foto yang dipilih.'));
    reader.readAsDataURL(file);
  });
}

async function prepareImageForUpload(file, { targetWidth = 1200, targetHeight = 900, quality = 0.78 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;

  const sourceUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memproses foto untuk upload.'));
    img.src = sourceUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) return file;

  context.fillStyle = '#fffafc';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(targetWidth / image.width, targetHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  const targetType = file.type === 'image/png' ? 'image/jpeg' : file.type;
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, targetType, quality);
  });

  if (!blob) return file;

  const extension = targetType === 'image/png' ? '.png' : targetType === 'image/webp' ? '.webp' : '.jpg';
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}${extension}`, {
    type: targetType,
    lastModified: Date.now()
  });
}

/* =========================================================================
 * PROFILE PHOTO HANDLING
 * -------------------------------------------------------------------------
 * We are on the Firestore free (Spark) plan and are NOT using Firebase
 * Storage. The profile photo is compressed client-side and stored directly
 * as a base64 data URL inside the user's Firestore document, under a single
 * canonical field: `photoUrl`.
 *
 * Firestore caps a single document at ~1 MiB, so we:
 *   1. Reject source files above 2 MB outright (matches the UI copy).
 *   2. Compress + resize, retrying with smaller dimensions/quality until
 *      the resulting data URL comfortably fits the document.
 *   3. Only ever write ONE field (`photoUrl`) — never duplicate the same
 *      base64 blob across `photo` / `profilePhotoUrl` / `avatarUrl`, which
 *      was silently multiplying storage usage 3-4x.
 * ========================================================================= */

const PROFILE_PHOTO_MAX_SOURCE_BYTES = 2 * 1024 * 1024; // 2 MB original upload, matches UI label
const PROFILE_PHOTO_MAX_STORED_BYTES = 700 * 1024; // keep comfortably under Firestore's ~1 MiB doc limit
const PROFILE_PHOTO_COMPRESSION_STEPS = [
  { targetWidth: 800, targetHeight: 800, quality: 0.72 },
  { targetWidth: 640, targetHeight: 640, quality: 0.6 },
  { targetWidth: 480, targetHeight: 480, quality: 0.5 },
  { targetWidth: 360, targetHeight: 360, quality: 0.42 }
];

function estimateDataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const base64Part = String(dataUrl).split(',')[1] || '';
  // Each base64 char encodes 6 bits, so bytes ≈ chars * 0.75 (ignoring padding).
  return Math.floor(base64Part.length * 0.75);
}

async function compressProfilePhotoToDataUrl(file) {
  let lastDataUrl = '';

  for (const step of PROFILE_PHOTO_COMPRESSION_STEPS) {
    const compressedFile = await prepareImageForUpload(file, step);
    const dataUrl = await fileToDataUrl(compressedFile);
    lastDataUrl = dataUrl;

    if (estimateDataUrlBytes(dataUrl) <= PROFILE_PHOTO_MAX_STORED_BYTES) {
      return dataUrl;
    }
  }

  return lastDataUrl;
}

async function uploadProfilePhoto(file) {
  if (!file) return '';

  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('File yang dipilih harus berupa gambar (JPG, PNG, atau WebP).');
  }

  if (file.size > PROFILE_PHOTO_MAX_SOURCE_BYTES) {
    throw new Error('Ukuran foto maksimal 2 MB. Silakan pilih foto yang lebih kecil.');
  }

  const dataUrl = await compressProfilePhotoToDataUrl(file);

  if (!dataUrl) {
    throw new Error('Foto profil tidak bisa diproses. Silakan coba foto lain.');
  }

  if (estimateDataUrlBytes(dataUrl) > PROFILE_PHOTO_MAX_STORED_BYTES) {
    throw new Error('Foto masih terlalu besar untuk database gratis (Firestore). Silakan pilih foto yang lebih sederhana atau resolusi lebih kecil.');
  }

  return dataUrl;
}

/* ======================= end profile photo handling ======================= */

function currentUser() {
  const user = readStorage(STORAGE_KEYS.USER, null);
  if (!user) return null;

  const expiresAt = Number(user.sessionExpiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    clearCurrentUser();
    if (!window.__marketplaceSessionExpiredShown) {
      window.__marketplaceSessionExpiredShown = true;
      showPopup('Sesi Anda telah berakhir. Silakan login kembali.', 'Sesi habis', 'error');
    }
    return null;
  }

  return user;
}

function clearCurrentUser() {
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem('gamon_marketplace_remember_me');
  window.__marketplaceSessionExpiredShown = false;
}

function setCurrentUser(user, rememberMe = true) {
  const safeUser = {
    ...user,
    sessionExpiresAt: rememberMe ? Date.now() + (1000 * 60 * 60 * 24 * 7) : Date.now() + (1000 * 60 * 60 * 2)
  };

  writeStorage(STORAGE_KEYS.USER, safeUser);
  if (rememberMe) {
    localStorage.setItem('gamon_marketplace_remember_me', '1');
  } else {
    localStorage.removeItem('gamon_marketplace_remember_me');
  }
}

async function syncCurrentUserFromFirebase(firebaseUser, rememberMe = true) {
  if (!firebaseUser) {
    clearCurrentUser();
    return;
  }

  const userDoc = await fetchUserDoc(firebaseUser.uid);
  const user = userDoc || {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || 'Pengguna',
    email: firebaseUser.email,
    phone: '',
    username: 'user',
    bio: '',
    city: 'Jakarta',
    role: 'both'
  };

  setCurrentUser(user, rememberMe);
  const users = readStorage(STORAGE_KEYS.USERS, []);
  const merged = [...users.filter((item) => (item.email || '').toLowerCase() !== (user.email || '').toLowerCase()), user];
  writeStorage(STORAGE_KEYS.USERS, merged);
}

function purgeKnownDummyData() {
  const knownDummyProductIds = new Set(['p1', 'p2', 'p3', 'p4']);
  const knownDummyUserEmails = new Set(['annisa@email.com']);

  Object.entries(STORAGE_KEYS).forEach(([_, key]) => {
    const current = readStorage(key, null);
    if (!Array.isArray(current)) return;

    const cleaned = current.filter((item) => {
      const id = String(item?.id || '');
      const email = String(item?.email || '').toLowerCase();
      const name = String(item?.name || '').toLowerCase();
      const seller = String(item?.seller || '').toLowerCase();
      return !knownDummyProductIds.has(id)
        && !knownDummyUserEmails.has(email)
        && !name.includes('hoodie putih premium')
        && !name.includes('jam tangan casio')
        && !name.includes('set kado anniversary')
        && !name.includes('jaket oversize')
        && !seller.includes('annisa')
        && !seller.includes('raka')
        && !seller.includes('dinda')
        && !seller.includes('sari');
    });

    if (cleaned.length !== current.length) {
      writeStorage(key, cleaned);
    }
  });
}

function ensureDemoData() {
  purgeKnownDummyData();

  if (!readStorage(STORAGE_KEYS.USERS, null)) writeStorage(STORAGE_KEYS.USERS, demoUsers);
  if (!readStorage(STORAGE_KEYS.PRODUCTS, null)) writeStorage(STORAGE_KEYS.PRODUCTS, productSeed);
  if (!readStorage(STORAGE_KEYS.CHATS, null)) writeStorage(STORAGE_KEYS.CHATS, chatSeed);
}

function setAuthMessage(message, tone = 'info') {
  const messageBox = document.querySelector('[data-auth-message]');
  if (!messageBox) return;

  messageBox.textContent = message || '';
  messageBox.style.display = message ? 'block' : 'none';
  messageBox.style.background = tone === 'error' ? '#fff2f2' : '#f0f5ff';
  messageBox.style.color = tone === 'error' ? '#a13232' : '#3654a8';
  messageBox.style.border = tone === 'error' ? '1px solid #f1b3b3' : '1px solid #c8d7ff';
}

function getLoginAttempts() {
  const stored = readStorage(STORAGE_KEYS.LOGIN_ATTEMPTS, { count: 0, lastAttemptAt: 0 });
  const now = Date.now();
  if (stored.lastAttemptAt && now - stored.lastAttemptAt > 15 * 60 * 1000) {
    return { count: 0, lastAttemptAt: 0 };
  }
  return stored;
}

function recordFailedLogin() {
  const now = Date.now();
  const attempts = getLoginAttempts();
  const next = { count: (attempts.count || 0) + 1, lastAttemptAt: now };
  writeStorage(STORAGE_KEYS.LOGIN_ATTEMPTS, next);
  return next;
}

function resetLoginAttempts() {
  writeStorage(STORAGE_KEYS.LOGIN_ATTEMPTS, { count: 0, lastAttemptAt: 0 });
}

function canAttemptLogin() {
  const attempts = getLoginAttempts();
  const now = Date.now();
  if ((attempts.count || 0) >= 5 && attempts.lastAttemptAt && now - attempts.lastAttemptAt < 5 * 60 * 1000) {
    return false;
  }
  if ((attempts.count || 0) >= 3 && attempts.lastAttemptAt && now - attempts.lastAttemptAt < 2 * 60 * 1000) {
    return false;
  }
  return true;
}

function formatCurrency(value) {
  return moneyFormatter.format(Number(value || 0));
}

function getCurrentPageIsUserArea() {
  return window.location.pathname.includes('/user/');
}

function getProductDetailUrl(productId) {
  const id = encodeURIComponent(productId ?? '');
  const isLoggedIn = Boolean(currentUser() || auth.currentUser);
  const targetPage = isLoggedIn ? (getCurrentPageIsUserArea() ? 'product.html' : 'user/product.html') : 'product.html';
  return `${targetPage}?id=${id}`;
}

function getUserChatUrl(sellerName, sellerId, productId = '', productName = '') {
  const basePage = getCurrentPageIsUserArea() ? 'chat.html' : 'user/chat.html';
  const safeSeller = sellerName || 'Penjual';
  const safeSellerId = sellerId || sellerName || '';
  const query = new URLSearchParams({
    user: safeSeller,
    userId: safeSellerId,
  });

  if (productId) {
    query.set('productId', String(productId));
  }

  if (productName) {
    query.set('productName', String(productName));
  }

  return `${basePage}?${query.toString()}`;
}

function getSafeUserName(name) {
  if (!name) return 'Pengguna';
  return name.trim() || 'Pengguna';
}

function getUserInitial(name) {
  const source = getSafeUserName(name || 'Pengguna');
  return source.charAt(0).toUpperCase();
}

function getUserPhotoUrl(user) {
  if (!user) return '';
  // `photoUrl` is the single canonical field going forward. The other keys
  // are only read for backward-compatibility with documents saved before
  // this fix (they get cleaned up automatically the next time that user
  // saves their profile — see bindEditForm/renderProfile submit handlers).
  return user.photoUrl || user.photo || user.profilePhotoUrl || user.avatarUrl || '';
}

function mergeUserIntoStorage(users, incomingUser) {
  if (!incomingUser || (!incomingUser.id && !incomingUser.uid)) return users;

  const normalizedList = Array.isArray(users) ? users : [];
  const userId = normalizeUserIdentifier(incomingUser.id || incomingUser.uid || incomingUser.email || '');
  const emailKey = normalizeUserIdentifier(incomingUser.email || '').toLowerCase();

  const nextUsers = normalizedList.filter((entry) => {
    const entryId = normalizeUserIdentifier(entry?.id || entry?.uid || '').toLowerCase();
    const entryEmail = normalizeUserIdentifier(entry?.email || '').toLowerCase();
    return !(userId && entryId === userId.toLowerCase()) && !(emailKey && entryEmail === emailKey);
  });

  nextUsers.push({ ...incomingUser, id: incomingUser.id || incomingUser.uid || userId || incomingUser.email || `user-${Date.now()}` });
  writeStorage(STORAGE_KEYS.USERS, nextUsers);
  return nextUsers;
}

async function resolveUserForMarketplaceLookup(userName, userId) {
  const identifier = normalizeUserIdentifier(userId || userName || '');
  const localUsers = readStorage(STORAGE_KEYS.USERS, []);

  if (identifier) {
    const byId = localUsers.find((entry) => {
      const candidates = [entry?.id, entry?.uid, entry?.email, entry?.name, entry?.username].map((value) => normalizeUserIdentifier(value || '').toLowerCase());
      return candidates.includes(identifier.toLowerCase());
    });
    if (byId) return byId;

    if (userId) {
      try {
        const fresh = await fetchUserDoc(userId);
        if (fresh) {
          mergeUserIntoStorage(localUsers, fresh);
          return fresh;
        }
      } catch (error) {
        console.warn('Gagal memuat data user terbaru dari Firestore untuk avatar:', error);
      }
    }
  }

  if (userName) {
    const byName = localUsers.find((entry) => {
      const localName = normalizeUserIdentifier(entry?.name || '').toLowerCase();
      const localEmail = normalizeUserIdentifier(entry?.email || '').toLowerCase();
      const target = normalizeUserIdentifier(userName || '').toLowerCase();
      return localName === target || localEmail === target;
    });
    if (byName) return byName;
  }

  return null;
}

function getUserAvatarMarkup(userName, userPhotoUrl = '', fallbackText = 'P') {
  const name = getSafeUserName(userName || fallbackText);
  const photo = userPhotoUrl || '';
  if (photo) {
    return `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" />`;
  }

  return escapeHtml(getUserInitial(name));
}

/* =========================================================================
 * AVATAR HYDRATION — CURRENT-USER ONLY
 * -------------------------------------------------------------------------
 * IMPORTANT: this function must only ever touch elements that represent the
 * CURRENTLY LOGGED-IN user's own avatar (the sidebar profile box and the
 * topbar/header avatar). It must NEVER touch generic `.avatar` elements or
 * `[data-detail-seller-initial]`, because those are used to show OTHER
 * people's avatars — sellers on product cards, the other participant in a
 * chat thread, the seller on a product-detail page. Those are populated
 * per-context via getUserAvatarMarkupByName()/resolveUserForMarketplaceLookup().
 *
 * Previously this selector also included `.avatar` and
 * `[data-detail-seller-initial]`, which meant that every time this ran
 * (on init, after auth resolves, after saving the profile) it would
 * overwrite EVERY avatar on the page — including other users' avatars in
 * product listings, the chat thread list, and product detail pages — with
 * the CURRENTLY LOGGED-IN user's own photo. That was the root cause of:
 *   - seller/other-user avatars not showing the correct photo
 *   - the chat "profile" avatar showing the logged-in user's own photo
 *     instead of the other participant's photo
 * ========================================================================= */
function hydrateUserAvatarElements(user) {
  const safeUser = user || currentUser();
  const photoUrl = getUserPhotoUrl(safeUser);
  const name = getSafeUserName((safeUser && safeUser.name) || 'Pengguna');

  document.querySelectorAll('.avatar-lg, [data-user-avatar]').forEach((element) => {
    if (!element) return;

    if (photoUrl) {
      element.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />`;
      element.classList.add('has-photo');
      return;
    }

    element.textContent = getUserInitial(name);
    element.classList.remove('has-photo');
  });
}

function hydrateUserProfileUI() {
  const user = currentUser();
  if (!user) return;

  const name = getSafeUserName(user.name);

  document.querySelectorAll('[data-user-name]').forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll('.profile-box strong').forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll('.avatar-lg, [data-user-avatar]').forEach((element) => {
    const photoUrl = getUserPhotoUrl(user);
    if (photoUrl) {
      element.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" />`;
      element.classList.add('has-photo');
      return;
    }

    element.textContent = getUserInitial(name);
    element.classList.remove('has-photo');
  });

  document.querySelectorAll('[data-greeting]').forEach((element) => {
    element.textContent = `Halo, ${name}`;
  });

  document.querySelectorAll('[data-profile-title]').forEach((element) => {
    element.textContent = name;
  });

  hydrateUserAvatarElements(user);
}

function getAuthTarget() {
  const currentPath = window.location.pathname;
  return currentPath.includes('/user/') ? '../login.html' : 'login.html';
}

function requireAuth() {
  const user = currentUser();
  if (!user) {
    clearCurrentUser();
    const target = getAuthTarget();
    if (window.location.pathname !== target && !window.location.pathname.endsWith(target)) {
      window.location.href = target;
    }
    return null;
  }
  return user;
}

async function fetchProductsFromFirebase() {
  try {
    const q = query(collection(db, 'marketplace_products'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    return readStorage(STORAGE_KEYS.PRODUCTS, []);
  }
}

async function fetchMyProductsFromFirebase(user) {
  const ownerId = user?.id || user?.uid || auth.currentUser?.uid;
  const localItems = readStorage(STORAGE_KEYS.PRODUCTS, []);

  if (!ownerId) {
    return localItems.filter((item) => item.seller === (user?.name || 'Seller'));
  }

  try {
    const q = query(collection(db, 'marketplace_products'), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    if (items.length > 0) return items;
  } catch (error) {
    console.warn('Gagal mengambil produk milik user dari Firestore:', error);
  }

  return localItems.filter((item) => (item.ownerId || '').toString() === ownerId.toString() || item.seller === (user?.name || 'Seller'));
}

async function repairMarketplaceSellerPhotos({ silent = true } = {}) {
  try {
    const firebaseProducts = await fetchProductsFromFirebase();
    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, []);
    const mergedProducts = [...firebaseProducts, ...localProducts];
    const seen = new Map();

    mergedProducts.forEach((product) => {
      if (!product || !product.id) return;
      const key = String(product.id);
      const current = seen.get(key) || {};
      seen.set(key, { ...current, ...product });
    });

    const updates = [];
    for (const product of seen.values()) {
      const hasSellerPhoto = Boolean(product.sellerPhotoUrl || product.sellerPhoto || product.avatarUrl || product.photoUrl || product.profilePhotoUrl);
      if (hasSellerPhoto || !product.id) continue;

      const sellerIdentifier = normalizeUserIdentifier(product.sellerId || product.ownerId || resolveUserIdByName(product.seller) || product.seller || '');
      const sellerUser = await resolveUserForMarketplaceLookup(product.seller, sellerIdentifier);
      const sellerPhotoUrl = getUserPhotoUrl(sellerUser || null);
      if (!sellerPhotoUrl) continue;

      const nextProduct = { ...product, sellerPhotoUrl };
      updates.push(nextProduct);

      try {
        await updateDoc(doc(db, 'marketplace_products', String(product.id)), { sellerPhotoUrl }, { merge: true });
      } catch (error) {
        console.warn('Gagal memperbarui sellerPhotoUrl produk lama:', error);
      }
    }

    if (!silent) {
      console.log(`Migrasi sellerPhotoUrl selesai: ${updates.length} produk diperbarui.`);
    }

    if (!updates.length) return 0;

    const normalizedLocal = readStorage(STORAGE_KEYS.PRODUCTS, []);
    const nextLocal = normalizedLocal.map((entry) => {
      const match = updates.find((item) => String(item.id) === String(entry.id));
      return match ? { ...entry, ...match, sellerPhotoUrl: match.sellerPhotoUrl || entry.sellerPhotoUrl || '' } : entry;
    });

    writeStorage(STORAGE_KEYS.PRODUCTS, nextLocal.length ? nextLocal : normalizedLocal);
    return updates.length;
  } catch (error) {
    console.warn('Gagal migrasi foto seller produk lama:', error);
    return 0;
  }
}

async function migrateExistingProductSellerPhotos() {
  return repairMarketplaceSellerPhotos({ silent: true });
}

async function syncSellerPhotosAcrossProducts(user) {
  if (!user) return 0;

  const userId = normalizeUserIdentifier(user.id || user.uid || user.email || '');
  const photoUrl = getUserPhotoUrl(user) || '';
  if (!userId || !photoUrl) return 0;

  const ownerMatches = (item) => {
    const ownerValue = normalizeUserIdentifier(item?.ownerId || item?.sellerId || '').toLowerCase();
    const sellerValue = normalizeUserIdentifier(item?.seller || '').toLowerCase();
    const userName = normalizeUserIdentifier(user.name || '').toLowerCase();
    return ownerValue === userId.toLowerCase() || sellerValue === userName;
  };

  let updatedCount = 0;

  try {
    const q = query(collection(db, 'marketplace_products'), where('ownerId', '==', userId));
    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
      const productData = docSnap.data() || {};
      const nextSellerPhotoUrl = photoUrl || productData.sellerPhotoUrl || '';
      const nextSellerName = user.name || productData.seller || 'Seller';
      const payload = {
        sellerPhotoUrl: nextSellerPhotoUrl,
        seller: nextSellerName,
        sellerInitial: (nextSellerName || 'S').charAt(0).toUpperCase()
      };

      if ((productData.sellerPhotoUrl || '') === nextSellerPhotoUrl && (productData.seller || '') === nextSellerName) continue;

      await updateDoc(doc(db, 'marketplace_products', docSnap.id), payload, { merge: true });
      updatedCount += 1;
    }
  } catch (error) {
    console.warn('Gagal memperbarui foto seller produk milik user dari Firestore:', error);
  }

  const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, []);
  const nextLocalProducts = localProducts.map((item) => {
    if (!ownerMatches(item)) return item;
    const nextSellerName = user.name || item.seller || 'Seller';
    const nextItem = {
      ...item,
      sellerPhotoUrl: photoUrl,
      seller: nextSellerName,
      sellerInitial: (nextSellerName || 'S').charAt(0).toUpperCase()
    };

    if ((item.sellerPhotoUrl || '') === photoUrl && (item.seller || '') === nextSellerName) return item;
    return nextItem;
  });

  if (JSON.stringify(nextLocalProducts) !== JSON.stringify(localProducts)) {
    writeStorage(STORAGE_KEYS.PRODUCTS, nextLocalProducts);
  }

  return updatedCount;
}

window.repairMarketplaceSellerPhotos = repairMarketplaceSellerPhotos;
window.syncSellerPhotosAcrossProducts = syncSellerPhotosAcrossProducts;

async function fetchUserDoc(uid) {
  try {
    const snap = await getDoc(doc(db, 'marketplace_users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    return null;
  }
}

function productLabel(category) {
  if (category === 'pakaian') return 'Pakaian';
  if (category === 'aksesori') return 'Aksesori';
  return 'Barang';
}

function productEmoji(category) {
  if (category === 'pakaian') return '👕';
  if (category === 'aksesori') return '⌚';
  return '🎁';
}

function normalizeProduct(item) {
  const parsedImages = Array.isArray(item?.images)
    ? item.images.filter(Boolean)
    : Array.isArray(item?.imageUrls)
      ? item.imageUrls.filter(Boolean)
      : item?.imageUrl
        ? [item.imageUrl]
        : [];

  const primaryImage = parsedImages[0] || item.imageUrl || item.image || '';
  const latitude = item.latitude ?? item.lat ?? '';
  const longitude = item.longitude ?? item.lng ?? '';
  const sellerPhotoUrl = item.sellerPhotoUrl || item.sellerPhoto || item.avatarUrl || item.photoUrl || item.profilePhotoUrl || '';

  return {
    id: item.id || item.slug || `p-${Date.now()}`,
    name: item.name || 'Barang baru',
    category: item.category || 'barang',
    price: Number(item.price || 0),
    condition: item.condition || 'Layak pakai',
    status: item.status || (item.isSold ? 'Terjual' : 'Tersedia') || 'Tersedia',
    image: primaryImage || item.image || productEmoji(item.category),
    label: item.label || productLabel(item.category),
    city: item.city || item.address || 'Jakarta',
    address: item.address || item.location || item.city || 'Jakarta',
    seller: item.seller || 'Penjual',
    sellerInitial: item.sellerInitial || (item.seller || 'P').charAt(0).toUpperCase(),
    sellerPhotoUrl,
    description: item.description || 'Deskripsi produk belum tersedia.',
    imageUrl: primaryImage || item.imageUrl || '',
    images: parsedImages.length ? parsedImages : [primaryImage || ''],
    createdAt: item.createdAt || Date.now(),
    ownerId: item.ownerId || item.owner_id || '',
    sellerId: item.sellerId || item.ownerId || item.owner_id || '',
    storyType: item.storyType || 'barang-kenangan',
    storyNote: item.storyNote || '',
    latitude: latitude,
    longitude: longitude,
    coordinates: latitude !== '' && longitude !== '' ? { lat: Number(latitude), lng: Number(longitude) } : null
  };
}

function normalizeUserIdentifier(value) {
  return String(value || '').trim();
}

function isPlaceholderUser(value) {
  const normalized = normalizeUserIdentifier(value || '').toLowerCase();
  return !normalized || ['penjual', 'seller', 'buyer', 'guest', 'me', 'user'].includes(normalized);
}

function getCurrentUserIdentifier() {
  const user = currentUser() || requireAuth();
  if (!user) return '';
  return normalizeUserIdentifier(user.id || user.uid || user.email || user.name || 'guest');
}

function resolveUserIdByName(name) {
  const value = normalizeUserIdentifier(name || '').trim();
  if (!value) return '';

  const users = readStorage(STORAGE_KEYS.USERS, []);
  const match = users.find((user) => {
    const userName = normalizeUserIdentifier(user.name || '').toLowerCase();
    const userEmail = normalizeUserIdentifier(user.email || '').toLowerCase();
    return userName === value.toLowerCase() || userEmail === value.toLowerCase();
  });

  return match ? normalizeUserIdentifier(match.id || match.uid || match.email || value) : value;
}

/* =========================================================================
 * CHAT SYSTEM
 * -------------------------------------------------------------------------
 * One deterministic thread id per pair of users - no more guessing which
 * Firestore doc "is" a conversation. Thread docs carry:
 *   - participantIds: [idA, idB]   -> lets us query "all my chats"
 *   - participants:   [{id,name}]  -> display info for the list/header
 *   - messages:       [{id, senderId, sender, text, createdAt}]
 *   - lastMessage / lastMessageAt / updatedAt -> for the chat list preview
 *   - lastReadAt: { [userId]: timestamp } -> drives unread counts
 * ========================================================================= */

function getChatThreadId(userIdA, userIdB, productId = '') {
  const left = normalizeUserIdentifier(userIdA || '').toLowerCase();
  const right = normalizeUserIdentifier(userIdB || '').toLowerCase();
  const productKey = normalizeUserIdentifier(String(productId || '')).toLowerCase();
  return [left, right, productKey].filter(Boolean).sort().join('__');
}

function buildTargetKey(targetUserId, targetName) {
  if (targetUserId && !isPlaceholderUser(targetUserId)) return normalizeUserIdentifier(targetUserId);
  if (targetName) return `name:${normalizeUserIdentifier(targetName).toLowerCase()}`;
  return '';
}

function readChatThreadsCache() {
  return readStorage('gamon_marketplace_threads_cache', {});
}

function writeChatThreadsCache(data) {
  writeStorage('gamon_marketplace_threads_cache', data);
}

function computeUnreadCount(thread, currentUserId) {
  const messages = thread?.messages || [];
  const lastReadAt = Number((thread?.lastReadAt || {})[currentUserId] || 0);
  const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();

  return messages.filter((msg) => {
    const senderId = normalizeUserIdentifier(msg.senderId || msg.sender || '').toLowerCase();
    return senderId !== normalizedCurrent && Number(msg.createdAt || 0) > lastReadAt;
  }).length;
}

function getOtherParticipant(thread, currentUserId) {
  const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();
  const participants = thread?.participants || [];
  return participants.find((participant) => normalizeUserIdentifier(participant.id || '').toLowerCase() !== normalizedCurrent) || { id: '', name: 'Pengguna' };
}

function getTotalUnreadCount(threadDocs, currentUserId) {
  return threadDocs.reduce((total, thread) => total + computeUnreadCount(thread, currentUserId), 0);
}

function ensureChatBadgeElements() {
  const chatLinks = document.querySelectorAll('a[href*="chat.html"]');
  chatLinks.forEach((link) => {
    if (link.querySelector('[data-chat-nav-badge]')) return;

    if (getComputedStyle(link).position === 'static') {
      link.style.position = 'relative';
    }

    const badge = document.createElement('span');
    badge.setAttribute('data-chat-nav-badge', '');
    badge.className = 'chat-nav-badge';
    badge.style.cssText = 'display:none;position:absolute;top:-6px;right:-8px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e0313f;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:600;box-shadow:0 0 0 2px #fff;';
    link.appendChild(badge);
  });
}

function updateChatBadges(count) {
  ensureChatBadgeElements();

  const badges = document.querySelectorAll('[data-chat-badge], [data-chat-nav-badge]');
  badges.forEach((badge) => {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = '';
      badge.classList.add('show');
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
      badge.classList.remove('show');
    }
  });

  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${BASE_DOCUMENT_TITLE}` : BASE_DOCUMENT_TITLE;
}

function subscribeToGlobalChatNotifications(currentUserId) {
  if (!currentUserId) return () => {};

  const knownLastMessageIds = new Map();
  let isInitialSnapshot = true;

  try {
    const listQuery = query(collection(db, 'marketplace_chats'), where('participantIds', 'array-contains', currentUserId));

    const unsubscribe = onSnapshot(listQuery, (snapshot) => {
      const threadDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

      threadDocs.forEach((thread) => {
        const messages = thread.messages || [];
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) return;

        const previousLastId = knownLastMessageIds.get(thread.id);
        knownLastMessageIds.set(thread.id, lastMessage.id);

        if (isInitialSnapshot) return;

        const senderId = normalizeUserIdentifier(lastMessage.senderId || '').toLowerCase();
        const isFromMe = senderId === normalizeUserIdentifier(currentUserId).toLowerCase();
        const isNewMessage = previousLastId !== lastMessage.id;
        const isActiveThread = thread.id === window.__marketplaceActiveChatThreadId;

        if (isNewMessage && !isFromMe && !isActiveThread) {
          const other = getOtherParticipant(thread, currentUserId);
          const senderName = lastMessage.sender || other.name || 'Seseorang';
          const preview = String(lastMessage.text || '').slice(0, 80);
          showToast(`${senderName}: ${preview}`, 'info');
        }
      });

      isInitialSnapshot = false;
      updateChatBadges(getTotalUnreadCount(threadDocs, currentUserId));
    }, (error) => {
      console.warn('Gagal memuat notifikasi chat:', error);
    });

    return unsubscribe;
  } catch (error) {
    console.warn('Gagal membuka notifikasi chat:', error);
    return () => {};
  }
}

async function markThreadReadRemote(chatRef, existingData, currentUserId) {
  const lastReadAt = { ...(existingData?.lastReadAt || {}), [currentUserId]: Date.now() };
  try {
    await setDoc(chatRef, { lastReadAt }, { merge: true });
  } catch (error) {
    console.warn('Gagal menandai chat sudah dibaca:', error);
  }
}

function renderChatMessages(container, messages, currentUserId) {
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = '<div class="empty-state">Belum ada pesan. Mulai percakapan sekarang.</div>';
    return;
  }

  const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();
  container.innerHTML = messages.map((msg) => {
    const senderIsMe = normalizeUserIdentifier(msg.senderId || '').toLowerCase() === normalizedCurrent;
    return `
      <div class="bubble-message ${senderIsMe ? 'me' : 'other'}">
        <div>${escapeHtml(msg.text)}</div>
      </div>
    `;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

/* -------------------------------------------------------------------------
 * Chat thread list — now resolves and shows each OTHER participant's own
 * profile photo (via getUserAvatarMarkupByName -> resolveUserForMarketplaceLookup,
 * which falls back to Firestore when the user isn't cached locally yet).
 * This function is now async because fetching a photo can require a network
 * call; callers must `await` it.
 * ------------------------------------------------------------------------- */
async function renderChatThreadList(container, threadDocs, currentUserId, activeThreadId) {
  if (!container) return;

  if (!threadDocs.length) {
    container.innerHTML = '<div class="empty-state">Belum ada chat</div>';
    return;
  }

  const sorted = [...threadDocs].sort((a, b) => Number(b.updatedAt || b.lastMessageAt || 0) - Number(a.updatedAt || a.lastMessageAt || 0));

  const rows = await Promise.all(sorted.map(async (thread) => {
    const other = getOtherParticipant(thread, currentUserId);
    const unread = computeUnreadCount(thread, currentUserId);
    const isActive = thread.id === activeThreadId;
    const preview = thread.lastMessage ? escapeHtml(thread.lastMessage) : 'Belum ada pesan';
    const productName = thread.productName ? escapeHtml(thread.productName) : '';
    const productId = thread.productId ? escapeHtml(String(thread.productId)) : '';
    const avatarMarkup = await getUserAvatarMarkupByName(other.name, other.id, other.name || 'P');

    return `
      <button class="chat-item ${isActive ? 'active' : ''}" type="button" data-thread-user-id="${escapeHtml(other.id || '')}" data-thread-user-name="${escapeHtml(other.name || 'Pengguna')}" data-thread-product-id="${productId}" data-thread-product-name="${productName}">
        ${avatarMarkup}
        <div class="chat-item-body">
          <div class="chat-item-head">
            <strong>${escapeHtml(other.name || 'Pengguna')}</strong>
            ${unread ? `<span class="chat-badge">${unread}</span>` : ''}
          </div>
          <div class="chat-item-product">${productName ? `Produk: ${productName}` : 'Produk: Barang umum'}</div>
          <small class="muted">${preview}</small>
        </div>
      </button>
    `;
  }));

  container.innerHTML = rows.join('');

  container.querySelectorAll('[data-thread-user-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.threadUserId;
      const targetName = button.dataset.threadUserName;
      const productId = button.dataset.threadProductId || '';
      const productName = button.dataset.threadProductName || '';
      const params = new URLSearchParams({ user: targetName || 'Pengguna', userId: targetId || '' });

      if (productId) params.set('productId', productId);
      if (productName) params.set('productName', productName);

      window.location.href = `chat.html?${params.toString()}`;
    });
  });
}

async function renderChat() {
  const user = requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const sellerNameParam = params.get('user') || '';
  const sellerIdParam = params.get('userId') || '';
  const productIdParam = params.get('productId') || '';
  const productNameParam = params.get('productName') || '';

  const currentUserId = getCurrentUserIdentifier();
  const currentUserName = getSafeUserName((currentUser() || {}).name || user.name);

  const resolvedTargetId = !isPlaceholderUser(sellerIdParam)
    ? normalizeUserIdentifier(sellerIdParam)
    : (sellerNameParam ? resolveUserIdByName(sellerNameParam) : '');
  const targetName = sellerNameParam ? normalizeUserIdentifier(sellerNameParam) : '';
  const targetKey = buildTargetKey(resolvedTargetId, targetName);
  const hasTarget = Boolean(targetKey);
  const threadId = hasTarget ? getChatThreadId(currentUserId, targetKey, productIdParam) : '';

  const sellerLabel = document.querySelector('[data-chat-contact]');
  if (sellerLabel) sellerLabel.textContent = targetName || 'Pilih percakapan';

  const productContextEl = document.querySelector('[data-chat-product-context]');
  if (productContextEl) {
    productContextEl.hidden = true;
    productContextEl.innerHTML = '';
  }

  const threadListEl = document.querySelector('[data-chat-list]');
  const threadEl = document.querySelector('[data-chat-thread]');
  const composer = document.querySelector('[data-chat-form]');

  // ---- Chat list: realtime "all conversations that contain me" ----
  let listUnsubscribe = () => {};
  if (threadListEl && currentUserId) {
    try {
      const listQuery = query(collection(db, 'marketplace_chats'), where('participantIds', 'array-contains', currentUserId));
      listUnsubscribe = onSnapshot(listQuery, async (snapshot) => {
        const threadDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const cache = readChatThreadsCache();
        threadDocs.forEach((thread) => { cache[thread.id] = thread; });
        writeChatThreadsCache(cache);
        await renderChatThreadList(threadListEl, threadDocs, currentUserId, threadId);
      }, async (error) => {
        console.warn('Gagal memuat daftar chat:', error);
        const cache = readChatThreadsCache();
        const cachedDocs = Object.entries(cache).map(([id, thread]) => ({ id, ...thread }));
        await renderChatThreadList(threadListEl, cachedDocs, currentUserId, threadId);
      });
    } catch (error) {
      console.warn('Gagal membuka daftar chat:', error);
    }
  }

  if (!hasTarget) {
    window.__marketplaceActiveChatThreadId = null;
    if (threadEl) threadEl.innerHTML = '<div class="empty-state">Pilih percakapan untuk mulai chat</div>';
    if (composer) composer.style.display = 'none';
    window.__marketplaceChatCleanup = listUnsubscribe;
    return;
  }

  window.__marketplaceActiveChatThreadId = threadId;

  // ---- Active thread: realtime messages ----
  const chatRef = doc(db, 'marketplace_chats', threadId);
  const participants = [
    { id: currentUserId, name: currentUserName },
    { id: targetKey, name: targetName || 'Pengguna' }
  ];

  const messageUnsubscribe = onSnapshot(chatRef, async (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : { messages: [] };
    const messages = data.messages || [];
    const activeProductId = productIdParam || data?.productId || '';
    const activeProductName = productNameParam || data?.productName || '';

    if (productContextEl) {
      if (activeProductId) {
        let productName = activeProductName || 'Produk yang ditanyakan';
        const productList = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
        const localProduct = productList.find((item) => String(item.id) === String(activeProductId));
        if (localProduct?.name) {
          productName = localProduct.name;
        } else {
          try {
            const productSnapshot = await getDoc(doc(db, 'marketplace_products', activeProductId));
            if (productSnapshot.exists()) {
              const productData = productSnapshot.data();
              if (productData?.name) {
                productName = productData.name;
              }
            }
          } catch (error) {
            console.warn('Gagal memuat detail produk untuk context chat:', error);
          }
        }

        productContextEl.hidden = false;
        productContextEl.innerHTML = `
          <span class="chat-product-context-label">Produk</span>
          <a href="${getProductDetailUrl(activeProductId)}" class="chat-product-context-link">${escapeHtml(productName)}</a>
        `;
      } else {
        productContextEl.hidden = true;
        productContextEl.innerHTML = '';
      }
    }

    renderChatMessages(threadEl, messages, currentUserId);

    const cache = readChatThreadsCache();
    cache[threadId] = { id: threadId, participants, ...data, productId: activeProductId || data?.productId || '', productName: activeProductName || data?.productName || '', messages };
    writeChatThreadsCache(cache);

    if (snapshot.exists() && computeUnreadCount(data, currentUserId) > 0) {
      markThreadReadRemote(chatRef, data, currentUserId);
    }
  }, (error) => {
    console.warn('Gagal memuat pesan chat:', error);
    const cache = readChatThreadsCache();
    const cachedThread = cache[threadId];
    renderChatMessages(threadEl, cachedThread?.messages || [], currentUserId);
  });

  if (composer) {
    composer.style.display = '';
    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = composer.querySelector('input');
      const text = (input.value || '').trim();
      if (!text) return;

      input.value = '';

      try {
        const existing = await getDoc(chatRef);
        const existingData = existing.exists() ? existing.data() : {};
        const currentMessages = existingData.messages || [];

        const newMessage = {
          id: `msg-${Date.now()}`,
          senderId: currentUserId,
          sender: currentUserName,
          text,
          createdAt: Date.now()
        };

        const nextMessages = [...currentMessages, newMessage];
        const nextLastReadAt = { ...(existingData.lastReadAt || {}), [currentUserId]: Date.now() };

        const activeProductId = productIdParam || (existingData?.productId || '');
        const activeProductName = productNameParam || (existingData?.productName || '');

        await setDoc(chatRef, {
          participantIds: [currentUserId, targetKey],
          participants,
          messages: nextMessages,
          lastMessage: text,
          lastMessageAt: Date.now(),
          updatedAt: Date.now(),
          lastReadAt: nextLastReadAt,
          ...(activeProductId ? { productId: activeProductId } : {}),
          ...(activeProductName ? { productName: activeProductName } : {})
        }, { merge: true });
      } catch (error) {
        console.error('Gagal mengirim pesan:', error);
        showToast('Pesan gagal terkirim. Coba lagi.', 'error');
      }
    });
  }

  window.__marketplaceChatCleanup = () => {
    listUnsubscribe();
    messageUnsubscribe();
  };
}

/* ======================= end chat system ======================= */

async function getUserAvatarMarkupByName(userName, userId, fallbackText = 'P', preferredPhotoUrl = '') {
  const matchedUser = await resolveUserForMarketplaceLookup(userName, userId);
  const photoUrl = preferredPhotoUrl || getUserPhotoUrl(matchedUser || null);
  const displayName = matchedUser?.name || userName || fallbackText;

  return photoUrl
    ? `<span class="avatar has-photo"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(getSafeUserName(displayName))}" /></span>`
    : `<span class="avatar">${escapeHtml((displayName || fallbackText).charAt(0).toUpperCase())}</span>`;
}

async function renderProductCards(items) {
  const renderedCards = [];

  for (const item of items) {
    const normalized = normalizeProduct(item);
    const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${escapeHtml(normalized.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
    const statusLabel = normalized.status || 'Tersedia';
    const statusStyle = statusLabel === 'Terjual'
      ? 'background: rgba(220, 38, 38, 0.08); color: #b91c1c; border: 1px solid rgba(220, 38, 38, 0.18);'
      : 'background: rgba(34, 197, 94, 0.08); color: #15803d; border: 1px solid rgba(34, 197, 94, 0.18);';
    const sellerAvatarMarkup = await getUserAvatarMarkupByName(
      normalized.seller,
      normalized.sellerId || normalized.ownerId || '',
      normalized.sellerInitial || 'P',
      normalized.sellerPhotoUrl || ''
    );

    renderedCards.push(`
      <article class="product-card compact-card thread-card" data-category="${normalized.category}">
        <div class="image">${imageMarkup} <span class="chip">${escapeHtml(normalized.label)}</span></div>
        <div class="product-body">
          <div class="product-head">
            <div class="price">${formatCurrency(normalized.price)}</div>
            <span class="condition" style="${statusStyle}">${escapeHtml(statusLabel)}</span>
          </div>
          <h3>${escapeHtml(normalized.name)}</h3>
          <div class="seller-row compact-row">
            <span class="seller-meta">${sellerAvatarMarkup} ${escapeHtml(normalized.seller)}</span>
            <span>${escapeHtml(normalized.city)}</span>
          </div>
          <div class="card-actions compact-actions">
            <a class="btn btn-soft" href="${getProductDetailUrl(normalized.id)}">Lihat detail</a>
          </div>
        </div>
      </article>
    `);
  }

  return renderedCards.join('');
}

function renderHomeProductsLoadingState() {
  const skeletons = Array.from({ length: 4 }, (_, index) => `
    <article class="product-card compact-card product-loading-card" aria-label="Memuat barang ${index + 1}" aria-busy="true">
      <div class="product-loading-image"></div>
      <div class="product-body product-loading-body">
        <div class="product-loading-line product-loading-price"></div>
        <div class="product-loading-line"></div>
        <div class="product-loading-line product-loading-line-short"></div>
        <div class="product-loading-meta">
          <span class="product-loading-avatar"></span>
          <span class="product-loading-line product-loading-meta-line"></span>
        </div>
      </div>
    </article>
  `).join('');

  return `
    <div class="product-loading-state" aria-live="polite" aria-label="Memuat barang yang sedang dijual">
      <div class="product-loading-indicator" role="status" aria-live="polite">
        <span class="product-loading-spinner" aria-hidden="true"></span>
        <span>Memuat barang yang sedang dijual...</span>
      </div>
      <div class="product-loading-grid">
        ${skeletons}
      </div>
    </div>
  `;
}

function renderBuyerProductsLoadingState() {
  return `
    <div class="product-loading-state" aria-live="polite" aria-label="Sedang memuat barang untuk dibeli">
      <div class="product-loading-indicator" role="status" aria-live="polite">
        <span class="product-loading-spinner" aria-hidden="true"></span>
        <span>Sedang memuat barang untuk dibeli...</span>
      </div>
      <div class="product-loading-grid">
        ${Array.from({ length: 4 }, () => `
          <article class="product-card compact-card product-loading-card" aria-busy="true">
            <div class="product-loading-image"></div>
            <div class="product-body product-loading-body">
              <div class="product-loading-line product-loading-price"></div>
              <div class="product-loading-line"></div>
              <div class="product-loading-line product-loading-line-short"></div>
              <div class="product-loading-meta">
                <span class="product-loading-avatar"></span>
                <span class="product-loading-line product-loading-meta-line"></span>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMyProductsLoadingState() {
  return `
    <div class="product-loading-state" aria-live="polite" aria-label="Sedang memuat barang saya">
      <div class="product-loading-indicator" role="status" aria-live="polite">
        <span class="product-loading-spinner" aria-hidden="true"></span>
        <span>Sedang memuat barang saya...</span>
      </div>
      <div class="product-loading-grid">
        ${Array.from({ length: 4 }, () => `
          <article class="product-card compact-card product-loading-card" aria-busy="true">
            <div class="product-loading-image"></div>
            <div class="product-body product-loading-body">
              <div class="product-loading-line product-loading-price"></div>
              <div class="product-loading-line"></div>
              <div class="product-loading-line product-loading-line-short"></div>
              <div class="product-loading-meta">
                <span class="product-loading-avatar"></span>
                <span class="product-loading-line product-loading-meta-line"></span>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

async function renderHomeProducts() {
  const container = document.querySelector('[data-product-list]');
  if (!container) return;

  container.innerHTML = renderHomeProductsLoadingState();
  ensureDemoData();
  const renderFromItems = async (items) => {
    const normalized = items.map(normalizeProduct);
    container.innerHTML = await renderProductCards(normalized);

    const filterButtons = document.querySelectorAll('[data-filter]');
    const cards = document.querySelectorAll('[data-category]');
    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.filter;
        filterButtons.forEach((item) => item.classList.toggle('active', item === button));
        cards.forEach((card) => {
          const visible = target === 'all' || card.dataset.category === target;
          card.style.display = visible ? '' : 'none';
        });
      });
    });
  };

  const products = await fetchProductsFromFirebase();
  await renderFromItems(products);

  const productsQuery = query(collection(db, 'marketplace_products'), orderBy('createdAt', 'desc'));
  const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
    const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderFromItems(items);
  }, (error) => {
    console.error('Realtime home products error:', error);
  });

  window.__marketplaceHomeProductsCleanup = unsubscribe;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = document.body.dataset.page === 'register' ? 'Membuat akun...' : 'Masuk...';
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const rememberMe = formData.get('remember') === 'on' || payload.remember === 'on';

  const isRegister = document.body.dataset.page === 'register';

  if (!canAttemptLogin()) {
    setAuthMessage('Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.', 'error');
    showPopup('Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.', 'Terlalu banyak', 'error');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = isRegister ? 'Buat akun' : 'Masuk ke dashboard';
    }
    return;
  }

  try {
    if (isRegister) {
      ensureDemoData();
      const email = String(payload.email || '').trim().toLowerCase();
      const users = readStorage(STORAGE_KEYS.USERS, []);
      const filteredUsers = users.filter((user) => (user.email || '').toLowerCase() !== email);
      if (filteredUsers.length !== users.length) {
        writeStorage(STORAGE_KEYS.USERS, filteredUsers);
      }

      const cred = await createUserWithEmailAndPassword(auth, email, String(payload.password || ''));

      const newUser = {
        id: cred.user.uid,
        name: `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || 'Pengguna',
        email: payload.email,
        phone: payload.phone || '',
        username: `${(payload.firstName || 'user').toLowerCase()}${(payload.lastName || '').toLowerCase()}`.trim() || 'user',
        bio: 'Saya membuka akun untuk jual dan beli barang dengan rasa aman dan nyaman.',
        city: 'Jakarta',
        role: payload.role || 'both'
      };

      await setDoc(doc(db, 'marketplace_users', cred.user.uid), newUser);
      users.push(newUser);
      writeStorage(STORAGE_KEYS.USERS, users);
      clearCurrentUser();
      setAuthMessage('Akun berhasil dibuat. Silakan masuk ke dashboard.', 'info');
      showPopup('Akun berhasil dibuat. Silakan masuk ke dashboard.', 'Berhasil', 'success');
      if (submitButton) {
        submitButton.textContent = 'Akun dibuat';
      }
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1200);
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, payload.email, payload.password);

    const userDoc = await fetchUserDoc(cred.user.uid);
    const user = userDoc || {
      id: cred.user.uid,
      name: cred.user.displayName || 'Pengguna',
      email: cred.user.email,
      phone: '',
      username: 'user',
      bio: '',
      city: 'Jakarta',
      role: 'both'
    };

    resetLoginAttempts();
    setCurrentUser(user, rememberMe);
    writeStorage(STORAGE_KEYS.USERS, [...(readStorage(STORAGE_KEYS.USERS, []) || []), user].filter((item, index, arr) => arr.findIndex((entry) => entry.email === item.email) === index));
    window.location.href = 'user/dashboard.html';
  } catch (error) {
    recordFailedLogin();
    console.error(error);

    const rawMessage = error?.message || 'Terjadi kesalahan saat proses autentikasi.';
    const errorText = String(rawMessage).toLowerCase();
    let userMessage = rawMessage;

    if (errorText.includes('invalid-credential') || errorText.includes('wrong-password') || errorText.includes('user-not-found') || errorText.includes('invalid-email')) {
      userMessage = 'Email atau password salah. Pastikan akun sudah dibuat dan password benar.';
    } else if (errorText.includes('email-already-in-use')) {
      userMessage = 'Email sudah dipakai. Jika akun sebelumnya sudah dihapus dari Firebase, tunggu beberapa menit lalu coba lagi atau pakai email lain.';
    } else if (errorText.includes('too-many-requests')) {
      userMessage = 'Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.';
    } else if (errorText.includes('network-request-failed')) {
      userMessage = 'Koneksi gagal. Coba lagi dalam beberapa saat.';
    }

    setAuthMessage(userMessage, 'error');
    showPopup(userMessage, isRegister ? 'Pendaftaran gagal' : 'Login gagal', 'error');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = isRegister ? 'Buat akun' : 'Masuk ke dashboard';
    }
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const emailInput = document.querySelector('#email');
  const email = String((emailInput && emailInput.value) || '').trim();

  if (!email) {
    setAuthMessage('Isi email login terlebih dahulu untuk reset password.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage('Link reset password sudah dikirim ke email Anda.', 'info');
    showPopup('Link reset password sudah dikirim ke email Anda.', 'Berhasil', 'success');
  } catch (error) {
    console.error('Reset password gagal:', error);
    setAuthMessage(error.message || 'Gagal mengirim link reset password.', 'error');
    showPopup(error.message || 'Gagal mengirim link reset password.', 'Gagal', 'error');
  }
}

async function bindAuthPage() {
  const page = document.body.dataset.page;
  if (!page || !['login', 'register'].includes(page)) return;

  const form = document.querySelector('[data-auth-form]');
  if (!form) return;
  form.addEventListener('submit', handleAuthSubmit);

  const forgotBtn = document.querySelector('[data-forgot-password]');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', handleForgotPassword);
  }

  const savedUser = currentUser();
  if (savedUser) {
    if (window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html')) {
      window.location.href = 'user/dashboard.html';
    }
    return;
  }

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) return;

    await syncCurrentUserFromFirebase(firebaseUser, true);
    if (window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html')) {
      window.location.href = 'user/dashboard.html';
    }
  });
}

function bindMobileSidebar() {
  const shell = document.querySelector('.user-shell');
  const sidebar = document.querySelector('.sidebar');
  const nav = document.querySelector('.topbar .nav');
  if (!shell || !sidebar || !nav) return;

  let toggle = document.querySelector('.mobile-menu-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-menu-toggle';
    toggle.setAttribute('aria-label', 'Buka menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(toggle);
  }

  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  const updateState = () => {
    const isOpen = shell.classList.contains('sidebar-open');
    sidebar.classList.toggle('is-open', isOpen);
    toggle.classList.toggle('is-active', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    backdrop.classList.toggle('is-visible', isOpen);
  };

  toggle.addEventListener('click', () => {
    shell.classList.toggle('sidebar-open');
    updateState();
  });

  backdrop.addEventListener('click', () => {
    shell.classList.remove('sidebar-open');
    updateState();
  });

  document.querySelectorAll('.sidebar nav a').forEach((link) => {
    link.addEventListener('click', () => {
      shell.classList.remove('sidebar-open');
      updateState();
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      shell.classList.remove('sidebar-open');
      updateState();
    }
  });

  updateState();
}

function updateSidebarProfile() {
  hydrateUserProfileUI();
}

async function renderDashboard() {
  const user = requireAuth();
  if (!user) return;

  const greeting = document.querySelector('[data-greeting]');
  if (greeting) greeting.textContent = `Halo, ${getSafeUserName(user.name)}`;

  const products = await fetchMyProductsFromFirebase(user);
  const normalizedProducts = products.map((item) => normalizeProduct(item));
  const totalSold = normalizedProducts.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    const condition = String(item.condition || '').toLowerCase();
    return status === 'terjual' || condition === 'terjual';
  }).length;
  const activeProducts = normalizedProducts.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return status !== 'terjual';
  }).length;
  const balance = normalizedProducts.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const soldEl = document.querySelector('[data-stat-sold]');
  if (soldEl) soldEl.textContent = String(totalSold);
  const orderEl = document.querySelector('[data-stat-orders]');
  if (orderEl) orderEl.textContent = String(activeProducts);
  const balanceEl = document.querySelector('[data-stat-balance]');
  if (balanceEl) balanceEl.textContent = formatCurrency(balance);

  const productList = document.querySelector('[data-dashboard-products]');
  if (productList) {
    if (!normalizedProducts.length) {
      productList.innerHTML = `
        <div style="display: grid; place-items: center; text-align: center; min-height: 180px;">
          <div>
            <div style="font-size: 2.5rem; margin-bottom: 12px;">📦</div>
            <h3 style="margin: 0 0 8px;">Belum ada produk</h3>
            <p class="muted" style="margin: 0;">Mulai dengan menambahkan barang pertama Anda.</p>
          </div>
        </div>
      `;
    } else {
      productList.innerHTML = normalizedProducts.slice(0, 3).map((item) => `
        <div class="mini-product-item" style="display: grid; grid-template-columns: 72px 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(148,163,184,0.18);">
          <div style="width: 72px; height: 72px; border-radius: 14px; overflow: hidden; background: #f4f6ff; display: grid; place-items: center;">
            ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" style="width:100%; height:100%; object-fit:cover;" />` : `<span style="font-size: 1.5rem;">${escapeHtml(item.label?.charAt(0) || 'B')}</span>`}
          </div>
          <div>
            <div style="font-weight: 700; color: var(--primary-strong);">${escapeHtml(item.name)}</div>
            <small class="muted">${escapeHtml(item.category || 'Barang')} • ${formatCurrency(item.price)}</small>
          </div>
          <span class="condition" style="${item.status === 'Terjual' ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;' : 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;'}">${escapeHtml(item.status || 'Tersedia')}</span>
        </div>
      `).join('');
    }
  }

  const activityContainer = document.querySelector('[data-dashboard-activity]');
  if (activityContainer) {
    if (!normalizedProducts.length) {
      activityContainer.innerHTML = `
        <div class="activity-item">
          <span class="dot"></span>
          <div>
            <p><strong>Aktivitas</strong> akan muncul di sini saat produk atau transaksi mulai dibuat.</p>
            <small>Belum ada update</small>
          </div>
        </div>
      `;
      return;
    }

    const latestActivities = normalizedProducts
      .slice(0, 4)
      .map((item) => ({
        title: item.status === 'Terjual' ? `Barang terjual: ${item.name}` : `Barang aktif: ${item.name}`,
        time: item.createdAt ? new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Baru'
      }));

    activityContainer.innerHTML = latestActivities.map((activity) => `
      <div class="activity-item">
        <span class="dot"></span>
        <div>
          <p><strong>${escapeHtml(activity.title)}</strong></p>
          <small>${escapeHtml(activity.time)}</small>
        </div>
      </div>
    `).join('');
  }

  updateSidebarProfile();
}

async function handleSellSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const user = currentUser() || requireAuth();
  if (!user) return;

  if (submitButton) {
    setButtonLoading(submitButton, true, 'Menyimpan...');
  }

  try {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const fileInput = form.querySelector('input[type="file"]');
    const selectedFiles = fileInput && fileInput.files ? Array.from(fileInput.files).filter((file) => file && file.type.startsWith('image/')) : [];

    if (!payload.name || !payload.description || !payload.price || !payload.location) {
      throw new Error('Form jual belum lengkap. Isi nama barang, harga, lokasi, dan deskripsi terlebih dahulu.');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const maxFileSize = 5 * 1024 * 1024;
    const validFiles = selectedFiles.filter((file) => {
      if (!allowedTypes.includes(file.type)) return false;
      if (file.size > maxFileSize) return false;
      return true;
    });

    if (selectedFiles.length && validFiles.length !== selectedFiles.length) {
      throw new Error('Beberapa foto tidak valid: gunakan JPG, PNG, atau WebP dengan ukuran maksimal 5 MB per file.');
    }

    const resizedFiles = validFiles.length ? await Promise.all(validFiles.map((file) => prepareImageForUpload(file))) : [];
    const finalFiles = resizedFiles.filter((file) => file && file.size <= maxFileSize);

    if (validFiles.length && finalFiles.length !== validFiles.length) {
      throw new Error('Foto terlalu besar untuk diupload. Silakan pilih foto yang lebih kecil atau lebih ringan.');
    }

    const productPayload = {
      name: payload.name || 'Barang Baru',
      category: payload.category || 'barang',
      price: Number(String(payload.price || '').replace(/[^\d]/g, '')) || 0,
      condition: payload.condition || 'Layak pakai',
      status: payload.status || 'Tersedia',
      description: payload.description || 'Barang ini siap dijual.',
      city: payload.location || 'Jakarta',
      address: payload.location || 'Jakarta',
      location: payload.location || 'Jakarta',
      seller: user.name || 'Seller',
      sellerInitial: (user.name || 'S').charAt(0).toUpperCase(),
      sellerPhotoUrl: getUserPhotoUrl(user) || '',
      sellerId: user.id || user.uid || auth.currentUser?.uid || '',
      ownerId: user.id || user.uid || auth.currentUser?.uid || '',
      image: payload.category === 'pakaian' ? '👕' : payload.category === 'aksesori' ? '⌚' : '🎁',
      label: productLabel(payload.category || 'barang'),
      storyType: payload.storyType || 'barang-kenangan',
      storyNote: payload.storyNote || '',
      latitude: payload.latitude || '',
      longitude: payload.longitude || '',
      imageUrl: '',
      images: [],
      createdAt: Date.now()
    };

    if (finalFiles.length) {
      if (submitButton) {
        setButtonLoading(submitButton, true, 'Mengolah foto...');
      }

      const dataUrls = await Promise.all(
        finalFiles.map(async (file) => fileToDataUrl(file))
      );

      productPayload.images = dataUrls;
      productPayload.imageUrl = dataUrls[0] || '';
      productPayload.image = dataUrls[0] || productPayload.image;
    }

    if (productPayload.ownerId) {
      const productRef = await withTimeout(addDoc(collection(db, 'marketplace_products'), productPayload), FILE_UPLOAD_TIMEOUT_MS, 'Simpan produk');
      productPayload.id = productRef.id;
      await withTimeout(updateDoc(productRef, { id: productRef.id }), FILE_UPLOAD_TIMEOUT_MS, 'Update ID produk');
    }

    showPopup('Barang berhasil dipublish.', 'Berhasil', 'success');
    setTimeout(() => {
      window.location.href = 'my-products.html';
    }, 1500);
  } catch (error) {
    console.error('Gagal publish produk:', error);
    showPopup(error.message || 'Proses menambahkan barang gagal. Data tidak disimpan.', 'Gagal', 'error');
  } finally {
    if (submitButton) {
      setButtonLoading(submitButton, false);
    }
  }
}

async function bindEditForm() {
  const form = document.querySelector('[data-edit-form]');
  if (!form) return;

  bindPriceFieldFormatting(form);

  const productId = new URLSearchParams(window.location.search).get('id');
  if (!productId) {
    showPopup('Produk tidak ditemukan untuk diedit.', 'Tidak ditemukan', 'error');
    window.location.href = 'my-products.html';
    return;
  }

  const photoInput = form.querySelector('input[type="file"]');
  const browseButton = form.querySelector('[data-browse-files]');
  const dropzone = form.querySelector('[data-upload-dropzone]');
  const uploadedList = form.querySelector('[data-uploaded-file-list]');
  const locationButton = form.querySelector('[data-use-location]');
  const locationStatus = form.querySelector('[data-location-status]');
  const latField = form.querySelector('[name="latitude"]');
  const lngField = form.querySelector('[name="longitude"]');
  const mapPreview = form.querySelector('[data-location-map-preview]');

  const updateLocationPreview = (lat, lng) => {
    if (!mapPreview) return;
    const latitude = Number(lat || 0);
    const longitude = Number(lng || 0);
    if (!latitude || !longitude) {
      mapPreview.innerHTML = '<div class="map-placeholder">📍</div>';
      return;
    }

    const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=14&output=embed`;
    mapPreview.innerHTML = `<iframe title="Preview lokasi" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe>`;
  };

  const syncChosenFiles = (files = []) => {
    if (!photoInput) return [];
    const validFiles = Array.from(files || []).filter((file) => file && file.name && file.type && file.type.startsWith('image/'));
    const uniqueFiles = [];
    const seen = new Set();

    validFiles.forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFiles.push(file);
      }
    });

    const dt = new DataTransfer();
    uniqueFiles.forEach((file) => dt.items.add(file));
    photoInput.files = dt.files;
    photoInput.__gamonSelectedFiles = uniqueFiles;
    return uniqueFiles;
  };

  const getStoredSelectedFiles = () => {
    if (!photoInput) return [];
    if (Array.isArray(photoInput.__gamonSelectedFiles)) {
      return [...photoInput.__gamonSelectedFiles];
    }
    return Array.from(photoInput.files || []);
  };

  const renderSelectedFiles = (fileList = []) => {
    if (!uploadedList) return;
    const files = Array.from(fileList || []).filter((file) => file && file.type && file.type.startsWith('image/'));

    if (!files.length) {
      uploadedList.innerHTML = '';
      return;
    }

    Promise.all(files.slice(0, 8).map((file) => fileToDataUrl(file))).then((urls) => {
      uploadedList.innerHTML = urls.map((url, index) => `
        <div class="uploaded-item">
          <div class="uploaded-item-thumb">
            <img src="${url}" alt="${escapeHtml(files[index]?.name || 'Preview foto')}" />
          </div>
          <div class="uploaded-item-name">${escapeHtml(files[index]?.name || 'Foto')}</div>
          <button class="uploaded-item-remove" type="button" data-remove-file="${index}" aria-label="Hapus foto">🗑</button>
        </div>
      `).join('');

      uploadedList.querySelectorAll('[data-remove-file]').forEach((button) => {
        button.addEventListener('click', () => {
          if (!photoInput) return;
          const fileArray = getStoredSelectedFiles();
          const removeIndex = Number(button.dataset.removeFile || 0);
          const remainingFiles = fileArray.filter((_, idx) => idx !== removeIndex);
          const syncedFiles = syncChosenFiles(remainingFiles);
          renderSelectedFiles(syncedFiles);
        });
      });
    }).catch(() => {
      uploadedList.innerHTML = '';
    });
  };

  if (browseButton && photoInput) {
    browseButton.addEventListener('click', () => photoInput.click());
  }

  if (dropzone && photoInput) {
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      if (event.dataTransfer?.files?.length) {
        const previousFiles = getStoredSelectedFiles();
        const mergedFiles = syncChosenFiles([...previousFiles, ...Array.from(event.dataTransfer.files || [])]);
        renderSelectedFiles(mergedFiles);
      }
    });
  }

  if (photoInput) {
    photoInput.addEventListener('change', (event) => {
      const incomingFiles = Array.from(event.target.files || []);
      const mergedFiles = syncChosenFiles(incomingFiles);
      renderSelectedFiles(mergedFiles);
    });
  }

  let existingImages = [];
  const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
  const product = localProducts.find((item) => String(item.id) === String(productId)) || null;

  const resolveProduct = async () => {
    try {
      const snapshot = await getDoc(doc(db, 'marketplace_products', productId));
      if (snapshot.exists()) {
        return snapshot.data();
      }
    } catch (error) {
      console.warn('Failed to fetch product from Firestore', error);
    }
    return product;
  };

  const selectedProduct = await resolveProduct();
  const normalized = selectedProduct ? normalizeProduct(selectedProduct) : null;

  if (!normalized) {
    showPopup('Produk yang akan diedit tidak ditemukan.', 'Tidak ditemukan', 'error');
    window.location.href = 'my-products.html';
    return;
  }

  form.querySelector('[name="name"]').value = normalized.name || '';
  form.querySelector('[name="category"]').value = normalized.category || 'barang';
  form.querySelector('[name="price"]').value = formatRupiahInputValue(normalized.price || '');
  form.querySelector('[name="condition"]').value = normalized.condition || 'Layak pakai';
  form.querySelector('[name="status"]').value = normalized.status || 'Tersedia';
  form.querySelector('[name="storyType"]').value = normalized.storyType || 'barang-kenangan';
  form.querySelector('[name="storyNote"]').value = normalized.storyNote || '';
  form.querySelector('[name="description"]').value = normalized.description || '';
  form.querySelector('[name="location"]').value = normalized.address || normalized.city || '';
  if (latField) latField.value = normalized.latitude || '';
  if (lngField) lngField.value = normalized.longitude || '';
  if (normalized.latitude && normalized.longitude) {
    updateLocationPreview(normalized.latitude, normalized.longitude);
  }

  existingImages = Array.isArray(normalized.images) ? normalized.images.filter(Boolean) : [];
  if (existingImages.length) {
    uploadedList.innerHTML = existingImages.map((src, index) => `
      <div class="uploaded-item">
        <div class="uploaded-item-thumb">
          <img src="${src}" alt="${escapeHtml(normalized.name || 'Foto produk')}" />
        </div>
        <div class="uploaded-item-name">Foto ${index + 1}</div>
        <button class="uploaded-item-remove" type="button" data-remove-existing="${index}" aria-label="Hapus foto lama">🗑</button>
      </div>
    `).join('');

    uploadedList.querySelectorAll('[data-remove-existing]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.removeExisting || 0);
        existingImages = existingImages.filter((_, i) => i !== index);
        if (!existingImages.length) {
          uploadedList.innerHTML = '';
          return;
        }
        uploadedList.innerHTML = existingImages.map((src, btnIndex) => `
          <div class="uploaded-item">
            <div class="uploaded-item-thumb">
              <img src="${src}" alt="${escapeHtml(normalized.name || 'Foto produk')}" />
            </div>
            <div class="uploaded-item-name">Foto ${btnIndex + 1}</div>
            <button class="uploaded-item-remove" type="button" data-remove-existing="${btnIndex}" aria-label="Hapus foto lama">🗑</button>
          </div>
        `).join('');
        uploadedList.querySelectorAll('[data-remove-existing]').forEach((newButton) => {
          newButton.addEventListener('click', () => {
            const secondIndex = Number(newButton.dataset.removeExisting || 0);
            existingImages = existingImages.filter((_, idx) => idx !== secondIndex);
            uploadedList.innerHTML = existingImages.length ? existingImages.map((img, innerIndex) => `
              <div class="uploaded-item">
                <div class="uploaded-item-thumb">
                  <img src="${img}" alt="${escapeHtml(normalized.name || 'Foto produk')}" />
                </div>
                <div class="uploaded-item-name">Foto ${innerIndex + 1}</div>
                <button class="uploaded-item-remove" type="button" data-remove-existing="${innerIndex}" aria-label="Hapus foto lama">🗑</button>
              </div>
            `).join('') : '';
          });
        });
      });
    });
  }

  if (locationButton) {
    locationButton.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showPopup('Browser Anda tidak mendukung pembacaan lokasi otomatis.', 'Lokasi tidak tersedia', 'error');
        if (locationStatus) locationStatus.textContent = 'Browser tidak mendukung';
        return;
      }

      if (locationStatus) locationStatus.textContent = 'Mencari lokasi...';
      locationButton.disabled = true;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = Number(position.coords.latitude || 0);
          const longitude = Number(position.coords.longitude || 0);
          if (latField) latField.value = String(latitude.toFixed(6));
          if (lngField) lngField.value = String(longitude.toFixed(6));
          updateLocationPreview(latitude, longitude);
          if (locationStatus) locationStatus.textContent = 'Lokasi berhasil dipakai';
          showPopup('Lokasi Anda berhasil dipakai untuk produk.', 'Lokasi diperbarui', 'success');
          locationButton.disabled = false;
        },
        (error) => {
          console.warn('Geolocation error:', error);
          if (locationStatus) locationStatus.textContent = 'Gagal mengambil lokasi';
          showPopup('Tidak dapat mengambil lokasi otomatis. Silakan izinkan akses lokasi browser Anda.', 'Lokasi gagal', 'error');
          locationButton.disabled = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Menyimpan...';
    }

    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      const selectedFiles = getStoredSelectedFiles();
      const user = currentUser() || requireAuth();

      const imageUrls = [...existingImages];
      const newFiles = Array.from(selectedFiles || []).filter((file) => file && file.type && file.type.startsWith('image/'));
      if (newFiles.length) {
        const prepared = await Promise.all(newFiles.map((file) => prepareImageForUpload(file)));
        const urls = await Promise.all(prepared.map((file) => fileToDataUrl(file)));
        imageUrls.push(...urls);
      }

      const updatedData = {
        name: payload.name,
        category: payload.category,
        price: Number(String(payload.price).replace(/[^\d]/g, '')) || 0,
        condition: payload.condition,
        status: payload.status || 'Tersedia',
        description: payload.description,
        city: payload.location,
        address: payload.location,
        location: payload.location,
        storyType: payload.storyType || 'barang-kenangan',
        storyNote: payload.storyNote || '',
        latitude: payload.latitude || normalized.latitude || '',
        longitude: payload.longitude || normalized.longitude || '',
        label: productLabel(payload.category || 'barang'),
        updatedAt: Date.now(),
        images: imageUrls,
        imageUrl: imageUrls[0] || normalized.imageUrl || normalized.image || '',
        image: imageUrls[0] || normalized.imageUrl || normalized.image || productEmoji(payload.category || normalized.category),
        seller: user?.name || normalized.seller || 'Seller',
        sellerInitial: (user?.name || normalized.seller || 'S').charAt(0).toUpperCase(),
        sellerPhotoUrl: getUserPhotoUrl(user || null) || normalized.sellerPhotoUrl || '',
        ownerId: normalized.ownerId || user?.id || user?.uid || '',
        sellerId: normalized.sellerId || normalized.ownerId || user?.id || user?.uid || ''
      };

      await updateDoc(doc(db, 'marketplace_products', productId), updatedData);

      const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
      const index = localProducts.findIndex((item) => String(item.id) === String(productId));
      if (index >= 0) {
        localProducts[index] = { ...localProducts[index], ...updatedData, id: productId };
        writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);
      }

      showPopup('Produk berhasil diperbarui.', 'Berhasil', 'success');
      setTimeout(() => {
        window.location.href = 'my-products.html';
      }, 700);
    } catch (error) {
      console.error('Update edit form error:', error);
      showPopup(error.message || 'Gagal memperbarui produk.', 'Gagal', 'error');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Simpan perubahan';
      }
    }
  });
}

async function bindSellForm() {
  const form = document.querySelector('[data-sell-form]');
  if (!form) return;

  bindPriceFieldFormatting(form);

  const locationField = form.querySelector('[name="location"]');
  const photoInput = form.querySelector('input[type="file"]');
  const browseButton = form.querySelector('[data-browse-files]');
  const dropzone = form.querySelector('[data-upload-dropzone]');
  const uploadedList = form.querySelector('[data-uploaded-file-list]');
  const locationButton = form.querySelector('[data-use-location]');
  const locationStatus = form.querySelector('[data-location-status]');
  const latField = form.querySelector('[name="latitude"]');
  const lngField = form.querySelector('[name="longitude"]');
  const mapPreview = form.querySelector('[data-location-map-preview]');

  const currentProfile = currentUser();
  const profileLocation = currentProfile?.location || currentProfile?.address || currentProfile?.city || '';
  const profileLatitude = currentProfile?.latitude || '';
  const profileLongitude = currentProfile?.longitude || '';

  if (locationField && profileLocation && !locationField.value) {
    locationField.value = profileLocation;
  }

  if (latField && profileLatitude && !latField.value) {
    latField.value = String(profileLatitude);
  }

  if (lngField && profileLongitude && !lngField.value) {
    lngField.value = String(profileLongitude);
  }

  const updateLocationPreview = (lat, lng) => {
    if (!mapPreview) return;
    const latitude = Number(lat || 0);
    const longitude = Number(lng || 0);
    if (!latitude || !longitude) {
      mapPreview.innerHTML = '<div class="map-placeholder">📍</div>';
      return;
    }

    const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=14&output=embed`;
    mapPreview.innerHTML = `<iframe title="Preview lokasi" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe>`;
  };

  if (profileLatitude && profileLongitude) {
    updateLocationPreview(profileLatitude, profileLongitude);
    if (locationStatus) locationStatus.textContent = 'Alamat profil terpakai';
  }

  const syncChosenFiles = (files = []) => {
    if (!photoInput) return [];

    const validFiles = Array.from(files || []).filter((file) => file && file.name && file.type && file.type.startsWith('image/'));
    const uniqueFiles = [];
    const seen = new Set();

    validFiles.forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFiles.push(file);
      }
    });

    const dt = new DataTransfer();
    uniqueFiles.forEach((file) => dt.items.add(file));
    photoInput.files = dt.files;
    photoInput.__gamonSelectedFiles = uniqueFiles;
    return uniqueFiles;
  };

  const getStoredSelectedFiles = () => {
    if (!photoInput) return [];
    if (Array.isArray(photoInput.__gamonSelectedFiles)) {
      return [...photoInput.__gamonSelectedFiles];
    }
    return Array.from(photoInput.files || []);
  };

  const renderSelectedFiles = (fileList = []) => {
    if (!uploadedList) return;
    const files = Array.from(fileList || []).filter((file) => file && file.type && file.type.startsWith('image/'));

    if (!files.length) {
      uploadedList.innerHTML = '';
      return;
    }

    Promise.all(files.slice(0, 8).map((file) => fileToDataUrl(file))).then((urls) => {
      uploadedList.innerHTML = urls.map((url, index) => `
        <div class="uploaded-item">
          <div class="uploaded-item-thumb">
            <img src="${url}" alt="${escapeHtml(files[index]?.name || 'Preview foto')}" />
          </div>
          <div class="uploaded-item-name">${escapeHtml(files[index]?.name || 'Foto')}</div>
          <button class="uploaded-item-remove" type="button" data-remove-file="${index}" aria-label="Hapus foto">🗑</button>
        </div>
      `).join('');

      uploadedList.querySelectorAll('[data-remove-file]').forEach((button) => {
        button.addEventListener('click', () => {
          if (!photoInput) return;
          const fileArray = getStoredSelectedFiles();
          const removeIndex = Number(button.dataset.removeFile || 0);
          const remainingFiles = fileArray.filter((_, idx) => idx !== removeIndex);
          const syncedFiles = syncChosenFiles(remainingFiles);
          renderSelectedFiles(syncedFiles);
        });
      });
    }).catch(() => {
      uploadedList.innerHTML = '';
    });
  };

  if (browseButton && photoInput) {
    browseButton.addEventListener('click', () => photoInput.click());
  }

  if (dropzone && photoInput) {
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      if (event.dataTransfer?.files?.length) {
        const previousFiles = getStoredSelectedFiles();
        const mergedFiles = syncChosenFiles([...previousFiles, ...Array.from(event.dataTransfer.files || [])]);
        renderSelectedFiles(mergedFiles);
      }
    });
  }

  if (photoInput) {
    photoInput.addEventListener('change', (event) => {
      const previousFiles = getStoredSelectedFiles();
      const incomingFiles = Array.from(event.target.files || []);
      const mergedFiles = syncChosenFiles([...previousFiles, ...incomingFiles]);
      renderSelectedFiles(mergedFiles);
    });
  }

  if (photoInput) {
    photoInput.__gamonSelectedFiles = Array.from(photoInput.files || []);
  }

  if (locationButton) {
    locationButton.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showPopup('Browser Anda tidak mendukung pembacaan lokasi otomatis.', 'Lokasi tidak tersedia', 'error');
        if (locationStatus) locationStatus.textContent = 'Browser tidak mendukung';
        return;
      }

      if (locationStatus) locationStatus.textContent = 'Mencari lokasi...';
      locationButton.disabled = true;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = Number(position.coords.latitude || 0);
          const longitude = Number(position.coords.longitude || 0);

          if (latField) latField.value = String(latitude.toFixed(6));
          if (lngField) lngField.value = String(longitude.toFixed(6));
          updateLocationPreview(latitude, longitude);

          if (locationStatus) locationStatus.textContent = 'Lokasi berhasil dipakai';
          showPopup('Lokasi Anda berhasil dipakai untuk iklan.', 'Lokasi diperbarui', 'success');
          locationButton.disabled = false;
        },
        (error) => {
          console.warn('Geolocation error:', error);
          if (locationStatus) locationStatus.textContent = 'Gagal mengambil lokasi';
          showPopup('Tidak dapat mengambil lokasi otomatis. Silakan izinkan akses lokasi browser Anda.', 'Lokasi gagal', 'error');
          locationButton.disabled = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit');
  if (editId) {
    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
    const product = localProducts.find((item) => String(item.id) === String(editId));
    if (product) {
      form.querySelector('[name="name"]').value = product.name || '';
      form.querySelector('[name="category"]').value = product.category || 'barang';
      form.querySelector('[name="price"]').value = formatRupiahInputValue(product.price || '');
      form.querySelector('[name="condition"]').value = product.condition || 'Layak pakai';
      form.querySelector('[name="status"]').value = product.status || 'Tersedia';
      form.querySelector('[name="description"]').value = product.description || '';
      form.querySelector('[name="location"]').value = product.address || product.city || '';
      form.querySelector('[name="storyType"]').value = product.storyType || 'barang-kenangan';
      form.querySelector('[name="storyNote"]').value = product.storyNote || '';
      if (latField) latField.value = product.latitude || '';
      if (lngField) lngField.value = product.longitude || '';
      if (product.latitude && product.longitude) {
        updateLocationPreview(product.latitude, product.longitude);
      }
      form.dataset.editId = editId;
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = 'Update iklan';
    }
  }

  renderSelectedFiles([]);

  form.addEventListener('submit', async (event) => {
    const editId = form.dataset.editId;
    if (editId) {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Mengupdate...';
      }

      try {
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        const updatedData = {
          name: payload.name,
          category: payload.category,
          price: Number(String(payload.price || '').replace(/[^\d]/g, '')) || 0,
          condition: payload.condition,
          status: payload.status || 'Tersedia',
          description: payload.description,
          city: payload.location,
          seller: currentUser()?.name || 'Seller',
          sellerInitial: (currentUser()?.name || 'S').charAt(0).toUpperCase(),
          label: productLabel(payload.category || 'barang'),
          updatedAt: Date.now()
        };

        const fileInput = form.querySelector('input[type="file"]');
        if (fileInput && fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          const compressedFile = await prepareImageForUpload(file);
          updatedData.imageUrl = await fileToDataUrl(compressedFile);
        }

        await updateDoc(doc(db, 'marketplace_products', editId), updatedData);

        const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
        const index = localProducts.findIndex((item) => String(item.id) === String(editId));
        if (index >= 0) {
          localProducts[index] = { ...localProducts[index], ...updatedData, id: editId };
          writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);
        }

        showPopup('Barang berhasil diperbarui.', 'Berhasil', 'success');
        window.location.href = 'my-products.html';
      } catch (error) {
        console.error('Update product error:', error);
        showPopup('Gagal update produk. Coba lagi.', 'Gagal', 'error');
      } finally {
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Update iklan';
        }
      }
      return;
    }

    handleSellSubmit(event);
  });
}

async function renderProductsForBuyer() {
  const container = document.querySelector('[data-buyer-list]');
  if (!container) return;
  const user = requireAuth();
  if (!user) return;

  container.innerHTML = renderBuyerProductsLoadingState();
  const currentUserId = normalizeUserIdentifier(user.id || user.uid || auth.currentUser?.uid || user.email || user.name || 'guest').toLowerCase();

  const renderFromItems = (items) => {
    const visibleItems = items.filter((item) => {
      const normalized = normalizeProduct(item);
      const productOwnerId = normalizeUserIdentifier(normalized.ownerId || normalized.sellerId || '').toLowerCase();
      const sellerName = normalizeUserIdentifier(normalized.seller || '').toLowerCase();
      const userName = normalizeUserIdentifier(user.name || '').toLowerCase();
      return productOwnerId !== currentUserId && sellerName !== userName;
    });

    if (!visibleItems.length) {
      container.innerHTML = `
        <div class="panel" style="padding: 20px; grid-column: 1 / -1;">
          <p class="muted">Belum ada barang lain yang bisa kamu beli saat ini.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = visibleItems.map((item) => {
      const normalized = normalizeProduct(item);
      const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${escapeHtml(normalized.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
      const sellerRef = normalizeUserIdentifier(normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '');
      const chatHref = getUserChatUrl(normalized.seller, sellerRef || normalized.seller || '', normalized.id, normalized.name);
      const statusStyle = normalized.status === 'Terjual'
        ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;'
        : 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;';
      return `
        <article class="product-card">
          <div class="image">${imageMarkup} <span class="chip">${escapeHtml(normalized.label)}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(normalized.price)}</div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
                <span class="condition">${escapeHtml(normalized.condition)}</span>
                <span class="condition" style="${statusStyle}">${escapeHtml(normalized.status || 'Tersedia')}</span>
              </div>
            </div>
            <h3>${escapeHtml(normalized.name)}</h3>
            <p>${escapeHtml(normalized.description)}</p>
            <div class="seller-row">
              <span>${escapeHtml(normalized.city)}</span>
              <span>Penjual: ${escapeHtml(normalized.seller)}</span>
            </div>
            <div class="card-actions">
              <a class="btn btn-soft" href="${getProductDetailUrl(normalized.id)}">Detail</a>
              <a class="btn btn-primary" href="${chatHref}">Chat penjual</a>
            </div>
          </div>
        </article>
      `;
    }).join('');
  };

  const items = await fetchProductsFromFirebase();
  renderFromItems(items);

  const productsQuery = query(collection(db, 'marketplace_products'), orderBy('createdAt', 'desc'));
  const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
    const liveItems = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderFromItems(liveItems);
  }, (error) => {
    console.error('Realtime buyer products error:', error);
  });

  window.__marketplaceBuyerProductsCleanup = unsubscribe;
}

async function renderMyProducts() {
  const user = requireAuth();
  if (!user) return;

  const container = document.querySelector('[data-my-products-list]');
  if (!container) return;

  container.innerHTML = renderMyProductsLoadingState();

  const renderFromItems = (items) => {
    if (!items.length) {
      container.innerHTML = `
        <div class="panel" style="padding: 20px;">
          <p class="muted">Belum ada barang yang kamu tambah. <a href="jual.html">Tambah barang baru</a></p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item) => {
      const normalized = normalizeProduct(item);
      const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${escapeHtml(normalized.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
      const statusStyle = normalized.status === 'Terjual'
        ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;'
        : 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;';
      return `
        <article class="product-card">
          <div class="image">${imageMarkup} <span class="chip">${escapeHtml(normalized.label)}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(normalized.price)}</div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
                <span class="condition">${escapeHtml(normalized.condition)}</span>
                <span class="condition" style="${statusStyle}">${escapeHtml(normalized.status || 'Tersedia')}</span>
              </div>
            </div>
            <h3>${escapeHtml(normalized.name)}</h3>
            <p>${escapeHtml(normalized.description)}</p>
            <div class="seller-row">
              <span>${escapeHtml(normalized.city)}</span>
            </div>
            <div class="card-actions">
              <a class="btn btn-soft" href="${getProductDetailUrl(normalized.id)}">Detail</a>
              <button class="btn btn-secondary" type="button" data-edit-product="${normalized.id}">Edit</button>
              <button class="btn btn-danger" type="button" data-delete-product="${normalized.id}">Hapus</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    const editButtons = document.querySelectorAll('[data-edit-product]');
    editButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const productId = button.dataset.editProduct;
        window.location.href = `edit.html?id=${encodeURIComponent(productId)}`;
      });
    });

    const deleteButtons = document.querySelectorAll('[data-delete-product]');
    deleteButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const productId = button.dataset.deleteProduct;

        showConfirm({
          title: 'Hapus barang?',
          message: 'Barang ini akan dihapus dari marketplace dan tidak bisa dikembalikan. Lanjutkan?',
          confirmText: 'Hapus barang',
          cancelText: 'Batal',
          tone: 'error',
          onConfirm: async () => {
            try {
              await deleteDoc(doc(db, 'marketplace_products', productId));
              const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed).filter((item) => String(item.id) !== String(productId));
              writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);
              showPopup('Barang berhasil dihapus.', 'Berhasil', 'success');
              await renderMyProducts();
            } catch (error) {
              console.error('Delete product error:', error);
              const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed).filter((item) => String(item.id) !== String(productId));
              writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);
              showPopup('Barang dihapus dari perangkat.', 'Pemberitahuan', 'info');
              await renderMyProducts();
            }
          }
        });
      });
    });
  };

  const items = await fetchMyProductsFromFirebase(user);
  renderFromItems(items);

  const productsQuery = query(collection(db, 'marketplace_products'), where('ownerId', '==', user.id || user.uid || auth.currentUser?.uid || ''));
  const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
    const liveItems = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderFromItems(liveItems.length ? liveItems : items);
  }, (error) => {
    console.error('Realtime my-products error:', error);
  });

  window.__marketplaceMyProductsCleanup = unsubscribe;
}

function findUserByIdentifier(value) {
  const target = normalizeUserIdentifier(value || '').toLowerCase();
  if (!target) return null;

  const users = readStorage(STORAGE_KEYS.USERS, []);
  return users.find((user) => {
    const candidates = [user?.id, user?.uid, user?.email, user?.name, user?.username].map((entry) => normalizeUserIdentifier(entry || '').toLowerCase());
    return candidates.includes(target);
  }) || null;
}

function renderProfile() {
  const user = requireAuth();
  if (!user) return;

  const nameField = document.querySelector('#fullName');
  const usernameField = document.querySelector('#username');
  const emailField = document.querySelector('#email');
  const phoneField = document.querySelector('#phone');
  const bioField = document.querySelector('#bio');
  const cityField = document.querySelector('#alamat');

  if (nameField) nameField.value = user.name || '';
  if (usernameField) usernameField.value = user.username || (user.name || 'user').toLowerCase().replace(/\s+/g, '');
  if (emailField) emailField.value = user.email || '';
  if (phoneField) phoneField.value = user.phone || '';
  if (bioField) bioField.value = user.bio || '';
  if (cityField) cityField.value = user.city || user.address || user.location || '';

  const form = document.querySelector('[data-profile-form]');
  if (!form) return;

  const photoInput = form.querySelector('[name="profilePhoto"]');
  const photoPreview = form.querySelector('[data-profile-photo-preview]');
  const previewImage = photoPreview ? photoPreview.querySelector('img') : null;
  const fileNameLabel = form.querySelector('[data-profile-file-name]');
  const selectPhotoButton = form.querySelector('[data-profile-select-button]');
  const submitButton = form.querySelector('button[type="submit"]');

  const updateSelectedFileLabel = (file) => {
    if (!fileNameLabel) return;
    fileNameLabel.textContent = file ? `Terpilih: ${file.name}` : '';
  };

  const syncProfilePhotoPreview = (photoUrl) => {
    if (!photoPreview) return;
    const resolvedPhoto = photoUrl || getUserPhotoUrl(user);
    if (resolvedPhoto) {
      photoPreview.classList.add('has-photo');
      if (previewImage) {
        previewImage.src = resolvedPhoto;
        previewImage.hidden = false;
      }
    } else {
      photoPreview.classList.remove('has-photo');
      if (previewImage) previewImage.hidden = true;
    }
  };

  if (selectPhotoButton && photoInput) {
    selectPhotoButton.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];

      if (!file) {
        updateSelectedFileLabel(null);
        return;
      }

      if (!file.type || !file.type.startsWith('image/')) {
        showPopup('File yang dipilih harus berupa gambar (JPG, PNG, atau WebP).', 'Format tidak didukung', 'error');
        photoInput.value = '';
        updateSelectedFileLabel(null);
        return;
      }

      if (file.size > PROFILE_PHOTO_MAX_SOURCE_BYTES) {
        showPopup('Ukuran foto maksimal 2 MB. Silakan pilih foto yang lebih kecil.', 'Foto terlalu besar', 'error');
        photoInput.value = '';
        updateSelectedFileLabel(null);
        return;
      }

      updateSelectedFileLabel(file);

      // Preview only — this is NOT what gets saved. The actual compressed
      // version is generated by uploadProfilePhoto() on submit.
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const result = String(loadEvent.target?.result || '');
        if (result) {
          syncProfilePhotoPreview(result);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (submitButton) {
    submitButton.style.position = 'relative';
    submitButton.style.zIndex = '2';
    submitButton.style.pointerEvents = 'auto';
  }

  updateSelectedFileLabel(photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null);
  syncProfilePhotoPreview(getUserPhotoUrl(user));

  const locationButton = form.querySelector('[data-use-location]');
  const locationStatus = form.querySelector('[data-location-status]');
  const latField = form.querySelector('[name="latitude"]');
  const lngField = form.querySelector('[name="longitude"]');
  const mapPreview = form.querySelector('[data-location-map-preview]');

  const updateLocationPreview = (lat, lng) => {
    if (!mapPreview) return;
    const latitude = Number(lat || 0);
    const longitude = Number(lng || 0);
    if (!latitude || !longitude) {
      mapPreview.innerHTML = '<div class="map-placeholder">📍</div>';
      return;
    }

    const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=14&output=embed`;
    mapPreview.innerHTML = `<iframe title="Preview lokasi profil" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe>`;
  };

  if (latField) latField.value = user.latitude || '';
  if (lngField) lngField.value = user.longitude || '';
  if (user.latitude && user.longitude) {
    updateLocationPreview(user.latitude, user.longitude);
  }

  if (locationButton) {
    locationButton.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showPopup('Browser Anda tidak mendukung pembacaan lokasi otomatis.', 'Lokasi tidak tersedia', 'error');
        if (locationStatus) locationStatus.textContent = 'Browser tidak mendukung';
        return;
      }

      if (locationStatus) locationStatus.textContent = 'Mencari lokasi...';
      locationButton.disabled = true;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = Number(position.coords.latitude || 0);
          const longitude = Number(position.coords.longitude || 0);

          if (latField) latField.value = String(latitude.toFixed(6));
          if (lngField) lngField.value = String(longitude.toFixed(6));
          updateLocationPreview(latitude, longitude);

          if (locationStatus) locationStatus.textContent = 'Lokasi berhasil dipakai';
          showPopup('Lokasi Anda berhasil dipakai di profil.', 'Lokasi diperbarui', 'success');
          locationButton.disabled = false;
        },
        (error) => {
          console.warn('Geolocation error:', error);
          if (locationStatus) locationStatus.textContent = 'Gagal mengambil lokasi';
          showPopup('Tidak dapat mengambil lokasi otomatis. Silakan izinkan akses lokasi browser Anda.', 'Lokasi gagal', 'error');
          locationButton.disabled = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const file = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
    const userId = user.id || user.uid || auth.currentUser?.uid || '';

    // Start from the current canonical photo (single field) — never carry
    // forward legacy duplicate fields (`photo`, `profilePhotoUrl`, `avatarUrl`).
    let photoUrl = getUserPhotoUrl(user) || '';

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Menyimpan...';
    }

    try {
      if (file) {
        photoUrl = await uploadProfilePhoto(file);
      }

      // Strip legacy photo-related keys out of the spread so they can never
      // silently re-enter the saved object.
      const { photo: _legacyPhoto, profilePhotoUrl: _legacyProfilePhotoUrl, avatarUrl: _legacyAvatarUrl, ...restUser } = user;

      const updatedUser = {
        ...restUser,
        name: formData.get('fullName') || user.name,
        username: formData.get('username') || user.username,
        email: formData.get('email') || user.email,
        phone: formData.get('phone') || user.phone,
        bio: formData.get('bio') || user.bio,
        city: formData.get('alamat') || user.city || user.address || user.location,
        address: formData.get('alamat') || user.address || user.city || user.location,
        location: formData.get('alamat') || user.location || user.address || user.city,
        latitude: formData.get('latitude') || user.latitude || '',
        longitude: formData.get('longitude') || user.longitude || '',
        photoUrl
      };

      if (userId) {
        // Write the canonical field AND explicitly delete the old duplicate
        // fields from Firestore itself (deleteField), so previously-bloated
        // documents shrink back down instead of staying triplicated forever.
        await setDoc(doc(db, 'marketplace_users', userId), {
          ...updatedUser,
          photo: deleteField(),
          profilePhotoUrl: deleteField(),
          avatarUrl: deleteField()
        }, { merge: true });
      }

      const users = readStorage(STORAGE_KEYS.USERS, []);
      const index = users.findIndex((item) => (item.email || '').toLowerCase() === (user.email || '').toLowerCase() || (item.id || item.uid || '').toLowerCase() === (userId || '').toLowerCase());
      if (index >= 0) {
        users[index] = updatedUser;
      } else {
        users.push(updatedUser);
      }
      writeStorage(STORAGE_KEYS.USERS, users);
      setCurrentUser(updatedUser);
      await syncSellerPhotosAcrossProducts(updatedUser);
      hydrateUserProfileUI();
      syncProfilePhotoPreview(photoUrl);
      showPopup('Profil berhasil diperbarui.', 'Berhasil', 'success');
    } catch (error) {
      console.error('Update profile photo error:', error);
      showPopup(error.message || 'Gagal memperbarui foto profil. Silakan coba lagi.', 'Gagal', 'error');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Simpan perubahan';
      }
    }
  });
}

function bindPasswordToggles() {
  const toggles = document.querySelectorAll('[data-password-toggle]');
  toggles.forEach((button) => {
    const wrapper = button.closest('.password-field');
    const input = wrapper ? wrapper.querySelector('input') : null;
    if (!input) return;

    button.addEventListener('click', () => {
      const isPasswordHidden = input.type === 'password';
      input.type = isPasswordHidden ? 'text' : 'password';
      button.textContent = isPasswordHidden ? '🙈' : '👁';
      button.setAttribute('aria-label', isPasswordHidden ? 'Sembunyikan password' : 'Tampilkan password');
      button.setAttribute('title', isPasswordHidden ? 'Sembunyikan password' : 'Tampilkan password');
    });
  });
}

function bindHeaderActionsMenu() {
  const headerToggle = document.querySelector('.header-menu-toggle');
  const headerActions = document.querySelector('[data-header-actions]');
  const mobileMenuPanel = document.querySelector('[data-mobile-menu-panel]');
  if (!headerToggle) return;

  const syncState = (isOpen) => {
    headerToggle.classList.toggle('is-active', isOpen);
    headerToggle.setAttribute('aria-expanded', String(isOpen));
    if (headerActions) {
      headerActions.classList.toggle('is-open', isOpen);
    }
    if (mobileMenuPanel) {
      mobileMenuPanel.classList.toggle('is-open', isOpen);
    }
  };

  headerToggle.addEventListener('click', () => {
    const isOpen = !headerToggle.classList.contains('is-active');
    syncState(isOpen);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    const clickedInsideMenu = mobileMenuPanel ? mobileMenuPanel.contains(target) : false;
    const clickedInsideActions = headerActions ? headerActions.contains(target) : false;
    if (!clickedInsideMenu && !clickedInsideActions && !headerToggle.contains(target)) {
      syncState(false);
    }
  });

  if (mobileMenuPanel) {
    mobileMenuPanel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => syncState(false));
    });
  }
}

function bindBackButton() {
  const backButton = document.querySelector('[data-back-button]');
  if (!backButton) return;

  backButton.addEventListener('click', () => {
    if (document.referrer && document.referrer.startsWith(window.location.origin)) {
      window.history.back();
      return;
    }

    window.location.href = 'index.html';
  });
}

function renderProductGallery(images, name) {
  const gallery = document.querySelector('[data-detail-gallery]');
  if (!gallery) return;

  const validImages = (images || []).filter(Boolean);
  const fallback = `<div class="detail-slide active"><div class="detail-image-fallback">${escapeHtml(name?.charAt(0)?.toUpperCase() || 'G')}</div></div>`;

  if (!validImages.length) {
    gallery.innerHTML = fallback;
    return;
  }

  const slides = validImages.map((src, index) => `
    <div class="detail-slide ${index === 0 ? 'active' : ''}">
      <img src="${src}" alt="${escapeHtml(name || 'Gambar produk')}" />
    </div>
  `).join('');

  gallery.innerHTML = `
    <div class="detail-gallery-track">${slides}</div>
    <button class="detail-gallery-btn prev" type="button" aria-label="Gambar sebelumnya">‹</button>
    <button class="detail-gallery-btn next" type="button" aria-label="Gambar berikutnya">›</button>
    <div class="detail-gallery-dots">${validImages.map((_, index) => `<span class="detail-dot ${index === 0 ? 'active' : ''}" data-index="${index}"></span>`).join('')}</div>
  `;

  const slidesEls = gallery.querySelectorAll('.detail-slide');
  const dots = gallery.querySelectorAll('.detail-dot');
  let activeIndex = 0;

  const updateGallery = (nextIndex) => {
    activeIndex = (nextIndex + slidesEls.length) % slidesEls.length;
    slidesEls.forEach((slide, index) => slide.classList.toggle('active', index === activeIndex));
    dots.forEach((dot, index) => dot.classList.toggle('active', index === activeIndex));
  };

  gallery.querySelector('.detail-gallery-btn.prev')?.addEventListener('click', () => updateGallery(activeIndex - 1));
  gallery.querySelector('.detail-gallery-btn.next')?.addEventListener('click', () => updateGallery(activeIndex + 1));
  dots.forEach((dot) => {
    dot.addEventListener('click', () => updateGallery(Number(dot.dataset.index || 0)));
  });
}

async function renderProductDetail() {
  const page = document.body.dataset.page;
  if (page !== 'product.html' && page !== 'user-product.html') return;

  bindBackButton();

  const isUserPage = page === 'user-product.html';
  if (isUserPage) {
    const user = requireAuth();
    if (!user) return;
  }

  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');
  if (!productId) {
    showPopup('Produk tidak ditemukan.', 'Tidak ditemukan', 'error');
    window.location.href = 'index.html';
    return;
  }

  let product = null;
  try {
    const snapshot = await getDoc(doc(db, 'marketplace_products', productId));
    product = snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    product = null;
  }

  if (!product) {
    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
    product = localProducts.find((item) => String(item.id) === String(productId)) || null;
  }

  if (!product) {
    showPopup('Produk tidak ditemukan.', 'Tidak ditemukan', 'error');
    window.location.href = 'index.html';
    return;
  }

  const normalized = normalizeProduct(product);
  renderProductGallery(normalized.images || [normalized.imageUrl || normalized.image], normalized.name);

  const detailImage = document.querySelector('[data-detail-image]');
  if (detailImage) {
    const image = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${escapeHtml(normalized.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
    detailImage.innerHTML = image;
  }

  const detailPrice = document.querySelector('[data-detail-price]');
  if (detailPrice) detailPrice.textContent = formatCurrency(normalized.price);

  const detailCondition = document.querySelector('[data-detail-condition]');
  if (detailCondition) detailCondition.textContent = normalized.condition;

  const detailStatus = document.querySelector('[data-detail-status]');
  if (detailStatus) detailStatus.textContent = normalized.status || 'Tersedia';

  const detailName = document.querySelector('[data-detail-name]');
  if (detailName) detailName.textContent = normalized.name;

  const detailDescription = document.querySelector('[data-detail-description]');
  if (detailDescription) detailDescription.textContent = normalized.description;

  const detailCategory = document.querySelector('[data-detail-category]');
  if (detailCategory) detailCategory.textContent = normalized.label;

  const detailCity = document.querySelector('[data-detail-city]');
  if (detailCity) detailCity.textContent = normalized.city;

  const detailSeller = document.querySelector('[data-detail-seller]');
  if (detailSeller) detailSeller.textContent = normalized.seller;

  // Seller avatar on the product detail page: resolve via
  // resolveUserForMarketplaceLookup so it falls back to Firestore when the
  // seller isn't cached in this browser's localStorage yet (e.g. a buyer
  // opening the marketplace for the very first time on a new device).
  // findUserByIdentifier() alone (localStorage-only) was the cause of
  // seller photos silently not appearing on other devices.
  const detailSellerInitial = document.querySelector('[data-detail-seller-initial]');
  if (detailSellerInitial) {
    const sellerIdentifier = normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '';
    const sellerUser = await resolveUserForMarketplaceLookup(normalized.seller, sellerIdentifier);
    const sellerPhoto = normalized.sellerPhotoUrl || getUserPhotoUrl(sellerUser || null);
    if (sellerPhoto) {
      detailSellerInitial.innerHTML = `<img src="${escapeHtml(sellerPhoto)}" alt="${escapeHtml(normalized.seller)}" />`;
      detailSellerInitial.classList.add('has-photo');
    } else {
      detailSellerInitial.textContent = normalized.sellerInitial;
      detailSellerInitial.classList.remove('has-photo');
    }
  }

  const detailLocation = document.querySelector('[data-detail-location]');
  if (detailLocation) detailLocation.value = normalized.address || normalized.city;

  const detailMap = document.querySelector('[data-detail-map]');
  if (detailMap) {
    const latitude = Number(normalized.latitude || 0);
    const longitude = Number(normalized.longitude || 0);
    if (latitude && longitude) {
      const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=14&output=embed`;
      detailMap.innerHTML = `<iframe title="Lokasi produk" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe>`;
    } else {
      detailMap.innerHTML = '<div class="map-placeholder">📍</div>';
    }
  }

  const detailStory = document.querySelector('[data-detail-story]');
  if (detailStory) {
    const storyLabel = (normalized.storyType || 'barang-kenangan').replace(/-/g, ' ');
    detailStory.textContent = storyLabel;
  }

  const detailSummary = document.querySelector('[data-detail-summary]');
  if (detailSummary) {
    const storySentence = normalized.storyNote ? `Cerita singkat: ${normalized.storyNote}. ` : '';
    detailSummary.value = `${storySentence}Barang ini termasuk kategori ${normalized.label}. Kondisi ${normalized.condition}. Dapat ditanyakan lebih lanjut melalui chat agar proses transaksi lebih aman.`;
  }

  const chatButton = document.querySelector('[data-chat-product]');
  if (chatButton) {
    const currentUserData = currentUser();
    const sellerRef = normalizeUserIdentifier(normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '');
    const chatUrl = getUserChatUrl(normalized.seller, sellerRef || normalized.seller || '', normalized.id, normalized.name);

    if (!isUserPage && !currentUserData) {
      chatButton.style.display = '';
      chatButton.href = getAuthTarget();
      chatButton.removeAttribute('aria-disabled');
      chatButton.removeAttribute('tabindex');
      return;
    }

    const currentUserId = getCurrentUserIdentifier();
    const user = currentUserData || requireAuth();
    if (!user) return;

    const currentUserName = normalizeUserIdentifier((user || {}).name || '');
    const productOwnerId = normalizeUserIdentifier(normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '');
    const productOwnerName = normalizeUserIdentifier(normalized.seller || '');
    const isProductOwner = Boolean(
      (currentUserId && productOwnerId && normalizeUserIdentifier(currentUserId).toLowerCase() === normalizeUserIdentifier(productOwnerId).toLowerCase()) ||
      (currentUserName && productOwnerName && normalizeUserIdentifier(currentUserName).toLowerCase() === normalizeUserIdentifier(productOwnerName).toLowerCase())
    );

    if (isProductOwner) {
      chatButton.style.display = 'none';
      chatButton.removeAttribute('href');
      chatButton.setAttribute('aria-disabled', 'true');
      chatButton.setAttribute('tabindex', '-1');
    } else {
      chatButton.style.display = '';
      chatButton.href = isUserPage ? chatUrl : (getAuthTarget() && !currentUserData ? getAuthTarget() : chatUrl);
      chatButton.removeAttribute('aria-disabled');
      chatButton.removeAttribute('tabindex');
    }
  }
}

function handleSidebarState() {
  const current = document.body.dataset.page;
  const links = document.querySelectorAll('.sidebar nav a');
  links.forEach((link) => {
    const target = (link.getAttribute('href') || '').split('/').pop();
    if (current && target === current) {
      link.classList.add('active');
    }
  });
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Logout gagal:', error);
  } finally {
    clearCurrentUser();
    const target = window.location.pathname.includes('/user/') ? '../index.html' : 'index.html';
    window.location.href = target;
  }
}

function bindLogoutButtons() {
  const buttons = document.querySelectorAll('[data-logout-button]');
  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      showConfirm({
        title: 'Keluar dari akun?',
        message: 'Anda akan keluar dari akun marketplace dan diarahkan kembali ke halaman utama.',
        confirmText: 'Keluar',
        cancelText: 'Batal',
        tone: 'warning',
        onConfirm: () => {
          handleLogout();
        }
      });
    });
  });
}

function bindRepairSellerPhotosButton() {
  const button = document.querySelector('[data-repair-seller-photos]');
  if (!button) return;

  button.addEventListener('click', async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Memperbaiki avatar...';

    try {
      const updatedCount = await repairMarketplaceSellerPhotos({ silent: false });
      if (updatedCount > 0) {
        showPopup(`Berhasil memperbarui avatar untuk ${updatedCount} produk lama.`, 'Berhasil', 'success');
      } else {
        showPopup('Semua produk sudah memiliki avatar seller yang lengkap.', 'Info', 'info');
      }
    } catch (error) {
      console.error('Repair seller photos failed:', error);
      showPopup('Gagal memperbaiki avatar produk lama. Silakan coba lagi nanti.', 'Gagal', 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

async function init() {
  await migrateExistingProductSellerPhotos();
  ensureDemoData();
  handleSidebarState();
  bindLogoutButtons();
  bindMobileSidebar();
  bindHeaderActionsMenu();
  bindPasswordToggles();
  hydrateUserProfileUI();

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      await syncCurrentUserFromFirebase(firebaseUser, localStorage.getItem('gamon_marketplace_remember_me') === '1');
      hydrateUserProfileUI();

      if (!window.__marketplaceGlobalChatUnsubscribe) {
        const currentUserId = getCurrentUserIdentifier();
        if (currentUserId) {
          window.__marketplaceGlobalChatUnsubscribe = subscribeToGlobalChatNotifications(currentUserId);
        }
      }
    }
  });

  const page = document.body.dataset.page;
  bindKineticHeroIfNeeded();

  if (page === 'login' || page === 'register') {
    bindAuthPage();
    return;
  }

  if (page === 'dashboard.html') {
    await renderDashboard();
    return;
  }

  if (page === 'jual.html') {
    await bindSellForm();
    return;
  }

  if (page === 'edit.html') {
    await bindEditForm();
    return;
  }

  if (page === 'beli.html') {
    await renderProductsForBuyer();
    return;
  }

  if (page === 'my-products.html') {
    await renderMyProducts();
    return;
  }

  if (page === 'profil.html') {
    renderProfile();
    return;
  }

  if (page === 'chat.html') {
    await renderChat();
    return;
  }

  if (page === 'product.html' || page === 'user-product.html') {
    await renderProductDetail();
    return;
  }

  await renderHomeProducts();
}

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', () => {
  if (window.__marketplaceChatCleanup) window.__marketplaceChatCleanup();
  if (window.__marketplaceHomeProductsCleanup) window.__marketplaceHomeProductsCleanup();
  if (window.__marketplaceBuyerProductsCleanup) window.__marketplaceBuyerProductsCleanup();
  if (window.__marketplaceMyProductsCleanup) window.__marketplaceMyProductsCleanup();
  if (window.__marketplaceGlobalChatUnsubscribe) window.__marketplaceGlobalChatUnsubscribe();
});