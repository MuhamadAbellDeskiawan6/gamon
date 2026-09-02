import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, getDocs, query, where, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const STORAGE_KEY = 'gamon_invitation_app';

const firebaseConfig = {
  apiKey: 'AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ',
  authDomain: 'gamon-tawing.firebaseapp.com',
  projectId: 'gamon-tawing',
  messagingSenderId: '370162915989',
  appId: '1:370162915989:web:76779062da83aa0c5c999c',
  measurementId: 'G-DDRQKDZXV7'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const defaultTemplates = [
  { id: 'classic', name: 'Classic Romance', description: 'Desain elegan dengan nuansa klasik dan hangat.', file: 'classic.html' },
  { id: 'lavender', name: 'Lavender Bloom', description: 'Tema lembut dengan sentuhan ungu dan romantis.', file: 'lavender.html' },
  { id: 'sunset', name: 'Sunset Grace', description: 'Konsep hangat dengan warna matahari terbenam.', file: 'sunset.html' },
  { id: 'forest', name: 'Forest Garden', description: 'Nuansa alami dan tenang untuk acara outdoor.', file: 'forest.html' }
];

const templatePresets = {
  classic: {
    id: 'classic',
    name: 'Classic Romance',
    palette: {
      primary: '#6b4b5d',
      secondary: '#d99ab3',
      background: '#fffaf8',
      card: '#fffefe',
      text: '#2d2130',
      muted: '#705f69',
      accent: '#f1d9de',
      soft: '#f4eef2'
    },
    typography: {
      heading: 'Cormorant Garamond',
      body: 'Inter'
    }
  },
  lavender: {
    id: 'lavender',
    name: 'Lavender Bloom',
    palette: {
      primary: '#8e6ca8',
      secondary: '#cfb9eb',
      background: '#f8f2ff',
      card: '#fffdfd',
      text: '#382b47',
      muted: '#6c5e7a',
      accent: '#eadcff',
      soft: '#f5efff'
    },
    typography: {
      heading: 'Cormorant Garamond',
      body: 'Inter'
    }
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset Grace',
    palette: {
      primary: '#d77a67',
      secondary: '#f7cfb8',
      background: '#fff7f2',
      card: '#fffdfc',
      text: '#3d2c29',
      muted: '#7d615c',
      accent: '#fce0d6',
      soft: '#fff2ee'
    },
    typography: {
      heading: 'Cormorant Garamond',
      body: 'Inter'
    }
  },
  forest: {
    id: 'forest',
    name: 'Forest Garden',
    palette: {
      primary: '#476d5a',
      secondary: '#b7d2bf',
      background: '#f4faf5',
      card: '#fffdfc',
      text: '#21362d',
      muted: '#607a6f',
      accent: '#dfeee4',
      soft: '#edf7f0'
    },
    typography: {
      heading: 'Cormorant Garamond',
      body: 'Inter'
    }
  }
};

function getTemplatePreset(templateId = 'classic') {
  return templatePresets[templateId] || templatePresets.classic;
}

function getTemplatePagePath(templateId = 'classic') {
  const templateFile = defaultTemplates.find((item) => item.id === templateId)?.file || 'classic.html';
  return `/templates/${templateFile}`;
}

function getPublicInvitationUrl(invitation = {}, guestName = '') {
  const templateId = invitation.templateId || 'classic';
  const slug = normalizeShareSlug(invitation.shareSlug || invitation.title || 'undangan');
  const params = new URLSearchParams({ slug });

  if (guestName && guestName.trim()) {
    params.set('to', guestName.trim());
  }

  return `${window.location.origin}${getTemplatePagePath(templateId)}?${params.toString()}`;
}

function applyTemplateTheme(templateId = 'classic') {
  const template = getTemplatePreset(templateId);
  const root = document.documentElement;

  if (!root) return template;

  root.style.setProperty('--theme-primary', template.palette.primary);
  root.style.setProperty('--theme-secondary', template.palette.secondary);
  root.style.setProperty('--theme-background', template.palette.background);
  root.style.setProperty('--theme-card', template.palette.card);
  root.style.setProperty('--theme-text', template.palette.text);
  root.style.setProperty('--theme-muted', template.palette.muted);
  root.style.setProperty('--theme-accent', template.palette.accent);
  root.style.setProperty('--theme-soft', template.palette.soft);
  root.style.setProperty('--theme-heading-font', template.typography.heading);
  root.style.setProperty('--theme-body-font', template.typography.body);

  const body = document.body;
  if (body) {
    body.dataset.theme = template.id;
  }

  return template;
}

const demoInvitation = {
  id: 'demo-template',
  title: 'Aperiam cillum qui f',
  groomName: 'Aperiam cillum qui f',
  brideName: 'Rahin Brady & Aaron Knowles',
  parentGroom: 'Rahin Brady & Aaron Knowles',
  parentBride: 'Rahin Brady & Aaron Knowles',
  akadDate: '2027-01-27',
  akadTime: '09:00',
  akadPlace: 'Office is a aute',
  receptionDate: '2027-01-27',
  receptionTime: '11:30',
  receptionPlace: 'Office is a aute',
  address: 'Jl. Merdeka No. 18, Bandung',
  countdownDate: '2027-01-27',
  shareSlug: 'demo-undangan',
  templateId: 'classic',
  story: 'Dengan memohon ridha Allah SWT, kami mengundang Bapak/Ibu/Saudara/i untuk hadir di momen bahagia kami.',
  rsvpMessage: 'Terima kasih atas kehadiran Anda. Mohon konfirmasi melalui form RSVP.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const state = {
  currentUser: null,
  invitations: []
};

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizeShareSlug(value) {
  return slugify(String(value || '').trim());
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setMessage(element, message, tone) {
  if (!element) return;
  element.textContent = message;
  element.className = 'form-message';
  if (tone) element.classList.add(tone);
}

function showCustomDialog({
  title = 'Pemberitahuan',
  message = '',
  tone = 'success',
  confirmText = 'OK',
  cancelText = '',
  details = ''
} = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('gamon-custom-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gamon-custom-dialog';
    overlay.className = 'custom-dialog-overlay';

    const modal = document.createElement('div');
    modal.className = `custom-dialog-card ${tone}`;

    const header = document.createElement('div');
    header.className = 'custom-dialog-header';

    const icon = document.createElement('span');
    icon.className = 'custom-dialog-icon';
    icon.textContent = tone === 'error' ? '!' : '✓';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    header.append(icon, titleEl);

    const body = document.createElement('div');
    body.className = 'custom-dialog-body';

    if (message) {
      const messageEl = document.createElement('p');
      messageEl.textContent = message;
      body.appendChild(messageEl);
    }

    if (details) {
      const detailsEl = document.createElement('div');
      detailsEl.className = 'custom-dialog-details';
      detailsEl.textContent = details;
      body.appendChild(detailsEl);
    }

    const actions = document.createElement('div');
    actions.className = 'custom-dialog-actions';

    const cancelButton = cancelText ? document.createElement('button') : null;
    if (cancelButton) {
      cancelButton.type = 'button';
      cancelButton.className = 'custom-dialog-button secondary';
      cancelButton.textContent = cancelText;
      cancelButton.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      actions.appendChild(cancelButton);
    }

    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'custom-dialog-button';
    okButton.textContent = confirmText;
    okButton.addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    actions.appendChild(okButton);
    modal.append(header, body, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    okButton.focus();
  });
}

function showCustomPrompt({ title = 'Masukkan data', message = 'Silakan masukkan nilai:', defaultValue = '', confirmText = 'OK' } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('gamon-custom-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gamon-custom-dialog';
    overlay.className = 'custom-dialog-overlay';

    const modal = document.createElement('div');
    modal.className = 'custom-dialog-card prompt';

    const header = document.createElement('div');
    header.className = 'custom-dialog-header';

    const icon = document.createElement('span');
    icon.className = 'custom-dialog-icon';
    icon.textContent = '✎';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    header.append(icon, titleEl);

    const body = document.createElement('div');
    body.className = 'custom-dialog-body';

    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    body.appendChild(messageEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-dialog-input';
    input.value = defaultValue;
    input.setAttribute('aria-label', title);

    const actions = document.createElement('div');
    actions.className = 'custom-dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'custom-dialog-button secondary';
    cancelButton.textContent = 'Batal';
    cancelButton.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'custom-dialog-button';
    okButton.textContent = confirmText;
    okButton.addEventListener('click', () => {
      const value = input.value.trim();
      overlay.remove();
      resolve(value || null);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        okButton.click();
      }
      if (event.key === 'Escape') {
        cancelButton.click();
      }
    });

    actions.append(cancelButton, okButton);
    modal.append(header, body, input, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => input.focus(), 50);
  });
}

function getCurrentUser() {
  return state.currentUser || null;
}

function getUserName(user) {
  if (!user) return 'Pengguna';
  return user.displayName || user.name || user.email?.split('@')[0] || 'Pengguna';
}

function updateUserHeader() {
  const user = getCurrentUser();
  if (!user) return;

  const safeName = getUserName(user);

  document.querySelectorAll('[data-user-name]').forEach((el) => {
    el.textContent = safeName;
  });

  document.querySelectorAll('[data-user-email]').forEach((el) => {
    el.textContent = user.email || 'email@example.com';
  });

  document.querySelectorAll('[data-user-initial]').forEach((el) => {
    el.textContent = safeName.charAt(0).toUpperCase();
  });

  const greeting = document.querySelector('[data-greeting]');
  if (greeting) {
    greeting.textContent = `Halo, ${safeName}`;
  }
}

function renderTemplateCards() {
  const list = document.querySelector('[data-template-list]');
  if (!list) return;

  list.innerHTML = defaultTemplates.map((template) => `
    <article class="template-card">
      <div class="template-thumb">${template.name.split(' ')[0]}</div>
      <div class="template-info">
        <h3>${template.name}</h3>
        <p>${template.description}</p>
        <a class="btn btn-secondary" href="register.html">Pilih template</a>
      </div>
    </article>
  `).join('');
}

function handleAuthGate() {
  const page = document.body?.dataset?.page;
  const user = getCurrentUser() || auth.currentUser;

  if ((page === 'dashboard' || page === 'form' || page === 'profil' || page === 'edit') && !user) {
    window.location.replace('login.html');
    return;
  }

  if ((page === 'login' || page === 'register') && user) {
    window.location.replace('dashboard.html');
  }
}

async function ensureUserProfile(currentUser) {
  if (!currentUser?.uid) return null;

  const profileRef = doc(db, 'gamon_wedding_users', currentUser.uid);
  const snap = await getDoc(profileRef);

  if (!snap.exists()) {
    const name = currentUser.displayName || currentUser.email?.split('@')[0] || 'Pengguna';
    const payload = {
      uid: currentUser.uid,
      name,
      email: currentUser.email,
      createdAt: new Date().toISOString()
    };
    await setDoc(profileRef, payload);
    return payload;
  }

  return snap.data();
}

async function fetchInvitationsForCurrentUser() {
  if (!state.currentUser?.uid) {
    state.invitations = [];
    return state.invitations;
  }

  const invitationsRef = collection(db, 'gamon_wedding_invitations');
  const q = query(invitationsRef, where('ownerUid', '==', state.currentUser.uid));
  const snapshot = await getDocs(q);

  state.invitations = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return state.invitations;
}

function getInvitations() {
  return state.invitations;
}

function renderClassicInvitationTemplate(invitation, guestName) {
  const galleryImages = Array.isArray(invitation.galleryImages) ? invitation.galleryImages.filter(Boolean).slice(0, MAX_GALLERY_COUNT) : [];
  const heroPhoto = invitation.openingPhoto || galleryImages[0] || 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1200&q=80';
  const groomPhoto = invitation.groomPhoto || galleryImages[0] || heroPhoto;
  const bridePhoto = invitation.bridePhoto || galleryImages[1] || heroPhoto;
  const groomName = invitation.groomName || 'Nama Pria';
  const brideName = invitation.brideName || 'Nama Wanita';
  const parentGroom = invitation.parentGroom || 'Bapak / Ibu';
  const parentBride = invitation.parentBride || 'Bapak / Ibu';
  const story = invitation.story || 'Dengan memohon ridha Allah SWT, kami mengundang Bapak/Ibu/Saudara/i untuk hadir di momen bahagia kami.';
  const invitationTitle = invitation.title || `${groomName} & ${brideName}`;
  const guestGreeting = invitation.guestGreeting || 'Kepada Yth.';
  const titleLine = guestName ? `${guestGreeting} ${guestName}` : guestGreeting;
  const rsvpMessage = invitation.rsvpMessage || 'Mohon konfirmasi kehadiran Anda.';
  const musicUrl = String(invitation.musicUrl || '').trim();
  const musicEmbedUrl = musicUrl && isDirectAudioUrl(musicUrl) ? musicUrl : '';
  const floatingMusicMarkup = musicEmbedUrl ? `
    <div class="fixed z-50 top-4 right-4">
      <audio id="bgMusic" src="${escapeHtml(musicEmbedUrl)}" loop preload="auto"></audio>
      <button
        id="musicToggleButton"
        type="button"
        aria-label="Play music"
        class="floating-music-toggle flex h-12 w-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-all duration-300 hover:scale-105"
      >
        <span id="musicIcon" class="material-symbols-outlined text-xl">music_note</span>
      </button>
    </div>
  ` : '';
  const mapTarget = String(invitation.mapLink || invitation.address || '').trim();
  const parsedExactCoords = parseGoogleMapsCoordinates(mapTarget);
  const savedLat = Number(invitation.locationLat);
  const savedLng = Number(invitation.locationLng);
  const exactCoords = parsedExactCoords || (
    Number.isFinite(savedLat) && Number.isFinite(savedLng) && savedLat !== 0 && savedLng !== 0
      ? { lat: savedLat, lng: savedLng }
      : null
  );
  const mapEmbedUrl = exactCoords
    ? `https://www.google.com/maps?q=${exactCoords.lat},${exactCoords.lng}&output=embed&z=16&markers=color:red%7C${exactCoords.lat},${exactCoords.lng}`
    : buildGoogleMapsEmbedUrl(mapTarget);
  const galleryMarkup = galleryImages.length
    ? galleryImages.slice(0, MAX_GALLERY_COUNT).map((image) => `
        <div class="w-full max-w-[280px] overflow-hidden rounded-2xl soft-shadow group">
          <img class="h-40 w-full object-cover transition-transform duration-700 group-hover:scale-105 md:h-52" src="${image}" alt="${groomName} & ${brideName}" />
        </div>
      `).join('')
    : `
        <div class="w-full max-w-[280px] overflow-hidden rounded-2xl soft-shadow group">
          <img class="h-40 w-full object-cover transition-transform duration-700 group-hover:scale-105 md:h-52" src="${heroPhoto}" alt="${groomName} & ${brideName}" />
        </div>
        <div class="w-full max-w-[280px] overflow-hidden rounded-2xl soft-shadow group">
          <img class="h-40 w-full object-cover transition-transform duration-700 group-hover:scale-105 md:h-52" src="${groomPhoto}" alt="${groomName}" />
        </div>
        <div class="w-full max-w-[280px] overflow-hidden rounded-2xl soft-shadow group">
          <img class="h-40 w-full object-cover transition-transform duration-700 group-hover:scale-105 md:h-52" src="${bridePhoto}" alt="${brideName}" />
        </div>
      `;

  const dateLabel = invitation.akadDate ? formatDate(invitation.akadDate) : 'Tanggal Akad';
  const receptionDateLabel = invitation.receptionDate ? formatDate(invitation.receptionDate) : 'Tanggal Resepsi';
  const venueName = invitation.receptionPlace || 'Tempat Resepsi';
  const venueAddress = invitation.address || 'Alamat lengkap akan ditampilkan di sini.';
  const mapLink = mapTarget;
  const countdownDate = invitation.countdownDate || invitation.receptionDate || invitation.akadDate || '';
  const countdownParts = countdownDate ? getCountdownParts(countdownDate) : { days: 0, hours: 0, minutes: 0, seconds: 0 };

  return `
    <main class="pb-24">
      ${floatingMusicMarkup}
      <section class="relative flex h-screen w-full flex-col items-center justify-end pb-20 md:pb-stack-lg" id="cover">
        <div class="absolute inset-0 z-0">
          <div class="h-full w-full bg-cover bg-center" style="background-image: url('${heroPhoto}')"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
        </div>
        <div class="relative z-10 flex flex-col items-center px-margin-mobile text-center">
          <p class="mb-4 font-body-md text-body-md uppercase tracking-widest text-on-surface-variant opacity-80">Pernikahan</p>
          <h1 class="mb-8 font-display-lg text-headline-lg-mobile text-primary md:text-display-lg">
            ${escapeHtml(groomName)} <span class="mx-2 italic font-light opacity-80">&amp;</span> ${escapeHtml(brideName)}
          </h1>
          <p class="mb-6 text-sm uppercase tracking-[0.25em] text-on-surface-variant opacity-80">${escapeHtml(titleLine)}</p>
          <a class="flex items-center gap-2 rounded-lg border border-inverse-primary/30 bg-secondary px-8 py-4 font-label-md text-label-md uppercase tracking-wider text-on-secondary transition-all hover:shadow-lg" href="#intro">
            Buka Undangan <span class="material-symbols-outlined text-sm">expand_more</span>
          </a>
        </div>
      </section>

      <section class="mx-auto flex max-w-2xl flex-col items-center px-margin-mobile py-stack-lg text-center" id="intro">
        <div class="floral-divider mb-12 w-full max-w-[200px]"></div>
        <p class="mb-8 font-headline-md text-headline-sm italic leading-relaxed text-primary md:text-headline-md">
          "Sesuatu yang membuat jiwa kita sama, jiwa saya dan jiwa Anda pun sama."
        </p>
        <p class="mb-6 font-body-lg text-body-lg uppercase tracking-widest text-on-surface-variant opacity-70">— Emily Brontë —</p>
        <p class="mt-4 font-body-md text-body-md leading-relaxed text-on-surface">
          ${escapeHtml(story)}
        </p>
        <div class="floral-divider mt-12 w-full max-w-[200px]"></div>
      </section>

      <section class="mx-auto max-w-4xl px-margin-mobile py-stack-md">
        <div class="grid grid-cols-1 gap-stack-md md:grid-cols-2">
          <div class="flex flex-col items-center rounded-2xl bg-surface-container-lowest p-8 text-center soft-shadow">
            <div class="mb-6 h-48 w-48 overflow-hidden rounded-t-full rounded-b-full border-4 border-surface border-opacity-50 shadow-inner md:h-52 md:w-52">
              <img class="h-full w-full object-cover" src="${groomPhoto}" alt="${escapeHtml(groomName)}" />
            </div>
            <h2 class="mb-2 font-headline-lg-mobile text-headline-sm text-primary">${escapeHtml(groomName)}</h2>
            <p class="font-body-md text-body-md text-sm italic text-on-surface-variant">Putra dari</p>
            <p class="font-body-md text-body-md text-on-surface">${escapeHtml(parentGroom)}</p>
          </div>

          <div class="flex flex-col items-center rounded-2xl bg-surface-container-lowest p-8 text-center soft-shadow md:mt-12">
            <div class="mb-6 h-48 w-48 overflow-hidden rounded-t-full rounded-b-full border-4 border-surface border-opacity-50 shadow-inner md:h-52 md:w-52">
              <img class="h-full w-full object-cover" src="${bridePhoto}" alt="${escapeHtml(brideName)}" />
            </div>
            <h2 class="mb-2 font-headline-lg-mobile text-headline-sm text-primary">${escapeHtml(brideName)}</h2>
            <p class="font-body-md text-body-md text-sm italic text-on-surface-variant">Putri dari</p>
            <p class="font-body-md text-body-md text-on-surface">${escapeHtml(parentBride)}</p>
          </div>
        </div>
      </section>

      <section class="relative mx-4 my-8 overflow-hidden rounded-3xl bg-surface-container-low px-margin-mobile py-stack-lg soft-shadow" id="details">
        <div class="absolute right-0 top-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-container opacity-30 blur-3xl"></div>
        <div class="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
          <span class="material-symbols-outlined mb-4 text-primary" style="font-variation-settings: 'FILL' 1;">location_on</span>
          <h2 class="mb-8 font-display-lg text-headline-lg-mobile text-primary">Perayaan</h2>
          <div class="mb-8 w-full rounded-2xl border border-inverse-primary/20 bg-surface-container-lowest p-8">
            <h3 class="mb-2 font-headline-sm text-headline-sm text-primary">${escapeHtml(dateLabel)}</h3>
            <p class="mb-6 font-body-md text-body-md text-on-surface-variant">Upacara dimulai pukul ${escapeHtml(invitation.akadTime || '04:30')} <br /> Resepsi dilanjutkan setelahnya</p>
            <h3 class="mb-2 font-headline-sm text-headline-sm text-primary">${escapeHtml(venueName)}</h3>
            <p class="mb-8 font-body-md text-body-md text-on-surface-variant">${escapeHtml(venueAddress)}</p>
            ${mapEmbedUrl ? `
              <div class="mb-6 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-low">
                <iframe
                  class="h-56 w-full border-0"
                  src="${mapEmbedUrl}"
                  loading="lazy"
                  allowfullscreen
                  referrerpolicy="no-referrer-when-downgrade"
                ></iframe>
              </div>
            ` : ''}
            ${mapLink ? `<a class="rounded-lg border border-primary bg-transparent px-6 py-3 font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary/5" href="${escapeHtml(mapLink)}" target="_blank" rel="noreferrer">Lihat Lokasi</a>` : '<button class="rounded-lg border border-primary bg-transparent px-6 py-3 font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary/5" type="button">Lihat Lokasi</button>'}
          </div>

          <div class="mt-4 flex justify-center gap-4">
            <div class="timer-unit">
              <span class="font-headline-sm text-headline-sm text-primary">${countdownParts.days}</span>
              <span class="mt-1 text-[10px] font-label-md text-label-md text-on-surface-variant">HARI</span>
            </div>
            <div class="timer-unit">
              <span class="font-headline-sm text-headline-sm text-primary">${countdownParts.hours}</span>
              <span class="mt-1 text-[10px] font-label-md text-label-md text-on-surface-variant">JAM</span>
            </div>
            <div class="timer-unit">
              <span class="font-headline-sm text-headline-sm text-primary">${countdownParts.minutes}</span>
              <span class="mt-1 text-[10px] font-label-md text-label-md text-on-surface-variant">MENIT</span>
            </div>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-lg px-margin-mobile py-stack-lg" id="rsvp">
        <div class="mb-10 text-center">
          <h2 class="mb-4 font-display-lg text-headline-lg-mobile text-primary">RSVP</h2>
          <p class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(rsvpMessage)}</p>
          <p class="mt-2 font-body-md text-body-md text-on-surface-variant">Mohon balasan paling lambat ${escapeHtml(receptionDateLabel)}</p>
          <div class="floral-divider mx-auto mt-6 w-full max-w-[150px]"></div>
        </div>
        <form class="space-y-6 rounded-2xl border border-surface-container bg-surface-container-lowest p-6 soft-shadow md:p-10">
          <div class="gold-border-focus space-y-1 border-b border-outline-variant pb-2 transition-colors">
            <label class="block font-label-md text-label-md uppercase tracking-wider text-on-surface-variant" for="guestNameInput">Nama Lengkap</label>
            <input id="guestNameInput" class="w-full border-none bg-transparent p-0 font-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-0" name="guestName" placeholder="${escapeHtml(guestName || 'Tamu Undangan')}" value="${escapeHtml(guestName || '')}" required type="text" />
          </div>
          <div class="space-y-4 py-4">
            <p class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Apakah Anda hadir?</p>
            <div class="flex flex-col gap-4 sm:flex-row">
              <label class="group flex cursor-pointer items-center space-x-3">
                <input checked class="h-5 w-5 border-outline-variant bg-transparent text-secondary focus:ring-secondary/50" name="attending" type="radio" value="yes" />
                <span class="font-body-md text-body-md text-on-surface transition-colors group-hover:text-primary">Dengan Senang Hati Hadir</span>
              </label>
              <label class="group flex cursor-pointer items-center space-x-3">
                <input class="h-5 w-5 border-outline-variant bg-transparent text-secondary focus:ring-secondary/50" name="attending" type="radio" value="no" />
                <span class="font-body-md text-body-md text-on-surface transition-colors group-hover:text-primary">Dengan Menyesal Tidak Dapat Hadir</span>
              </label>
            </div>
          </div>
          <div class="gold-border-focus space-y-1 border-b border-outline-variant pb-2 transition-colors">
            <label class="block font-label-md text-label-md uppercase tracking-wider text-on-surface-variant" for="guests">Jumlah Tamu</label>
            <select id="guests" class="w-full cursor-pointer appearance-none border-none bg-transparent p-0 font-body-md text-on-surface focus:ring-0" name="guests">
              <option value="1">1 Tamu</option>
              <option selected value="2">2 Tamu</option>
              <option value="3">3 Tamu</option>
              <option value="4">4 Tamu</option>
            </select>
          </div>
          <div class="gold-border-focus space-y-1 border-b border-outline-variant pb-2 transition-colors">
            <label class="block font-label-md text-label-md uppercase tracking-wider text-on-surface-variant" for="song">Request Lagu (Opsional)</label>
            <input id="song" class="w-full border-none bg-transparent p-0 font-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-0" name="song" placeholder="Saya ingin menari sambil mendengar..." type="text" />
          </div>
          <div class="pt-4">
            <button class="w-full rounded-lg border border-inverse-primary/30 bg-secondary px-4 py-4 font-label-md text-label-md uppercase tracking-wider text-on-secondary transition-all hover:shadow-lg" type="submit">
              Kirim Balasan
            </button>
          </div>
        </form>
      </section>

      <section class="px-margin-mobile py-stack-lg" id="gallery">
        <div class="mb-10 text-center">
          <h2 class="mb-4 font-display-lg text-headline-lg-mobile text-primary">Momen</h2>
          <div class="floral-divider mx-auto w-full max-w-[150px]"></div>
        </div>
        <div class="mx-auto grid max-w-5xl grid-cols-1 justify-items-center gap-3 sm:grid-cols-2 md:grid-cols-3 md:gap-4">
          ${galleryMarkup}
        </div>
      </section>
    </main>

    <footer class="mt-stack-lg flex w-full flex-col items-center border-t border-surface-container bg-surface-container-lowest px-margin-mobile py-stack-md pb-24 text-center md:pb-stack-md">
      <h4 class="mb-4 font-display-lg text-headline-sm text-primary">${escapeHtml(groomName)} &amp; ${escapeHtml(brideName)}</h4>
      <p class="mb-6 max-w-sm font-body-md text-body-md text-on-surface-variant">
        Dibuat dengan cinta untuk ${escapeHtml(groomName)} &amp; ${escapeHtml(brideName)}.
      </p>
      <div class="flex gap-4">
        <a class="font-body-md text-body-md text-sm text-on-surface-variant transition-colors hover:text-primary" href="#">Kebijakan Privasi</a>
        <span class="text-on-surface-variant/50">•</span>
        <a class="font-body-md text-body-md text-sm text-on-surface-variant transition-colors hover:text-primary" href="#">Bantuan</a>
      </div>
    </footer>
  `;
}

function renderDashboard() {
  const list = document.getElementById('invitationList');
  if (!list) return;

  const invitations = getInvitations();
  const total = document.querySelector('[data-total-invitations]');
  const shared = document.querySelector('[data-shared-count]');
  const template = document.querySelector('[data-template-count]');

  if (total) total.textContent = invitations.length;
  if (shared) shared.textContent = invitations.filter((item) => Number(item.sharedCount || 0) > 0).length;
  if (template) template.textContent = new Set(invitations.map((item) => item.templateId || 'classic')).size;

  if (!invitations.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Belum ada undangan</h3>
        <p>Mulai buat undangan pertamamu dan bagikan linknya ke keluarga serta teman.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = invitations.map((item) => {
    const templateId = item.templateId || 'classic';
    const slug = normalizeShareSlug(item.shareSlug || item.title || 'undangan');
    const previewUrl = getPublicInvitationUrl({ templateId, shareSlug: slug });

    return `
      <article class="invitation-item">
        <div>
          <h3>${item.title || 'Undangan Baru'}</h3>
          <div class="invitation-meta">
            <span>${item.groomName || '-'} & ${item.brideName || '-'}</span>
            <span>${formatDate(item.akadDate)}</span>
            <span>Link: ${previewUrl}</span>
          </div>
        </div>
        <div class="invitation-menu-wrap">
          <button class="invitation-menu-toggle" type="button" aria-label="Menu aksi undangan" data-menu-toggle="${item.id}">
            <span class="menu-dots" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
          <div class="invitation-menu" hidden>
            <a class="menu-link" href="${previewUrl}">Lihat</a>
            <a class="menu-link" href="edit.html?id=${item.id}">Edit</a>
            <button class="menu-link menu-link-primary" type="button" data-copy-link="${slug}" data-template-id="${templateId}" data-copy-url="${previewUrl}">Salin link</button>
            <button class="menu-link" type="button" data-copy-guest-link="${slug}" data-template-id="${templateId}">Link tamu</button>
            <button class="menu-link menu-link-danger" type="button" data-delete-id="${item.id}" data-delete-title="${escapeHtml(item.title || 'Undangan Baru')}">Hapus</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.invitation-menu-toggle').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wrap = button.closest('.invitation-menu-wrap');
      const menu = wrap ? wrap.querySelector('.invitation-menu') : null;
      if (!menu) return;

      const shouldOpen = menu.hasAttribute('hidden');
      const allMenus = document.querySelectorAll('.invitation-menu');
      allMenus.forEach((item) => {
        item.classList.remove('is-open');
        item.setAttribute('hidden', 'hidden');
      });

      if (shouldOpen) {
        menu.removeAttribute('hidden');
        requestAnimationFrame(() => menu.classList.add('is-open'));
      }
    });
  });

  if (!document.body.dataset.menuListenerBound) {
    document.body.dataset.menuListenerBound = 'true';
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.invitation-menu-wrap')) {
        document.querySelectorAll('.invitation-menu').forEach((menu) => {
          menu.classList.remove('is-open');
          menu.setAttribute('hidden', 'hidden');
        });
      }
    });
  }

  document.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const invitationId = button.dataset.deleteId;
      const title = button.dataset.deleteTitle || 'Undangan';

      const confirmed = await showCustomDialog({
        title: 'Konfirmasi hapus',
        message: `Apakah Anda yakin ingin menghapus undangan "${title}"?`,
        tone: 'error',
        confirmText: 'Hapus',
        cancelText: 'Batal',
        details: 'Tindakan ini tidak dapat dibatalkan.'
      });

      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, 'gamon_wedding_invitations', invitationId));
        state.invitations = state.invitations.filter((item) => item.id !== invitationId);
        renderDashboard();
        await showCustomDialog({
          title: 'Undangan dihapus',
          message: 'Undangan berhasil dihapus.',
          tone: 'success',
          confirmText: 'OK'
        });
      } catch (error) {
        await showCustomDialog({
          title: 'Gagal menghapus',
          message: error.message || 'Undangan gagal dihapus.',
          tone: 'error',
          confirmText: 'OK'
        });
      }
    });
  });

  document.querySelectorAll('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyUrl || getPublicInvitationUrl({
        templateId: button.dataset.templateId || 'classic',
        shareSlug: button.dataset.copyLink
      });
      try {
        await navigator.clipboard.writeText(value);
        const target = document.querySelector('[data-form-message]');
        if (target) {
          setMessage(target, 'Link undangan berhasil disalin.', 'success');
        } else {
          await showCustomDialog({
            title: 'Link berhasil disalin',
            message: 'Link undangan berhasil disalin ke clipboard.',
            tone: 'success',
            confirmText: 'OK'
          });
        }
      } catch {
        await showCustomDialog({
          title: 'Gagal menyalin link',
          message: 'Tidak dapat menyalin link undangan otomatis.',
          tone: 'error',
          confirmText: 'OK'
        });
      }
    });
  });

  document.querySelectorAll('[data-copy-guest-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const guestName = await showCustomPrompt({
        title: 'Buat link tamu',
        message: 'Masukkan nama tamu:',
        defaultValue: 'Tamu Undangan',
        confirmText: 'Buat link'
      });

      if (!guestName || !guestName.trim()) {
        return;
      }

      const value = getPublicInvitationUrl({
        templateId: button.dataset.templateId || 'classic',
        shareSlug: button.dataset.copyGuestLink
      }, guestName.trim());

      try {
        await navigator.clipboard.writeText(value);
        await showCustomDialog({
          title: 'Link tamu berhasil dibuat',
          message: 'Link khusus tamu berhasil dibuat dan disalin.',
          tone: 'success',
          confirmText: 'OK',
          details: value
        });
      } catch {
        await showCustomDialog({
          title: 'Gagal menyalin link tamu',
          message: 'Link khusus tamu gagal disalin otomatis.',
          tone: 'error',
          confirmText: 'OK',
          details: value
        });
      }
    });
  });
}

async function initAuthState() {
  onAuthStateChanged(auth, async (user) => {
    state.currentUser = user || null;

    if (user) {
      const profile = await ensureUserProfile(user);
      if (profile) {
        state.currentUser = { ...user, name: profile.name, email: profile.email || user.email };
      }
      updateUserHeader();
      await fetchInvitationsForCurrentUser();
      renderDashboard();
      const editForm = document.getElementById('invitationForm');
      if (editForm) {
        const params = new URLSearchParams(window.location.search);
        const invitationId = params.get('id');
        const invitation = invitationId ? (getInvitationFromUrl() || await loadInvitationByIdForEdit(invitationId)) : null;
        if (invitation) fillFormFromInvitation(invitation);
      }
    } else {
      state.invitations = [];
      renderDashboard();
      updateUserHeader();
    }

    handleAuthGate();
  });
}

async function registerWithFirebase(name, email, password) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const nextUser = userCredential.user;

  await setDoc(doc(db, 'gamon_wedding_users', nextUser.uid), {
    uid: nextUser.uid,
    name,
    email,
    createdAt: new Date().toISOString()
  }, { merge: true });

  return nextUser;
}

function initRegisterForm() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();
    const messageEl = form.querySelector('[data-form-message]');

    if (!name || !email || password.length < 6) {
      setMessage(messageEl, 'Nama, email, dan password wajib diisi dengan benar.', 'error');
      return;
    }

    try {
      setMessage(messageEl, 'Membuat akun...', 'success');
      await registerWithFirebase(name, email, password);
      setMessage(messageEl, 'Akun berhasil dibuat. Mengarahkan ke dashboard...', 'success');
      window.location.href = 'dashboard.html';
    } catch (error) {
      setMessage(messageEl, error.message || 'Gagal membuat akun.', 'error');
    }
  });
}

async function loginWithFirebase(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

function initLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const urlParams = new URLSearchParams(window.location.search);
  const paramsEmail = String(urlParams.get('email') || '').trim();
  const paramsPassword = String(urlParams.get('password') || '').trim();

  if (paramsEmail && paramsPassword) {
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const messageEl = form.querySelector('[data-form-message]');

    if (emailInput) emailInput.value = paramsEmail;
    if (passwordInput) passwordInput.value = paramsPassword;

    (async () => {
      try {
        setMessage(messageEl, 'Memproses login dari link...', 'success');
        await loginWithFirebase(paramsEmail, paramsPassword);
        setMessage(messageEl, 'Login berhasil. Mengarahkan ke dashboard...', 'success');
        window.location.href = 'dashboard.html';
      } catch (error) {
        setMessage(messageEl, error.message || 'Login gagal.', 'error');
      }
    })();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();
    const messageEl = form.querySelector('[data-form-message]');

    if (!email || !password) {
      setMessage(messageEl, 'Email dan password wajib diisi.', 'error');
      return;
    }

    try {
      setMessage(messageEl, 'Memproses login...', 'success');
      await loginWithFirebase(email, password);
      setMessage(messageEl, 'Login berhasil. Mengarahkan ke dashboard...', 'success');
      window.location.href = 'dashboard.html';
    } catch (error) {
      setMessage(messageEl, error.message || 'Login gagal.', 'error');
    }
  });
}

function initLogout() {
  const button = document.querySelector('[data-logout]');
  if (!button) return;

  button.addEventListener('click', async () => {
    try {
      await signOut(auth);
      state.currentUser = null;
      state.invitations = [];
      window.location.href = 'index.html';
    } catch (error) {
      window.location.href = 'index.html';
    }
  });
}

function initProfileForm() {
  const form = document.getElementById('profileForm');
  if (!form) return;

  const user = getCurrentUser();
  if (user) {
    form.elements.name.value = user.name || user.displayName || '';
    form.elements.email.value = user.email || '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const messageEl = form.querySelector('[data-form-message]');

    if (!name || !email) {
      setMessage(messageEl, 'Nama dan email harus diisi.', 'error');
      return;
    }

    try {
      if (!state.currentUser?.uid) throw new Error('User belum login.');
      const profileRef = doc(db, 'gamon_wedding_users', state.currentUser.uid);
      await setDoc(profileRef, { name, email }, { merge: true });
      state.currentUser = { ...state.currentUser, name, email };
      setMessage(messageEl, 'Profil berhasil diperbarui.', 'success');
      updateUserHeader();
    } catch (error) {
      setMessage(messageEl, error.message || 'Gagal memperbarui profil.', 'error');
    }
  });
}

function getInvitationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  return getInvitations().find((item) => item.id === id) || null;
}

function syncFormFieldValue(form, key, value) {
  const field = form.elements.namedItem(key);
  if (!field) return;

  if (field instanceof RadioNodeList) {
    field.forEach((radio) => {
      radio.checked = String(radio.value) === String(value ?? '');
    });
    return;
  }

  if (field.type === 'checkbox') {
    field.checked = Boolean(value);
    return;
  }

  if (field.type === 'file') {
    return;
  }

  if (field.tagName === 'SELECT') {
    field.value = value ?? '';
    return;
  }

  field.value = value ?? '';
}

function renderStoredUploadPreview(form, fieldName, imageUrl) {
  if (!imageUrl) return;

  const dropzone = form.querySelector(`[data-upload-dropzone="${fieldName}"]`);
  if (!dropzone) return;

  const inner = dropzone.querySelector('.upload-inner');
  if (!inner) return;

  inner.innerHTML = `
    <div class="stored-upload-preview">
      <img src="${imageUrl}" alt="Preview ${fieldName}" />
    </div>
    <button class="btn btn-primary btn-upload" type="button" data-browse-files="${fieldName}">Ganti foto</button>
    <div class="upload-hint">Foto saat ini</div>
  `;

  const browseButton = inner.querySelector(`[data-browse-files="${fieldName}"]`);
  if (browseButton) {
    browseButton.addEventListener('click', () => {
      const input = form.querySelector(`input[name="${fieldName}"]`);
      if (input) input.click();
    });
  }
}

function renderStoredGalleryPreview(form, galleryImages = []) {
  const list = form.querySelector('[data-uploaded-file-list="galleryPhotos"]');
  if (!list) return;

  const images = Array.isArray(galleryImages) ? galleryImages.filter(Boolean).slice(0, MAX_GALLERY_COUNT) : [];

  if (!images.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = images.map((imageUrl, index) => `
    <div class="uploaded-item">
      <div class="uploaded-item-thumb">
        <img src="${imageUrl}" alt="Preview gallery ${index + 1}" />
      </div>
      <div class="uploaded-item-name">Foto ${index + 1}</div>
    </div>
  `).join('');
}

function populateMusicSelectionState(form, musicUrl) {
  const musicInput = form.querySelector('input[name="musicUrl"]');
  if (musicInput) musicInput.value = musicUrl || '';

  const selectedContainer = form.querySelector('[data-music-selected]');
  const selectedLabel = form.querySelector('[data-music-selected-label]');
  if (!selectedContainer || !selectedLabel) return;

  if (musicUrl) {
    selectedLabel.textContent = musicUrl.includes('itunes') ? 'Musik tersimpan dari katalog' : 'Musik tersimpan';
    selectedContainer.hidden = false;
  } else {
    selectedContainer.hidden = true;
    selectedLabel.textContent = '';
  }
}

function fillFormFromInvitation(invitation) {
  if (!invitation) return;

  const form = document.getElementById('invitationForm');
  if (!form) return;

  Object.entries(invitation).forEach(([key, value]) => {
    if (key === 'galleryImages' || key === 'openingPhoto' || key === 'groomPhoto' || key === 'bridePhoto' || key === 'musicUrl') {
      return;
    }

    if (key === 'templateId') {
      const templateInput = form.querySelector('input[name="templateId"]');
      if (templateInput) templateInput.value = value || 'classic';
      const templateButton = form.querySelector(`[data-template-option="${value || 'classic'}"]`);
      if (templateButton) {
        const buttons = form.querySelectorAll('[data-template-option]');
        buttons.forEach((button) => button.classList.toggle('active', button === templateButton));
      }
      return;
    }

    syncFormFieldValue(form, key, value);
  });

  const templateInput = form.querySelector('input[name="templateId"]');
  if (templateInput) {
    const templateValue = invitation.templateId || templateInput.value || 'classic';
    templateInput.value = templateValue;
    const templateButton = form.querySelector(`[data-template-option="${templateValue}"]`);
    if (templateButton) {
      form.querySelectorAll('[data-template-option]').forEach((button) => {
        button.classList.toggle('active', button === templateButton);
      });
      applyTemplateTheme(templateValue);
    }
  }

  if (invitation.musicUrl) {
    populateMusicSelectionState(form, invitation.musicUrl);
  }

  if (invitation.openingPhoto) {
    renderStoredUploadPreview(form, 'openingPhoto', invitation.openingPhoto);
  }
  if (invitation.groomPhoto) {
    renderStoredUploadPreview(form, 'groomPhoto', invitation.groomPhoto);
  }
  if (invitation.bridePhoto) {
    renderStoredUploadPreview(form, 'bridePhoto', invitation.bridePhoto);
  }
  if (Array.isArray(invitation.galleryImages) && invitation.galleryImages.length) {
    renderStoredGalleryPreview(form, invitation.galleryImages);
  }

  const parsedCoords = parseGoogleMapsCoordinates(invitation.mapLink || '');
  if (parsedCoords) {
    const latInput = form.elements.namedItem('locationLat');
    const lngInput = form.elements.namedItem('locationLng');
    if (latInput) latInput.value = parsedCoords.lat;
    if (lngInput) lngInput.value = parsedCoords.lng;
  } else {
    const latInput = form.elements.namedItem('locationLat');
    const lngInput = form.elements.namedItem('locationLng');
    if (latInput) latInput.value = invitation.locationLat || '';
    if (lngInput) lngInput.value = invitation.locationLng || '';
  }

  const title = document.getElementById('formTitle');
  if (title) title.textContent = 'Edit undangan';
}

async function saveInvitation(payload, invitationId = null) {
  if (!state.currentUser?.uid) throw new Error('Silakan login terlebih dahulu.');

  const sanitizedPayload = sanitizePayloadForFirestore(payload);
  const galleryImages = Array.isArray(sanitizedPayload.galleryImages)
    ? sanitizedPayload.galleryImages.filter(Boolean).slice(0, MAX_GALLERY_COUNT)
    : [];

  const cleaned = {
    ...sanitizedPayload,
    ownerUid: state.currentUser.uid,
    shareSlug: normalizeShareSlug(sanitizedPayload.shareSlug || sanitizedPayload.title || 'undangan'),
    templateId: sanitizedPayload.templateId || 'classic',
    story: sanitizedPayload.story || '',
    address: sanitizedPayload.address || '',
    musicUrl: sanitizedPayload.musicUrl || '',
    galleryImages,
    countdownDate: sanitizedPayload.countdownDate || sanitizedPayload.receptionDate || '',
    rsvpMessage: sanitizedPayload.rsvpMessage || 'Mohon konfirmasi kehadiran Anda.',
    updatedAt: new Date().toISOString(),
    createdAt: sanitizedPayload.createdAt || new Date().toISOString()
  };

  if (!cleaned.musicUrl) delete cleaned.musicUrl;
  if (!cleaned.galleryImages || !cleaned.galleryImages.length) delete cleaned.galleryImages;

  const safePayload = validateDocumentSizeBeforeWrite(cleaned);
  if (!safePayload.galleryImages || !safePayload.galleryImages.length) delete safePayload.galleryImages;
  if (!safePayload.openingPhoto) delete safePayload.openingPhoto;
  if (!safePayload.groomPhoto) delete safePayload.groomPhoto;
  if (!safePayload.bridePhoto) delete safePayload.bridePhoto;
  if (!safePayload.musicUrl) delete safePayload.musicUrl;

  if (invitationId) {
    const ref = doc(db, 'gamon_wedding_invitations', invitationId);
    await updateDoc(ref, safePayload);
    return invitationId;
  }

  const ref = await addDoc(collection(db, 'gamon_wedding_invitations'), safePayload);
  return ref.id;
}

function bindMarketplaceStyleUpload(groupName) {
  const form = document.getElementById('invitationForm');
  if (!form) return;

  const fileInput = form.querySelector(`input[name="${groupName}"]`);
  const browseButton = form.querySelector(`[data-browse-files="${groupName}"]`);
  const dropzone = form.querySelector(`[data-upload-dropzone="${groupName}"]`);
  const uploadedList = form.querySelector(`[data-uploaded-file-list="${groupName}"]`);

  if (!fileInput || !browseButton || !dropzone) return;

  let selectedFiles = Array.from(fileInput.files || []).filter((file) => file && file.name && file.type && file.type.startsWith('image/'));

  const applySelectedFiles = (files = []) => {
    const validFiles = Array.from(files || []).filter((file) => file && file.name && file.type && file.type.startsWith('image/'));

    if (groupName === 'galleryPhotos') {
      const mergedFiles = [...selectedFiles, ...validFiles];
      const uniqueFiles = mergedFiles.filter((file, index, list) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        return list.findIndex((item) => `${item.name}-${item.size}-${item.lastModified}` === key) === index;
      });

      selectedFiles = uniqueFiles.slice(0, MAX_GALLERY_COUNT);
    } else {
      selectedFiles = validFiles.slice(0, 1);
    }

    const dt = new DataTransfer();
    selectedFiles.forEach((file) => dt.items.add(file));
    fileInput.files = dt.files;
    return selectedFiles;
  };

  const renderSelectedFiles = (files = []) => {
    if (!uploadedList) return;
    const list = Array.from(files || []).slice(0, MAX_GALLERY_COUNT);

    if (!list.length) {
      uploadedList.innerHTML = '';
      return;
    }

    uploadedList.innerHTML = list.map((file, index) => `
      <div class="uploaded-item">
        <div class="uploaded-item-thumb">
          <img src="${URL.createObjectURL(file)}" alt="${escapeHtml(file.name || 'Preview foto')}" />
        </div>
        <div class="uploaded-item-name">${escapeHtml(file.name || `Foto ${index + 1}`)}</div>
        <button class="uploaded-item-remove" type="button" data-remove-file="${index}" aria-label="Hapus foto">🗑</button>
      </div>
    `).join('');

    uploadedList.querySelectorAll('[data-remove-file]').forEach((button) => {
      button.addEventListener('click', () => {
        const removeIndex = Number(button.dataset.removeFile || 0);
        const remaining = selectedFiles.filter((_, idx) => idx !== removeIndex);
        selectedFiles = remaining;

        const dt = new DataTransfer();
        selectedFiles.forEach((file) => dt.items.add(file));
        fileInput.files = dt.files;
        renderSelectedFiles(selectedFiles);
      });
    });
  };

  browseButton.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (!event.dataTransfer?.files?.length) return;
    const incoming = Array.from(event.dataTransfer.files || []);
    const merged = applySelectedFiles(incoming);
    renderSelectedFiles(merged);
  });

  fileInput.addEventListener('change', (event) => {
    const nextFiles = Array.from(event.target.files || []);
    const picked = applySelectedFiles(nextFiles);
    renderSelectedFiles(picked);
  });

  renderSelectedFiles(selectedFiles);
}

async function searchMusicCatalog(searchTerm) {
  const query = String(searchTerm || '').trim();
  if (!query) {
    return [];
  }

  const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5`;

  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) {
    throw new Error('Gagal mengambil hasil musik dari katalog gratis.');
  }

  const data = await response.json();
  const tracks = Array.isArray(data?.results) ? data.results : [];

  return tracks
    .map((track) => {
      const name = track?.trackName || 'Judul tidak tersedia';
      const artist = track?.artistName || 'Unknown Artist';
      const previewUrl = track?.previewUrl || '';

      return {
        id: track?.trackId || `${name}-${artist}`,
        name,
        artist,
        url: previewUrl,
        details: `${artist} • ${name}`
      };
    })
    .filter((track) => Boolean(track.url));
}

function bindMusicSearch() {
  const form = document.getElementById('invitationForm');
  if (!form) return;

  const searchInput = form.querySelector('[data-music-search-input]');
  const searchButton = form.querySelector('[data-music-search-button]');
  const resultsContainer = form.querySelector('[data-music-results]');
  const selectedContainer = form.querySelector('[data-music-selected]');
  const selectedLabel = form.querySelector('[data-music-selected-label]');
  const clearButton = form.querySelector('[data-clear-music-selection]');
  const musicUrlInput = form.querySelector('input[name="musicUrl"]');

  if (!searchInput || !searchButton || !resultsContainer) return;

  const renderResults = (tracks) => {
    if (!tracks.length) {
      resultsContainer.innerHTML = '<div class="music-result-empty">Tidak ada hasil. Coba kata kunci lain atau paste link langsung.</div>';
      return;
    }

    resultsContainer.innerHTML = tracks.map((track) => `
      <button class="music-result-item" type="button" data-select-track='${JSON.stringify(track).replace(/'/g, '&apos;')}'>
        <span class="music-result-title">${track.name}</span>
        <span class="music-result-subtitle">${track.artist}</span>
      </button>
    `).join('');
  };

  const applySelectedTrack = (track) => {
    if (!track || !track.url) return;

    if (musicUrlInput) {
      musicUrlInput.value = track.url;
    }

    if (selectedContainer && selectedLabel) {
      selectedLabel.textContent = `${track.artist} - ${track.name}`;
      selectedContainer.hidden = false;
    }

    resultsContainer.innerHTML = '';
  };

  const clearSelection = () => {
    if (musicUrlInput) {
      musicUrlInput.value = '';
    }

    if (selectedContainer) {
      selectedContainer.hidden = true;
    }

    if (selectedLabel) {
      selectedLabel.textContent = '';
    }

    resultsContainer.innerHTML = '';
  };

  searchButton.addEventListener('click', async () => {
    const keyword = searchInput.value.trim();
    if (!keyword) {
      resultsContainer.innerHTML = '<div class="music-result-empty">Masukkan judul lagu atau nama artis terlebih dahulu.</div>';
      return;
    }

    try {
      resultsContainer.innerHTML = '<div class="music-result-empty">Mencari musik...</div>';
      const tracks = await searchMusicCatalog(keyword);
      renderResults(tracks);
    } catch (error) {
      resultsContainer.innerHTML = '<div class="music-result-empty">Gagal mencari musik. Anda bisa paste link audio langsung.</div>';
    }
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchButton.click();
    }
  });

  resultsContainer.addEventListener('click', (event) => {
    const selection = event.target.closest('[data-select-track]');
    if (!selection) return;

    try {
      const parsed = JSON.parse(selection.getAttribute('data-select-track').replace(/&apos;/g, "'"));
      applySelectedTrack(parsed);
    } catch (error) {
      // ignore malformed track data
    }
  });

  if (clearButton) {
    clearButton.addEventListener('click', clearSelection);
  }
}

function bindTemplatePicker() {
  const form = document.getElementById('invitationForm');
  if (!form) return;

  const templateInput = form.querySelector('input[name="templateId"]');
  const templateButtons = form.querySelectorAll('[data-template-option]');

  if (!templateInput || !templateButtons.length) return;

  const syncSelection = (templateId) => {
    templateInput.value = templateId;
    templateButtons.forEach((button) => {
      const isActive = button.dataset.templateOption === templateId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    applyTemplateTheme(templateId);
  };

  templateButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const templateId = button.dataset.templateOption || 'classic';
      syncSelection(templateId);
    });
  });

  const initValue = templateInput.value || 'classic';
  syncSelection(initValue);
}

function syncLocationCoordinatesFromMapLink(form) {
  const field = form.querySelector('input[name="mapLink"]');
  const latField = form.querySelector('input[name="locationLat"]');
  const lngField = form.querySelector('input[name="locationLng"]');

  if (!field || !latField || !lngField) return;

  const rawValue = String(field.value || '').trim();
  const parsedCoords = parseGoogleMapsCoordinates(rawValue);

  if (parsedCoords) {
    latField.value = String(parsedCoords.lat);
    lngField.value = String(parsedCoords.lng);
    return;
  }

  latField.value = '';
  lngField.value = '';
}

function bindGoogleMapsSearch() {
  const form = document.getElementById('invitationForm');
  if (!form) return;

  const button = form.querySelector('[data-open-map-search]');
  const field = form.querySelector('input[name="mapLink"]');
  const modal = document.querySelector('[data-map-picker-modal]');
  const confirmButton = document.querySelector('[data-location-picker-confirm]');
  const label = document.querySelector('[data-location-picker-label]');
  const latField = form.querySelector('input[name="locationLat"]');
  const lngField = form.querySelector('input[name="locationLng"]');
  if (!button || !field) return;

  const syncMapLocation = () => syncLocationCoordinatesFromMapLink(form);
  field.addEventListener('input', syncMapLocation);
  field.addEventListener('change', syncMapLocation);

  let pickerMap = null;
  let selectedMarker = null;

  const openPicker = () => {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      const mapContainer = document.getElementById('locationMapPicker');
      if (!mapContainer || pickerMap) return;

      const defaultLat = Number(latField?.value || -3.3219118);
      const defaultLng = Number(lngField?.value || 114.5836577);

      pickerMap = L.map('locationMapPicker', { zoomControl: true }).setView([defaultLat || -3.3219118, defaultLng || 114.5836577], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(pickerMap);

      selectedMarker = L.marker([defaultLat || -3.3219118, defaultLng || 114.5836577]).addTo(pickerMap);
      if (label) {
        label.textContent = `Titik dipilih: ${defaultLat.toFixed(6)}, ${defaultLng.toFixed(6)}`;
      }

      pickerMap.on('click', (event) => {
        const { lat, lng } = event.latlng;
        if (selectedMarker) {
          selectedMarker.setLatLng([lat, lng]);
        } else {
          selectedMarker = L.marker([lat, lng]).addTo(pickerMap);
        }

        if (latField) latField.value = String(lat);
        if (lngField) lngField.value = String(lng);

        const googleShareUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        if (field) field.value = googleShareUrl;
        if (label) {
          label.textContent = `Titik dipilih: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
      });
    }, 100);
  };

  const closePicker = () => {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  };

  const confirmSelection = () => {
    if (!latField || !lngField || !field) return closePicker();
    const lat = Number(latField.value);
    const lng = Number(lngField.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const exactUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      field.value = exactUrl;
      syncLocationCoordinatesFromMapLink(form);
    }
    closePicker();
  };

  button.addEventListener('click', () => {
    syncMapLocation();
    openPicker();
  });

  if (modal) {
    modal.querySelectorAll('[data-map-picker-close]').forEach((item) => {
      item.addEventListener('click', closePicker);
    });
  }

  if (confirmButton) {
    confirmButton.addEventListener('click', confirmSelection);
  }
}

function initInvitationForm() {
  const form = document.getElementById('invitationForm');
  if (!form) return;

  bindMarketplaceStyleUpload('openingPhoto');
  bindMarketplaceStyleUpload('groomPhoto');
  bindMarketplaceStyleUpload('bridePhoto');
  bindMarketplaceStyleUpload('galleryPhotos');
  bindMusicSearch();
  bindTemplatePicker();
  bindGoogleMapsSearch();
  syncLocationCoordinatesFromMapLink(form);

  const hydrateEditForm = async () => {
    const params = new URLSearchParams(window.location.search);
    const invitationId = params.get('id');
    let invitation = getInvitationFromUrl();

    if (!invitation && invitationId) {
      invitation = await loadInvitationByIdForEdit(invitationId);
    }

    if (invitation) fillFormFromInvitation(invitation);
  };

  hydrateEditForm();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const messageEl = form.querySelector('[data-form-message]');

    const requiredFields = [
      'title', 'groomName', 'brideName', 'parentGroom', 'parentBride',
      'akadDate', 'akadTime', 'akadPlace', 'receptionDate', 'receptionTime', 'receptionPlace'
    ];

    const payload = Object.fromEntries(formData.entries());
    const mapLinkValue = String(payload.mapLink || '').trim();
    const parsedMapCoords = parseGoogleMapsCoordinates(mapLinkValue);

    if (parsedMapCoords) {
      payload.locationLat = String(parsedMapCoords.lat);
      payload.locationLng = String(parsedMapCoords.lng);
    } else if (!String(payload.locationLat || '').trim() || !String(payload.locationLng || '').trim()) {
      payload.locationLat = '';
      payload.locationLng = '';
    }

    const missing = requiredFields.some((field) => !String(payload[field] || '').trim());
    if (missing) {
      setMessage(messageEl, 'Harap lengkapi semua field penting sebelum menyimpan.', 'error');
      return;
    }

    try {
      const musicFile = form.querySelector('input[name="musicFile"]')?.files?.[0] || null;
      const openingPhotoFile = form.querySelector('input[name="openingPhoto"]')?.files?.[0] || null;
      const groomPhotoFile = form.querySelector('input[name="groomPhoto"]')?.files?.[0] || null;
      const bridePhotoFile = form.querySelector('input[name="bridePhoto"]')?.files?.[0] || null;
      const galleryPhotoFiles = Array.from(form.querySelector('input[name="galleryPhotos"]')?.files || [])
        .slice(0, MAX_GALLERY_COUNT);

      const galleryImages = [];
      let totalGalleryBytes = 0;
      const remainingGalleryBudget = MAX_FIRESTORE_DOCUMENT_BYTES * 0.55;
      const openingPhotoBytes = openingPhotoFile ? estimateDataUrlBytes(await uploadWeddingImageFile(openingPhotoFile, { maxBytes: MAX_OPENING_IMAGE_BYTES, fieldName: 'opening' })) : 0;

      if (openingPhotoFile) {
        payload.openingPhoto = await uploadWeddingImageFile(openingPhotoFile, { maxBytes: MAX_OPENING_IMAGE_BYTES, fieldName: 'opening' });
      } else {
        delete payload.openingPhoto;
      }

      if (groomPhotoFile) {
        payload.groomPhoto = await uploadWeddingImageFile(groomPhotoFile, { maxBytes: MAX_OPENING_IMAGE_BYTES, fieldName: 'opening' });
      } else {
        delete payload.groomPhoto;
      }

      if (bridePhotoFile) {
        payload.bridePhoto = await uploadWeddingImageFile(bridePhotoFile, { maxBytes: MAX_OPENING_IMAGE_BYTES, fieldName: 'opening' });
      } else {
        delete payload.bridePhoto;
      }

      let openingBytes = 0;
      if (payload.openingPhoto) {
        openingBytes = estimateDataUrlBytes(payload.openingPhoto);
      }

      const safeGalleryBudget = Math.max(0, remainingGalleryBudget - openingBytes);

      for (let i = 0; i < galleryPhotoFiles.length; i += 1) {
        const uploadedUrl = await uploadWeddingImageFile(galleryPhotoFiles[i], { maxBytes: MAX_GALLERY_IMAGE_BYTES, fieldName: 'gallery' });
        const imageBytes = estimateDataUrlBytes(uploadedUrl);
        if (totalGalleryBytes + imageBytes <= safeGalleryBudget) {
          totalGalleryBytes += imageBytes;
          galleryImages.push(uploadedUrl);
        }
      }

      payload.galleryImages = galleryImages;
      const selectedMusicUrl = String(form.querySelector('input[name="musicUrl"]')?.value || '').trim();
      const musicUrlCandidate = selectedMusicUrl || String(formData.get('musicUrl') || '').trim();
      payload.musicUrl = musicUrlCandidate && isDirectAudioUrl(musicUrlCandidate) ? musicUrlCandidate : '';

      if (musicFile) {
        try {
          payload.musicUrl = await uploadWeddingAudioFile(musicFile);
        } catch (error) {
          if (!payload.musicUrl) {
            throw new Error('File musik terlalu besar. Gunakan link audio dari Google Drive/Dropbox atau upload file yang lebih kecil.');
          }
        }
      }

      const savedId = await saveInvitation(payload, invitation?.id || null);
      setMessage(messageEl, 'Undangan berhasil disimpan.', 'success');
      setTimeout(() => {
        window.location.href = `dashboard.html?id=${savedId}`;
      }, 600);
    } catch (error) {
      setMessage(messageEl, error.message || 'Gagal menyimpan undangan.', 'error');
    }
  });

  const cancelButton = document.querySelector('[data-cancel-form]');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      window.location.href = 'dashboard.html';
    });
  }
}

function resolveInvitationBySlug(slugValue) {
  if (!slugValue) return null;
  const target = normalizeShareSlug(slugValue);
  return getInvitations().find((item) => normalizeShareSlug(item.shareSlug || item.title || 'undangan') === target) || null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file yang dipilih.'));
    reader.readAsDataURL(file);
  });
}

async function prepareImageForUpload(file, { targetWidth = 1200, targetHeight = 900, quality = 0.78 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;

  const sourceUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memproses foto undangan.'));
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

const MAX_FIRESTORE_DOCUMENT_BYTES = 780 * 1024;
const MAX_GALLERY_IMAGE_BYTES = 110 * 1024;
const MAX_OPENING_IMAGE_BYTES = 180 * 1024;
const MAX_AUDIO_BYTES = 700 * 1024;
const MAX_GALLERY_COUNT = 3;

const WEDDING_MEDIA_COMPRESSION_STEPS = [
  { targetWidth: 1200, targetHeight: 900, quality: 0.72 },
  { targetWidth: 1000, targetHeight: 760, quality: 0.64 },
  { targetWidth: 840, targetHeight: 620, quality: 0.52 },
  { targetWidth: 620, targetHeight: 460, quality: 0.42 },
  { targetWidth: 480, targetHeight: 360, quality: 0.34 }
];

function estimateDataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const base64Part = String(dataUrl).split(',')[1] || '';
  return Math.floor(base64Part.length * 0.75);
}

async function compressWeddingImageToDataUrl(file, maxBytes = MAX_GALLERY_IMAGE_BYTES) {
  let lastDataUrl = '';

  for (const step of WEDDING_MEDIA_COMPRESSION_STEPS) {
    const compressedFile = await prepareImageForUpload(file, step);
    const dataUrl = await fileToDataUrl(compressedFile);
    lastDataUrl = dataUrl;

    if (estimateDataUrlBytes(dataUrl) <= maxBytes) {
      return dataUrl;
    }
  }

  return lastDataUrl;
}

function isDirectAudioUrl(value) {
  if (!value || typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  const directAudioPatterns = [
    /\.(mp3|m4a|wav|ogg|aac|flac)(\?.*)?$/i,
    /audio[-_a-z0-9.]*\.(mp3|m4a|wav|ogg|aac|flac)/i,
    /audio[-_a-z0-9.]*\?.*$/i,
    /itunes\.apple\.com/i,
    /audio-ssl\.itunes\.apple\.com/i,
    /googleapis\.com.*(download|uc)/i,
    /dropbox\.com\/s\//i,
    /drive\.google\.com\/uc/i
  ];

  return directAudioPatterns.some((pattern) => pattern.test(trimmed));
}

function getDocumentSizeBytes(data) {
  return new Blob([JSON.stringify(data || {})]).size;
}

function trimMediaToFirestoreLimit(data) {
  const result = { ...(data || {}) };
  const galleryImages = Array.isArray(result.galleryImages) ? result.galleryImages.filter(Boolean) : [];
  result.galleryImages = [...galleryImages];

  while (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.galleryImages.length > 0) {
    result.galleryImages.pop();
  }

  if (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.galleryImages.length === 0) {
    result.galleryImages = [];
  }

  if (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.openingPhoto) {
    delete result.openingPhoto;
  }

  if (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.groomPhoto) {
    delete result.groomPhoto;
  }

  if (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.bridePhoto) {
    delete result.bridePhoto;
  }

  if (getDocumentSizeBytes(result) > MAX_FIRESTORE_DOCUMENT_BYTES && result.musicUrl) {
    delete result.musicUrl;
  }

  return result;
}

function validateDocumentSizeBeforeWrite(data) {
  const safeData = trimMediaToFirestoreLimit(data);
  if (getDocumentSizeBytes(safeData) > MAX_FIRESTORE_DOCUMENT_BYTES) {
    throw new Error('Jumlah foto terlalu besar untuk disimpan di Firestore. Silakan kurangi ukuran foto atau pilih gambar yang lebih kecil.');
  }
  return safeData;
}

async function uploadWeddingImageFile(file, { maxBytes = MAX_GALLERY_IMAGE_BYTES, fieldName = 'gallery' } = {}) {
  if (!file) return '';
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('File foto harus berupa gambar JPG, PNG, atau WebP.');
  }

  const maxAllowedBytes = fieldName === 'opening' ? MAX_OPENING_IMAGE_BYTES : maxBytes;
  const base64 = await compressWeddingImageToDataUrl(file, maxAllowedBytes);
  if (!base64) {
    throw new Error('Foto tidak bisa diproses. Silakan coba foto lain.');
  }

  if (estimateDataUrlBytes(base64) > maxAllowedBytes) {
    throw new Error('Foto terlalu besar untuk disimpan di database gratis. Pilih foto yang lebih kecil atau lebih ringan.');
  }

  return base64;
}

async function uploadWeddingAudioFile(file) {
  if (!file) return '';
  if (!file.type || !file.type.startsWith('audio/')) {
    throw new Error('File musik harus berupa audio.');
  }

  const dataUrl = await fileToDataUrl(file);
  if (estimateDataUrlBytes(dataUrl) > MAX_AUDIO_BYTES) {
    throw new Error('File musik terlalu besar untuk disimpan di database gratis. Gunakan link audio dari Google Drive/Dropbox atau upload file yang lebih kecil.');
  }

  return dataUrl;
}

function sanitizePayloadForFirestore(payload) {
  const sanitized = {};

  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value instanceof File || value instanceof Blob) return;
    if (value === undefined) return;
    sanitized[key] = value;
  });

  return sanitized;
}

function getCountdownParts(targetDate) {
  const date = new Date(targetDate + 'T00:00:00');
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60)
  };
}

function parseGoogleMapsCoordinates(value) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const tryParsePair = (latValue, lngValue) => {
    const lat = Number(latValue);
    const lng = Number(lngValue);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  };

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://maps.google.com/?q=${encodeURIComponent(raw)}`);

    const q = parsed.searchParams.get('q') || '';
    const qMatch = q.match(/@?\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
    if (qMatch) {
      const result = tryParsePair(qMatch[1], qMatch[2]);
      if (result) return result;
    }

    const pbValue = parsed.searchParams.get('pb') || '';
    const longLatMatch = pbValue.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/i);
    if (longLatMatch) {
      const result = tryParsePair(longLatMatch[2], longLatMatch[1]);
      if (result) return result;
    }

    const latLngMatch = pbValue.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
    if (latLngMatch) {
      const result = tryParsePair(latLngMatch[1], latLngMatch[2]);
      if (result) return result;
    }

    const rawTextLongLatMatch = raw.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/i);
    if (rawTextLongLatMatch) {
      const result = tryParsePair(rawTextLongLatMatch[2], rawTextLongLatMatch[1]);
      if (result) return result;
    }

    const rawTextLatLngMatch = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i)
      || raw.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
    if (rawTextLatLngMatch) {
      if (rawTextLatLngMatch[1] && rawTextLatLngMatch[2]) {
        const result = tryParsePair(rawTextLatLngMatch[1], rawTextLatLngMatch[2]);
        if (result) return result;
      }
    }
  } catch {
    // ignore invalid URL formats
  }

  const fallback = raw.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (fallback) {
    const lat = Number(fallback[1]);
    const lng = Number(fallback[2]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

function buildGoogleMapsEmbedUrl(value) {
  if (!value) return '';

  const rawValue = String(value).trim();
  if (!rawValue) return '';

  const exactCoords = parseGoogleMapsCoordinates(rawValue);
  if (exactCoords) {
    const lat = Number(exactCoords.lat);
    const lng = Number(exactCoords.lng);
    return `https://www.google.com/maps?q=${lat},${lng}&z=16&output=embed&markers=color:red%7C${lat},${lng}`;
  }

  const googleQuery = rawValue.startsWith('http') ? rawValue : `https://www.google.com/maps?q=${encodeURIComponent(rawValue)}`;

  try {
    const parsed = new URL(googleQuery);
    const qParam = parsed.searchParams.get('q');
    const qValue = qParam || parsed.pathname.replace(/^\/maps\/place\//i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
    const query = qValue || rawValue;
    return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed&markers=color:red%7C${encodeURIComponent(query)}`;
  } catch {
    return `https://www.google.com/maps?q=${encodeURIComponent(rawValue)}&z=15&output=embed`;
  }
}

function attachRsvpHandler(container) {
  const form = container.querySelector('#rsvpForm');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = container.querySelector('[data-rsvp-message]');
    const formData = new FormData(form);
    const guest = String(formData.get('guestName') || formData.get('name') || '').trim();
    const attendingValue = formData.get('attending') || formData.get('attendance') || 'yes';
    const status = String(attendingValue).toLowerCase() === 'no' ? 'tidak dapat hadir' : 'akan hadir';

    if (!guest) {
      if (message) {
        message.textContent = 'Silakan isi nama tamu terlebih dahulu.';
        message.className = 'rsvp-message error';
      }
      return;
    }

    if (message) {
      const responseText = status === 'tidak dapat hadir'
        ? `Terima kasih, ${guest}. Kami menerima kabar bahwa Anda tidak dapat hadir.`
        : `Terima kasih, ${guest}. Konfirmasi kehadiran Anda telah tercatat.`;
      message.textContent = responseText;
      message.className = 'rsvp-message success';
    }

    try {
      const savedKey = `gamon_rsvp_${window.location.pathname}_${new URLSearchParams(window.location.search).get('slug') || 'default'}`;
      localStorage.setItem(savedKey, JSON.stringify({
        guest,
        status,
        submittedAt: new Date().toISOString()
      }));
    } catch {
      // ignore localStorage failures in restricted environments
    }

    form.reset();
  });
}

function initFloatingMusicPlayer(container = document) {
  const bgMusic = container.querySelector('#bgMusic');
  const toggleButton = container.querySelector('#musicToggleButton');
  const musicIcon = container.querySelector('#musicIcon');

  if (!bgMusic || !toggleButton || !musicIcon) return;

  let isPlaying = false;

  const updateButtonState = () => {
    toggleButton.classList.toggle('is-playing', isPlaying);
    toggleButton.setAttribute('aria-label', isPlaying ? 'Pause music' : 'Play music');
    musicIcon.textContent = isPlaying ? 'pause' : 'music_note';
  };

  toggleButton.addEventListener('click', async () => {
    try {
      if (bgMusic.paused) {
        await bgMusic.play();
        isPlaying = true;
      } else {
        bgMusic.pause();
        isPlaying = false;
      }
      updateButtonState();
    } catch (error) {
      console.warn('Gagal mengontrol musik latar:', error);
    }
  });

  bgMusic.addEventListener('ended', () => {
    isPlaying = false;
    updateButtonState();
  });

  const autoplayMusic = async () => {
    try {
      await bgMusic.play();
      isPlaying = true;
      updateButtonState();
    } catch (error) {
      console.warn('Autoplay musik diblokir oleh browser:', error);
      isPlaying = false;
      updateButtonState();
    }
  };

  autoplayMusic();
  updateButtonState();
}

async function getTemplatePageUrl(templateId = 'classic') {
  const templateFile = defaultTemplates.find((item) => item.id === templateId)?.file || 'classic.html';
  return `/templates/${templateFile}`;
}

function redirectLegacyPublicInvitePath() {
  if (!window.location.pathname.includes('/user/undangan/templates/')) return;

  const url = new URL(window.location.href);
  const rawPath = url.pathname.replace('/user/undangan/templates/', '/templates/');
  url.pathname = rawPath;
  window.location.replace(url.toString());
}

async function loadPublicInvitationBySlug() {
  const container = document.getElementById('publicInvitation');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  const templateFromPath = window.location.pathname.match(/\/templates\/([^/]+)\.html$/i)?.[1] || '';
  const requestedTemplateId = (
    defaultTemplates.some((item) => item.id === templateFromPath)
      ? templateFromPath
      : (params.get('template') || 'classic')
  ).toLowerCase();

  if (!slug || !slug.trim() || !/^[a-z0-9-]+$/i.test(slug.trim())) {
    const redirectUrl = new URL('/404.html', window.location.origin);
    redirectUrl.searchParams.set('slug', slug || '');
    window.location.replace(redirectUrl.toString());
    return;
  }

  const normalizedSlug = normalizeShareSlug(slug);

  try {
    const q = query(collection(db, 'gamon_wedding_invitations'), where('shareSlug', '==', normalizedSlug));
    let snapshot = await getDocs(q);
    let candidates = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    let invitation = candidates.find((item) => (item.templateId || 'classic') === requestedTemplateId) || candidates[0] || null;

    if (!invitation) {
      const fallbackSnapshot = await getDocs(collection(db, 'gamon_wedding_invitations'));
      candidates = fallbackSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      invitation = candidates.find((item) => (item.templateId || 'classic') === requestedTemplateId) ||
        candidates.find((item) => normalizeShareSlug(item.shareSlug || item.title || 'undangan') === normalizedSlug) || null;
    }

    if (!invitation && normalizedSlug === normalizeShareSlug(demoInvitation.shareSlug)) {
      invitation = { ...demoInvitation, shareSlug: normalizeShareSlug(demoInvitation.shareSlug), templateId: requestedTemplateId };
    }

    if (!invitation) {
      const redirectUrl = new URL('/404.html', window.location.origin);
      redirectUrl.searchParams.set('slug', normalizedSlug);
      window.location.replace(redirectUrl.toString());
      return;
    }

    const templateId = requestedTemplateId || invitation.templateId || 'classic';
    const template = getTemplatePreset(templateId);
    const templateName = defaultTemplates.find((item) => item.id === templateId)?.name || template.name || 'Classic Romance';
    applyTemplateTheme(templateId);
    const inviteLink = getPublicInvitationUrl(invitation);
    const musicUrl = invitation.musicUrl || '';
    const galleryImages = Array.isArray(invitation.galleryImages) ? invitation.galleryImages.filter(Boolean) : [];
    const heroPhoto = invitation.openingPhoto || galleryImages[0] || '';
    const greetingText = invitation.story || 'Dengan memohon ridha Tuhan Yang Maha Esa, kami mengundang Bapak/Ibu/Saudara/i untuk hadir di acara kami.';
    const groomName = invitation.groomName || 'Nama Pria';
    const brideName = invitation.brideName || 'Nama Wanita';
    const parentGroom = invitation.parentGroom || 'Bapak / Ibu';
    const parentBride = invitation.parentBride || 'Bapak / Ibu';
    const receptionPlace = invitation.receptionPlace || 'Tempat Resepsi';
    const receptionAddress = invitation.address || 'Alamat lengkap akan ditampilkan di sini.';
    const mapTarget = String(invitation.mapLink || invitation.address || '').trim() || receptionAddress;
    const parsedExactCoords = parseGoogleMapsCoordinates(mapTarget);
    const savedLat = Number(invitation.locationLat);
    const savedLng = Number(invitation.locationLng);
    const exactCoords = parsedExactCoords || (
      Number.isFinite(savedLat) && Number.isFinite(savedLng) && savedLat !== 0 && savedLng !== 0
        ? { lat: savedLat, lng: savedLng }
        : null
    );
    const mapEmbedUrl = exactCoords
      ? `https://www.google.com/maps?q=${exactCoords.lat},${exactCoords.lng}&output=embed`
      : buildGoogleMapsEmbedUrl(mapTarget);
    const akadDate = invitation.akadDate ? formatDate(invitation.akadDate) : 'Tanggal Akad';
    const receptionDate = invitation.receptionDate ? formatDate(invitation.receptionDate) : 'Tanggal Resepsi';
    const guestGreeting = String(invitation.guestGreeting || 'Bapak/Ibu/Saudara/i').trim() || 'Bapak/Ibu/Saudara/i';
    const guestNameFromUrl = params.get('to') ? decodeURIComponent(params.get('to')) : '';
    const displayGuestName = guestNameFromUrl || guestGreeting;
    const galleryMarkup = galleryImages.length
      ? galleryImages.slice(0, 6).map((image) => `<img src="${image}" alt="Foto undangan" class="gallery-image" />`).join('')
      : `
        <div class="gallery-item one">❤</div>
        <div class="gallery-item two">✦</div>
        <div class="gallery-item three">❀</div>
        <div class="gallery-item four">♡</div>
        <div class="gallery-item five">✧</div>
        <div class="gallery-item six">❋</div>
      `;

    const acceptedMusicUrl = musicUrl && isDirectAudioUrl(musicUrl) ? musicUrl : '';
    const hasMusic = Boolean(acceptedMusicUrl);
    const audioMarkup = hasMusic ? `
      <div class="floating-music-player" data-music-player data-music-url="${escapeHtml(acceptedMusicUrl)}">
        <div class="floating-music-disc-wrap">
          <span class="material-symbols-outlined floating-music-disc">music_note</span>
        </div>
        <div class="floating-music-meta">
          <span class="floating-music-label">Music</span>
          <span class="floating-music-state" data-music-state>Paused</span>
        </div>
        <button type="button" class="floating-music-toggle" data-music-toggle aria-label="Play music">
          <span class="material-symbols-outlined">play_arrow</span>
        </button>
      </div>
    ` : '';

    if (templateId === 'classic') {
      container.innerHTML = renderClassicInvitationTemplate(invitation, displayGuestName);
      initFloatingMusicPlayer(container);
      return;
    }

    container.innerHTML = `
      <div class="invitation-phone">
        <div class="invitation-screen">
          <div class="screen-section active" data-screen="opening">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-hero">
              <div class="mini-label">${templateName}</div>
              <h1 class="script-title">${groomName} & ${brideName}</h1>
              <div class="photo-frame">
                ${heroPhoto ? `<img src="${heroPhoto}" alt="${groomName} & ${brideName}" />` : `<div class="photo-placeholder">Pasangan</div>`}
              </div>
              <div class="detail-card">
                <p>Kepada Yth:</p>
                <h2>${displayGuestName}</h2>
                <div class="couple-inline">${groomName} & ${brideName}</div>
                <p class="meta-line">${akadDate} • ${invitation.akadTime || '08.00'} WIB</p>
                <p class="meta-line">${receptionDate} • ${invitation.receptionTime || '10.00'} WIB</p>
              </div>
              <button type="button" class="cta-button" data-copy-link="${inviteLink}">Open Invitation</button>
            </div>
          </div>

          <div class="screen-section" data-screen="groom">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-text">
              <h2 class="script-title">${groomName}</h2>
              <p class="subtitle">Putra Pertama dari</p>
              <p>${parentGroom}</p>
              <p class="verse-block">“Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan pasangan-pasangan untukmu...”</p>
            </div>
          </div>

          <div class="screen-section" data-screen="bride">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-text">
              <h2 class="script-title">${brideName}</h2>
              <p class="subtitle">Putri Pertama dari</p>
              <p>${parentBride}</p>
              <p class="verse-block">“Maha Suci Allah yang telah menciptakan segala sesuatu dengan pasangan-pasangan yang indah.”</p>
            </div>
          </div>

          <div class="screen-section" data-screen="akad">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-center">
              <h2>Akad Nikah</h2>
              <p>${akadDate}</p>
              <p>${invitation.akadTime || '09.00'} WIB - Selesai</p>
              <p>${invitation.akadPlace || 'Tempat Akad'}</p>
              <p class="verse-block">“Dan sempurnakanlah ibadah haji dan umrah karena Allah.”</p>
            </div>
          </div>

          <div class="screen-section" data-screen="resepsi">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-center">
              <h2>Resepsi</h2>
              <p>${receptionDate}</p>
              <p>${invitation.receptionTime || '10.00'} WIB - Selesai</p>
              <p>${receptionPlace}</p>
              <p class="verse-block">“Barangsiapa yang beriman dan berbuat baik, maka kami akan menambah nikmat baginya.”</p>
            </div>
          </div>

          <div class="screen-section" data-screen="maps">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="map-box">
              ${mapEmbedUrl ? `<iframe class="map-embed" src="${mapEmbedUrl}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>` : '<div class="map-placeholder"></div>'}
              <h3>${receptionPlace}</h3>
              <p>${receptionAddress}</p>
              <button type="button" class="cta-button small" onclick="window.open('${String(mapTarget).startsWith('http') ? mapTarget : 'https://maps.google.com/?q=' + encodeURIComponent(mapTarget)}', '_blank')">Petunjuk Ke Lokasi</button>
            </div>
          </div>

          <div class="screen-section" data-screen="gallery">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="gallery-wrap">
              <h2 class="script-title">Our Memories</h2>
              <div class="gallery-grid-mobile">
                ${galleryMarkup}
              </div>
            </div>
          </div>

          <div class="screen-section" data-screen="gift">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-center narrow">
              <h2>Tanda Kasih</h2>
              <p class="verse-block">“Maka nikmat Tuhanmu yang manakah yang kamu dustakan?”</p>
              <p>${greetingText}</p>
              <div class="gift-actions">
                <button type="button" class="cta-button secondary">Cashless</button>
                <button type="button" class="cta-button secondary">Kirim Kado</button>
              </div>
            </div>
          </div>

          <div class="screen-section" data-screen="rsvp">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="rsvp-panel">
              <h2 class="script-title">Ucapan & RSVP</h2>
              <div class="rsvp-figure">
                ${heroPhoto ? `<img src="${heroPhoto}" alt="${groomName} & ${brideName}" />` : `<div class="photo-placeholder">Pasangan</div>`}
              </div>
              <p>Tekan tombol di bawah ini untuk mengirim ucapan dan konfirmasi kehadiran.</p>
              <form id="rsvpForm" class="rsvp-form-mobile">
                <input type="text" name="guestName" value="${escapeHtml(displayGuestName)}" placeholder="Nama Anda" required />
                <select name="attendance">
                  <option value="akan hadir">Akan hadir</option>
                  <option value="mungkin hadir">Mungkin hadir</option>
                  <option value="tidak bisa hadir">Tidak bisa hadir</option>
                </select>
                <button type="submit" class="cta-button">Konfirmasi & Kirim Ucapan</button>
              </form>
              <div class="rsvp-message" data-rsvp-message></div>
            </div>
          </div>

          <div class="screen-section" data-screen="thanks">
            <div class="screen-floral floral-top"></div>
            <div class="screen-floral floral-bottom"></div>
            <div class="screen-center narrow">
              <h2>Terima Kasih</h2>
              <p>Merupakan suatu kehormatan dan kebahagiaan bagi kami apabila Bapak/Ibu/Saudara/i berkenan hadir dan memberikan doa restu kepada kami.</p>
              <h3 class="script-title">${groomName} & ${brideName}</h3>
            </div>
          </div>
        </div>

        ${audioMarkup}

        <div class="bottom-nav">
          <button type="button" class="nav-item active" data-target="opening">Opening</button>
          <button type="button" class="nav-item" data-target="groom">Groom</button>
          <button type="button" class="nav-item" data-target="bride">Bride</button>
          <button type="button" class="nav-item" data-target="akad">Akad</button>
          <button type="button" class="nav-item" data-target="resepsi">Resepsi</button>
          <button type="button" class="nav-item" data-target="maps">Maps</button>
          <button type="button" class="nav-item" data-target="gallery">Gallery</button>
          <button type="button" class="nav-item" data-target="gift">Gift</button>
          <button type="button" class="nav-item" data-target="rsvp">RSVP</button>
          <button type="button" class="nav-item" data-target="thanks">Thanks</button>
        </div>
      </div>
    `;

    const copyButton = container.querySelector('[data-copy-link]');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inviteLink);
          copyButton.textContent = 'Link Tersalin';
        } catch {
          copyButton.textContent = 'Salin Link';
        }
      });
    }

    const navItems = container.querySelectorAll('.nav-item');
    navItems.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.target;
        container.querySelectorAll('.screen-section').forEach((section) => {
          section.classList.toggle('active', section.dataset.screen === target);
        });
        navItems.forEach((item) => item.classList.toggle('active', item === button));
      });
    });

    initFloatingMusicPlayer(container);
    attachRsvpHandler(container);
  } catch (error) {
    container.innerHTML = `
      <div class="preview-empty">
        <h1>Undangan tidak ditemukan</h1>
        <p>Terjadi kesalahan saat membuka data undangan.</p>
      </div>
    `;
  }
}

function initPage() {
  redirectLegacyPublicInvitePath();
  renderTemplateCards();
  initAuthState();
  initRegisterForm();
  initLoginForm();
  initLogout();
  initInvitationForm();
  initProfileForm();
  loadPublicInvitationBySlug();
}

window.addEventListener('DOMContentLoaded', initPage);
