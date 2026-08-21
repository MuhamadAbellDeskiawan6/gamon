import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, orderBy, where, onSnapshot, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

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
const storage = getStorage(app);

const STORAGE_KEYS = {
  USERS: 'gamon_marketplace_users',
  PRODUCTS: 'gamon_marketplace_products',
  USER: 'gamon_marketplace_current_user',
  CHATS: 'gamon_marketplace_chats',
  LOGIN_ATTEMPTS: 'gamon_marketplace_login_attempts'
};

const productSeed = [
  {
    id: 'p1',
    name: 'Hoodie Putih Premium',
    category: 'pakaian',
    price: 280000,
    condition: 'Layak pakai',
    image: '👕',
    label: 'Pakaian',
    city: 'Jakarta',
    seller: 'Annisa',
    sellerInitial: 'A',
    sellerId: 'u1',
    ownerId: 'u1',
    description: 'Hoodie berwarna putih, kondisi masih bagus, ukuran L, nyaman dipakai sehari-hari.'
  },
  {
    id: 'p2',
    name: 'Jam Tangan Casio',
    category: 'aksesori',
    price: 620000,
    condition: 'Bekas terawat',
    image: '⌚',
    label: 'Aksesori',
    city: 'Bandung',
    seller: 'Raka',
    sellerInitial: 'R',
    sellerId: 'demo-raka',
    ownerId: 'demo-raka',
    description: 'Jam tangan masih berfungsi baik, tampilan bersih, dan siap dipakai.'
  },
  {
    id: 'p3',
    name: 'Set Kado Anniversary',
    category: 'barang',
    price: 450000,
    condition: 'Baru',
    image: '🎁',
    label: 'Kado',
    city: 'Surabaya',
    seller: 'Dinda',
    sellerInitial: 'D',
    sellerId: 'demo-dinda',
    ownerId: 'demo-dinda',
    description: 'Terdiri dari tas kecil, parfum, dan aksesori dengan kemasan elegan.'
  },
  {
    id: 'p4',
    name: 'Jaket Oversize',
    category: 'pakaian',
    price: 200000,
    condition: 'Cukup bagus',
    image: '🧥',
    label: 'Pakaian',
    city: 'Yogyakarta',
    seller: 'Sari',
    sellerInitial: 'S',
    sellerId: 'demo-sari',
    ownerId: 'demo-sari',
    description: 'Jaket oversize dengan bahan nyaman dan warna krem yang timeless.'
  }
];

const demoUsers = [
  {
    id: 'u1',
    name: 'Annisa Rahma',
    email: 'annisa@email.com',
    phone: '081234567890',
    bio: 'Saya suka barang dengan cerita, tapi lebih suka melihat barang bisa berpindah ke rumah baru yang lebih tepat.',
    city: 'Jakarta Selatan',
    username: 'annisarahma'
  }
];

const chatSeed = {
  Raka: [
    { from: 'Raka', text: 'Halo, jam tangan ini masih berfungsi dengan baik. Kalau kamu tertarik, saya bisa kirim detail lebih lanjut.' },
    { from: 'Me', text: 'Oke, boleh kirim foto bagian belakang dan kondisi jarum jamnya.' },
    { from: 'Raka', text: 'Siap, saya kirim foto hari ini juga. Kalau cocok, bisa deal di harga 600 ribu.' }
  ],
  Dinda: [
    { from: 'Dinda', text: 'Set kado anniversary masih rapi dan siap dipakai. Mau lihat detailnya?' }
  ]
};

const moneyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
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

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

function ensureDemoData() {
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

function getSafeUserName(name) {
  if (!name) return 'Pengguna';
  return name.trim() || 'Pengguna';
}

function getUserInitial(name) {
  const source = getSafeUserName(name || 'Pengguna');
  return source.charAt(0).toUpperCase();
}

function hydrateUserProfileUI() {
  const user = currentUser();
  if (!user) return;

  const name = getSafeUserName(user.name);
  const initial = getUserInitial(user.name);

  document.querySelectorAll('[data-user-name]').forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll('.profile-box strong').forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll('.avatar-lg').forEach((element) => {
    element.textContent = initial;
  });

  document.querySelectorAll('[data-greeting]').forEach((element) => {
    element.textContent = `Halo, ${name}`;
  });

  document.querySelectorAll('[data-profile-title]').forEach((element) => {
    element.textContent = name;
  });
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
    return readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
  }
}

async function fetchMyProductsFromFirebase(user) {
  const ownerId = user?.id || user?.uid || auth.currentUser?.uid;
  const localItems = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);

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
  return {
    id: item.id || item.slug || `p-${Date.now()}`,
    name: item.name || 'Barang baru',
    category: item.category || 'barang',
    price: Number(item.price || 0),
    condition: item.condition || 'Layak pakai',
    image: item.image || productEmoji(item.category),
    label: item.label || productLabel(item.category),
    city: item.city || 'Jakarta',
    seller: item.seller || 'Penjual',
    sellerInitial: item.sellerInitial || (item.seller || 'P').charAt(0).toUpperCase(),
    description: item.description || 'Deskripsi produk belum tersedia.',
    imageUrl: item.imageUrl || '',
    createdAt: item.createdAt || Date.now(),
    ownerId: item.ownerId || item.owner_id || '',
    sellerId: item.sellerId || item.ownerId || item.owner_id || ''
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

function findMatchingThreadKey(targetUserId, targetName, currentUserId) {
  const threads = readChatThreads();
  const normalizedTarget = normalizeUserIdentifier(targetUserId || resolveUserIdByName(targetName) || targetName || '').toLowerCase();
  const normalizedTargetName = normalizeUserIdentifier(targetName || '').toLowerCase();
  const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();

  const keys = Object.keys(threads).sort((a, b) => {
    const aTime = Number(threads[a]?.messages?.[threads[a].messages.length - 1]?.createdAt || 0);
    const bTime = Number(threads[b]?.messages?.[threads[b].messages.length - 1]?.createdAt || 0);
    return bTime - aTime;
  });

  const exactMatch = keys.find((key) => {
    const thread = threads[key] || {};
    const participants = thread.participants || [];
    const hasCurrent = participants.some((participant) => normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase() === normalizedCurrent);
    const hasTarget = participants.some((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return participantId === normalizedTarget || participantName === normalizedTargetName || participantName === normalizedTarget;
    });
    return hasCurrent && hasTarget;
  });

  if (exactMatch) return exactMatch;

  const realThread = keys.find((key) => {
    const thread = threads[key] || {};
    const participants = thread.participants || [];
    const hasCurrent = participants.some((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return participantId === normalizedCurrent || participantName === normalizedCurrent;
    });
    const hasRealCounterpart = participants.some((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return !!participantId && !isPlaceholderUser(participantId) && !isPlaceholderUser(participantName) && participantId !== normalizedCurrent && participantName !== normalizedCurrent;
    });
    return hasCurrent && hasRealCounterpart;
  });

  return realThread || '';
}

async function findFirestoreThreadId(currentUserId, targetUserId, targetName) {
  try {
    const snapshot = await getDocs(collection(db, 'marketplace_chats'));
    const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();
    const normalizedTarget = normalizeUserIdentifier(targetUserId || resolveUserIdByName(targetName) || targetName || '').toLowerCase();
    const normalizedTargetName = normalizeUserIdentifier(targetName || '').toLowerCase();
    const ignoreTarget = isPlaceholderUser(targetUserId || targetName);

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const hasCurrent = participants.some((participant) => {
        const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
        const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
        return participantId === normalizedCurrent || participantName === normalizedCurrent;
      });
      const hasTarget = ignoreTarget ? true : participants.some((participant) => {
        const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
        const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
        return participantId === normalizedTarget || participantName === normalizedTargetName || participantName === normalizeUserIdentifier(targetUserId || '').toLowerCase();
      });

      if (hasCurrent && hasTarget) {
        return docSnap.id;
      }
    }

    return null;
  } catch (error) {
    console.warn('Gagal mencari thread Firestore:', error);
    return null;
  }
}

async function findExactThreadForCurrentUser(currentUserId, currentUserName, targetUserId, targetName) {
  try {
    const snapshot = await getDocs(collection(db, 'marketplace_chats'));
    const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();
    const normalizedCurrentName = normalizeUserIdentifier(currentUserName || '').toLowerCase();
    const normalizedTarget = normalizeUserIdentifier(targetUserId || resolveUserIdByName(targetName) || targetName || '').toLowerCase();
    const normalizedTargetName = normalizeUserIdentifier(targetName || '').toLowerCase();
    const ignoreTarget = isPlaceholderUser(targetUserId || targetName);

    const matches = [];
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const containsCurrentUser = participants.some((participant) => {
        const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
        const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
        return participantId === normalizedCurrent || participantName === normalizedCurrent || participantName === normalizedCurrentName;
      });

      const containsTargetUser = ignoreTarget ? true : participants.some((participant) => {
        const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
        const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
        return participantId === normalizedTarget || participantName === normalizedTargetName || participantName === normalizedTarget;
      });

      if (containsCurrentUser && containsTargetUser) {
        matches.push({
          id: docSnap.id,
          data: data,
          updatedAt: Number(data.updatedAt || data.lastMessageAt || 0),
          participants: participants
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return matches[0];
  } catch (error) {
    console.warn('Gagal mencari thread exact untuk user aktif:', error);
    return null;
  }
}

async function findActiveThreadForCurrentUser(currentUserId, currentUserName) {
  try {
    const snapshot = await getDocs(collection(db, 'marketplace_chats'));
    const normalizedCurrent = normalizeUserIdentifier(currentUserId || '').toLowerCase();
    const normalizedCurrentName = normalizeUserIdentifier(currentUserName || '').toLowerCase();
    const matches = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const isMine = participants.some((participant) => {
        const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
        const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
        return participantId === normalizedCurrent || participantName === normalizedCurrentName || participantName === normalizedCurrent;
      });

      if (isMine) {
        matches.push({
          id: docSnap.id,
          updatedAt: Number(data.updatedAt || data.lastMessageAt || 0),
          participants: participants,
          messages: Array.isArray(data.messages) ? data.messages : []
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return matches[0];
  } catch (error) {
    console.warn('Gagal mencari thread aktif untuk user:', error);
    return null;
  }
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

function getChatThreadId(userA, userB) {
  const left = normalizeUserIdentifier(userA || '').toLowerCase();
  const right = normalizeUserIdentifier(userB || '').toLowerCase();
  return [left, right].sort().join('__');
}

function readChatThreads() {
  return readStorage('gamon_marketplace_threads', {});
}

function writeChatThreads(data) {
  writeStorage('gamon_marketplace_threads', data);
}

function sanitizeChatThreadCache(currentUserId, currentUserName) {
  const threads = readChatThreads();
  const normalizedCurrentId = normalizeUserIdentifier(currentUserId || '').toLowerCase();
  const normalizedCurrentName = normalizeUserIdentifier(currentUserName || '').toLowerCase();

  const cleaned = Object.fromEntries(Object.entries(threads).filter(([key, thread]) => {
    const participants = Array.isArray(thread?.participants) ? thread.participants : [];
    if (!participants.length) return true;

    const hasCurrentUser = participants.some((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return participantId === normalizedCurrentId || participantName === normalizedCurrentName || participantName === normalizedCurrentId;
    });

    const hasMeaningfulParticipant = participants.some((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return !!participantId && !isPlaceholderUser(participantId) && !isPlaceholderUser(participantName);
    });

    const allParticipantsPlaceholder = participants.length > 0 && participants.every((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return isPlaceholderUser(participantId) || isPlaceholderUser(participantName);
    });

    return hasCurrentUser && (hasMeaningfulParticipant || !allParticipantsPlaceholder);
  }));

  if (Object.keys(cleaned).length !== Object.keys(threads).length) {
    writeChatThreads(cleaned);
  }

  return cleaned;
}

function getThreadSummary(thread) {
  const messages = thread?.messages || [];
  const lastMessage = messages[messages.length - 1];
  return {
    lastMessageText: lastMessage ? lastMessage.text : 'Belum ada pesan',
    lastMessageAt: lastMessage ? lastMessage.createdAt || 0 : 0,
    unreadCount: Number(thread?.unreadCount || 0)
  };
}

function updateThreadUnread(threadKey, viewerUserId, senderId) {
  const threads = readChatThreads();
  const thread = threads[threadKey] || { messages: [], unreadCount: 0 };
  const currentUserId = normalizeUserIdentifier(viewerUserId || '').toLowerCase();
  const senderUserId = normalizeUserIdentifier(senderId || '').toLowerCase();

  if (senderUserId !== currentUserId) {
    thread.unreadCount = Number(thread.unreadCount || 0) + 1;
  }

  threads[threadKey] = thread;
  writeChatThreads(threads);
}

function markThreadRead(threadKey, userId) {
  const threads = readChatThreads();
  const thread = threads[threadKey];
  if (!thread) return;
  thread.unreadCount = 0;
  threads[threadKey] = thread;
  writeChatThreads(threads);
}

function renderProductCards(items) {
  return items.map((item) => {
    const normalized = normalizeProduct(item);
    const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${normalized.name}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
    return `
      <article class="product-card" data-category="${normalized.category}">
        <div class="image">${imageMarkup} <span class="chip">${normalized.label}</span></div>
        <div class="product-body">
          <div class="product-head">
            <div class="price">${formatCurrency(normalized.price)}</div>
            <span class="condition">${normalized.condition}</span>
          </div>
          <h3>${normalized.name}</h3>
          <p>${normalized.description}</p>
          <div class="seller-row">
            <span class="seller-meta"><span class="avatar">${normalized.sellerInitial}</span> ${normalized.seller}</span>
            <span>${normalized.city}</span>
          </div>
          <div class="card-actions">
            <a class="btn btn-soft" href="product.html?id=${encodeURIComponent(normalized.id)}">Lihat detail</a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function renderHomeProducts() {
  const container = document.querySelector('[data-product-list]');
  if (!container) return;

  ensureDemoData();
  const renderFromItems = async (items) => {
    const normalized = items.map(normalizeProduct);
    container.innerHTML = renderProductCards(normalized);

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
      await sendEmailVerification(cred.user);

      const newUser = {
        id: cred.user.uid,
        name: `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || 'Pengguna',
        email: payload.email,
        phone: payload.phone || '',
        username: `${(payload.firstName || 'user').toLowerCase()}${(payload.lastName || '').toLowerCase()}`.trim() || 'user',
        bio: 'Saya membuka akun untuk jual dan beli barang dengan rasa aman dan nyaman.',
        city: 'Jakarta',
        role: payload.role || 'both',
        emailVerified: false
      };

      await setDoc(doc(db, 'marketplace_users', cred.user.uid), newUser);
      users.push(newUser);
      writeStorage(STORAGE_KEYS.USERS, users);
      clearCurrentUser();
      setAuthMessage('Akun berhasil dibuat. Silakan cek email dan klik link verifikasi sebelum masuk ke dashboard.', 'info');
      showPopup('Akun berhasil dibuat. Silakan cek email dan klik link verifikasi sebelum masuk ke dashboard.', 'Berhasil', 'success');
      if (submitButton) {
        submitButton.textContent = 'Akun dibuat';
      }
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1200);
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, payload.email, payload.password);
    if (!cred.user.emailVerified) {
      await signOut(auth);
      clearCurrentUser();
      setAuthMessage('Email belum diverifikasi. Cek inbox Anda lalu coba lagi setelah verifikasi.', 'error');
      showPopup('Email belum diverifikasi. Cek inbox Anda lalu coba lagi setelah verifikasi.', 'Verifikasi email', 'error');
      return;
    }

    const userDoc = await fetchUserDoc(cred.user.uid);
    const user = userDoc || {
      id: cred.user.uid,
      name: cred.user.displayName || 'Pengguna',
      email: cred.user.email,
      phone: '',
      username: 'user',
      bio: '',
      city: 'Jakarta',
      role: 'both',
      emailVerified: true
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
      userMessage = 'Email atau password salah. Pastikan akun sudah dibuat dan email sudah diverifikasi.';
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

async function handleResendVerification(event) {
  event.preventDefault();
  const emailInput = document.querySelector('#email');
  const passwordInput = document.querySelector('#password');
  const email = String((emailInput && emailInput.value) || '').trim();
  const password = String((passwordInput && passwordInput.value) || '').trim();

  if (!email) {
    setAuthMessage('Isi email terlebih dahulu untuk kirim ulang link verifikasi.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!password && !auth.currentUser) {
    setAuthMessage('Masukkan password untuk mengirim ulang link verifikasi.', 'error');
    if (passwordInput) passwordInput.focus();
    return;
  }

  try {
    const currentUser = auth.currentUser && auth.currentUser.email && auth.currentUser.email.toLowerCase() === email.toLowerCase() ? auth.currentUser : null;
    const verifiedUser = currentUser || await signInWithEmailAndPassword(auth, email, password);

    if (verifiedUser.user?.emailVerified) {
      await signOut(auth);
      clearCurrentUser();
      setAuthMessage('Email Anda sudah diverifikasi. Silakan login.', 'info');
      showPopup('Email Anda sudah diverifikasi. Silakan login.', 'Verifikasi selesai', 'success');
      return;
    }

    await sendEmailVerification(verifiedUser.user ?? verifiedUser);
    await signOut(auth);
    clearCurrentUser();
    setAuthMessage('Link verifikasi dikirim. Cek inbox atau folder Spam.', 'info');
    showPopup('Link verifikasi dikirim. Cek inbox atau folder Spam.', 'Berhasil', 'success');
  } catch (error) {
    console.error('Kirim ulang verifikasi gagal:', error);
    const rawMessage = error?.message || 'Gagal mengirim ulang link verifikasi.';
    const errorText = String(rawMessage).toLowerCase();
    const friendlyMessage = errorText.includes('invalid-credential') || errorText.includes('wrong-password') || errorText.includes('user-not-found')
      ? 'Password atau email salah. Pastikan akun sudah dibuat dan password benar.'
      : rawMessage;

    setAuthMessage(friendlyMessage, 'error');
    showPopup(friendlyMessage, 'Gagal', 'error');
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

  const resendBtn = document.querySelector('[data-resend-verification]');
  if (resendBtn) {
    resendBtn.addEventListener('click', handleResendVerification);
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
    if (!firebaseUser.emailVerified) {
      await signOut(auth);
      clearCurrentUser();
      setAuthMessage('Email Anda belum diverifikasi. Cek email lalu coba lagi.', 'error');
      return;
    }

    await syncCurrentUserFromFirebase(firebaseUser, true);
    if (window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html')) {
      window.location.href = 'user/dashboard.html';
    }
  });
}

function updateSidebarProfile() {
  hydrateUserProfileUI();
}

async function renderDashboard() {
  const user = requireAuth();
  if (!user) return;

  const greeting = document.querySelector('[data-greeting]');
  if (greeting) greeting.textContent = `Halo, ${getSafeUserName(user.name)}`;

  const products = await fetchProductsFromFirebase();
  const totalSold = products.filter((item) => item.condition === 'Terjual').length || 18;
  const totalOrders = Math.max(6, products.length + 2);
  const balance = 2400000;

  const soldEl = document.querySelector('[data-stat-sold]');
  if (soldEl) soldEl.textContent = String(totalSold);
  const orderEl = document.querySelector('[data-stat-orders]');
  if (orderEl) orderEl.textContent = String(totalOrders);
  const balanceEl = document.querySelector('[data-stat-balance]');
  if (balanceEl) balanceEl.textContent = formatCurrency(balance);

  updateSidebarProfile();
}

async function handleSellSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const user = currentUser() || requireAuth();
  if (!user) return;

  if (auth.currentUser && !auth.currentUser.emailVerified) {
    showPopup('Akun Anda belum diverifikasi. Verifikasi email terlebih dahulu sebelum menambah barang.', 'Verifikasi dibutuhkan', 'error');
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Menyimpan...';
  }

  try {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const fileInput = form.querySelector('input[type="file"]');
    const selectedFile = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (!payload.name || !payload.description || !payload.price || !payload.location) {
      throw new Error('Form jual belum lengkap. Isi nama barang, harga, lokasi, dan deskripsi terlebih dahulu.');
    }

    const productPayload = {
      name: payload.name || 'Barang Baru',
      category: payload.category || 'barang',
      price: Number(String(payload.price).replace(/[^\d]/g, '')) || 0,
      condition: payload.condition || 'Layak pakai',
      description: payload.description || 'Barang ini siap dijual.',
      city: payload.location || 'Jakarta',
      seller: user.name || 'Seller',
      sellerInitial: (user.name || 'S').charAt(0).toUpperCase(),
      sellerId: user.id || user.uid || auth.currentUser?.uid || '',
      ownerId: user.id || user.uid || auth.currentUser?.uid || '',
      image: payload.category === 'pakaian' ? '👕' : payload.category === 'aksesori' ? '⌚' : '🎁',
      label: productLabel(payload.category || 'barang'),
      imageUrl: '',
      createdAt: Date.now()
    };

    let firebaseStored = false;
    let firebaseError = null;

    if (selectedFile) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!allowedTypes.includes(selectedFile.type)) {
        throw new Error('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.');
      }

      try {
        productPayload.imageUrl = await fileToDataUrl(selectedFile);
        const authUserId = auth.currentUser?.uid || user.id || user.uid || 'local-user';
        const storageRef = ref(storage, `marketplace-products/${authUserId}/${Date.now()}-${selectedFile.name.replace(/\s+/g, '_')}`);
        const uploaded = await withTimeout(uploadBytes(storageRef, selectedFile), 8000, 'Upload foto');
        productPayload.imageUrl = await withTimeout(getDownloadURL(uploaded.ref), 8000, 'Ambil URL foto');
        firebaseStored = true;
      } catch (error) {
        firebaseError = error;
        productPayload.imageUrl = productPayload.imageUrl || await fileToDataUrl(selectedFile);
        console.warn('Firebase upload gagal, lanjutkan ke penyimpanan lokal:', error);
      }
    }

    try {
      if (productPayload.ownerId) {
        const productRef = await withTimeout(addDoc(collection(db, 'marketplace_products'), productPayload), 8000, 'Simpan produk');
        productPayload.id = productRef.id;
        await withTimeout(updateDoc(productRef, { id: productRef.id }), 8000, 'Update ID produk');
        firebaseStored = true;
      }
    } catch (error) {
      firebaseError = error;
      console.warn('Firebase Firestore gagal, gunakan penyimpanan lokal:', error);
    }

    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
    localProducts.unshift({ ...productPayload, id: productPayload.id || `local-${Date.now()}` });
    writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);

    if (firebaseError) {
      showPopup('Firebase sedang lambat atau belum aktif. Barang tetap tersimpan di perangkat dan bisa dilihat di halaman marketplace.', 'Pemberitahuan', 'error');
    } else {
      showPopup('Barang berhasil dipublish.', 'Berhasil', 'success');
    }

    window.location.href = 'dashboard.html';
  } catch (error) {
    console.error('Gagal publish produk:', error);
    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
    const fallbackProduct = {
      id: `local-${Date.now()}`,
      name: form.querySelector('[name="name"]').value || 'Barang Baru',
      category: form.querySelector('[name="category"]').value || 'barang',
      price: Number(String(form.querySelector('[name="price"]').value || '').replace(/[^\d]/g, '')) || 0,
      condition: form.querySelector('[name="condition"]').value || 'Layak pakai',
      description: form.querySelector('[name="description"]').value || 'Barang ini siap dijual.',
      city: form.querySelector('[name="location"]').value || 'Jakarta',
      seller: (currentUser() || {}).name || 'Seller',
      sellerInitial: ((currentUser() || {}).name || 'S').charAt(0).toUpperCase(),
      sellerId: (currentUser() || {}).id || (currentUser() || {}).uid || '',
      ownerId: (currentUser() || {}).id || (currentUser() || {}).uid || '',
      image: form.querySelector('[name="category"]').value === 'pakaian' ? '👕' : form.querySelector('[name="category"]').value === 'aksesori' ? '⌚' : '🎁',
      label: productLabel(form.querySelector('[name="category"]').value || 'barang'),
      imageUrl: '',
      createdAt: Date.now()
    };
    localProducts.unshift(fallbackProduct);
    writeStorage(STORAGE_KEYS.PRODUCTS, localProducts);

    showPopup(error.message || 'Proses menambahkan barang gagal, tapi data sudah disimpan di perangkat.', 'Gagal', 'error');
    window.location.href = 'dashboard.html';
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Publish iklan';
    }
  }
}

async function bindSellForm() {
  const form = document.querySelector('[data-sell-form]');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit');
  if (editId) {
    const localProducts = readStorage(STORAGE_KEYS.PRODUCTS, productSeed);
    const product = localProducts.find((item) => String(item.id) === String(editId));
    if (product) {
      form.querySelector('[name="name"]').value = product.name || '';
      form.querySelector('[name="category"]').value = product.category || 'barang';
      form.querySelector('[name="price"]').value = product.price || '';
      form.querySelector('[name="condition"]').value = product.condition || 'Layak pakai';
      form.querySelector('[name="description"]').value = product.description || '';
      form.querySelector('[name="location"]').value = product.city || '';
      form.dataset.editId = editId;
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = 'Update iklan';
    }
  }

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
          price: Number(String(payload.price).replace(/[^\d]/g, '')) || 0,
          condition: payload.condition,
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
          const uploadRef = ref(storage, `marketplace-products/${currentUser()?.id || 'local-user'}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`);
          const uploaded = await withTimeout(uploadBytes(uploadRef, file), 8000, 'Upload foto update');
          updatedData.imageUrl = await withTimeout(getDownloadURL(uploaded.ref), 8000, 'Ambil URL update');
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
      const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${normalized.name}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
      const sellerRef = normalizeUserIdentifier(normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '');
      const chatHref = `chat.html?user=${encodeURIComponent(normalized.seller || 'Penjual')}&userId=${encodeURIComponent(sellerRef || normalized.seller || '')}`;
      return `
        <article class="product-card">
          <div class="image">${imageMarkup} <span class="chip">${normalized.label}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(normalized.price)}</div>
              <span class="condition">${normalized.condition}</span>
            </div>
            <h3>${normalized.name}</h3>
            <p>${normalized.description}</p>
            <div class="seller-row">
              <span>${normalized.city}</span>
              <span>Penjual: ${normalized.seller}</span>
            </div>
            <div class="card-actions">
              <a class="btn btn-soft" href="../product.html?id=${encodeURIComponent(normalized.id)}">Detail</a>
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
      const imageMarkup = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${normalized.name}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;
      return `
        <article class="product-card">
          <div class="image">${imageMarkup} <span class="chip">${normalized.label}</span></div>
          <div class="product-body">
            <div class="product-head">
              <div class="price">${formatCurrency(normalized.price)}</div>
              <span class="condition">${normalized.condition}</span>
            </div>
            <h3>${normalized.name}</h3>
            <p>${normalized.description}</p>
            <div class="seller-row">
              <span>${normalized.city}</span>
            </div>
            <div class="card-actions">
              <a class="btn btn-soft" href="../product.html?id=${encodeURIComponent(normalized.id)}">Detail</a>
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
        window.location.href = `jual.html?edit=${encodeURIComponent(productId)}`;
      });
    });

    const deleteButtons = document.querySelectorAll('[data-delete-product]');
    deleteButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const productId = button.dataset.deleteProduct;
        const yes = confirm('Hapus barang ini?');
        if (!yes) return;

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
  if (cityField) cityField.value = user.city || '';

  const form = document.querySelector('[data-profile-form]');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const updatedUser = {
      ...user,
      name: formData.get('fullName') || user.name,
      username: formData.get('username') || user.username,
      email: formData.get('email') || user.email,
      phone: formData.get('phone') || user.phone,
      bio: formData.get('bio') || user.bio,
      city: formData.get('alamat') || user.city,
    };

    if (auth.currentUser && auth.currentUser.uid) {
      await setDoc(doc(db, 'marketplace_users', auth.currentUser.uid), updatedUser, { merge: true });
    }

    const users = readStorage(STORAGE_KEYS.USERS, []);
    const index = users.findIndex((item) => (item.email || '').toLowerCase() === (user.email || '').toLowerCase());
    if (index >= 0) users[index] = updatedUser;
    writeStorage(STORAGE_KEYS.USERS, users);
    setCurrentUser(updatedUser);
    showPopup('Profil berhasil diperbarui.', 'Berhasil', 'success');
  });
}

async function renderProductDetail() {
  const page = document.body.dataset.page;
  if (page !== 'product.html') return;

  const user = requireAuth();
  if (!user) return;

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
  const image = normalized.imageUrl ? `<img src="${normalized.imageUrl}" alt="${normalized.name}" style="width: 100%; height: 100%; object-fit: cover;" />` : normalized.image;

  const detailImage = document.querySelector('[data-detail-image]');
  if (detailImage) detailImage.innerHTML = image;

  const detailPrice = document.querySelector('[data-detail-price]');
  if (detailPrice) detailPrice.textContent = formatCurrency(normalized.price);

  const detailCondition = document.querySelector('[data-detail-condition]');
  if (detailCondition) detailCondition.textContent = normalized.condition;

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

  const detailSellerInitial = document.querySelector('[data-detail-seller-initial]');
  if (detailSellerInitial) detailSellerInitial.textContent = normalized.sellerInitial;

  const detailLocation = document.querySelector('[data-detail-location]');
  if (detailLocation) detailLocation.value = normalized.city;

  const detailSummary = document.querySelector('[data-detail-summary]');
  if (detailSummary) detailSummary.value = `Barang ini termasuk kategori ${normalized.label}. Kondisi ${normalized.condition}. Dapat ditanyakan lebih lanjut melalui chat agar proses transaksi lebih aman.`;

  const sellerRef = normalizeUserIdentifier(normalized.sellerId || normalized.ownerId || resolveUserIdByName(normalized.seller) || normalized.seller || '');
  const chatButton = document.querySelector('[data-chat-product]');
  if (chatButton) chatButton.href = `user/chat.html?user=${encodeURIComponent(normalized.seller || 'Penjual')}&userId=${encodeURIComponent(sellerRef || normalized.seller || '')}`;
}

async function renderChat() {
  const user = requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const sellerName = params.get('user') || 'Penjual';
  const sellerIdParam = params.get('userId') || '';
  const currentUserId = getCurrentUserIdentifier();
  const currentUserName = normalizeUserIdentifier((currentUser() || {}).name || user.name || 'Saya');
  sanitizeChatThreadCache(currentUserId, currentUserName);
  const targetUserId = isPlaceholderUser(sellerIdParam || sellerName) ? '' : normalizeUserIdentifier(sellerIdParam || resolveUserIdByName(sellerName) || sellerName);
  const targetName = isPlaceholderUser(sellerName) ? '' : sellerName;
  const resolvedSellerId = targetUserId || '';
  const fallbackThreadId = getChatThreadId(currentUserId, resolvedSellerId || targetName || currentUserId);

  const exactThread = await findExactThreadForCurrentUser(currentUserId, currentUserName, resolvedSellerId || '', targetName || '');
  const firestoreThreadId = exactThread?.id || await findFirestoreThreadId(currentUserId, resolvedSellerId || '', targetName || '');
  const existingThreadId = firestoreThreadId || findMatchingThreadKey(resolvedSellerId || targetName || currentUserId, targetName || currentUserName, currentUserId) || fallbackThreadId;
  const threadId = existingThreadId || fallbackThreadId;
  const chatRef = doc(db, 'marketplace_chats', threadId);

  const sellerLabel = document.querySelector('[data-chat-contact]');
  if (sellerLabel) sellerLabel.textContent = sellerName;

  if (exactThread && Array.isArray(exactThread.participants)) {
    const otherParticipant = exactThread.participants.find((participant) => {
      const participantId = normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase();
      const participantName = normalizeUserIdentifier(participant.name || '').toLowerCase();
      return participantId !== normalizeUserIdentifier(currentUserId || '').toLowerCase() && participantName !== normalizeUserIdentifier(currentUserName || '').toLowerCase();
    });

    if (otherParticipant && sellerLabel) {
      sellerLabel.textContent = otherParticipant.name || sellerName;
    }
  }

  const threadListEl = document.querySelector('[data-chat-list]');
  const threadEl = document.querySelector('[data-chat-thread]');
  const composer = document.querySelector('[data-chat-form]');

  const syncThreadList = () => {
    const threads = readChatThreads();
    const entries = Object.entries(threads).sort((a, b) => {
      const aSummary = getThreadSummary(a[1]);
      const bSummary = getThreadSummary(b[1]);
      return (bSummary.lastMessageAt || 0) - (aSummary.lastMessageAt || 0);
    });

    if (!threadListEl) return;

    if (!entries.length) {
      threadListEl.innerHTML = '<div class="empty-state">Belum ada chat</div>';
      return;
    }

    threadListEl.innerHTML = entries.map(([key, thread]) => {
      const threadUser = thread.participants?.find((participant) => normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase() !== normalizeUserIdentifier(currentUserId || '').toLowerCase()) || { name: 'Penjual' };
      const summary = getThreadSummary(thread);
      const isActive = key === threadId;
      return `
        <button class="chat-item ${isActive ? 'active' : ''}" type="button" data-thread-key="${key}">
          <div class="avatar">${String(threadUser.name || 'P').charAt(0).toUpperCase()}</div>
          <div class="chat-item-body">
            <div class="chat-item-head">
              <strong>${threadUser.name || 'Penjual'}</strong>
              ${summary.unreadCount ? `<span class="chat-badge">${summary.unreadCount}</span>` : ''}
            </div>
            <small class="muted">${summary.lastMessageText}</small>
          </div>
        </button>
      `;
    }).join('');

    threadListEl.querySelectorAll('[data-thread-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.threadKey;
        const thread = readChatThreads()[key] || { messages: [], participants: [] };
        const targetParticipant = thread.participants?.find((participant) => normalizeUserIdentifier(participant.id || participant.uid || participant.email || '').toLowerCase() !== normalizeUserIdentifier(currentUserId || '').toLowerCase());
        const targetName = targetParticipant?.name || 'Penjual';
        const targetId = targetParticipant?.id || targetParticipant?.uid || targetName;
        window.location.href = `chat.html?user=${encodeURIComponent(targetName)}&userId=${encodeURIComponent(targetId)}`;
      });
    });
  };

  const renderMessages = (messages = []) => {
    if (!threadEl) return;

    threadEl.innerHTML = messages.map((msg) => {
      const senderIsMe = normalizeUserIdentifier(msg.senderId || msg.sender || '').toLowerCase() === normalizeUserIdentifier(currentUserId || '').toLowerCase() || msg.sender === (user.name || 'Me');
      return `
        <div class="bubble-message ${senderIsMe ? 'me' : 'other'}">
          <div>${msg.text}</div>
        </div>
      `;
    }).join('');
    threadEl.scrollTop = threadEl.scrollHeight;
  };

  const ensureThread = async () => {
    const threads = readChatThreads();
    if (!threads[threadId]) {
      const matchedThreadId = findMatchingThreadKey(resolvedSellerId || sellerName, sellerName, currentUserId);
      if (matchedThreadId) {
        const targetThread = threads[matchedThreadId] || { messages: [], participants: [] };
        threads[threadId] = targetThread;
        threads[matchedThreadId] = targetThread;
      } else {
        threads[threadId] = {
          id: threadId,
          participants: [
            { id: currentUserId, name: user.name || 'Saya' },
            { id: resolvedSellerId || sellerName, name: sellerName }
          ],
          messages: [],
          unreadCount: 0
        };
      }
      writeChatThreads(threads);
    }
    markThreadRead(threadId, currentUserId);
    syncThreadList();
    return readChatThreads()[threadId] || { messages: [], participants: [] };
  };

  const renderCurrentThread = async () => {
    const thread = await ensureThread();
    markThreadRead(threadId, currentUserId);
    renderMessages(thread.messages || []);
  };

  const updateFromSnapshot = (snapshot) => {
    const data = snapshot.data() || { messages: [] };
    const nextMessages = data.messages || [];
    const threads = readChatThreads();
    const previousThread = threads[threadId] || { messages: [], participants: [], unreadCount: 0 };
    const previousLastMessage = previousThread.messages?.[previousThread.messages.length - 1];
    const latestMessage = nextMessages[nextMessages.length - 1];
    const isIncomingMessage = latestMessage && normalizeUserIdentifier(latestMessage.senderId || latestMessage.sender || '').toLowerCase() !== normalizeUserIdentifier(currentUserId || '').toLowerCase();
    const isNewIncomingMessage = !!latestMessage && (!previousLastMessage || previousLastMessage.id !== latestMessage.id);

    const normalizedThread = {
      id: threadId,
      participants: [
        { id: currentUserId, name: user.name || 'Saya' },
        { id: resolvedSellerId || sellerName, name: sellerName }
      ],
      messages: nextMessages,
      unreadCount: Number(previousThread.unreadCount || 0)
    };

    if (isIncomingMessage && isNewIncomingMessage) {
      if (window.location.href.includes(`chat.html?user=${encodeURIComponent(sellerName)}`) || window.location.href.includes('chat.html')) {
        normalizedThread.unreadCount = 0;
      } else {
        normalizedThread.unreadCount = Number(normalizedThread.unreadCount || 0) + 1;
      }

      const toastText = latestMessage.text || 'Ada pesan baru';
      const toastSender = latestMessage.sender || sellerName || 'Pengirim';
      showToast(`${toastSender}: ${toastText}`, 'info');
    }

    if (!isIncomingMessage || threadId === findMatchingThreadKey(resolvedSellerId || sellerName, sellerName, currentUserId) || window.location.href.includes(`chat.html?user=${encodeURIComponent(sellerName)}`)) {
      normalizedThread.unreadCount = 0;
    }

    threads[threadId] = normalizedThread;
    writeChatThreads(threads);
    syncThreadList();
    renderMessages(normalizedThread.messages || []);
  };

  syncThreadList();
  renderCurrentThread();

  const unsubscribe = onSnapshot(chatRef, (snapshot) => {
    updateFromSnapshot(snapshot);
  }, (error) => {
    const threads = readChatThreads();
    const thread = threads[threadId] || { messages: [], unreadCount: 0 };
    thread.messages = thread.messages || [];
    threads[threadId] = thread;
    writeChatThreads(threads);
    syncThreadList();
    renderMessages(thread.messages || []);
    console.error(error);
  });

  if (composer) {
    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = composer.querySelector('input');
      const text = (input.value || '').trim();
      if (!text) return;

      const existing = await getDoc(chatRef);
      const currentMessages = existing.exists() && existing.data().messages ? existing.data().messages : [];
      const newMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUserId,
        sender: user.name || 'Me',
        text,
        createdAt: Date.now()
      };

      const nextMessages = [...currentMessages, newMessage];
      const chatParticipants = [
        { id: currentUserId, name: user.name || 'Saya' },
        { id: resolvedSellerId || sellerName, name: sellerName }
      ];
      await setDoc(chatRef, { participants: chatParticipants, messages: nextMessages, updatedAt: Date.now() }, { merge: true });

      const threads = readChatThreads();
      const thread = threads[threadId] || { messages: [], participants: [] };
      thread.messages = nextMessages;
      thread.unreadCount = 0;
      thread.participants = chatParticipants;
      threads[threadId] = thread;
      writeChatThreads(threads);
      syncThreadList();
      renderMessages(nextMessages);
      input.value = '';
    });
  }

  window.__marketplaceChatCleanup = unsubscribe;
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
      handleLogout();
    });
  });
}

async function init() {
  ensureDemoData();
  handleSidebarState();
  bindLogoutButtons();
  hydrateUserProfileUI();

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      await syncCurrentUserFromFirebase(firebaseUser, localStorage.getItem('gamon_marketplace_remember_me') === '1');
      hydrateUserProfileUI();
    }
  });

  const page = document.body.dataset.page;
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

  if (page === 'product.html') {
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
});
