const redeemInput = document.getElementById('redeemInput');
const resultBox = document.getElementById('resultBox');
const verifyButton = document.getElementById('verifyButton');
let html5QrCode = null;
let currentOrderId = null;

function switchTab(mode) {
    const tabManual = document.getElementById('tabManual');
    const tabScanner = document.getElementById('tabScanner');
    const sectionManual = document.getElementById('sectionManual');
    const sectionScanner = document.getElementById('sectionScanner');

    if (mode === 'manual') {
        tabManual.className = "flex-1 pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 text-sm";
        tabScanner.className = "flex-1 pb-3 font-medium text-slate-400 border-b-2 border-transparent text-sm";
        sectionManual.classList.remove('hidden');
        sectionScanner.classList.add('hidden');
        if (html5QrCode) {
            html5QrCode.stop().catch(() => {});
        }
    } else {
        tabScanner.className = "flex-1 pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 text-sm";
        tabManual.className = "flex-1 pb-3 font-medium text-slate-400 border-b-2 border-transparent text-sm";
        sectionScanner.classList.remove('hidden');
        sectionManual.classList.add('hidden');

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }
        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                document.getElementById('redeemInput').value = decodedText;
                switchTab('manual');
                processRedeem(decodedText);
            },
            (errorMessage) => {
                // ignore
            }
        ).catch(err => {
            alert("Gagal mengakses kamera: " + err);
        });
    }
}

window.switchTab = switchTab;

const urlParams = new URLSearchParams(window.location.search);
const initialOrderId = urlParams.get('orderId');
if (initialOrderId) {
    redeemInput.value = initialOrderId;
}

function setLoading(isLoading) {
    verifyButton.disabled = isLoading;
    verifyButton.innerText = isLoading ? 'Memverifikasi...' : 'Verifikasi & Tandai Diambil';
    verifyButton.classList.toggle('opacity-70', isLoading);
    verifyButton.classList.toggle('cursor-not-allowed', isLoading);
    verifyButton.classList.toggle('animate-pulse', isLoading);
}

async function fetchOrderDetails(orderId) {
    try {
        await fetch(`/api/get-photobox-order?orderId=${encodeURIComponent(orderId)}`);
    } catch (err) {
        console.error('Failed to fetch order details', err);
    }
}

async function processRedeem(codeOverride = null) {
    const code = codeOverride || redeemInput.value.trim();
    if (!code) {
        alert('Masukkan Order ID terlebih dahulu!');
        return;
    }

    fetchOrderDetails(code);

    try {
        setLoading(true);
        resultBox.classList.add('hidden');
        const response = await fetch('/api/admin/redeem-photobox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: code })
        });

        const result = await response.json();
        resultBox.classList.remove('hidden');

        if (result.success) {
            resultBox.className = "mt-6 rounded-2xl p-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800";
            resultBox.innerHTML = `
                <div class="font-bold text-base mb-1">✅ Order Valid & Sudah Ditandai Diambil!</div>
                <div class="text-xs space-y-1 mt-2 text-emerald-700">
                    <div><b>Order ID:</b> ${result.data.orderId}</div>
                    <div><b>Nama Pemesan:</b> ${result.data.nama}</div>
                    <div><b>Status:</b> ${result.data.statusMerchandise}</div>
                </div>
            `;
            if (result.data && result.data.orderId) {
                currentOrderId = result.data.orderId;
                fetchOrderDetails(result.data.orderId);
            }
        } else {
            resultBox.className = "mt-6 rounded-2xl p-4 text-sm bg-rose-50 border border-rose-200 text-rose-800";
            resultBox.innerHTML = `
                <div class="font-bold text-base mb-1">❌ Verifikasi Gagal</div>
                <div>${result.message}</div>
            `;
        }
    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan sistem.');
    } finally {
        setLoading(false);
    }
}

window.processRedeem = processRedeem;
