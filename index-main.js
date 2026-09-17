import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, orderBy, limit, startAfter, doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ",
    authDomain: "gamon-tawing.firebaseapp.com",
    projectId: "gamon-tawing",
    storageBucket: "gamon-tawing.firebasestorage.app",
    messagingSenderId: "370162915989",
    appId: "1:370162915989:web:76779062da83aa0c5c999c",
    measurementId: "G-DDRQKDZXV7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const PAGE_SIZE = 24;
let posts = [];
let lastVisible = null;
let hasMore = false;
let isLoading = false;

const bubbleCanvas = document.getElementById('bubbleCanvas');
const loadMoreBtn = document.getElementById('loadMorePosts');
const loadingMsg = document.getElementById('loadingMsg');
const menuBtn = document.getElementById('menuBtn');
const menuItems = document.getElementById('menuItems');
const menuIcon = menuBtn?.querySelector('.material-symbols-outlined');
const music = document.getElementById('bgMusic');
const musicBtn = document.getElementById('musicToggle');
const playerBar = document.getElementById('musicPlayerBar');
const resizeBtn = document.getElementById('musicResizeBtn');
const textInfo = document.getElementById('musicTextInfo');

let menuOpen = false;
let isPlaying = false;
let isMinimized = true;
let activeContainer = null;
let startX = 0;
let startY = 0;
let initialLeft = 0;
let initialTop = 0;
let isMoving = false;
let currentPost = null;
let likedPosts = [];

window._cachedPosts = [];

window._incrementLike = async (id) => {
    try {
        await updateDoc(doc(db, 'gamon', id), { likes: increment(1) });
    } catch (e) {
        console.error(e);
    }
};

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setLoadingMessage(text) {
    if (!loadingMsg) return;
    loadingMsg.textContent = text;
}

function renderLoadMore() {
    if (!loadMoreBtn) return;
    loadMoreBtn.classList.toggle('hidden', !hasMore);
    loadMoreBtn.disabled = !hasMore;
}

/* ══════════════════════════════════════════════════════════
   DEKORASI BACKGROUND — bintang & elemen luar angkasa
   (dulu ada di inline <script> index.html, sekarang di sini
   supaya cuma dijalankan SEKALI, bukan dua kali)
   ══════════════════════════════════════════════════════════ */
function initBackgroundDecor() {
    const spaceBg = document.getElementById('spaceBackground');
    const starsEl = document.getElementById('stars');
    if (!spaceBg || !starsEl) return;

    const fragStars = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
        const s = document.createElement('div');
        s.className = 'star-particle';
        const sz = 2 + Math.random() * 4;
        s.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation:pulse-soft ${3 + Math.random() * 6}s infinite ease-in-out;animation-delay:${Math.random() * 5}s`;
        fragStars.appendChild(s);
    }
    starsEl.appendChild(fragStars);

    const spaceEmojis = ['☁️', '🪐', '✨', '☁️', '🌙'];
    const fragDecor = document.createDocumentFragment();
    for (let i = 0; i < 6; i++) {
        const decor = document.createElement('div');
        decor.className = 'space-decor';
        decor.textContent = spaceEmojis[i % spaceEmojis.length];
        decor.style.fontSize = (40 + Math.random() * 60) + 'px';
        decor.style.left = (Math.random() * 90) + '%';
        decor.style.top = (Math.random() * 80) + '%';
        decor.style.animationDelay = (Math.random() * -10) + 's';
        decor.style.animationDuration = (15 + Math.random() * 15) + 's';
        fragDecor.appendChild(decor);
    }
    spaceBg.appendChild(fragDecor);
}

/* ── Parallax lembut untuk lapisan awan dekoratif ── */
function initCloudParallax() {
    const cloudL = document.getElementById('gtCloudLeft');
    const cloudR = document.getElementById('gtCloudRight');
    if (!cloudL || !cloudR) return;

    let targetY = 0, currentY = 0;
    window.addEventListener('scroll', () => {
        targetY = window.scrollY || window.pageYOffset || 0;
    }, { passive: true });

    function tick() {
        currentY += (targetY - currentY) * 0.06;
        cloudL.style.transform = `translate3d(${-currentY * 0.03}px, ${-currentY * 0.05}px, 0)`;
        cloudR.style.transform = `translate3d(${currentY * 0.03}px, ${-currentY * 0.05}px, 0) scaleX(-1)`;
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

/* ── Progress bar scroll, "jelajahi cerita" cue, tombol kembali ke atas ── */
function initScrollUI() {
    const scrollProgress = document.getElementById('scrollProgress');
    const scrollCue = document.getElementById('scrollCue');
    const backToTop = document.getElementById('backToTop');

    function onPageScroll() {
        const docEl = document.documentElement;
        const scrollTop = window.scrollY || docEl.scrollTop || 0;
        const maxScroll = (docEl.scrollHeight - docEl.clientHeight) || 1;
        const progress = Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100));

        if (scrollProgress) scrollProgress.style.width = progress + '%';
        if (scrollCue) scrollCue.classList.toggle('is-hidden', scrollTop > 140);
        if (backToTop) backToTop.classList.toggle('show', scrollTop > 420);
    }

    window.addEventListener('scroll', onPageScroll, { passive: true });
    window.addEventListener('resize', onPageScroll);
    onPageScroll();

    scrollCue?.addEventListener('click', () => {
        (bubbleCanvas || document.body).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    backToTop?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

/* ── Modal "Tentang Kami & Layanan Bantuan" ── */
function initAboutModal() {
    const aboutFab = document.getElementById('aboutFab');
    const aboutOverlay = document.getElementById('aboutModalOverlay');
    const aboutClose = document.getElementById('aboutModalClose');

    function openAboutModal() { aboutOverlay?.classList.add('show'); }
    function closeAboutModal() { aboutOverlay?.classList.remove('show'); }

    aboutFab?.addEventListener('click', openAboutModal);
    aboutClose?.addEventListener('click', closeAboutModal);
    aboutOverlay?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAboutModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAboutModal();
    });
}

function tryAutoplay() {
    if (!music || !music.play) return;
    music.play().then(() => {
        updateMusicUI(true);
    }).catch(() => {
        const playOnInteraction = () => {
            if (music && music.play) {
                music.play().then(() => {
                    updateMusicUI(true);
                    document.removeEventListener('click', playOnInteraction);
                }).catch(() => {});
            }
        };
        document.addEventListener('click', playOnInteraction);
    });
}

function updateMusicUI(playing) {
    if (!musicBtn) return;
    isPlaying = playing;
    const iconEl = musicBtn.querySelector('.material-symbols-outlined');
    if (!iconEl) return;

    if (playing) {
        iconEl.textContent = 'pause';
        musicBtn.classList.add('bg-primary', 'text-white');
        musicBtn.classList.remove('bg-primary/10', 'text-primary');
    } else {
        iconEl.textContent = 'play_arrow';
        musicBtn.classList.remove('bg-primary', 'text-white');
        musicBtn.classList.add('bg-primary/10', 'text-primary');
    }
}

function closeModal() {
    const overlayEl = document.getElementById('modalOverlay');
    if (overlayEl) overlayEl.classList.remove('show');
    const modalAudio = document.getElementById('modalAudio');
    if (modalAudio) modalAudio.pause();
    const photoToggle = document.getElementById('modalPhotoToggle');
    const photoShell = document.getElementById('modalPhotoShell');
    if (photoToggle) {
        photoToggle.hidden = true;
        photoToggle.setAttribute('aria-expanded', 'false');
    }
    photoShell?.classList.remove('open');
}

function setPhotoboxPreviewState(isOpen) {
    const photoToggle = document.getElementById('modalPhotoToggle');
    const photoShell = document.getElementById('modalPhotoShell');
    if (!photoToggle || !photoShell) return;
    photoToggle.setAttribute('aria-expanded', String(isOpen));
    photoShell.classList.toggle('open', isOpen);
}

function openModal(data, id) {
    currentPost = { data, id };
    const isPhotobox = data.type === 'photobox';
    const photoToggle = document.getElementById('modalPhotoToggle');
    const photoShell = document.getElementById('modalPhotoShell');
    const photo = document.getElementById('modalPhoto');

    document.getElementById('modalBadgeEl').innerHTML = isPhotobox
        ? '<span class="modal-badge badge-photobox"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">photo_camera</span> Photobox</span>'
        : '<span class="modal-badge badge-curhat"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">mail</span> Ekspresi</span>';

    const nama = esc(data.nama || 'Anonim');
    const tujuan = esc(data.tujuan || 'Seseorang');
    document.getElementById('modalHeader').innerHTML = `${nama} <span class="to-label">ke</span> ${tujuan}`;

    const modalMessage = data.pesan && String(data.pesan).trim()
        ? `"${data.pesan}"`
        : (isPhotobox ? 'Foto tanpa pesan.' : '');
    document.getElementById('modalMsg').textContent = modalMessage;

    if (photo) photo.src = data.photoUrl || '';

    if (photoToggle) {
        if (isPhotobox && data.photoUrl) {
            photoToggle.hidden = false;
            setPhotoboxPreviewState(false);
        } else {
            photoToggle.hidden = true;
            photoShell?.classList.remove('open');
        }
    }

    const audioEl = document.getElementById('modalAudio');
    if (audioEl) {
        if (data.audioUrl) { audioEl.src = data.audioUrl; audioEl.classList.add('has-audio'); }
        else { audioEl.src = ''; audioEl.classList.remove('has-audio'); }
    }

    const waktu = data.waktu ? new Date(Number(data.waktu)).toLocaleDateString('id-ID') : '-';
    document.getElementById('modalDate').textContent = waktu;

    const loveBtn = document.getElementById('modalLoveBtn');
    const likeCount = document.getElementById('modalLikeCount');
    likeCount.textContent = data.likes || 0;
    loveBtn.disabled = Array.isArray(likedPosts) && likedPosts.includes(id);

    const overlayEl = document.getElementById('modalOverlay');
    if (!overlayEl) return;
    overlayEl.classList.add('show');
}

function setupDragAndDrop(containerEl) {
    const onStart = (e) => {
        if (e.target.closest('.bubble-likes')) return;

        activeContainer = containerEl;
        isMoving = false;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseFloat(activeContainer.style.left);
        initialTop = parseFloat(activeContainer.style.top);
        activeContainer.classList.add('dragging');

        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
    };

    const onMove = (e) => {
        if (!activeContainer) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isMoving = true;
        activeContainer.style.left = `${initialLeft + dx}px`;
        activeContainer.style.top = `${initialTop + dy}px`;
        e.preventDefault();
    };

    const onEnd = () => {
        if (activeContainer) {
            activeContainer.classList.remove('dragging');
            activeContainer = null;
        }
        isMoving = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
    };

    containerEl.addEventListener('pointerdown', onStart);
}

function placeBubbles(postsList) {
    const canvas = bubbleCanvas;
    if (!canvas) return;
    canvas.innerHTML = '';

    const W = canvas.offsetWidth || window.innerWidth;
    const H = canvas.offsetHeight || 460;
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        const cols = 2;
        const gap = 12;
        const minSize = 96;
        const size = Math.min(Math.max(minSize, (W - gap * (cols + 1)) / cols), 118);
        const rows = Math.ceil(postsList.length / cols);
        const totalHeight = rows * size + (rows - 1) * gap + 40;
        canvas.style.height = `${Math.max(420, totalHeight)}px`;

        postsList.forEach((item, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const left = 10 + col * (size + gap);
            const top = 10 + row * (size + gap);

            const wrapper = document.createElement('div');
            wrapper.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;`;

            const bubble = document.createElement('div');
            bubble.className = `bubble shape-circle type-${item.type || 'curhat'} bubble-enter`;
            bubble.dataset.id = item.id;
            bubble.style.cssText = `width:${size}px;height:${size}px;padding:8px;`;

            const short = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
            bubble.innerHTML = `
                <span class="bubble-emoji material-symbols-outlined">${item.type === 'photobox' ? 'photo_camera' : 'mail'}</span>
                <span class="bubble-from">${short(item.nama || 'Anonim', 7)}</span>
                <span class="bubble-to">${short(item.tujuan || 'Seseorang', 7)}</span>
                <span class="bubble-likes">♥ ${item.likes || 0}</span>
            `;

            bubble.addEventListener('click', () => {
                openModal(item, item.id);
            });

            wrapper.appendChild(bubble);
            canvas.appendChild(wrapper);
        });

        return;
    }

    const count = postsList.length;
    const cols = Math.max(3, Math.round(Math.sqrt(count * 1.6)));
    const rows = Math.ceil(count / cols);
    const cellW = W / cols;
    const cellH = H / rows;
    const shapes = ['shape-circle', 'shape-cloud', 'shape-cloud-2', 'shape-blob'];
    const floats = ['float-a', 'float-b', 'float-c'];
    const durations = [6, 7, 8, 9];
    const delays = [0, 0.5, 1, 1.5, 2];

    postsList.forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const margin = 0.15;
        const cx = (col + margin + Math.random() * (1 - margin * 2)) * cellW;
        const cy = (row + margin + Math.random() * (1 - margin * 2)) * cellH;
        const sz = 84;
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const float = floats[Math.floor(Math.random() * floats.length)];
        const dur = durations[Math.floor(Math.random() * durations.length)];
        const delay = delays[Math.floor(Math.random() * delays.length)];

        const wrapper = document.createElement('div');
        wrapper.className = `float-container ${float}`;
        wrapper.style.cssText = `left:${cx - sz / 2}px;top:${cy - sz / 2}px;--fd:${dur}s;--fdel:${delay}s;`;

        const bubble = document.createElement('div');
        bubble.className = `bubble ${shape} type-${item.type || 'curhat'} bubble-enter`;
        bubble.dataset.id = item.id;
        bubble.style.cssText = `width:${sz}px;height:${sz}px;animation-delay: ${delay}s;`;

        const short = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
        bubble.innerHTML = `
            <span class="bubble-emoji">${item.type === 'photobox' ? '📸' : '💌'}</span>
            <span class="bubble-from">${short(item.nama || 'Anonim', 8)}</span>
            <span class="bubble-to">→ ${short(item.tujuan || 'Seseorang', 8)}</span>
            <span class="bubble-likes">♥ ${item.likes || 0}</span>
        `;

        bubble.addEventListener('click', () => {
            if (!isMoving) openModal(item, item.id);
        });

        setupDragAndDrop(wrapper);
        wrapper.appendChild(bubble);
        canvas.appendChild(wrapper);
    });
}

async function loadPosts(isLoadMore = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isLoadMore) {
        posts = [];
        lastVisible = null;
        setLoadingMessage('Memuat pesan-pesan rindu...');
    } else {
        setLoadingMessage('Memuat lebih banyak pesan...');
    }

    try {
        // Query terurut langsung pada collection 'gamon', tanpa `where`,
        // supaya tidak butuh composite index dan tetap cepat.
        const q = lastVisible
            ? query(collection(db, 'gamon'), orderBy('waktu', 'desc'), startAfter(lastVisible), limit(PAGE_SIZE))
            : query(collection(db, 'gamon'), orderBy('waktu', 'desc'), limit(PAGE_SIZE));

        const snap = await getDocs(q);
        const loaded = [];
        snap.forEach(d => {
            const data = d.data();
            if (!data) return;
            loaded.push({ id: d.id, ...data });
        });

        if (snap.docs.length > 0) {
            lastVisible = snap.docs[snap.docs.length - 1];
        }

        posts = isLoadMore ? posts.concat(loaded) : loaded;

        hasMore = loaded.length === PAGE_SIZE;
        renderLoadMore();

        if (!posts.length) {
            setLoadingMessage('Tidak ada pesan yang bisa ditampilkan saat ini.');
            bubbleCanvas.innerHTML = '';
        } else {
            setLoadingMessage('');
            window._cachedPosts = posts;
            placeBubbles(posts);
        }

        if (!hasMore && loadMoreBtn) {
            loadMoreBtn.textContent = 'Tidak ada lagi pesan';
        }
    } catch (e) {
        console.error('Gagal load data:', e);
        setLoadingMessage('Gagal memuat pesan');
        bubbleCanvas.innerHTML = '';
    } finally {
        isLoading = false;
    }
}

function goPage(direction) {
    if (direction === 'more') loadPosts(true);
}

function initMenu() {
    if (!menuBtn || !menuItems || !menuIcon) return;
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        menuItems.classList.toggle('opacity-0', !menuOpen);
        menuItems.classList.toggle('pointer-events-none', !menuOpen);
        menuItems.classList.toggle('translate-y-4', !menuOpen);
        menuItems.classList.toggle('opacity-100', menuOpen);
        menuItems.classList.toggle('pointer-events-auto', menuOpen);
        menuItems.classList.toggle('translate-y-0', menuOpen);
        menuIcon.textContent = menuOpen ? 'close' : 'apps';
    });

    document.addEventListener('click', () => {
        if (!menuOpen) return;
        menuOpen = false;
        menuItems.classList.add('opacity-0', 'pointer-events-none', 'translate-y-4');
        menuItems.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
        menuIcon.textContent = 'apps';
    });
}

function initMusic() {
    if (music) window.addEventListener('DOMContentLoaded', tryAutoplay);

    if (musicBtn) {
        musicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!music) return;
            if (isPlaying) {
                music.pause();
                updateMusicUI(false);
            } else {
                music.play();
                updateMusicUI(true);
            }
        });
    }

    if (resizeBtn) {
        resizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isMinimized = !isMinimized;
            const resizeIcon = resizeBtn.querySelector('.material-symbols-outlined');

            if (isMinimized) {
                textInfo?.classList.add('opacity-0');
                setTimeout(() => textInfo?.classList.add('hidden'), 150);
                playerBar.style.width = '110px';
                resizeIcon.textContent = 'chevron_right';
            } else {
                textInfo?.classList.remove('hidden');
                playerBar.style.width = window.innerWidth < 640 ? 'calc(100% - 32px)' : '280px';
                setTimeout(() => textInfo?.classList.remove('opacity-0'), 100);
                resizeIcon.textContent = 'chevron_left';
            }
        });
    }

    window.addEventListener('resize', () => {
        if (!isMinimized && playerBar) {
            playerBar.style.width = window.innerWidth < 640 ? 'calc(100% - 32px)' : '280px';
        }
    });
}

function initModal() {
    const modalCloseButton = document.getElementById('modalClose');
    const modalPhotoToggle = document.getElementById('modalPhotoToggle');

    modalCloseButton?.addEventListener('click', closeModal);
    modalPhotoToggle?.addEventListener('click', () => {
        if (!currentPost || !currentPost.data || currentPost.data.type !== 'photobox') return;
        const nextState = !document.getElementById('modalPhotoShell')?.classList.contains('open');
        setPhotoboxPreviewState(nextState);
    });
    document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('modalLoveBtn')?.addEventListener('click', async () => {
        if (!currentPost || likedPosts.includes(currentPost.id)) return;
        if (window._incrementLike) await window._incrementLike(currentPost.id);
        likedPosts.push(currentPost.id);
        try {
            localStorage.setItem('likedPosts', JSON.stringify(likedPosts));
        } catch (err) {
            console.warn('Gagal menyimpan likedPosts ke localStorage', err);
        }
        const loveBtn = document.getElementById('modalLoveBtn');
        loveBtn.disabled = true;
        const likeCountEl = document.getElementById('modalLikeCount');
        likeCountEl.textContent = parseInt(likeCountEl.textContent, 10) + 1;
        const bEl = document.querySelector(`.bubble[data-id="${currentPost.id}"] .bubble-likes`);
        if (bEl) bEl.textContent = '♥ ' + likeCountEl.textContent;
    });

    try {
        const storedLikes = localStorage.getItem('likedPosts');
        likedPosts = storedLikes ? JSON.parse(storedLikes) : [];
        if (!Array.isArray(likedPosts)) likedPosts = [];
    } catch (err) {
        likedPosts = [];
    }
}

// ── Resize: hanya SATU listener yang rebuild bubble (debounced) ──
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (window._cachedPosts && window._cachedPosts.length) {
            placeBubbles(window._cachedPosts);
        }
    }, 300);
});

window.addEventListener('DOMContentLoaded', () => {
    initBackgroundDecor();
    initCloudParallax();
    initScrollUI();
    initAboutModal();
    initMenu();
    initMusic();
    initModal();
    loadMoreBtn?.addEventListener('click', () => goPage('more'));
    loadPosts();
});