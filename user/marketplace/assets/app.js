import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, updateDoc, writeBatch, increment, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ',
  authDomain: 'gamon-tawing.firebaseapp.com',
  projectId: 'gamon-tawing',
  storageBucket: 'gamon-tawing.firebasestorage.app',
  messagingSenderId: '370162915989',
  appId: '1:370162915989:web:76779062da83aa0c5c999c',
  measurementId: 'G-DDRQKDZXV7'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_ACCOUNT_EMAIL = 'muhamadabelldeskiawan@gmail.com';

const STORAGE_KEYS = {
  USERS: 'gamon_marketplace_users',
  PRODUCTS: 'gamon_marketplace_products',
  USER: 'gamon_marketplace_current_user',
  LOGIN_ATTEMPTS: 'gamon_marketplace_login_attempts'
};

const productSeed = [];

const demoUsers = [];

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
        <div class="modal-icon" data-confirm-icon><span class="material-symbols-outlined">warning</span></div>
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
    const iconMap = {
      error: 'delete',
      success: 'check_circle',
      warning: 'warning'
    };
    const iconName = iconMap[tone] || 'warning';
    iconEl.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
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

  if (String(user.email || '').toLowerCase() === ADMIN_ACCOUNT_EMAIL) {
    clearCurrentUser();
    return null;
  }

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
  Object.entries(STORAGE_KEYS).forEach(([_, key]) => {
    if (key === STORAGE_KEYS.PRODUCTS) return;
    const current = readStorage(key, null);
    if (!Array.isArray(current)) return;

    const cleaned = current.filter((item) => {
      const name = String(item?.name || '').toLowerCase();
      return !name.includes('hoodie putih premium')
        && !name.includes('jam tangan casio')
        && !name.includes('set kado anniversary')
        && !name.includes('jaket oversize');
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
  return window.location.pathname.includes('/user/marketplace/');
}

function getProductDetailUrl(productId) {
  const id = encodeURIComponent(productId ?? '');
  return `product.html?id=${id}`;
}

function safeMarketplaceImageUrl(value) {
  const imageUrl = String(value || '').trim();
  return /^https:\/\//i.test(imageUrl) || /^data:image\/(?:jpeg|png|webp);base64,/i.test(imageUrl) ? imageUrl : '';
}

function getShippingAddressFromUser(user) {
  const shipping = user?.shipping || {};
  const latitudeSource = shipping.latitude ?? user?.latitude;
  const longitudeSource = shipping.longitude ?? user?.longitude;
  const latitude = Number(latitudeSource);
  const longitude = Number(longitudeSource);
  const validCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    latitudeSource !== '' && latitudeSource !== null && latitudeSource !== undefined &&
    longitudeSource !== '' && longitudeSource !== null && longitudeSource !== undefined;
  const address = {
    recipientName: String(shipping.recipientName || user?.name || ''),
    phone: String(shipping.phone || user?.phone || ''),
    address: String(shipping.address || user?.address || user?.location || ''),
    city: String(shipping.city || user?.city || ''),
    province: String(shipping.province || ''),
    postalCode: String(shipping.postalCode || ''),
    note: String(shipping.note || ''),
    latitude: validCoordinates ? latitude : null,
    longitude: validCoordinates ? longitude : null,
    mapsUrl: validCoordinates ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` : ''
  };
  address.complete = Boolean(address.recipientName.trim() && address.phone.trim() && address.address.trim() && validCoordinates);
  address.outsideIndonesia = validCoordinates && (latitude < -11.2 || latitude > 6.2 || longitude < 95 || longitude > 141);
  return address;
}

async function waitForMarketplaceFirebaseUser() {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribe();
      resolve(firebaseUser);
    }, () => resolve(null));
  });
}

async function getMarketplaceCartUserId() {
  const cachedUser = currentUser() || requireAuth();
  if (!cachedUser) return '';
  const firebaseUser = await waitForMarketplaceFirebaseUser();
  if (!firebaseUser) {
    window.location.href = getAuthTarget();
    return '';
  }
  return firebaseUser.uid;
}

async function addProductToCart(productId, quantity = 1, openCart = false) {
  try {
    const userId = await getMarketplaceCartUserId();
    if (!userId) return;
    const productRef = doc(db, 'marketplace_products', String(productId));
    const productSnapshot = await getDoc(productRef);
    if (!productSnapshot.exists()) throw new Error('Produk sudah tidak tersedia.');
    const product = productSnapshot.data();
    const stockValue = Number(product.stock);
    const stock = Number.isInteger(stockValue) && stockValue >= 0 ? stockValue : 1;
    if (!stock) throw new Error('Stok produk habis.');

    const cartRef = doc(db, 'marketplace_carts', userId);
    const cartSnapshot = await getDoc(cartRef);
    const items = cartSnapshot.exists() && Array.isArray(cartSnapshot.data().items) ? cartSnapshot.data().items : [];
    const index = items.findIndex((item) => String(item.productId) === String(productId));
    const previousQty = index >= 0 ? Number(items[index].qty || 0) : 0;
    const requestedQty = Math.max(1, Math.min(99, Math.trunc(Number(quantity) || 1)));
    const nextQty = Math.min(stock, previousQty + requestedQty);
    const nextItems = [...items];
    if (index >= 0) nextItems[index] = { productId: String(productId), qty: nextQty };
    else {
      if (items.length >= 30) throw new Error('Keranjang maksimal 30 jenis barang.');
      nextItems.push({ productId: String(productId), qty: nextQty });
    }

    await setDoc(cartRef, { items: nextItems, updatedAt: Date.now() });
    if (nextQty < previousQty + requestedQty) showToast(`Jumlah dibatasi ke stok tersedia: ${stock}.`, 'info');
    else showToast('Barang ditambahkan ke keranjang.', 'success');
    if (openCart) window.location.href = 'keranjang.html';
  } catch (error) {
    console.error('[marketplace] gagal menambahkan barang ke keranjang:', error);
    showPopup(error.message || 'Barang gagal ditambahkan ke keranjang.', 'Keranjang', 'error');
  }
}

function bindAddToCartButtons(container = document) {
  if (container.dataset?.cartButtonsBound === 'true') return;
  if (container.dataset) container.dataset.cartButtonsBound = 'true';
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-add-cart]');
    if (!button || !container.contains(button)) return;
    const user = currentUser();
    if (!user) {
      window.location.href = getAuthTarget();
      return;
    }
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Menambahkan...';
    await addProductToCart(button.dataset.addCart, 1, button.dataset.buyNow === 'true');
    button.disabled = false;
    button.textContent = originalText;
  });
}

function subscribeToCartBadge() {
  const badges = document.querySelectorAll('[data-cart-count]');
  if (!badges.length || !auth.currentUser) return () => {};
  const userId = auth.currentUser.uid;
  const unsubscribe = onSnapshot(doc(db, 'marketplace_carts', userId), (snapshot) => {
    const items = snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
    const count = items.reduce((total, item) => total + Math.max(0, Number(item.qty || 0)), 0);
    badges.forEach((badge) => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    });
  }, (error) => console.error('[marketplace] badge keranjang gagal dimuat:', error));
  return unsubscribe;
}

function getBuyerChatUrl(productId = '', productName = '', orderId = '') {
  const params = new URLSearchParams();
  if (productId) {
    params.set('productId', String(productId));
  }
  if (productName) {
    params.set('productName', String(productName));
  }
  if (orderId) params.set('orderId', String(orderId));
  const search = params.toString();
  return `chat.html${search ? `?${search}` : ''}`;
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
  // saves their profile in renderProfile).
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
  return currentPath.includes('/user/marketplace/') ? 'login.html' : 'login.html';
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

function cacheMarketplaceProducts(items) {
  try {
    writeStorage(STORAGE_KEYS.PRODUCTS, items);
  } catch (error) {
    console.warn('[marketplace] cache produk tidak dapat disimpan:', error);
  }
}

async function fetchProductsFromFirebase() {
  try {
    const snapshot = await getDocs(collection(db, 'marketplace_products'));
    const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    cacheMarketplaceProducts(items);
    console.log('[marketplace] produk dimuat:', items.length);
    if (snapshot.metadata.fromCache) {
      window.__marketplaceProductsError = {
        code: 'unavailable',
        message: 'Firestore belum memberikan data terbaru; katalog memakai data tersimpan.'
      };
      window.__marketplaceProductsFromCache = items.length > 0;
      return items;
    }
    delete window.__marketplaceProductsError;
    delete window.__marketplaceProductsFromCache;
    return items;
  } catch (error) {
    console.error('[marketplace] gagal memuat produk dari Firestore:', error);
    window.__marketplaceProductsError = {
      code: error?.code || 'unknown',
      message: error?.message || 'Terjadi kesalahan saat membaca katalog.'
    };
    const cached = readStorage(STORAGE_KEYS.PRODUCTS, []);
    window.__marketplaceProductsFromCache = cached.length > 0;
    return cached;
  }
}

function marketplaceLoadErrorMarkup() {
  const error = window.__marketplaceProductsError;
  if (!error) return '';

  const cacheLabel = window.__marketplaceProductsFromCache
    ? '<p style="margin: 8px 0 0;">Menampilkan data tersimpan di perangkat.</p>'
    : '';
  return `
    <div class="panel" role="alert" style="margin-bottom: 14px; padding: 14px; color: #991b1b; background: #fff1f2; border: 1px solid #fecdd3;">
      <strong>Gagal memuat katalog (${escapeHtml(error.code)}).</strong>
      <p style="margin: 6px 0 0;">${escapeHtml(error.message)}</p>
      ${cacheLabel}
      <button class="btn btn-secondary" type="button" data-marketplace-retry style="margin-top: 10px;">Muat ulang</button>
    </div>
  `;
}

function normalizeMarketplaceProducts(items) {
  return items.flatMap((item) => {
    try {
      return [normalizeProduct(item)];
    } catch (error) {
      console.error('[marketplace] produk dilewati karena data tidak valid:', item?.id, error);
      return [];
    }
  });
}

function bindMarketplaceRetry(container, reload) {
  if (container.dataset.marketplaceRetryBound === 'true') return;
  container.dataset.marketplaceRetryBound = 'true';
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-marketplace-retry]');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Memuat...';
    await reload();
  });
}

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
  if (category === 'pakaian') return 'checkroom';
  if (category === 'aksesori') return 'watch';
  return 'card_giftcard';
}

function getCreatedAtMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value.seconds === 'number') {
      return Number(value.seconds) * 1000 + Math.floor((Number(value.nanoseconds || 0) / 1e6));
    }
  }
  return 0;
}

function getMarketplaceSellerDisplayName() {
  return 'Marketplace Mantan';
}

function normalizeProduct(item) {
  const rawImages = Array.isArray(item?.images)
    ? item.images.filter(Boolean)
    : Array.isArray(item?.imageUrls)
      ? item.imageUrls.filter(Boolean)
      : item?.imageUrl
        ? [item.imageUrl]
        : [];

  const parsedImages = rawImages.map(safeMarketplaceImageUrl).filter(Boolean);
  const primaryImage = parsedImages[0] || safeMarketplaceImageUrl(item?.imageUrl) || safeMarketplaceImageUrl(item?.image) || '';
  const latitude = item.latitude ?? item.lat ?? '';
  const longitude = item.longitude ?? item.lng ?? '';
  const sellerPhotoUrl = item.sellerPhotoUrl || item.sellerPhoto || item.avatarUrl || item.photoUrl || item.profilePhotoUrl || '';
  const sellerName = getMarketplaceSellerDisplayName();
  const stockValue = Number(item.stock);
  const stock = Number.isInteger(stockValue) && stockValue >= 0 ? stockValue : 1;
  const soldValue = Number(item.sold);
  const sold = Number.isInteger(soldValue) && soldValue >= 0 ? soldValue : 0;

  return {
    id: item.id || item.slug || `p-${Date.now()}`,
    name: item.name || 'Barang baru',
    category: item.category || 'barang',
    price: Number(item.price || 0),
    condition: item.condition || 'Layak pakai',
    status: stock > 0 ? 'Tersedia' : 'Habis',
    stock,
    sold,
    image: primaryImage || productEmoji(item.category),
    label: item.label || productLabel(item.category),
    city: item.city || item.address || 'Jakarta',
    address: item.address || item.location || item.city || 'Jakarta',
    seller: sellerName,
    sellerInitial: 'M',
    sellerPhotoUrl: '',
    description: item.description || 'Deskripsi produk belum tersedia.',
    imageUrl: primaryImage || item.imageUrl || '',
    images: parsedImages.length ? parsedImages : [primaryImage || ''],
    createdAt: getCreatedAtMs(item.createdAt),
    ownerId: item.ownerId || item.owner_id || 'admin',
    sellerId: item.sellerId || item.ownerId || item.owner_id || 'admin',
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

function getCurrentUserIdentifier() {
  const user = currentUser() || requireAuth();
  if (!user) return '';
  return normalizeUserIdentifier(auth.currentUser?.uid || user.uid || user.id || user.email || user.name || 'guest');
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

  let isInitialSnapshot = true;
  let previousUnread = 0;

  try {
    const unsubscribe = onSnapshot(
      query(collection(db, 'marketplace_chats'), where('buyerId', '==', currentUserId)),
      (snapshot) => {
        let unread = 0;
        let latest = null;
        snapshot.docs.forEach((threadDoc) => {
          const summary = threadDoc.data() || {};
          const threadUnread = Math.max(0, Number(summary.unreadForUser || 0));
          unread += threadUnread;
          if (threadUnread > 0 && (!latest || getCreatedAtMs(summary.lastMessageAt) > getCreatedAtMs(latest.lastMessageAt))) {
            latest = summary;
          }
        });

        if (!isInitialSnapshot && unread > previousUnread && document.body.dataset.page !== 'chat.html') {
          const preview = String(latest?.lastMessage || '').slice(0, 80);
          const label = latest?.productName ? `Marketplace Mantan (${latest.productName})` : 'Marketplace Mantan';
          showToast(`${label}: ${preview}`, 'info');
        }
        previousUnread = unread;
        isInitialSnapshot = false;
        updateChatBadges(unread);
      },
      (error) => {
        console.error('[marketplace chat] gagal memuat ringkasan chat:', error);
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error('[marketplace chat] gagal membuka listener ringkasan:', error);
    return () => {};
  }
}

function renderChatMessages(container, messages, currentUserId) {
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = '<div class="empty-state">Belum ada pesan. Mulai percakapan sekarang.</div>';
    return;
  }

  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  let previousDate = '';
  container.innerHTML = messages.map((message) => {
    const createdAt = Number(message.createdAt || 0);
    const date = createdAt ? new Date(createdAt) : new Date();
    const dateKey = date.toLocaleDateString('sv-SE');
    const dateDivider = dateKey !== previousDate
      ? `<div class="chat-date-divider"><span>${escapeHtml(date.toLocaleDateString('id-ID', { dateStyle: 'full' }))}</span></div>`
      : '';
    previousDate = dateKey;
    const senderIsMe = message.senderRole !== 'admin' && message.senderId === currentUserId;
    return `${dateDivider}
      <div class="bubble-message ${senderIsMe ? 'me' : 'other'}">
        <div>${escapeHtml(message.text || '')}</div>
        <small>${escapeHtml(date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))}</small>
      </div>
    `;
  }).join('');
  if (wasNearBottom) container.scrollTop = container.scrollHeight;
}

function buildChatThreadId(userId, { productId = '', orderId = '' } = {}) {
  const clean = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_');
  if (productId) return `${userId}__p_${clean(productId)}`;
  if (orderId) return `${userId}__o_${clean(orderId)}`;
  return `${userId}__general`;
}

async function renderChat() {
  const user = requireAuth();
  if (!user) return;

  const firebaseUser = auth.currentUser || await waitForMarketplaceFirebaseUser();
  if (!firebaseUser) {
    window.location.href = getAuthTarget();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const productIdParam = (params.get('productId') || '').trim();
  const productNameParam = (params.get('productName') || '').trim();
  const orderIdParam = (params.get('orderId') || '').trim();

  const currentUserId = firebaseUser.uid;
  const currentUserName = getSafeUserName(user.name || firebaseUser.displayName || 'Pembeli');
  const currentUserEmail = String(user.email || firebaseUser.email || '');

  const layout = document.querySelector('[data-chat-layout]');
  const listEl = document.querySelector('[data-chat-list]');
  const newGeneralButton = document.querySelector('[data-chat-new-general]');
  const backButton = document.querySelector('[data-chat-back]');
  const titleEl = document.querySelector('[data-chat-title]');
  const contextEl = document.querySelector('[data-chat-product-context]');
  const threadEl = document.querySelector('[data-chat-thread]');
  const composer = document.querySelector('[data-chat-form]');
  const input = composer?.querySelector('textarea');
  const submitButton = composer?.querySelector('button[type="submit"]');
  const statusEl = document.querySelector('[data-chat-status]');
  if (!layout || !listEl || !threadEl || !composer || !input || !submitButton) return;

  let threads = [];
  let draft = null;
  let activeId = '';
  let listeningId = '';
  let messagesUnsubscribe = () => {};
  let threadsUnsubscribe = () => {};
  let isMarkingRead = false;
  let didInitialSelect = false;
  const productMeta = new Map();

  const setStatus = (message) => { if (statusEl) statusEl.textContent = message || ''; };

  const relativeTime = (value) => {
    const time = getCreatedAtMs(value);
    if (!time) return '';
    const elapsed = Math.max(0, Date.now() - time);
    if (elapsed < 60000) return 'Baru saja';
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} mnt`;
    if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} jam`;
    return new Date(time).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  };

  const findThread = (id) => {
    const saved = threads.find((thread) => thread.id === id);
    if (saved) return saved;
    return draft && draft.id === id ? { ...draft, isDraft: true } : null;
  };

  const threadLabel = (thread) => {
    if (thread.productId) {
      const meta = productMeta.get(String(thread.productId));
      return thread.productName || meta?.name || 'Produk';
    }
    if (thread.orderId) return `Pesanan ${thread.orderId}`;
    if (thread.id === currentUserId) return 'Percakapan lama';
    return 'Pertanyaan umum';
  };

  async function loadProductMeta(productId) {
    const key = String(productId || '');
    if (!key) return null;
    if (productMeta.has(key)) return productMeta.get(key);
    productMeta.set(key, null);
    try {
      const snapshot = await getDoc(doc(db, 'marketplace_products', key));
      if (snapshot.exists()) {
        const data = snapshot.data() || {};
        const firstImage = Array.isArray(data.images) ? data.images[0] : '';
        productMeta.set(key, {
          name: String(data.name || ''),
          image: safeMarketplaceImageUrl(data.imageUrl || data.image || firstImage)
        });
      }
    } catch (error) {
      console.error('[marketplace chat] gagal memuat info produk:', key, error);
    }
    renderList();
    renderHeader();
    return productMeta.get(key);
  }

  function renderList() {
    const items = [...threads];
    if (draft && !items.some((thread) => thread.id === draft.id)) items.unshift({ ...draft, isDraft: true });

    if (!items.length) {
      listEl.innerHTML = '<p class="chat-list-empty">Belum ada percakapan. Tanyakan produk lewat tombol "Chat admin" di katalog atau halaman produk, atau pakai "+ Pertanyaan umum".</p>';
      return;
    }

    listEl.innerHTML = items.map((thread) => {
      const meta = thread.productId ? productMeta.get(String(thread.productId)) : null;
      const icon = thread.orderId && !thread.productId ? 'receipt_long' : thread.productId ? 'sell' : 'help';
      const thumb = meta?.image
        ? `<img src="${escapeHtml(meta.image)}" alt="" />`
        : `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
      const unread = Math.max(0, Number(thread.unreadForUser || 0));
      const isActive = thread.id === activeId;
      const last = thread.isDraft
        ? 'Percakapan baru, belum ada pesan'
        : `${thread.lastSenderRole === 'admin' ? '' : 'Anda: '}${thread.lastMessage || 'Belum ada pesan'}`;
      return `<button type="button" class="chat-list-item ${isActive ? 'is-active' : ''}" data-thread-id="${escapeHtml(thread.id)}">
        <span class="chat-list-thumb">${thumb}</span>
        <span class="chat-list-body">
          <span class="chat-list-row"><span class="chat-list-title">${escapeHtml(threadLabel(thread))}</span><span class="chat-list-time">${thread.isDraft ? '' : escapeHtml(relativeTime(thread.lastMessageAt || thread.updatedAt))}</span></span>
          <span class="chat-list-row"><span class="chat-list-last">${escapeHtml(last)}</span>${thread.isDraft ? '<span class="chat-list-new">Baru</span>' : unread ? `<span class="chat-list-badge">${unread > 99 ? '99+' : unread}</span>` : ''}</span>
        </span>
      </button>`;
    }).join('');

    listEl.querySelectorAll('[data-thread-id]').forEach((button) => {
      button.addEventListener('click', () => selectThread(button.dataset.threadId));
    });
  }

  function renderHeader() {
    const thread = activeId ? findThread(activeId) : null;
    if (!thread) {
      if (titleEl) titleEl.textContent = 'Pilih percakapan';
      if (contextEl) { contextEl.hidden = true; contextEl.innerHTML = ''; }
      return;
    }
    if (titleEl) titleEl.textContent = threadLabel(thread);
    if (!contextEl) return;

    if (thread.productId) {
      const meta = productMeta.get(String(thread.productId));
      const image = meta?.image ? `<img src="${escapeHtml(meta.image)}" alt="" />` : '';
      contextEl.hidden = false;
      contextEl.innerHTML = `<span class="chat-product-context-label">Produk ditanyakan</span><a href="${getProductDetailUrl(thread.productId)}" class="chat-product-context-link">${image}<span>${escapeHtml(thread.productName || meta?.name || 'Lihat produk')}</span></a>${thread.orderId ? `<span class="chat-product-context-label">Pesanan</span><span>${escapeHtml(thread.orderId)}</span>` : ''}`;
    } else if (thread.orderId) {
      contextEl.hidden = false;
      contextEl.innerHTML = `<span class="chat-product-context-label">Pesanan</span><a href="pesanan.html?orderId=${encodeURIComponent(thread.orderId)}" class="chat-product-context-link"><span>${escapeHtml(thread.orderId)}</span></a>`;
    } else {
      contextEl.hidden = true;
      contextEl.innerHTML = '';
    }
  }

  function attachMessages(id) {
    messagesUnsubscribe();
    listeningId = id;
    messagesUnsubscribe = onSnapshot(
      query(collection(db, 'marketplace_chats', id, 'messages'), orderBy('createdAt', 'asc')),
      (snapshot) => {
        if (activeId !== id) return;
        setStatus('');
        const messages = snapshot.docs.map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }));
        renderChatMessages(threadEl, messages, currentUserId);
        if (messages.length) threadEl.scrollTop = threadEl.scrollHeight;
      },
      (error) => {
        console.error('[marketplace chat] gagal memuat pesan:', error);
        setStatus(`Pesan gagal dimuat (${error?.code || 'unknown'}).`);
      }
    );
  }

  function selectThread(id) {
    const thread = findThread(id);
    if (!thread) return;

    messagesUnsubscribe();
    messagesUnsubscribe = () => {};
    listeningId = '';
    activeId = id;
    layout.dataset.view = 'conversation';
    setStatus('');
    input.disabled = false;
    submitButton.disabled = false;
    input.placeholder = 'Ketik pesan...';

    if (thread.productId) loadProductMeta(thread.productId);
    renderHeader();
    renderList();

    if (thread.isDraft) {
      threadEl.innerHTML = '<div class="empty-state">Belum ada pesan. Tulis pertanyaan Anda di bawah.</div>';
    } else {
      threadEl.innerHTML = '<div class="empty-state">Memuat pesan...</div>';
      attachMessages(id);
    }
    markActiveRead();
  }

  function markActiveRead() {
    const thread = threads.find((item) => item.id === activeId);
    if (!thread || isMarkingRead || Number(thread.unreadForUser || 0) <= 0) return;
    isMarkingRead = true;
    updateDoc(doc(db, 'marketplace_chats', thread.id), { unreadForUser: 0 })
      .catch((error) => console.error('[marketplace chat] gagal menandai pesan dibaca:', error))
      .finally(() => { isMarkingRead = false; });
  }

  async function startContextThread(context, fallbackName = '') {
    const id = buildChatThreadId(currentUserId, context);
    if (threads.some((thread) => thread.id === id)) {
      selectThread(id);
      return;
    }
    let productName = fallbackName;
    if (context.productId) {
      const meta = await loadProductMeta(context.productId);
      if (meta?.name) productName = meta.name;
    }
    draft = {
      id,
      buyerId: currentUserId,
      type: context.productId ? 'product' : context.orderId ? 'order' : 'general',
      ...(context.productId ? { productId: String(context.productId), productName: productName || 'Produk yang ditanyakan' } : {}),
      ...(context.orderId ? { orderId: String(context.orderId) } : {})
    };
    selectThread(id);
  }

  threadsUnsubscribe = onSnapshot(
    query(collection(db, 'marketplace_chats'), where('buyerId', '==', currentUserId)),
    (snapshot) => {
      threads = snapshot.docs
        .map((threadDoc) => ({ id: threadDoc.id, ...threadDoc.data() }))
        .sort((a, b) => getCreatedAtMs(b.lastMessageAt || b.updatedAt) - getCreatedAtMs(a.lastMessageAt || a.updatedAt));

      if (draft && threads.some((thread) => thread.id === draft.id)) draft = null;
      threads.forEach((thread) => { if (thread.productId) loadProductMeta(thread.productId); });
      updateChatBadges(threads.reduce((total, thread) => total + Math.max(0, Number(thread.unreadForUser || 0)), 0));

      if (activeId && listeningId !== activeId && threads.some((thread) => thread.id === activeId)) {
        attachMessages(activeId);
      }
      renderList();
      renderHeader();
      markActiveRead();

      if (!didInitialSelect) {
        didInitialSelect = true;
        if (productIdParam) {
          startContextThread({ productId: productIdParam }, productNameParam);
        } else if (orderIdParam) {
          startContextThread({ orderId: orderIdParam });
        } else if (threads.length && window.innerWidth >= 900) {
          selectThread(threads[0].id);
        }
      }
    },
    (error) => {
      console.error('[marketplace chat] gagal memuat daftar percakapan:', error);
      listEl.innerHTML = `<p class="chat-list-empty">Daftar chat gagal dimuat (${escapeHtml(error?.code || 'unknown')}).</p>`;
    }
  );

  newGeneralButton?.addEventListener('click', () => startContextThread({}));
  backButton?.addEventListener('click', () => { layout.dataset.view = 'list'; });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    const thread = activeId ? findThread(activeId) : null;
    if (!thread || !text || submitButton.disabled) return;

    const createdAt = Date.now();
    const threadRef = doc(db, 'marketplace_chats', thread.id);
    const messageRef = doc(collection(threadRef, 'messages'));
    const context = {
      ...(thread.productId ? { productId: String(thread.productId), productName: thread.productName || '' } : {}),
      ...(thread.orderId ? { orderId: String(thread.orderId) } : {})
    };

    submitButton.disabled = true;
    setStatus('Mengirim pesan...');
    try {
      const batch = writeBatch(db);
      batch.set(messageRef, { senderId: currentUserId, senderRole: 'user', text, createdAt, ...context });
      batch.set(threadRef, {
        buyerId: currentUserId,
        buyerName: currentUserName,
        buyerEmail: currentUserEmail,
        participantIds: [currentUserId, 'admin'],
        type: thread.type || (thread.productId ? 'product' : thread.orderId ? 'order' : 'general'),
        ...context,
        lastMessage: text,
        lastMessageAt: createdAt,
        lastSenderRole: 'user',
        updatedAt: createdAt,
        unreadForAdmin: increment(1),
        ...(thread.isDraft ? { createdAt } : {})
      }, { merge: true });
      await batch.commit();
      input.value = '';
      setStatus('');
    } catch (error) {
      console.error('[marketplace chat] pesan user gagal dikirim:', error);
      setStatus(`Pesan gagal terkirim: ${error?.code || 'unknown'}`);
    } finally {
      submitButton.disabled = false;
      input.focus();
    }
  });

  window.__marketplaceChatCleanup = () => {
    threadsUnsubscribe();
    messagesUnsubscribe();
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

function chunkProducts(items, chunkSize = 4) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function renderProductCarousel(items) {
  const chunks = chunkProducts(items, 4);
  if (!chunks.length) {
    return `
      <div class="product-carousel product-carousel-empty">
        <p>Belum ada produk yang tersedia saat ini.</p>
      </div>
    `;
  }

  const slidesMarkup = chunks.map((chunk, index) => `
    <div class="product-carousel-slide ${index === 0 ? 'is-active' : ''}" data-slide-index="${index}">
      ${chunk.map((item) => `
        <article class="product-card compact-card thread-card" data-category="${item.category}">
          <div class="image">${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : item.image} <span class="chip">${escapeHtml(item.label)}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(item.price)}</div>
              <span class="condition" style="${item.stock === 0 ? 'background: rgba(220, 38, 38, 0.08); color: #b91c1c; border: 1px solid rgba(220, 38, 38, 0.18);' : item.stock <= 2 ? 'background: rgba(245, 158, 11, 0.1); color: #92400e; border: 1px solid rgba(245, 158, 11, 0.2);' : 'background: rgba(34, 197, 94, 0.08); color: #15803d; border: 1px solid rgba(34, 197, 94, 0.18);'}">${item.stock > 0 ? `Stok: ${item.stock}` : 'Stok habis'}</span>
            </div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="seller-row compact-row">
              <span class="seller-meta">${item.sellerPhotoUrl ? `<span class="avatar has-photo"><img src="${escapeHtml(item.sellerPhotoUrl)}" alt="${escapeHtml(getSafeUserName(item.seller || 'P'))}" /></span>` : `<span class="avatar">${escapeHtml((item.seller || 'P').charAt(0).toUpperCase())}</span>`} <span class="seller-name">${escapeHtml(item.seller)}</span></span>
              <span>${escapeHtml(item.city)}</span>
            </div>
            <div class="card-actions compact-actions">
              <a class="btn btn-soft" href="${getProductDetailUrl(item.id)}">Lihat detail</a>
              ${item.stock > 0 ? `<button class="btn btn-primary" type="button" data-add-cart="${escapeHtml(item.id)}">+ Keranjang</button>` : '<button class="btn btn-secondary" type="button" disabled>Stok habis</button>'}
            </div>
          </div>
        </article>
      `).join('')}
    </div>
  `).join('');

  const dotsMarkup = chunks.map((_, dotIndex) => `
    <button class="product-carousel-dot ${dotIndex === 0 ? 'is-active' : ''}" type="button" data-dot-index="${dotIndex}" aria-label="Lihat slide ${dotIndex + 1}"></button>
  `).join('');

  return `
    <div class="product-carousel" data-product-carousel data-total-slides="${chunks.length}">
      <div class="product-carousel-track">${slidesMarkup}</div>
      <div class="product-carousel-controls">
        <button class="product-carousel-btn product-carousel-nav product-carousel-prev" type="button" aria-label="Previous product">‹</button>
        <div class="product-carousel-dots" aria-label="Navigasi slide produk">${dotsMarkup}</div>
        <button class="product-carousel-btn product-carousel-nav product-carousel-next" type="button" aria-label="Next product">›</button>
      </div>
    </div>
  `;
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

function formatCompactMetric(value, label) {
  if (value >= 1000) {
    const compact = (value / 1000).toFixed(1).replace(/\.0$/, '');
    return `${compact}k ${label}`;
  }

  return `${value} ${label}`;
}

async function refreshMarketplaceLandingMetrics() {
  const itemsEl = document.querySelector('[data-metric-items]');
  const buyersEl = document.querySelector('[data-metric-buyers]');

  if (!itemsEl && !buyersEl) return;

  try {
    const productsSnapshot = await getDocs(collection(db, 'marketplace_products'));
    const products = productsSnapshot.docs.map((docSnap) => docSnap.data());
    const activeItems = products.filter((product) => Number(product?.stock ?? 1) > 0).length;
    const soldItems = products.reduce((total, product) => total + Math.max(0, Number(product?.sold || 0)), 0);

    if (itemsEl) {
      itemsEl.textContent = formatCompactMetric(Math.max(activeItems, 0), 'produk aktif');
    }

    if (buyersEl) {
      buyersEl.textContent = formatCompactMetric(Math.max(soldItems, 0), 'terjual');
    }
  } catch (error) {
    console.warn('Gagal memuat metric marketplace dari Firestore:', error);
    if (itemsEl) itemsEl.textContent = '0 produk aktif';
    if (buyersEl) buyersEl.textContent = '0 terjual';
  }
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

async function callMarketplaceApi(action, body = {}) {
  // Tunggu Firebase selesai memulihkan sesi login (penting setelah halaman baru dibuka
  // atau setelah kembali dari halaman pembayaran DOKU).
  const firebaseUser = auth.currentUser || await waitForMarketplaceFirebaseUser();
  if (!firebaseUser) throw Object.assign(new Error('Silakan masuk kembali untuk melanjutkan.'), { code: 'unauthenticated' });
  const idToken = await firebaseUser.getIdToken();
  const response = await fetch(`/api/marketplace?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  let result = {};
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }
  if (!response.ok || result.success === false) {
    const apiError = new Error(result.message || 'Permintaan toko gagal.');
    apiError.code = result.code || `http-${response.status}`;
    apiError.details = result.details;
    throw apiError;
  }
  return result;
}

async function renderCartPage() {
  const container = document.querySelector('[data-cart-content]');
  if (!container) return;
  const user = requireAuth();
  if (!user) return;
  const userId = auth.currentUser?.uid || user.uid || user.id;
  if (!userId) return;

  const cartRef = doc(db, 'marketplace_carts', userId);
  let profile = user;
  try {
    const [profileSnapshot] = await Promise.all([
      getDoc(doc(db, 'marketplace_users', userId)),
      callMarketplaceApi('release-expired-reservations').catch((error) => {
        console.error('[marketplace] gagal melepas reservasi kedaluwarsa saat buka keranjang:', error);
      })
    ]);
    if (profileSnapshot.exists()) profile = { ...user, ...profileSnapshot.data() };
  } catch (error) {
    console.error('[marketplace] gagal memuat alamat profil untuk keranjang:', error);
  }

  const shipping = getShippingAddressFromUser(profile);
  const cartSummary = document.querySelector('[data-cart-shipping]');
  if (cartSummary) {
    const completeness = shipping.complete ? 'Alamat siap untuk checkout.' : 'Alamat belum lengkap; isi nama penerima, HP, alamat, latitude, dan longitude di Profil.';
    const warning = shipping.outsideIndonesia ? '<p class="commerce-warning">Koordinat berada di luar Indonesia; periksa kembali sebelum membayar.</p>' : '';
    const map = shipping.complete ? `<iframe title="Preview alamat pengiriman" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${shipping.latitude},${shipping.longitude}&z=16&output=embed"></iframe><a href="${shipping.mapsUrl}" target="_blank" rel="noopener noreferrer">Lihat titik di Google Maps</a>` : '';
    cartSummary.innerHTML = `<div class="commerce-section-heading"><div><h2>Alamat pengiriman</h2><p>${escapeHtml(completeness)}</p></div><a href="profil.html">Ubah alamat</a></div>${shipping.complete ? `<address>${escapeHtml(shipping.recipientName)} · ${escapeHtml(shipping.phone)}<br>${escapeHtml(shipping.address)}${shipping.city ? `, ${escapeHtml(shipping.city)}` : ''}${shipping.province ? `, ${escapeHtml(shipping.province)}` : ''}${shipping.postalCode ? ` ${escapeHtml(shipping.postalCode)}` : ''}${shipping.note ? `<br>Catatan: ${escapeHtml(shipping.note)}` : ''}</address><div class="commerce-map">${map}</div>` : ''}${warning}`;
  }

  let renderSequence = 0;
  const showCartError = (message) => {
    const errorEl = document.querySelector('[data-cart-error]');
    if (errorEl) errorEl.textContent = message || '';
  };

  const renderCartContents = async (cartSnapshot) => {
    const sequence = ++renderSequence;
    const savedItems = cartSnapshot.exists() && Array.isArray(cartSnapshot.data().items) ? cartSnapshot.data().items : [];
    if (!savedItems.length) {
      container.innerHTML = '<div class="commerce-empty">Keranjang masih kosong. <a href="beli.html">Lihat katalog</a></div>';
      const totalEl = document.querySelector('[data-cart-total]');
      if (totalEl) totalEl.textContent = formatCurrency(0);
      syncCheckoutButton(shipping.complete, true);
      return;
    }

    const resolved = await Promise.all(savedItems.map(async (item) => {
      try {
        const snapshot = await getDoc(doc(db, 'marketplace_products', String(item.productId)));
        if (!snapshot.exists()) return { productId: String(item.productId), qty: Number(item.qty || 1), product: null, stock: 0 };
        const product = normalizeProduct({ id: snapshot.id, ...snapshot.data() });
        return { productId: snapshot.id, qty: Number(item.qty || 1), product, stock: product.stock };
      } catch (error) {
        console.error('[marketplace] gagal memeriksa produk keranjang:', item.productId, error);
        return { productId: String(item.productId), qty: Number(item.qty || 1), product: null, stock: 0 };
      }
    }));
    if (sequence !== renderSequence) return;

    let changed = false;
    const correctedItems = resolved.map((item) => {
      if (!item.product || item.stock === 0) return { productId: item.productId, qty: item.qty };
      const qty = Math.max(1, Math.min(99, item.stock, item.qty));
      if (qty !== item.qty) changed = true;
      return { productId: item.productId, qty };
    });
    if (changed) {
      await setDoc(cartRef, { items: correctedItems, updatedAt: Date.now() });
      showCartError('Jumlah di keranjang disesuaikan karena stok barang berubah.');
    }

    const total = resolved.reduce((sum, item) => item.product && item.stock > 0
      ? sum + Math.round(item.product.price) * Math.min(item.qty, item.stock)
      : sum, 0);
    const hasUnavailable = resolved.some((item) => !item.product || item.stock === 0);
    container.innerHTML = resolved.map((item) => {
      const product = item.product;
      const unavailable = !product || item.stock === 0;
      const qty = product && item.stock > 0 ? Math.min(item.qty, item.stock) : item.qty;
      const unitPrice = product ? Math.round(product.price) : 0;
      const imageUrl = safeMarketplaceImageUrl(product?.imageUrl);
      const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" />` : '<span class="commerce-image-fallback">G</span>';
      return `<article class="commerce-cart-item ${unavailable ? 'is-unavailable' : ''}" data-cart-item="${escapeHtml(item.productId)}">
        <div class="commerce-cart-image">${image}</div>
        <div class="commerce-cart-main"><div class="commerce-cart-title"><h3>${escapeHtml(product?.name || 'Produk tidak tersedia')}</h3><strong>${formatCurrency(unitPrice)}</strong></div>
          <p class="commerce-stock ${unavailable ? 'is-unavailable' : ''}">${unavailable ? 'Produk habis atau tidak tersedia' : `Stok tersisa: ${item.stock}`}</p>
          <div class="commerce-cart-controls">
            <div class="commerce-quantity"><button type="button" data-cart-step="-1" aria-label="Kurangi jumlah" ${unavailable || qty <= 1 ? 'disabled' : ''}>−</button><output>${qty}</output><button type="button" data-cart-step="1" aria-label="Tambah jumlah" ${unavailable || qty >= item.stock || qty >= 99 ? 'disabled' : ''}>+</button></div>
            <strong>Subtotal: ${formatCurrency(unavailable ? 0 : unitPrice * qty)}</strong>
            <button class="commerce-remove" type="button" data-cart-remove>Hapus</button>
          </div>
        </div>
      </article>`;
    }).join('');

    const totalEl = document.querySelector('[data-cart-total]');
    if (totalEl) totalEl.textContent = formatCurrency(total);
    syncCheckoutButton(shipping.complete, !resolved.length || hasUnavailable);
  };

  function syncCheckoutButton(addressComplete, hasInvalidItems) {
    const button = document.querySelector('[data-checkout]');
    if (!button) return;
    button.disabled = !addressComplete || hasInvalidItems;
    const reason = !addressComplete ? 'Lengkapi alamat pengiriman di Profil.' : hasInvalidItems ? 'Hapus barang habis atau periksa stok.' : '';
    button.title = reason;
  }

  container.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-cart-item]');
    if (!row) return;
    const productId = row.dataset.cartItem;
    try {
      const snapshot = await getDoc(cartRef);
      const items = snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
      const current = items.find((item) => String(item.productId) === productId);
      if (!current) return;
      if (event.target.closest('[data-cart-remove]')) {
        await setDoc(cartRef, { items: items.filter((item) => String(item.productId) !== productId), updatedAt: Date.now() });
      } else {
        const step = Number(event.target.closest('[data-cart-step]')?.dataset.cartStep || 0);
        if (!step) return;
        const productSnapshot = await getDoc(doc(db, 'marketplace_products', productId));
        const rawStock = productSnapshot.exists() ? Number(productSnapshot.data().stock) : 0;
        const stock = Number.isInteger(rawStock) && rawStock >= 0 ? rawStock : (productSnapshot.exists() ? 1 : 0);
        const nextQty = Math.max(1, Math.min(99, stock, Number(current.qty || 1) + step));
        if (stock <= 0) return;
        await setDoc(cartRef, { items: items.map((item) => String(item.productId) === productId ? { productId, qty: nextQty } : item), updatedAt: Date.now() });
      }
    } catch (error) {
      console.error('[marketplace] gagal mengubah keranjang:', error);
      showCartError(`Keranjang gagal diperbarui: ${error?.code || error.message || 'unknown'}`);
    }
  });

  const checkoutButton = document.querySelector('[data-checkout]');
  checkoutButton?.addEventListener('click', async () => {
    if (checkoutButton.disabled) return;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Menyiapkan pembayaran...';
    showCartError('');
    try {
      const result = await callMarketplaceApi('checkout', { shippingAddress: shipping });
      if (!result.paymentUrl || !/^https:\/\//i.test(result.paymentUrl)) throw new Error('DOKU tidak mengembalikan link pembayaran HTTPS.');
      window.location.href = result.paymentUrl;
    } catch (error) {
      console.error('[marketplace] checkout gagal:', error);
      const stockIssues = Array.isArray(error.details) ? error.details.map((item) => `${item.name || 'Produk'}: stok ${item.stock ?? 0}`).join(' · ') : '';
      showCartError(`Checkout gagal (${error.code || 'unknown'}): ${error.message}${stockIssues ? ` ${stockIssues}` : ''}`);
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Bayar dengan DOKU';
    }
  });

  const unsubscribe = onSnapshot(cartRef, (snapshot) => {
    renderCartContents(snapshot).catch((error) => {
      console.error('[marketplace] gagal merender keranjang:', error);
      showCartError(`Keranjang gagal dimuat: ${error?.code || 'unknown'}`);
    });
  }, (error) => {
    console.error('[marketplace] gagal membaca keranjang:', error);
    showCartError(`Keranjang gagal dimuat: ${error?.code || 'unknown'}`);
  });
  window.__marketplaceCartCleanup = unsubscribe;
}

async function renderHomeProducts() {
  const container = document.querySelector('[data-product-list]');
  if (!container) return;

  let activeFilter = 'all';
  let latestProducts = [];

  container.innerHTML = renderHomeProductsLoadingState();
  ensureDemoData();
  bindAddToCartButtons(container);

  const bindProductCarouselControls = () => {
    const carousel = container.querySelector('[data-product-carousel]');
    if (!carousel) return;

    const slides = [...carousel.querySelectorAll('.product-carousel-slide')];
    const dots = [...carousel.querySelectorAll('.product-carousel-dot')];
    const prevButton = carousel.querySelector('.product-carousel-prev');
    const nextButton = carousel.querySelector('.product-carousel-next');
    let activeIndex = 0;

    const setActiveSlide = (index) => {
      activeIndex = (index + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === activeIndex));
      dots.forEach((dot, dotIndex) => dot.classList.toggle('is-active', dotIndex === activeIndex));
    };

    prevButton?.addEventListener('click', () => setActiveSlide(activeIndex - 1));
    nextButton?.addEventListener('click', () => setActiveSlide(activeIndex + 1));
    dots.forEach((dot) => {
      dot.addEventListener('click', () => setActiveSlide(Number(dot.dataset.dotIndex || 0)));
    });
  };

  const rerenderProducts = async () => {
    const normalizedItems = normalizeMarketplaceProducts(
      [...latestProducts].sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt))
    );
    const normalized = activeFilter === 'all'
      ? normalizedItems
      : normalizedItems.filter((item) => item.category === activeFilter);
    const loadNotice = marketplaceLoadErrorMarkup();
    container.innerHTML = window.__marketplaceProductsError && !normalized.length
      ? loadNotice
      : `${loadNotice}${renderProductCarousel(normalized)}`;
    bindProductCarouselControls();

    const filterButtons = document.querySelectorAll('[data-filter]');
    filterButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === activeFilter);
      button.onclick = () => {
        activeFilter = button.dataset.filter || 'all';
        rerenderProducts();
      };
    });
  };

  bindMarketplaceRetry(container, async () => {
    latestProducts = await fetchProductsFromFirebase();
    await rerenderProducts();
  });

  const products = await fetchProductsFromFirebase();
  latestProducts = products;
  await rerenderProducts();

  const productsQuery = collection(db, 'marketplace_products');
  const unsubscribe = onSnapshot(productsQuery, { includeMetadataChanges: true }, (snapshot) => {
    const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    console.log('[marketplace] produk dimuat:', items.length);
    latestProducts = items;
    cacheMarketplaceProducts(items);
    if (snapshot.metadata.fromCache) {
      window.__marketplaceProductsError ||= { code: 'unavailable', message: 'Firestore belum memberikan data terbaru; katalog memakai data tersimpan.' };
      window.__marketplaceProductsFromCache = items.length > 0;
    } else {
      delete window.__marketplaceProductsError;
      delete window.__marketplaceProductsFromCache;
    }
    rerenderProducts();
  }, (error) => {
    console.error('[marketplace] realtime home products gagal:', error);
    window.__marketplaceProductsError = { code: error?.code || 'unknown', message: error?.message || 'Terjadi kesalahan saat membaca katalog.' };
    window.__marketplaceProductsFromCache = readStorage(STORAGE_KEYS.PRODUCTS, []).length > 0;
    rerenderProducts();
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
        bio: 'Saya menggunakan akun sebagai pembeli di Marketplace Mantan.',
        city: 'Jakarta',
        role: 'buyer'
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
      bio: 'Pembeli Marketplace Mantan',
      city: 'Jakarta',
      role: 'buyer'
    };

    resetLoginAttempts();
    setCurrentUser(user, rememberMe);
    writeStorage(STORAGE_KEYS.USERS, [...(readStorage(STORAGE_KEYS.USERS, []) || []), user].filter((item, index, arr) => arr.findIndex((entry) => entry.email === item.email) === index));
    window.location.href = 'dashboard.html';
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
      window.location.href = 'dashboard.html';
    }
    return;
  }

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser || String(firebaseUser.email || '').toLowerCase() === ADMIN_ACCOUNT_EMAIL) return;

    try {
      await syncCurrentUserFromFirebase(firebaseUser, true);
      if (window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html')) {
        window.location.href = 'dashboard.html';
      }
    } catch (error) {
      console.error('[marketplace] gagal memuat sesi pada halaman login:', error);
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

  const userId = auth.currentUser?.uid || user.uid || user.id || '';
  const [productsResult, ordersResult, chatResult] = await Promise.allSettled([
    getDocs(collection(db, 'marketplace_products')),
    userId ? getDocs(query(collection(db, 'marketplace_orders'), where('userId', '==', userId))) : Promise.resolve({ docs: [] }),
    userId ? getDocs(query(collection(db, 'marketplace_chats'), where('buyerId', '==', userId))) : Promise.resolve({ docs: [] })
  ]);

  const products = productsResult.status === 'fulfilled'
    ? productsResult.value.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    : [];
  const orders = ordersResult.status === 'fulfilled'
    ? ordersResult.value.docs.map((docSnap) => docSnap.data())
    : [];
  const chatDocs = chatResult.status === 'fulfilled' ? (chatResult.value?.docs || []) : [];

  [productsResult, ordersResult, chatResult].forEach((result) => {
    if (result.status === 'rejected') console.error('[marketplace] dashboard gagal memuat data pembeli:', result.reason);
  });

  if (productsResult.status === 'fulfilled') cacheMarketplaceProducts(products);
  const normalizedProducts = normalizeMarketplaceProducts(products)
    .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));
  const awaitingPaymentOrders = orders.filter((order) => String(order.status || '').toLowerCase() === 'awaiting_payment');
  const activeOrders = orders.filter((order) => ['paid', 'processing', 'shipped'].includes(String(order.status || '').toLowerCase()));
  const completedOrders = orders.filter((order) => String(order.status || '').toLowerCase() === 'completed');
  const unreadMessages = chatDocs.reduce((total, threadDoc) => total + Math.max(0, Number(threadDoc.data().unreadForUser || 0)), 0);

  const orderEl = document.querySelector('[data-stat-orders]');
  if (orderEl) orderEl.textContent = String(activeOrders.length);
  const awaitingEl = document.querySelector('[data-stat-awaiting]');
  if (awaitingEl) awaitingEl.textContent = String(awaitingPaymentOrders.length);
  const finishedEl = document.querySelector('[data-stat-finished]');
  if (finishedEl) finishedEl.textContent = String(completedOrders.length);
  const chatEl = document.querySelector('[data-stat-chat]');
  if (chatEl) chatEl.textContent = String(unreadMessages);

  const productList = document.querySelector('[data-dashboard-products]');
  if (productList) {
    if (!normalizedProducts.length) {
      productList.innerHTML = `
        <div style="display: grid; place-items: center; text-align: center; min-height: 180px;">
          <div>
            <h3 style="margin: 0 0 8px;">Belum ada produk toko</h3>
            <p class="muted" style="margin: 0;">Produk terbaru dari Marketplace Mantan akan tampil di sini.</p>
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
            <div style="font-weight:700;color:var(--primary-strong);">${escapeHtml(item.name)}</div>
            <small class="muted">${escapeHtml(item.category || 'Barang')} • ${formatCurrency(item.price)}</small>
          </div>
          <span class="condition" style="${item.stock === 0 ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;' : item.stock <= 2 ? 'background: #fef3c7; color: #92400e; border: 1px solid #fde68a;' : 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;'}">${item.stock > 0 ? `Stok: ${item.stock}` : 'Habis'}</span>
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
            <p><strong>Pesanan dan chat</strong> akan muncul di menu Pesanan Saya dan Chat Admin.</p>
            <small>${activeOrders.length} pesanan aktif · ${unreadMessages} pesan belum dibaca</small>
          </div>
        </div>
      `;
      updateSidebarProfile();
      return;
    }

    const latestActivities = normalizedProducts.slice(0, 4).map((item) => ({
      title: `Produk toko: ${item.name}`,
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

async function renderOrdersForBuyer() {
  const container = document.querySelector('[data-buyer-orders]');
  if (!container) return;
  const user = requireAuth();
  if (!user) return;

  const userId = auth.currentUser?.uid || user.uid || user.id || '';
  const pageStatus = document.querySelector('[data-orders-status]');
  const titleEl = document.querySelector('[data-orders-title]');
  const eyebrowEl = document.querySelector('[data-orders-eyebrow]');
  const backEl = document.querySelector('[data-orders-back]');
  const requestedOrderId = (new URLSearchParams(window.location.search).get('orderId') || '').trim();
  const isDetailMode = Boolean(requestedOrderId);

  let countdownInterval = null;
  let detailUnsubscribe = null;
  let stopPaymentPolling = false;

  const statusLabels = {
    awaiting_payment: ['Menunggu Pembayaran', 'bg-amber-100 text-amber-800'],
    paid: ['Dibayar', 'bg-blue-100 text-blue-800'],
    processing: ['Diproses', 'bg-indigo-100 text-indigo-800'],
    shipped: ['Dikirim', 'bg-cyan-100 text-cyan-800'],
    completed: ['Selesai', 'bg-emerald-100 text-emerald-800'],
    cancelled: ['Dibatalkan', 'bg-slate-100 text-slate-700'],
    expired: ['Kedaluwarsa', 'bg-rose-100 text-rose-800'],
    payment_failed: ['Pembayaran Gagal', 'bg-rose-100 text-rose-800']
  };

  const setStatus = (message) => {
    if (pageStatus) pageStatus.textContent = message || '';
  };

  const formatOrderDate = (value) => {
    const ms = getCreatedAtMs(value);
    return ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Tanggal belum tersedia';
  };

  const formatAddress = (shipping) => {
    const parts = [
      escapeHtml(shipping.address || ''),
      shipping.city ? escapeHtml(shipping.city) : '',
      shipping.province ? escapeHtml(shipping.province) : '',
      shipping.postalCode ? escapeHtml(shipping.postalCode) : ''
    ].filter(Boolean);
    return parts.join(', ');
  };

  const getMapPoint = (shipping) => {
    const latitude = Number(shipping.latitude);
    const longitude = Number(shipping.longitude);
    const valid = shipping.latitude !== '' && shipping.longitude !== '' &&
      shipping.latitude !== null && shipping.longitude !== null &&
      shipping.latitude !== undefined && shipping.longitude !== undefined &&
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    return valid ? { latitude, longitude } : null;
  };

  function updatePaymentCountdowns() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
    if (!container.querySelector('[data-payment-countdown]')) return;
    const update = () => {
      container.querySelectorAll('[data-payment-countdown]').forEach((element) => {
        const remaining = Math.max(0, Number(element.dataset.paymentCountdown) - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        element.textContent = remaining
          ? `Selesaikan pembayaran dalam ${minutes}:${String(seconds).padStart(2, '0')}`
          : 'Batas pembayaran lewat; memeriksa pelepasan stok...';
      });
    };
    update();
    countdownInterval = setInterval(update, 1000);
  }

  function bindOrderActions(onAfterCancel) {
    container.querySelectorAll('[data-pay-order]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await callMarketplaceApi('pay-again', { orderId: button.dataset.payOrder });
        if (!/^https:\/\//i.test(String(result.paymentUrl || ''))) throw new Error('Link pembayaran tidak valid.');
        window.location.href = result.paymentUrl;
      } catch (error) {
        console.error('[marketplace] gagal membuka pembayaran ulang:', error);
        setStatus(`Pembayaran gagal dibuka (${error.code || 'unknown'}): ${error.message}`);
        button.disabled = false;
      }
    }));

    container.querySelectorAll('[data-cancel-order]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Batalkan pesanan ini dan lepaskan stok yang dicadangkan?')) return;
      button.disabled = true;
      try {
        await callMarketplaceApi('cancel-order', { orderId: button.dataset.cancelOrder });
        setStatus('');
        if (onAfterCancel) await onAfterCancel();
      } catch (error) {
        console.error('[marketplace] gagal membatalkan pesanan:', error);
        setStatus(`Pembatalan gagal (${error.code || 'unknown'}): ${error.message}`);
        button.disabled = false;
      }
    }));
  }

  /* =====================================================================
   * MODE DETAIL  →  pesanan.html?orderId=MM-xxxxxx-xxxxxx
   * Hanya menampilkan satu pesanan (mis. setelah kembali dari DOKU).
   * ===================================================================== */
  function getBanner(order) {
    const status = order.status;
    const paid = order.paymentStatus === 'PAID';
    if (status === 'awaiting_payment') {
      return { tone: 'pending', icon: 'schedule', title: 'Menunggu pembayaran', text: 'Kami sedang memeriksa pembayaran Anda. Jika sudah membayar, halaman ini akan diperbarui otomatis.' };
    }
    if (status === 'paid') {
      return { tone: 'success', icon: 'check_circle', title: 'Pembayaran berhasil', text: 'Terima kasih! Pesanan Anda sudah dibayar dan menunggu diproses admin.' };
    }
    if (status === 'processing') {
      return { tone: 'info', icon: 'inventory_2', title: 'Pesanan sedang diproses', text: 'Admin sedang menyiapkan barang Anda.' };
    }
    if (status === 'shipped') {
      return { tone: 'info', icon: 'local_shipping', title: 'Pesanan dikirim', text: order.trackingNumber ? 'Pesanan sedang dalam perjalanan. Cek nomor resi di bawah.' : 'Pesanan sedang dalam perjalanan.' };
    }
    if (status === 'completed') {
      return { tone: 'success', icon: 'task_alt', title: 'Pesanan selesai', text: 'Pesanan sudah diterima. Terima kasih sudah berbelanja!' };
    }
    if (status === 'cancelled') {
      return { tone: 'neutral', icon: 'cancel', title: 'Pesanan dibatalkan', text: paid ? 'Pesanan dibatalkan. Refund diproses manual oleh admin; hubungi admin untuk info lebih lanjut.' : 'Pesanan ini dibatalkan dan stok sudah dilepas.' };
    }
    if (status === 'expired') {
      return { tone: 'danger', icon: 'timer_off', title: 'Pembayaran kedaluwarsa', text: paid ? 'Pembayaran diterima setelah batas waktu. Hubungi admin untuk pemeriksaan.' : 'Batas waktu pembayaran terlewati. Silakan checkout ulang dari keranjang.' };
    }
    if (status === 'payment_failed') {
      return { tone: 'danger', icon: 'error', title: 'Pembayaran gagal', text: 'Pembayaran tidak berhasil. Silakan checkout ulang dari keranjang.' };
    }
    return { tone: 'neutral', icon: 'info', title: 'Status sedang diperiksa', text: 'Hubungi admin jika status tidak kunjung berubah.' };
  }

  function renderOrderDetail(order) {
    const [label, badgeClass] = statusLabels[order.status] || ['Status diperiksa admin', 'bg-slate-100 text-slate-700'];
    const banner = getBanner(order);
    const items = Array.isArray(order.items) ? order.items : [];
    const shipping = order.shippingAddress || {};
    const point = getMapPoint(shipping);
    const canPay = order.status === 'awaiting_payment' && Number(order.paymentExpiresAt || 0) > Date.now();
    const history = Array.isArray(order.statusHistory) ? [...order.statusHistory].sort((a, b) => Number(a.at || 0) - Number(b.at || 0)) : [];

    if (titleEl) titleEl.textContent = 'Detail Pesanan';

    const itemsMarkup = items.map((item) => {
      const image = safeMarketplaceImageUrl(item.image);
      const thumb = image
        ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name || 'Produk')}" />`
        : '<span class="order-line-fallback">G</span>';
      const name = item.productId
        ? `<a href="${getProductDetailUrl(item.productId)}">${escapeHtml(item.name || 'Produk')}</a>`
        : `<strong>${escapeHtml(item.name || 'Produk')}</strong>`;
      return `<div class="order-line">${thumb}<div class="order-line-info">${name}<small>${formatCurrency(item.unitPrice || 0)} × ${Math.max(1, Number(item.qty || 1))}</small></div><strong>${formatCurrency(item.subtotal || 0)}</strong></div>`;
    }).join('') || '<p class="muted">Rincian barang tidak tersedia.</p>';

    const historyMarkup = history.length
      ? `<ol class="order-timeline">${history.map((entry) => {
          const [entryLabel] = statusLabels[entry.status] || [entry.status || '-'];
          return `<li><strong>${escapeHtml(entryLabel)}</strong><small>${escapeHtml(formatOrderDate(entry.at))}</small></li>`;
        }).join('')}</ol>`
      : '<p class="muted">Belum ada riwayat status.</p>';

    const paymentLabel = order.paymentStatus === 'PAID' ? 'Lunas' : order.paymentStatus === 'EXPIRED' ? 'Kedaluwarsa' : order.paymentStatus === 'FAILED' ? 'Gagal' : 'Belum dibayar';

    container.innerHTML = `
      <div class="order-banner tone-${banner.tone}" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">${banner.icon}</span>
        <div>
          <h3>${escapeHtml(banner.title)}</h3>
          <p>${escapeHtml(banner.text)}</p>
          ${canPay ? `<p class="commerce-payment-countdown" data-payment-countdown="${Number(order.paymentExpiresAt)}" style="margin-top:6px;font-weight:700;"></p>` : ''}
        </div>
      </div>

      <div class="order-detail-head">
        <div>
          <strong>${escapeHtml(order.orderCode || order.id)}</strong>
          <small>Dipesan ${escapeHtml(formatOrderDate(order.createdAt))}</small>
        </div>
        <span class="commerce-status ${badgeClass}">${escapeHtml(label)}</span>
      </div>

      <div class="order-detail-grid">
        <div>
          <section class="order-detail-card">
            <h3>Barang dipesan</h3>
            ${itemsMarkup}
            <div style="margin-top:10px;">
              <div class="order-sum-row"><span>Subtotal</span><span>${formatCurrency(order.subtotal || 0)}</span></div>
              <div class="order-sum-row"><span>Ongkos kirim</span><span>${formatCurrency(order.shippingFee || 0)}</span></div>
              <div class="order-sum-row is-total"><span>Total</span><span>${formatCurrency(order.totalAmount || 0)}</span></div>
            </div>
          </section>
          <section class="order-detail-card">
            <h3>Riwayat status</h3>
            ${historyMarkup}
          </section>
        </div>

        <div>
          <section class="order-detail-card">
            <h3>Pembayaran</h3>
            <ul class="order-meta-list">
              <li><span>Status bayar</span><strong>${escapeHtml(paymentLabel)}</strong></li>
              ${order.paidAt ? `<li><span>Dibayar pada</span><strong>${escapeHtml(formatOrderDate(order.paidAt))}</strong></li>` : ''}
              <li><span>Metode</span><strong>DOKU</strong></li>
            </ul>
          </section>
          <section class="order-detail-card">
            <h3>Alamat pengiriman</h3>
            <address class="order-address">
              <strong>${escapeHtml(shipping.recipientName || '-')}</strong><br>
              ${escapeHtml(shipping.phone || '-')}<br>
              ${formatAddress(shipping) || 'Alamat belum tersedia'}
              ${shipping.note ? `<br><em>Catatan: ${escapeHtml(shipping.note)}</em>` : ''}
            </address>
            ${point ? `<div class="order-detail-map"><iframe title="Lokasi pengiriman" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${point.latitude},${point.longitude}&z=16&output=embed"></iframe></div><p style="margin:8px 0 0;"><a href="https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}" target="_blank" rel="noopener noreferrer">Lihat di Google Maps</a></p>` : ''}
          </section>
          ${order.trackingNumber ? `<section class="order-detail-card"><h3>Pengiriman</h3><ul class="order-meta-list"><li><span>Kurir</span><strong>${escapeHtml(order.courier || '-')}</strong></li><li><span>No. resi</span><strong>${escapeHtml(order.trackingNumber)}</strong></li></ul></section>` : ''}
        </div>
      </div>

      <div class="order-detail-actions">
        ${canPay ? `<button class="btn btn-primary" type="button" data-pay-order="${escapeHtml(order.id)}">Bayar Sekarang</button><button class="btn btn-secondary" type="button" data-cancel-order="${escapeHtml(order.id)}">Batalkan Pesanan</button>` : ''}
        <a class="btn btn-secondary" href="chat.html?orderId=${encodeURIComponent(order.id)}">Tanya Admin</a>
        <a class="btn btn-soft" href="pesanan.html">Lihat semua pesanan</a>
        <a class="btn btn-soft" href="beli.html">Lanjut belanja</a>
      </div>
    `;

    bindOrderActions(null); // onSnapshot yang memperbarui tampilan setelah batal
    updatePaymentCountdowns();
  }

  async function runDetailMode() {
    if (eyebrowEl) eyebrowEl.textContent = 'Pesanan';
    if (titleEl) titleEl.textContent = 'Detail Pesanan';
    if (backEl) backEl.classList.add('is-visible');
    container.innerHTML = '<p class="muted">Memuat detail pesanan...</p>';

    // Lepas reservasi kedaluwarsa lebih dulu (gagal pun tidak masalah).
    try {
      await callMarketplaceApi('release-expired-reservations');
    } catch (error) {
      console.error('[marketplace] gagal melepas reservasi kedaluwarsa:', error);
    }

    const orderRef = doc(db, 'marketplace_orders', requestedOrderId);
    let firstSnapshot = true;

    detailUnsubscribe = onSnapshot(orderRef, (snapshot) => {
      if (!snapshot.exists()) {
        container.innerHTML = '<div class="commerce-empty">Pesanan tidak ditemukan. <a href="pesanan.html">Lihat semua pesanan</a></div>';
        return;
      }
      const order = { id: snapshot.id, ...snapshot.data() };
      if (order.userId && order.userId !== userId) {
        container.innerHTML = '<div class="commerce-empty">Pesanan ini bukan milik akun Anda. <a href="pesanan.html">Lihat pesanan saya</a></div>';
        return;
      }
      if (firstSnapshot) {
        firstSnapshot = false;
        setStatus('');
      }
      renderOrderDetail(order);
    }, (error) => {
      console.error('[marketplace] gagal memuat detail pesanan:', error);
      setStatus(`Gagal memuat pesanan (${error?.code || 'unknown'}).`);
      container.innerHTML = '<p class="commerce-error">Detail pesanan gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>';
    });

    // Setelah kembali dari DOKU, webhook bisa tiba beberapa detik kemudian.
    // Tanya status ke DOKU beberapa kali sampai status berubah dari "menunggu".
    (async () => {
      for (let attempt = 0; attempt < 4 && !stopPaymentPolling; attempt += 1) {
        try {
          const result = await callMarketplaceApi('check-payment', { orderId: requestedOrderId });
          if (result.order && result.order.status !== 'awaiting_payment') return;
        } catch (error) {
          console.error('[marketplace] pemeriksaan pembayaran gagal:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    })();
  }

  /* =====================================================================
   * MODE DAFTAR  →  pesanan.html (tanpa parameter)
   * ===================================================================== */
  let orders = [];

  const renderOrderList = () => {
    if (!orders.length) {
      container.innerHTML = '<div class="commerce-empty">Belum ada pesanan. <a href="beli.html">Pilih barang dari katalog</a>.</div>';
      return;
    }
    container.innerHTML = orders.map((order) => {
      const [label, badgeClass] = statusLabels[order.status] || ['Status diperiksa admin', 'bg-slate-100 text-slate-700'];
      const items = Array.isArray(order.items) ? order.items : [];
      const shipping = order.shippingAddress || {};
      const point = getMapPoint(shipping);
      const mapUrl = point ? `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}` : '';
      const canPay = order.status === 'awaiting_payment' && Number(order.paymentExpiresAt || 0) > Date.now();
      const itemMarkup = items.map((item) => `<li>${escapeHtml(item.name || 'Produk')} × ${Math.max(1, Number(item.qty || 1))} <span>${formatCurrency(item.subtotal || 0)}</span></li>`).join('');
      return `<article class="commerce-panel commerce-order-card" data-order-id="${escapeHtml(order.id)}">
        <header class="commerce-order-header"><div><strong>${escapeHtml(order.orderCode || order.id)}</strong><p class="muted">${escapeHtml(formatOrderDate(order.createdAt))}</p></div><span class="commerce-status ${badgeClass}">${label}</span></header>
        <ul class="commerce-order-items">${itemMarkup}</ul>
        <div class="commerce-order-total"><span>Total</span><strong>${formatCurrency(order.totalAmount || 0)}</strong></div>
        ${canPay ? `<p class="commerce-payment-countdown" data-payment-countdown="${Number(order.paymentExpiresAt)}"></p>` : ''}
        <div class="commerce-order-shipping"><strong>Alamat pengiriman</strong><p>${escapeHtml(shipping.recipientName || '')} · ${escapeHtml(shipping.phone || '')}<br>${formatAddress(shipping)}${shipping.note ? `<br>Catatan: ${escapeHtml(shipping.note)}` : ''}</p>${mapUrl ? `<a href="${mapUrl}" target="_blank" rel="noopener noreferrer">Lihat di Google Maps</a>` : ''}</div>
        ${order.trackingNumber ? `<p class="commerce-tracking"><strong>${escapeHtml(order.courier || 'Kurir')}:</strong> ${escapeHtml(order.trackingNumber)}</p>` : ''}
        <footer class="commerce-order-actions">
          <a class="btn btn-soft" href="pesanan.html?orderId=${encodeURIComponent(order.id)}">Lihat detail</a>
          ${canPay ? `<button class="btn btn-primary" type="button" data-pay-order="${escapeHtml(order.id)}">Bayar Sekarang</button><button class="btn btn-secondary" type="button" data-cancel-order="${escapeHtml(order.id)}">Batalkan</button>` : ''}
          <a class="btn btn-secondary" href="chat.html?orderId=${encodeURIComponent(order.id)}">Tanya Admin</a>
        </footer>
      </article>`;
    }).join('');
    bindOrderActions(loadOrders);
    updatePaymentCountdowns();
  };

  async function loadOrders() {
    const snapshot = await getDocs(query(collection(db, 'marketplace_orders'), where('userId', '==', userId)));
    orders = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));
    renderOrderList();
  }

  async function runListMode() {
    if (eyebrowEl) eyebrowEl.textContent = 'Riwayat Pesanan';
    if (titleEl) titleEl.textContent = 'Pesanan Saya';
    if (backEl) backEl.classList.remove('is-visible');
    container.innerHTML = '<p class="muted">Memuat pesanan...</p>';
    try {
      await callMarketplaceApi('release-expired-reservations');
      await loadOrders();
    } catch (error) {
      console.error('[marketplace] gagal memuat pesanan:', error);
      setStatus(`Gagal memuat pesanan (${error.code || 'unknown'}): ${error.message}`);
      container.innerHTML = '<p class="commerce-error">Pesanan gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>';
    }
  }

  window.addEventListener('beforeunload', () => {
    stopPaymentPolling = true;
    if (countdownInterval) clearInterval(countdownInterval);
    if (detailUnsubscribe) detailUnsubscribe();
  }, { once: true });

  if (isDetailMode) await runDetailMode();
  else await runListMode();
}

async function renderProductsForBuyer() {
  const container = document.querySelector('[data-buyer-list]');
  if (!container) return;

  container.innerHTML = renderBuyerProductsLoadingState();
  bindAddToCartButtons(container);

  let latestItems = [];
  const renderFromItems = (items) => {
    const visibleItems = normalizeMarketplaceProducts(
      [...items].sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt))
    );

    if (!visibleItems.length) {
      container.innerHTML = window.__marketplaceProductsError
        ? marketplaceLoadErrorMarkup()
        : `
        <div class="panel" style="padding: 20px; grid-column: 1 / -1;">
          <p class="muted">Belum ada barang yang tersedia saat ini.</p>
        </div>
      `;
      return;
    }

    const controls = container.closest('.panel') || document;
    const search = (controls.querySelector('[data-product-search]')?.value || '').trim().toLocaleLowerCase('id');
    const category = controls.querySelector('[data-product-category]')?.value || 'all';
    const status = controls.querySelector('[data-product-status]')?.value || 'all';
    const filteredItems = visibleItems.filter((item) =>
      (!search || item.name.toLocaleLowerCase('id').includes(search)) &&
      (category === 'all' || item.category === category) &&
      (status === 'all' || item.status === status)
    );

    container.innerHTML = `${marketplaceLoadErrorMarkup()}${filteredItems.length ? filteredItems.map((normalized) => {
      const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${escapeHtml(normalized.name)}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
      const available = normalized.stock > 0;
      const chatHref = currentUser() ? getBuyerChatUrl(normalized.id, normalized.name) : 'login.html';
      const statusStyle = normalized.stock === 0
        ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;'
        : normalized.stock <= 2
          ? 'background: #fef3c7; color: #92400e; border: 1px solid #fde68a;'
          : 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;';
      return `
        <article class="product-card">
          <div class="image">${imageMarkup} <span class="chip">${escapeHtml(normalized.label)}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(normalized.price)}</div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
                <span class="condition">${escapeHtml(normalized.condition)}</span>
                <span class="condition" style="${statusStyle}">${normalized.stock > 0 ? `Stok: ${normalized.stock}` : 'Terjual/Habis'}</span>
              </div>
            </div>
            <h3>${escapeHtml(normalized.name)}</h3>
            <p>${escapeHtml(normalized.description)}</p>
            <div class="seller-row">
              <span>${escapeHtml(normalized.city)}</span>
              <span>Marketplace Mantan</span>
            </div>
            <div class="card-actions">
              <a class="btn btn-soft" href="${getProductDetailUrl(normalized.id)}">Detail</a>
              ${available ? `<button class="btn btn-primary" type="button" data-add-cart="${escapeHtml(normalized.id)}">+ Keranjang</button><a class="btn btn-secondary" href="${chatHref}">Chat admin</a>` : '<button class="btn btn-secondary" type="button" disabled>Stok habis</button>'}
            </div>
          </div>
        </article>
      `;
    }).join('') : '<div class="panel" style="padding: 20px; grid-column: 1 / -1;"><p class="muted">Tidak ada produk yang cocok dengan pencarian dan filter.</p></div>'}`;
  };

  const reload = async () => {
    try {
      latestItems = await fetchProductsFromFirebase();
      renderFromItems(latestItems);
    } catch (error) {
      console.error('[marketplace] gagal memuat katalog pembeli:', error);
      window.__marketplaceProductsError = { code: error?.code || 'unknown', message: error?.message || 'Terjadi kesalahan saat membaca katalog.' };
      renderFromItems(latestItems);
    }
  };
  bindMarketplaceRetry(container, reload);
  document.querySelectorAll('[data-product-search], [data-product-category], [data-product-status]').forEach((control) => {
    control.addEventListener(control.matches('[data-product-search]') ? 'input' : 'change', () => renderFromItems(latestItems));
  });
  await reload();

  const productsQuery = collection(db, 'marketplace_products');
  const unsubscribe = onSnapshot(productsQuery, { includeMetadataChanges: true }, (snapshot) => {
    const liveItems = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    console.log('[marketplace] produk dimuat:', liveItems.length);
    latestItems = liveItems;
    cacheMarketplaceProducts(liveItems);
    if (snapshot.metadata.fromCache) {
      window.__marketplaceProductsError ||= { code: 'unavailable', message: 'Firestore belum memberikan data terbaru; katalog memakai data tersimpan.' };
      window.__marketplaceProductsFromCache = liveItems.length > 0;
    } else {
      delete window.__marketplaceProductsError;
      delete window.__marketplaceProductsFromCache;
    }
    renderFromItems(liveItems);
  }, (error) => {
    console.error('[marketplace] realtime buyer products gagal:', error);
    window.__marketplaceProductsError = { code: error?.code || 'unknown', message: error?.message || 'Terjadi kesalahan saat membaca katalog.' };
    window.__marketplaceProductsFromCache = latestItems.length > 0;
    renderFromItems(latestItems);
  });

  window.__marketplaceBuyerProductsCleanup = unsubscribe;
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
  const shipping = user.shipping || {};

  if (nameField) nameField.value = user.name || '';
  if (usernameField) usernameField.value = user.username || (user.name || 'user').toLowerCase().replace(/\s+/g, '');
  if (emailField) emailField.value = user.email || '';
  if (phoneField) phoneField.value = user.phone || '';
  if (bioField) bioField.value = user.bio || '';
  if (cityField) cityField.value = user.city || user.address || user.location || '';

  const shippingFields = {
    recipientName: document.querySelector('[name="shippingRecipientName"]'),
    phone: document.querySelector('[name="shippingPhone"]'),
    address: document.querySelector('[name="shippingAddress"]'),
    city: document.querySelector('[name="shippingCity"]'),
    province: document.querySelector('[name="shippingProvince"]'),
    postalCode: document.querySelector('[name="shippingPostalCode"]'),
    note: document.querySelector('[name="shippingNote"]'),
    latitude: document.querySelector('[name="shippingLatitude"]'),
    longitude: document.querySelector('[name="shippingLongitude"]')
  };
  Object.entries(shippingFields).forEach(([key, field]) => {
    if (field) field.value = shipping[key] ?? '';
  });
  if (shippingFields.recipientName && !shippingFields.recipientName.value) shippingFields.recipientName.value = user.name || '';
  if (shippingFields.phone && !shippingFields.phone.value) shippingFields.phone.value = user.phone || '';
  if (shippingFields.address && !shippingFields.address.value) shippingFields.address.value = user.address || user.location || '';
  if (shippingFields.city && !shippingFields.city.value) shippingFields.city.value = user.city || '';
  if (shippingFields.latitude && !shippingFields.latitude.value && user.latitude !== undefined) shippingFields.latitude.value = user.latitude;
  if (shippingFields.longitude && !shippingFields.longitude.value && user.longitude !== undefined) shippingFields.longitude.value = user.longitude;

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
  const shippingMapPreview = form.querySelector('[data-shipping-map-preview]');
  const shippingMapLink = form.querySelector('[data-shipping-map-link]');
  const shippingMapsUrl = form.querySelector('#shippingMapsUrl');
  const shippingStatus = form.querySelector('[data-shipping-completeness]');
  const shippingLocationStatus = form.querySelector('[data-shipping-location-status]');
  const parseMapsButton = form.querySelector('[data-parse-shipping-map]');
  const shippingLocationButton = form.querySelector('[data-use-shipping-location]');

  if (shippingMapsUrl && typeof shipping.mapsUrl === 'string' && /^https:\/\//i.test(shipping.mapsUrl)) {
    shippingMapsUrl.value = shipping.mapsUrl;
  }

  const getShippingCoordinates = () => {
    const latitudeText = String(shippingFields.latitude?.value || '').trim();
    const longitudeText = String(shippingFields.longitude?.value || '').trim();
    if (!latitudeText || !longitudeText) return null;
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
      ? { latitude, longitude }
      : null;
  };

  const updateShippingPreview = () => {
    const coordinates = getShippingCoordinates();
    const addressComplete = Boolean(
      shippingFields.recipientName?.value.trim() &&
      shippingFields.phone?.value.trim() &&
      shippingFields.address?.value.trim() &&
      coordinates
    );

    if (shippingStatus) {
      shippingStatus.textContent = addressComplete ? 'Alamat lengkap' : 'Alamat belum lengkap';
      shippingStatus.style.color = addressComplete ? '#15803d' : '#b45309';
    }

    if (!coordinates) {
      if (shippingMapPreview) shippingMapPreview.innerHTML = '<div class="map-placeholder"><span class="material-symbols-outlined map-placeholder-icon">location_on</span></div>';
      if (shippingMapLink) shippingMapLink.hidden = true;
      return;
    }

    const { latitude, longitude } = coordinates;
    const mapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
    if (shippingMapPreview) {
      shippingMapPreview.innerHTML = `<iframe title="Titik alamat pengiriman" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapUrl}"></iframe>`;
    }
    if (shippingMapLink) {
      shippingMapLink.href = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
      shippingMapLink.hidden = false;
      shippingMapLink.textContent = 'Buka di Google Maps';
    }
  };

  const parseGoogleMapsCoordinates = (rawValue) => {
    let url;
    try {
      url = new URL(rawValue);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'https:') return null;

    const candidate = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('ll') || '';
    const queryMatch = candidate.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    const pathMatch = url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const placeMatch = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const match = queryMatch || pathMatch || placeMatch;
    if (!match) return null;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  };

  const syncShippingCoordinates = (latitude, longitude, message = '') => {
    if (shippingFields.latitude) shippingFields.latitude.value = String(Number(latitude.toFixed(6)));
    if (shippingFields.longitude) shippingFields.longitude.value = String(Number(longitude.toFixed(6)));
    const canonicalUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    if (shippingMapsUrl) shippingMapsUrl.value = canonicalUrl;
    if (shippingLocationStatus) shippingLocationStatus.textContent = message;
    updateShippingPreview();
  };

  [shippingFields.recipientName, shippingFields.phone, shippingFields.address, shippingFields.latitude, shippingFields.longitude].forEach((field) => {
    field?.addEventListener('input', updateShippingPreview);
  });

  parseMapsButton?.addEventListener('click', () => {
    const url = String(shippingMapsUrl?.value || '').trim();
    const coordinates = parseGoogleMapsCoordinates(url);
    if (!coordinates) {
      showPopup('Link Google Maps HTTPS tidak berisi koordinat yang valid.', 'Link tidak valid', 'error');
      return;
    }
    syncShippingCoordinates(coordinates.latitude, coordinates.longitude, 'Koordinat diambil dari link Google Maps.');
  });

  shippingLocationButton?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showPopup('Browser Anda tidak mendukung pembacaan lokasi otomatis.', 'Lokasi tidak tersedia', 'error');
      return;
    }
    shippingLocationButton.disabled = true;
    if (shippingLocationStatus) shippingLocationStatus.textContent = 'Mencari lokasi...';
    navigator.geolocation.getCurrentPosition((position) => {
      syncShippingCoordinates(position.coords.latitude, position.coords.longitude, 'Lokasi berhasil dipakai.');
      shippingLocationButton.disabled = false;
    }, (error) => {
      console.error('[marketplace] gagal membaca lokasi pengiriman:', error);
      if (shippingLocationStatus) shippingLocationStatus.textContent = 'Gagal mengambil lokasi';
      showPopup('Tidak dapat mengambil lokasi. Izinkan akses lokasi atau isi koordinat manual.', 'Lokasi gagal', 'error');
      shippingLocationButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  updateShippingPreview();

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
        city: shippingFields.city?.value.trim() || formData.get('alamat') || user.city || user.address || user.location,
        address: shippingFields.address?.value.trim() || formData.get('alamat') || user.address || user.city || user.location,
        location: shippingFields.address?.value.trim() || formData.get('alamat') || user.location || user.address || user.city,
        latitude: formData.get('latitude') || user.latitude || '',
        longitude: formData.get('longitude') || user.longitude || '',
        shipping: {
          recipientName: shippingFields.recipientName?.value.trim() || '',
          phone: shippingFields.phone?.value.trim() || '',
          address: shippingFields.address?.value.trim() || '',
          city: shippingFields.city?.value.trim() || '',
          province: shippingFields.province?.value.trim() || '',
          postalCode: shippingFields.postalCode?.value.trim() || '',
          note: shippingFields.note?.value.trim() || '',
          latitude: getShippingCoordinates()?.latitude ?? '',
          longitude: getShippingCoordinates()?.longitude ?? '',
          mapsUrl: getShippingCoordinates()
            ? `https://www.google.com/maps/search/?api=1&query=${getShippingCoordinates().latitude},${getShippingCoordinates().longitude}`
            : '',
          updatedAt: Date.now()
        },
        photoUrl
      };

      updatedUser.latitude = updatedUser.shipping.latitude !== '' ? updatedUser.shipping.latitude : updatedUser.latitude;
      updatedUser.longitude = updatedUser.shipping.longitude !== '' ? updatedUser.shipping.longitude : updatedUser.longitude;

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

function bindBrandScrollToTop() {
  const brandLinks = document.querySelectorAll('.brand');
  if (!brandLinks.length) return;

  brandLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const currentPath = window.location.pathname;
      const isMarketplaceHome = currentPath.endsWith('/user/marketplace/index.html') || currentPath.endsWith('/user/marketplace/') || currentPath.endsWith('/user/marketplace');

      if (isMarketplaceHome) {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      event.preventDefault();
      window.location.href = 'index.html';
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
  if (detailStatus) detailStatus.textContent = normalized.stock > 0 ? 'Tersedia' : 'Terjual/Habis';
  const detailStock = document.querySelector('[data-detail-stock]');
  if (detailStock) detailStock.textContent = normalized.stock > 0 ? `Stok: ${normalized.stock}` : 'Stok habis';

  const detailName = document.querySelector('[data-detail-name]');
  if (detailName) detailName.textContent = normalized.name;

  const detailDescription = document.querySelector('[data-detail-description]');
  if (detailDescription) detailDescription.textContent = normalized.description;

  const detailCategory = document.querySelector('[data-detail-category]');
  if (detailCategory) detailCategory.textContent = normalized.label;

  const detailCity = document.querySelector('[data-detail-city]');
  if (detailCity) detailCity.textContent = normalized.city;

  const detailSeller = document.querySelector('[data-detail-seller]');
  if (detailSeller) detailSeller.textContent = 'Marketplace Mantan';

  const detailSellerInitial = document.querySelector('[data-detail-seller-initial]');
  if (detailSellerInitial) {
    detailSellerInitial.textContent = 'M';
    detailSellerInitial.classList.remove('has-photo');
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
    const chatUrl = getBuyerChatUrl(normalized.id, normalized.name);

    chatButton.style.display = normalized.stock > 0 ? '' : 'none';
    chatButton.href = currentUserData ? chatUrl : getAuthTarget();
    chatButton.removeAttribute('aria-disabled');
    chatButton.removeAttribute('tabindex');
  }

  const quantityOutput = document.querySelector('[data-product-quantity]');
  const decreaseQuantity = document.querySelector('[data-product-quantity-step="-1"]');
  const increaseQuantity = document.querySelector('[data-product-quantity-step="1"]');
  let quantity = 1;
  const syncQuantity = () => {
    quantity = Math.max(1, Math.min(normalized.stock || 1, quantity));
    if (quantityOutput) quantityOutput.textContent = String(quantity);
    if (decreaseQuantity) decreaseQuantity.disabled = normalized.stock <= 0 || quantity <= 1;
    if (increaseQuantity) increaseQuantity.disabled = normalized.stock <= 0 || quantity >= normalized.stock || quantity >= 99;
  };
  decreaseQuantity?.addEventListener('click', () => { quantity -= 1; syncQuantity(); });
  increaseQuantity?.addEventListener('click', () => { quantity += 1; syncQuantity(); });
  syncQuantity();

  const addButton = document.querySelector('[data-add-to-cart]');
  const buyButton = document.querySelector('[data-buy-now]');
  [addButton, buyButton].forEach((button) => {
    if (!button) return;
    button.disabled = normalized.stock <= 0;
    if (normalized.stock <= 0) button.textContent = 'Stok habis';
    button.addEventListener('click', () => {
      if (normalized.stock <= 0) return;
      if (!currentUser()) {
        window.location.href = getAuthTarget();
        return;
      }
      addProductToCart(normalized.id, quantity, button === buyButton);
    });
  });
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
    const target = window.location.pathname.includes('/user/') ? '../../index.html' : 'index.html';
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

async function init() {
  ensureDemoData();
  handleSidebarState();
  bindLogoutButtons();
  bindMobileSidebar();
  bindHeaderActionsMenu();
  bindPasswordToggles();
  hydrateUserProfileUI();

  onAuthStateChanged(auth, async (firebaseUser) => {
    try {
      if (firebaseUser && String(firebaseUser.email || '').toLowerCase() !== ADMIN_ACCOUNT_EMAIL) {
        await syncCurrentUserFromFirebase(firebaseUser, localStorage.getItem('gamon_marketplace_remember_me') === '1');
        hydrateUserProfileUI();

        if (!window.__marketplaceCartUnsubscribe) {
          window.__marketplaceCartUnsubscribe = subscribeToCartBadge();
        }

        if (!window.__marketplaceGlobalChatUnsubscribe) {
          const currentUserId = getCurrentUserIdentifier();
          if (currentUserId) {
            window.__marketplaceGlobalChatUnsubscribe = subscribeToGlobalChatNotifications(currentUserId);
          }
        }
      }
    } catch (error) {
      console.error('[marketplace] gagal menyinkronkan sesi pembeli:', error);
    }
  });

  const page = document.body.dataset.page;
  bindKineticHeroIfNeeded();
  bindBrandScrollToTop();

  if (page === 'login' || page === 'register') {
    bindAuthPage();
    return;
  }

  if (page === 'dashboard.html') {
    await renderDashboard();
    return;
  }

  if (page === 'beli.html') {
    await renderProductsForBuyer();
    return;
  }

  if (page === 'pesanan.html') {
    await renderOrdersForBuyer();
    return;
  }

  if (page === 'keranjang.html') {
    await renderCartPage();
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
  await refreshMarketplaceLandingMetrics();
}

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', () => {
  if (window.__marketplaceChatCleanup) window.__marketplaceChatCleanup();
  if (window.__marketplaceHomeProductsCleanup) window.__marketplaceHomeProductsCleanup();
  if (window.__marketplaceBuyerProductsCleanup) window.__marketplaceBuyerProductsCleanup();
  if (window.__marketplaceGlobalChatUnsubscribe) window.__marketplaceGlobalChatUnsubscribe();
  if (window.__marketplaceCartUnsubscribe) window.__marketplaceCartUnsubscribe();
});