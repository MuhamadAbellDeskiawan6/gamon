(function () {
    const sidebarHost = document.querySelector('[data-admin-sidebar]');
    if (!sidebarHost) return;

    const normalizePath = (path) => (String(path || '').replace(/\/+$/, '').replace(/\.html$/, '')) || '/';
    const currentPath = normalizePath(window.location.pathname);

    const menuItems = [
        { href: '/admin/dashboard.html', label: 'Dashboard', icon: 'dashboard' },
        { href: '/admin/match-confirm.html', label: 'Kelola Match Confirm', icon: 'favorite' },
        { href: '/admin/ldr-frames.html', label: 'Frame Foto LDR', icon: 'photo_library' },
        { section: 'Marketplace Mantan' },
        { href: '/admin/marketplace.html', label: 'Ringkasan Marketplace', icon: 'storefront' },
        {
            href: '/admin/marketplace-products.html',
            label: 'Produk Marketplace',
            icon: 'inventory_2',
            alsoActive: ['/admin/marketplace-product-form.html']
        },
        { href: '/admin/marketplace-orders.html', label: 'Pesanan Marketplace', icon: 'receipt_long', orders: true },
        { href: '/admin/marketplace-chat.html', label: 'Chat Pembeli', icon: 'chat', chat: true }
    ];

    const menuMarkup = menuItems.map((item) => {
        if (item.section) {
            return `<p class="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">${item.section}</p>`;
        }

        const targets = [item.href, ...(item.alsoActive || [])].map(normalizePath);
        const isActive = targets.includes(currentPath);
        const classes = isActive
            ? 'flex items-center justify-between gap-2 rounded-xl bg-pink-600 px-3 py-2 text-sm font-semibold text-white'
            : 'flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100';
        const badge = item.chat
            ? '<span data-admin-chat-unread class="hidden rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"></span>'
            : item.orders
                ? '<span data-admin-orders-unread class="hidden rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white"></span>'
                : '';
        const icon = item.icon ? `<span class="material-symbols-outlined" style="font-size:20px">${item.icon}</span>` : '';
        return `<a href="${item.href}" class="${classes}"${isActive ? ' aria-current="page"' : ''}><span class="flex items-center gap-2">${icon}<span>${item.label}</span></span>${badge}</a>`;
    }).join('');

    sidebarHost.outerHTML = `<aside class="border-r border-slate-200 bg-white p-4 lg:p-6">
        <div class="mb-6">
            <h1 class="text-lg font-bold text-pink-600">Gamon Admin</h1>
            <p class="mt-1 text-xs text-slate-500">Panel pengelolaan admin</p>
        </div>
        <nav class="space-y-1">${menuMarkup}</nav>
        <div class="mt-6 border-t border-slate-200 pt-4">
            <p id="adminEmail" class="mb-2 text-xs text-slate-500">Memeriksa sesi...</p>
            <button id="logoutButton" type="button" class="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-100">Keluar Sesi</button>
        </div>
    </aside>`;

    document.getElementById('logoutButton').addEventListener('click', () => {
        if (typeof window.handleLogout === 'function') window.handleLogout();
    });

    const chatBadge = document.querySelector('[data-admin-chat-unread]');
    const ordersBadge = document.querySelector('[data-admin-orders-unread]');
    if (chatBadge || ordersBadge) {
        import('/admin/admin-firebase.js').then(async ({ db, requireAdmin }) => {
            const access = await requireAdmin();
            if (!access) return;
            const { collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const unsubs = [];
            if (chatBadge) {
                unsubs.push(onSnapshot(collection(db, 'marketplace_chats'), (snapshot) => {
                    // Setiap thread (per produk) dihitung; tidak lagi dibatasi buyerId === id.
                    const unread = snapshot.docs.reduce((total, thread) => {
                        return total + Math.max(0, Number(thread.data().unreadForAdmin || 0));
                    }, 0);
                    chatBadge.textContent = unread > 99 ? '99+' : String(unread);
                    chatBadge.classList.toggle('hidden', unread === 0);
                }, (error) => console.error('[marketplace chat admin] gagal memperbarui badge sidebar:', error)));
            }
            if (ordersBadge) {
                unsubs.push(onSnapshot(collection(db, 'marketplace_orders'), (snapshot) => {
                    const pending = snapshot.docs.filter((order) => order.data().status === 'paid').length;
                    ordersBadge.textContent = pending > 99 ? '99+' : String(pending);
                    ordersBadge.classList.toggle('hidden', pending === 0);
                }, (error) => console.error('[marketplace orders admin] gagal memperbarui badge sidebar:', error)));
            }
            window.addEventListener('beforeunload', () => unsubs.forEach((unsubscribe) => unsubscribe()), { once: true });
        }).catch((error) => console.error('[marketplace chat admin] badge sidebar gagal dimulai:', error));
    }
})();