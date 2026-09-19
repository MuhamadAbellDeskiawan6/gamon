(function () {
    const sidebarHost = document.querySelector('[data-admin-sidebar]');
    if (!sidebarHost) return;

    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    const menuItems = [
        { href: '/admin/dashboard.html', label: 'Dashboard' },
        { href: '/admin/match-confirm.html', label: 'Kelola Match Confirm' },
        { href: '/admin/ldr-frames.html', label: 'Frame Foto LDR' }
    ];

    const menuMarkup = menuItems.map((item) => {
        const isActive = currentPath === item.href;
        const classes = isActive
            ? 'block rounded-xl bg-pink-600 px-3 py-2 text-sm font-semibold text-white'
            : 'block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100';
        return `<a href="${item.href}" class="${classes}"${isActive ? ' aria-current="page"' : ''}>${item.label}</a>`;
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
})();