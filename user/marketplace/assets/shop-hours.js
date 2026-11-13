/* =========================================================================
 * TOKO TUTUP (ROLLING DOOR) + JARAH TOKO - Marketplace Mantan
 * Tutup : 22.00 - 07.59 WITA   |   Buka : 08.00 - 21.59 WITA
 *
 * FITUR JARAH TOKO (hiburan):
 *   Saat toko tutup, pengunjung bisa klik tombol "JARAH TOKO". Rolling door
 *   bergetar, retak, lalu hancur. Setelah itu SEMUA halaman Marketplace Mantan
 *   terbuka selama LOOT_SECONDS detik (tersimpan di localStorage, jadi tetap
 *   berlaku saat pindah halaman). Waktu habis -> rolling door turun lagi.
 *
 * Dipasang sebagai <script> biasa (BUKAN type="module") di <head> semua halaman.
 * CATATAN: ini murni efek tampilan di browser (hiburan). Bukan pengaman server.
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- PENGATURAN (ubah di sini) ---------- */
  var CFG = {
    openHour: 8,          // jam buka  (08.00)
    closeHour: 22,        // jam tutup (22.00)
    utcOffsetHours: 8,    // WITA = UTC+8
    zoneLabel: 'WITA',

    lootEnabled: true,    // false = matikan fitur jarah toko
    lootSeconds: 60,      // lama toko terbuka setelah dijarah
    lootCooldownSeconds: 30, // jeda sebelum boleh jarah lagi (0 = tanpa jeda)
    lootWarnSeconds: 10   // banner berkedip di N detik terakhir
  };

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var LOOT_MS = CFG.lootSeconds * 1000;
  var COOLDOWN_MS = CFG.lootCooldownSeconds * 1000;
  var KEY_UNTIL = 'mm_loot_until';
  var KEY_NEXT = 'mm_loot_next';

  // Hanya untuk uji coba: tambahkan ?tutup=1 di URL untuk memaksa tampilan tutup.
  var forceClosed = /[?&]tutup=1(&|$)/.test(window.location.search);
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Selisih jam server dengan jam perangkat (diisi setelah sinkron ke server).
  var clockOffset = 0;
  function nowMs() { return Date.now() + clockOffset; }

  /* ---------- PENYIMPANAN (aman bila localStorage diblokir) ---------- */
  function store(key, val) { try { localStorage.setItem(key, String(val)); } catch (e) {} }
  function load(key) { try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; } }
  function unstore(key) { try { localStorage.removeItem(key); } catch (e) {} }

  /* ---------- HITUNG WAKTU WITA (tidak tergantung zona waktu perangkat) ---------- */
  function msIntoDay(ms) {
    var d = new Date(ms + CFG.utcOffsetHours * HOUR);
    return ((d.getUTCHours() * 60 + d.getUTCMinutes()) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds();
  }
  function isClosed(ms) {
    if (forceClosed) return true;
    var t = msIntoDay(ms);
    return t >= CFG.closeHour * HOUR || t < CFG.openHour * HOUR;
  }
  function msUntilOpen(ms) {
    var t = msIntoDay(ms);
    var openAt = CFG.openHour * HOUR;
    return t < openAt ? openAt - t : DAY + openAt - t;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function formatCountdown(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(total / 3600)) + ':' + pad(Math.floor((total % 3600) / 60)) + ':' + pad(total % 60);
  }
  function formatShort(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
  }
  function hourLabel(h) { return pad(h) + '.00'; }

  /* ---------- STATUS JARAH (tahan banting terhadap data localStorage yang dioprek) ---------- */
  function lootRemaining(ms) {
    var r = load(KEY_UNTIL) - ms;
    if (r > LOOT_MS + 15000) { unstore(KEY_UNTIL); return 0; }
    return r > 0 ? r : 0;
  }
  function cooldownRemaining(ms) {
    var r = load(KEY_NEXT) - ms;
    if (r > LOOT_MS + COOLDOWN_MS + 15000) { unstore(KEY_NEXT); return 0; }
    return r > 0 ? r : 0;
  }

  /* ---------- CSS ---------- */
  var STRIPES = 'repeating-linear-gradient(180deg,#f3efe4 0,#ece7da 11px,#d3cdbd 12px,#bdb7a6 14px,#f3efe4 16px)';

  var CSS = `
#mm-shop-closed{position:fixed;inset:0;z-index:2147483647;overflow:hidden;background:transparent;font-family:"Bricolage Grotesque","Inter",system-ui,sans-serif}
#mm-shop-closed *{box-sizing:border-box}
#mm-shop-closed .mm-sc-door{position:absolute;inset:0;transform:translateY(-101%);will-change:transform;
  transition:transform 1.8s cubic-bezier(.45,.05,.25,1);
  background:${STRIPES};
  box-shadow:inset 12px 0 14px -8px rgba(0,0,0,.28),inset -12px 0 14px -8px rgba(0,0,0,.28)}
#mm-shop-closed .mm-sc-door.is-down{transform:translateY(0)}
#mm-shop-closed .mm-sc-door::before{content:"";position:absolute;left:0;right:0;top:0;height:20px;background:linear-gradient(#111,#2a2a2a);border-bottom:3px solid #000}
#mm-shop-closed .mm-sc-bar{position:absolute;left:0;right:0;bottom:0;height:38px;background:linear-gradient(#d4cdbb,#a9a290);border-top:4px solid #857f6d;box-shadow:0 -6px 10px rgba(0,0,0,.18)}
#mm-shop-closed .mm-sc-bar::after{content:"";position:absolute;left:50%;top:50%;width:46px;height:10px;transform:translate(-50%,-50%);background:#2b3440;border-radius:3px;border:2px solid #0b2342}
#mm-shop-closed .mm-sc-handle{position:absolute;left:50%;top:62%;width:70px;height:13px;transform:translateX(-50%);background:#1f2a36;border:2px solid #0b2342;border-radius:4px;box-shadow:0 3px 0 rgba(0,0,0,.25)}
#mm-shop-closed .mm-sc-sign{position:absolute;left:50%;top:22%;width:min(440px,calc(100% - 32px));transform:translateX(-50%);transform-origin:50% -34px;text-align:center;
  padding:22px 20px 20px;background:#ffd66b;color:#0b2342;border:3px solid #0b2342;border-radius:20px;box-shadow:7px 7px 0 #0b2342;z-index:3}
#mm-shop-closed .mm-sc-door.is-down .mm-sc-sign{animation:mm-sc-swing 2.6s ease-out 1.6s 1 both}
#mm-shop-closed .mm-sc-sign::before,#mm-shop-closed .mm-sc-sign::after{content:"";position:absolute;top:-36px;width:3px;height:36px;background:#0b2342}
#mm-shop-closed .mm-sc-sign::before{left:22%}
#mm-shop-closed .mm-sc-sign::after{right:22%}
#mm-shop-closed .mm-sc-brand{font:700 .8rem "Inter",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;opacity:.8;margin:0 0 6px}
#mm-shop-closed h2{margin:0;font-weight:800;font-size:clamp(2rem,9vw,3.1rem);line-height:1;letter-spacing:-.03em}
#mm-shop-closed h2 span{display:inline-block;margin-top:6px;padding:0 .18em;background:#ff5c7a;border:3px solid #0b2342;border-radius:12px;transform:rotate(-2deg);box-shadow:4px 4px 0 #0b2342}
#mm-shop-closed .mm-sc-open{margin:16px 0 0;font:600 1.05rem "Inter",system-ui,sans-serif}
#mm-shop-closed .mm-sc-hours{margin:4px 0 0;font:500 .86rem "Inter",system-ui,sans-serif;color:#47607c}
#mm-shop-closed .mm-sc-count{display:inline-block;margin-top:14px;padding:8px 16px;background:#fff;border:2px solid #0b2342;border-radius:999px;font:700 .95rem "Inter",system-ui,sans-serif;box-shadow:3px 3px 0 #0b2342}
#mm-shop-closed .mm-sc-count b{font-variant-numeric:tabular-nums;letter-spacing:.04em}
#mm-shop-closed .mm-sc-tag{margin:14px 0 0;font:600 .82rem "Inter",system-ui,sans-serif;color:#47607c}

/* Tombol jarah */
#mm-shop-closed .mm-sc-loot-wrap{margin-top:16px;padding-top:14px;border-top:2px dashed #0b2342}
#mm-shop-closed .mm-sc-loot{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 18px;border:3px solid #0b2342;border-radius:14px;background:#ff5c7a;color:#0b2342;
  font:800 1.1rem "Bricolage Grotesque","Inter",system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;box-shadow:5px 5px 0 #0b2342;transition:transform .12s,box-shadow .12s}
#mm-shop-closed .mm-sc-loot:hover:not(:disabled){transform:translate(2px,2px);box-shadow:3px 3px 0 #0b2342}
#mm-shop-closed .mm-sc-loot:active:not(:disabled){transform:translate(4px,4px);box-shadow:1px 1px 0 #0b2342}
#mm-shop-closed .mm-sc-loot:disabled{background:#e6e1d3;color:#47607c;cursor:not-allowed;box-shadow:3px 3px 0 #0b2342}
#mm-shop-closed .mm-sc-loot:focus-visible{outline:3px solid #0b2342;outline-offset:3px}
#mm-shop-closed .mm-sc-loot-note{margin:8px 0 0;font:500 .78rem "Inter",system-ui,sans-serif;color:#47607c}

/* Retakan */
#mm-shop-closed .mm-sc-cracks{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;opacity:0}
#mm-shop-closed .mm-sc-cracks path{fill:none;stroke:#1b1b1b;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:1}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks{opacity:1}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path{animation:mm-sc-crack .9s ease-out forwards}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path:nth-child(2){animation-delay:.25s}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path:nth-child(3){animation-delay:.5s}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path:nth-child(4){animation-delay:.75s}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path:nth-child(5){animation-delay:1s}
#mm-shop-closed .mm-sc-door.is-hit .mm-sc-cracks path:nth-child(6){animation-delay:1.15s}
@keyframes mm-sc-crack{to{stroke-dashoffset:0}}

/* Getar */
#mm-shop-closed .mm-sc-door.is-hit{animation:mm-sc-shake 1.6s linear both;transition:none}
@keyframes mm-sc-shake{
  0%{transform:translate(0,0)}
  8%{transform:translate(-3px,1px)} 16%{transform:translate(4px,-1px)} 24%{transform:translate(-4px,2px)}
  32%{transform:translate(5px,-2px)} 40%{transform:translate(-6px,2px)} 48%{transform:translate(6px,-3px)}
  56%{transform:translate(-8px,3px)} 64%{transform:translate(8px,-3px)} 72%{transform:translate(-10px,4px)}
  80%{transform:translate(10px,-4px)} 88%{transform:translate(-12px,4px)} 94%{transform:translate(12px,-5px)}
  100%{transform:translate(0,0)}}

/* Hancur */
#mm-shop-closed .mm-sc-door.is-broken{background:transparent;box-shadow:none;animation:none;transform:translateY(0);transition:none}
#mm-shop-closed .mm-sc-door.is-broken::before,
#mm-shop-closed .mm-sc-door.is-broken .mm-sc-bar,
#mm-shop-closed .mm-sc-door.is-broken .mm-sc-handle,
#mm-shop-closed .mm-sc-door.is-broken .mm-sc-cracks{display:none}
#mm-shop-closed .mm-sc-door.is-broken .mm-sc-sign{animation:mm-sc-signfall 1.2s cubic-bezier(.5,0,.9,.6) both;pointer-events:none}
#mm-shop-closed .mm-sc-slat{position:absolute;left:0;right:0;z-index:2;background:${STRIPES};border-bottom:3px solid #8f8978;
  box-shadow:inset 12px 0 14px -8px rgba(0,0,0,.28),inset -12px 0 14px -8px rgba(0,0,0,.28);
  animation:mm-sc-fall 1.1s cubic-bezier(.5,0,.9,.6) var(--delay,0s) both;will-change:transform}
@keyframes mm-sc-fall{
  0%{transform:translate(0,0) rotate(0)}
  15%{transform:translate(calc(var(--dx) * .2),-14px) rotate(calc(var(--rot) * .3))}
  100%{transform:translate(var(--dx),125vh) rotate(var(--rot))}}
@keyframes mm-sc-signfall{
  0%{transform:translateX(-50%) rotate(0)}
  20%{transform:translateX(-50%) rotate(-6deg)}
  100%{transform:translate(-30%,120vh) rotate(28deg)}}
@keyframes mm-sc-swing{0%{transform:translateX(-50%) rotate(0)}12%{transform:translateX(-50%) rotate(5deg)}30%{transform:translateX(-50%) rotate(-3.5deg)}50%{transform:translateX(-50%) rotate(2deg)}70%{transform:translateX(-50%) rotate(-1deg)}100%{transform:translateX(-50%) rotate(0)}}
@media (max-height:640px){#mm-shop-closed .mm-sc-sign{top:6%;padding:14px}#mm-shop-closed .mm-sc-loot-wrap{margin-top:10px;padding-top:10px}}

/* Banner mode jarah */
#mm-loot-banner{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;
  display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:10px 18px;background:#ffd66b;color:#0b2342;border:3px solid #0b2342;border-radius:999px;
  box-shadow:4px 4px 0 #0b2342;font:700 .92rem "Inter",system-ui,sans-serif;animation:mm-lb-in .5s cubic-bezier(.2,1.4,.4,1) both}
#mm-loot-banner b{font-variant-numeric:tabular-nums;letter-spacing:.04em;padding:2px 10px;background:#fff;border:2px solid #0b2342;border-radius:999px}
#mm-loot-banner.is-warn{background:#ff5c7a;animation:mm-lb-blink .6s steps(2,jump-none) infinite}
@keyframes mm-lb-in{from{transform:translate(-50%,160%)}to{transform:translate(-50%,0)}}
@keyframes mm-lb-blink{50%{background:#ffd66b}}

@media (prefers-reduced-motion:reduce){
  #mm-shop-closed .mm-sc-door{transition-duration:.3s}
  #mm-shop-closed .mm-sc-door.is-down .mm-sc-sign{animation:none}
  #mm-shop-closed .mm-sc-door.is-hit{animation:none}
  #mm-loot-banner,#mm-loot-banner.is-warn{animation:none}
}`;

  /* ---------- OVERLAY ---------- */
  var root = null;
  var door = null;
  var countEl = null;
  var lootBtn = null;
  var removeTimer = null;
  var lootTimers = [];
  var banner = null;
  var bannerEl = null;
  var state = null;      // null = belum diketahui, true = pintu tertutup, false = terbuka
  var lootBusy = false;  // animasi jarah sedang berjalan

  function injectStyle() {
    if (document.getElementById('mm-shop-closed-style')) return;
    var style = document.createElement('style');
    style.id = 'mm-shop-closed-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function setPageLocked(locked) {
    document.documentElement.style.overflow = locked ? 'hidden' : '';
    if (document.body) {
      document.body.style.overflow = locked ? 'hidden' : '';
      // inert: isi halaman di belakang tidak bisa diklik / difokus lewat keyboard
      document.body.inert = locked;
      if (locked) document.body.setAttribute('aria-hidden', 'true');
      else document.body.removeAttribute('aria-hidden');
    }
  }

  function crackSvg() {
    return '<svg class="mm-sc-cracks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path pathLength="1" d="M50 0 L47 14 L53 26 L46 40 L52 55 L48 70 L54 84 L50 100"/>' +
      '<path pathLength="1" d="M47 14 L30 22 L22 38 L8 44"/>' +
      '<path pathLength="1" d="M53 26 L70 30 L80 46 L96 50"/>' +
      '<path pathLength="1" d="M46 40 L34 56 L24 74 L12 86"/>' +
      '<path pathLength="1" d="M52 55 L68 66 L76 82 L90 94"/>' +
      '<path pathLength="1" d="M48 70 L58 78 L64 92"/>' +
      '</svg>';
  }

  function buildOverlay() {
    root = document.createElement('div');
    root.id = 'mm-shop-closed';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Toko tutup, buka kembali pukul ' + hourLabel(CFG.openHour) + ' ' + CFG.zoneLabel);

    var lootHtml = CFG.lootEnabled
      ? '<div class="mm-sc-loot-wrap">' +
          '<button type="button" class="mm-sc-loot" data-sc-loot>&#128296; JARAH TOKO</button>' +
          '<p class="mm-sc-loot-note">Cuma hiburan! Toko terbuka ' + CFG.lootSeconds + ' detik, lalu tutup lagi.</p>' +
        '</div>'
      : '';

    root.innerHTML =
      '<div class="mm-sc-door">' +
        crackSvg() +
        '<div class="mm-sc-handle"></div>' +
        '<div class="mm-sc-sign">' +
          '<p class="mm-sc-brand">Marketplace Mantan</p>' +
          '<h2>TOKO <span>TUTUP</span></h2>' +
          '<p class="mm-sc-open">Buka kembali pukul <b>' + hourLabel(CFG.openHour) + ' ' + CFG.zoneLabel + '</b></p>' +
          '<p class="mm-sc-hours">Jam buka: ' + hourLabel(CFG.openHour) + ' &ndash; ' + pad(CFG.closeHour - 1) + '.59 ' + CFG.zoneLabel + '</p>' +
          '<div class="mm-sc-count" role="timer">Buka dalam <b data-sc-count>--:--:--</b></div>' +
          '<p class="mm-sc-tag">Pian himung, kami untung.</p>' +
          lootHtml +
        '</div>' +
        '<div class="mm-sc-bar"></div>' +
      '</div>';
    door = root.querySelector('.mm-sc-door');
    countEl = root.querySelector('[data-sc-count]');
    lootBtn = root.querySelector('[data-sc-loot]');
    if (lootBtn) lootBtn.addEventListener('click', startLoot);
    (document.body || document.documentElement).appendChild(root);
    // Pindahkan ke <html> supaya tidak ikut terkena inert pada <body>.
    if (root.parentNode !== document.documentElement) document.documentElement.appendChild(root);
  }

  function showDoor() {
    injectStyle();
    clearTimeout(removeTimer);
    removeBanner();
    if (!root || !root.isConnected) buildOverlay();
    setPageLocked(true);
    // dua frame agar transisi dari atas ke bawah benar-benar berjalan
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (door) door.classList.add('is-down'); });
    });
    updateCountdown();
  }

  function hideDoor() {
    if (!root || !root.isConnected) { setPageLocked(false); return; }
    door.classList.remove('is-down'); // pintu naik ke atas
    var finish = function () {
      if (root && root.isConnected && door && !door.classList.contains('is-down')) {
        root.remove();
        root = door = countEl = lootBtn = null;
        setPageLocked(false);
      }
    };
    clearTimeout(removeTimer);
    removeTimer = setTimeout(finish, 1900);
  }

  function updateCountdown() {
    var ms = nowMs();
    if (countEl) countEl.textContent = formatCountdown(msUntilOpen(ms));
    if (lootBtn && !lootBusy) {
      var cd = cooldownRemaining(ms);
      if (cd > 0) {
        lootBtn.disabled = true;
        lootBtn.textContent = 'Tunggu ' + formatShort(cd);
      } else {
        lootBtn.disabled = false;
        lootBtn.innerHTML = '&#128296; JARAH TOKO';
      }
    }
  }

  /* ---------- ANIMASI JARAH TOKO ---------- */
  function later(fn, ms) { lootTimers.push(setTimeout(fn, ms)); }
  function clearLootTimers() { while (lootTimers.length) clearTimeout(lootTimers.pop()); }

  function startLoot() {
    if (lootBusy || !root || !door) return;
    if (cooldownRemaining(nowMs()) > 0) return;
    lootBusy = true;
    if (lootBtn) { lootBtn.disabled = true; lootBtn.textContent = 'DOBRAK...!'; }

    door.classList.add('is-hit');                // getar + retak
    later(breakDoor, reduceMotion ? 400 : 1650); // lalu hancur
  }

  function breakDoor() {
    if (!root || !door) { lootBusy = false; return; }
    var N = 10;
    for (var i = 0; i < N; i++) {
      var slat = document.createElement('div');
      slat.className = 'mm-sc-slat';
      slat.style.top = (i * 100 / N) + '%';
      slat.style.height = (100 / N + 0.4) + '%';
      slat.style.setProperty('--dx', Math.round((Math.random() * 2 - 1) * 90) + 'px');
      slat.style.setProperty('--rot', Math.round((Math.random() * 2 - 1) * 28) + 'deg');
      slat.style.setProperty('--delay', (Math.random() * 0.4).toFixed(2) + 's');
      root.appendChild(slat);
    }
    door.classList.remove('is-hit');
    door.classList.add('is-broken');
    later(finishLoot, reduceMotion ? 300 : 1800);
  }

  function finishLoot() {
    var ms = nowMs();
    store(KEY_UNTIL, ms + LOOT_MS);
    store(KEY_NEXT, ms + LOOT_MS + COOLDOWN_MS);
    if (root) { root.remove(); }
    root = door = countEl = lootBtn = null;
    clearTimeout(removeTimer);
    setPageLocked(false);
    lootBusy = false;
    state = false;
    showBanner();
    updateBanner();
  }

  /* ---------- BANNER MODE JARAH ---------- */
  function showBanner() {
    if (banner && banner.isConnected) return;
    injectStyle();
    banner = document.createElement('div');
    banner.id = 'mm-loot-banner';
    banner.setAttribute('role', 'timer');
    banner.innerHTML = '<span>&#128296; Toko dijarah! Cuma lihat-lihat, checkout tetap tutup. Tutup lagi dalam</span><b data-lb-count>00:00</b>';
    bannerEl = banner.querySelector('[data-lb-count]');
    document.documentElement.appendChild(banner);
  }
  function removeBanner() {
    if (banner && banner.isConnected) banner.remove();
    banner = bannerEl = null;
  }
  function updateBanner() {
    var ms = nowMs();
    var r = lootRemaining(ms);
    if (!(isClosed(ms) && r > 0)) { removeBanner(); return; }
    showBanner();
    if (bannerEl) bannerEl.textContent = formatShort(r);
    banner.classList.toggle('is-warn', r <= CFG.lootWarnSeconds * 1000);
  }

  /* ---------- LOOP PEMERIKSA ---------- */
  function tick() {
    if (lootBusy) return; // jangan ganggu animasi jarah yang sedang jalan
    var ms = nowMs();
    var closed = isClosed(ms);
    var looted = closed && CFG.lootEnabled && lootRemaining(ms) > 0;
    var doorDown = closed && !looted;

    if (doorDown !== state) {
      state = doorDown;
      if (doorDown) showDoor(); else hideDoor();
    }
    if (doorDown) updateCountdown();
    updateBanner();
  }

  /* ---------- SINKRON JAM SERVER (agar jam HP yang salah tidak bisa mengakali) ---------- */
  function syncServerTime() {
    if (!window.fetch) return;
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 5000);
    fetch(window.location.pathname || '/', { method: 'HEAD', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (res) {
        var header = res.headers.get('Date');
        var serverMs = header ? Date.parse(header) : NaN;
        if (isFinite(serverMs)) clockOffset = serverMs - Date.now();
        tick();
      })
      .catch(function () { /* gagal? pakai jam perangkat saja */ })
      .then(function () { clearTimeout(timer); });
  }

  /* ---------- START ---------- */
  injectStyle();
  tick();                                    // langsung periksa saat script dimuat
  setInterval(tick, 1000);                   // cek tiap detik (pasti pas jam 22.00 / 08.00 / akhir waktu jarah)
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('pageshow', tick); // tombol Back / bfcache
  window.addEventListener('storage', tick);  // tab lain menjarah toko -> tab ini ikut terbuka
  document.addEventListener('DOMContentLoaded', function () {
    if (state === true) setPageLocked(true); // body baru ada setelah DOM siap
    updateBanner();
  });
  syncServerTime();
})();