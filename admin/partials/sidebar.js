(function () {
    const sidebarHost = document.querySelector('[data-admin-sidebar]');
    if (!sidebarHost) return;

    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    const menuItems = [
        { href: '/admin/dashboard.html', label: 'Dashboard' },
        { href: '/admin/match-confirm.html', label: 'Kelola Match Confirm' },
        { href: '/admin/ldr-frames.html', label: 'Frame Foto LDR' },
        { href: '/admin/marketplace.html', label: 'Produk Marketplace' },
        { href: '/admin/marketplace-orders.html', label: 'Pesanan Marketplace', orders: true },
        { href: '/admin/marketplace-chat.html', label: 'Chat Pembeli', chat: true }
    ];

    const menuMarkup = menuItems.map((item) => {
        const isActive = currentPath === item.href;
        const classes = isActive
            ? 'block rounded-xl bg-pink-600 px-3 py-2 text-sm font-semibold text-white'
            : 'block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100';
        const badge = item.chat
            ? '<span data-admin-chat-unread class="hidden rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"></span>'
            : item.orders
                ? '<span data-admin-orders-unread class="hidden rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white"></span>'
                : '';
        return `<a href="${item.href}" class="${classes} flex items-center justify-between gap-2"${isActive ? ' aria-current="page"' : ''}>${item.label}${badge}</a>`;
    }).join('');

    sidebarHost.outerHTML = `<aside class="border-r border-slate-200 bg-white p-4 lg:p-6">
        <div class="mb-6">
            <h1 class="text-lg font-bold text-pink-600">Gamon Admin</h1>
            <p class="mt-1 text-xs text-slate-500">Panel pengelolaan admin</p>
        </div>
        <nav class="space-y-2">${menuMarkup}</nav>
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
                    const unread = snapshot.docs.reduce((total, thread) => {
                        const data = thread.data();
                        return total + (data.buyerId === thread.id ? Math.max(0, Number(data.unreadForAdmin || 0)) : 0);
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