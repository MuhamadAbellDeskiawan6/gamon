








    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getFirestore, doc, getDoc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

    const firebaseConfig = {
        apiKey: "AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ",
        authDomain: "gamon-tawing.firebaseapp.com",
        projectId: "gamon-tawing",
        storageBucket: "gamon-tawing.firebasestorage.app",
        messagingSenderId: "370162915989",
        appId: "1:370162915989:web:76779062da83aa0c5c999c"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const btnMulai = document.getElementById('btnMulai');
    const redeemCodeInput = document.getElementById('redeemCodeInput');
    const btnRedeemCode = document.getElementById('btnRedeemCode');
    const redeemSection = document.getElementById('redeemSection');
    const returnLoadingOverlay = document.getElementById('returnLoadingOverlay');
    const returnLoadingTitle = document.getElementById('returnLoadingTitle');
    const returnLoadingSubtitle = document.getElementById('returnLoadingSubtitle');
    const areaAksiFoto = document.getElementById('areaAksiFoto');
    const btnSwitchCamera = document.getElementById('btnSwitchCamera');
    const cameraSwitchLabel = document.getElementById('cameraSwitchLabel');
    const btnFoto = document.getElementById('btnFoto');
    const areaRetake = document.getElementById('areaRetake');
    const btnRetake = document.getElementById('btnRetake');
    const btnLanjut = document.getElementById('btnLanjut');
    const formData = document.getElementById('formData');
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const outputCanvas = document.getElementById('outputCanvas');
    const photoPreview = document.getElementById('photoPreview');
    const countdownDisplay = document.getElementById('countdownDisplay');
    const flashOverlay = document.getElementById('flashOverlay');
    const backgroundSelector = document.getElementById('backgroundSelector');
    const showOnHomeToggle = document.getElementById('showOnHome');
    const pickupAddress = "Jl. Kelayan A Gg. Sidodadi No.75 RT.009 RW.001, Murung Raya, Banjarmasin";

    const recordBtn = document.getElementById('recordBtn');
    const recordText = document.getElementById('recordText');
    const recordIcon = document.getElementById('recordIcon');
    const audioPreview = document.getElementById('audioPreview');
    const player = document.getElementById('player');
    const recordingStatus = document.getElementById('recordingStatus');

    const frameSelector = document.getElementById("frameSelector");
    const frameOptions = document.getElementById("frameOptions");
    const frameLoadingMessage = document.getElementById("frameLoadingMessage");
    const frameOverlay = document.getElementById("frameOverlay");
    const framePreviewMeta = document.getElementById("framePreviewMeta");
    const framePreviewDots = document.getElementById("framePreviewDots");
    const framePreviewCaption = document.getElementById("framePreviewCaption");

    let localStream;
    let rawCapturedImage = null;
    let selfieSegmentation;
    let currentBackground = "original";
    let currentFacingMode = "user";
    let cameraSessionId = 0;
    let ctxOutput = outputCanvas.getContext("2d");

    document.querySelectorAll(".bg-thumb").forEach(item => {
        item.addEventListener("click", () => {
            document.querySelectorAll(".bg-thumb").forEach(bg => bg.classList.remove("active"));
            item.classList.add("active");
            currentBackground = item.dataset.bg;
        });
    });

    const fallbackFrames = [
        {
            id: 'default-polaroid',
            name: 'Classic Polaroid',
            previewImage: 'image/assets/polaroid-frame-preview.png',
            frameImage: 'image/assets/polaroid-frame.png'
        },
        {
            id: 'default-valentine',
            name: 'Valentine',
            previewImage: 'image/assets/valentine-frame-preview.png',
            frameImage: 'image/assets/valentine-frame.png'
        }
    ];
    let availableFrames = [];
    let selectedFrame = null;
    let carouselIndex = 0;
    let carouselTimer = null;

    let mediaRecorder;
    let audioChunks = [];
    let audioBase64 = null;
    let unsubscribePaymentListener = null;
    const REDEEM_SESSION_KEY = 'photoboxRedeemSession';
    const PENDING_SUBMISSION_KEY = 'photoboxPendingSubmission';
    let cameraActive = false;
    let frameTextColor = '#1F2937';
    const PHOTBOX_PRICE = 5000;

    function getPaymentAmount() {
        return loadRedeemSession() ? 0 : PHOTBOX_PRICE;
    }

    function syncSubmitButtonLabel() {
        const btnKirim = document.getElementById('btnKirim');
        if (!btnKirim) return;
        btnKirim.innerText = getPaymentAmount() === 0 ? 'Kirim & Gratis' : 'Kirim & Bayar 5K';
    }

    function showSuccess(message) {
        return Swal.fire({ icon: 'success', title: 'Berhasil', text: message, confirmButtonColor: '#171717' });
    }

    function showError(message) {
        return Swal.fire({ icon: 'error', title: 'Oops...', text: message, confirmButtonColor: '#171717' });
    }

    function showReturnLoading(title = 'Menyelesaikan pembayaran...', subtitle = 'Sedang menyiapkan pesanan Anda...') {
        if (!returnLoadingOverlay || !returnLoadingTitle || !returnLoadingSubtitle) return;
        returnLoadingTitle.textContent = title;
        returnLoadingSubtitle.textContent = subtitle;
        returnLoadingOverlay.classList.remove('hidden');
    }

    function hideReturnLoading() {
        if (!returnLoadingOverlay) return;
        returnLoadingOverlay.classList.add('hidden');
    }

    function initSelfieSegmentation() {
        selfieSegmentation = new SelfieSegmentation({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
        });
        selfieSegmentation.setOptions({ modelSelection: 1 });
        selfieSegmentation.onResults(onSegmentationResults);
    }

    function drawCover(ctx, img, canvasW, canvasH) {
        const iw = img.videoWidth || img.naturalWidth || img.width;
        const ih = img.videoHeight || img.naturalHeight || img.height;
        if (!iw || !ih) return;

        const imageRatio = iw / ih;
        const canvasRatio = canvasW / canvasH;

        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (imageRatio > canvasRatio) {
            sw = ih * canvasRatio;
            sx = (iw - sw) / 2;
        } else {
            sh = iw / canvasRatio;
            sy = (ih - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
    }

    function onSegmentationResults(results) {
        const w = outputCanvas.width;
        const h = outputCanvas.height;
        ctxOutput.clearRect(0, 0, w, h);
        ctxOutput.save();

        if (currentFacingMode === "user") {
            ctxOutput.translate(w, 0);
            ctxOutput.scale(-1, 1);
        }

        drawCover(ctxOutput, results.segmentationMask, w, h);
        ctxOutput.globalCompositeOperation = "source-in";
        drawCover(ctxOutput, results.image, w, h);

        ctxOutput.globalCompositeOperation = "destination-over";
        if (currentBackground === "original") {
            drawCover(ctxOutput, results.image, w, h);
        } else {
            ctxOutput.fillStyle = currentBackground;
            ctxOutput.fillRect(0, 0, w, h);
        }
        ctxOutput.restore();
        ctxOutput.globalCompositeOperation = "source-over";
    }

    function updateSwitchCameraLabel() {
        if (!cameraSwitchLabel) return;
        cameraSwitchLabel.textContent = currentFacingMode === "user"
            ? "Pakai Kamera Belakang"
            : "Pakai Kamera Depan";
    }

    function setRedeemSectionVisible(isVisible) {
        if (redeemSection) {
            redeemSection.classList.toggle('hidden', !isVisible);
        }
    }

    function saveRedeemSession(code, metadata = {}) {
        localStorage.setItem(REDEEM_SESSION_KEY, JSON.stringify({
            code: String(code || '').trim(),
            label: metadata.label || '',
            redeemedAt: metadata.redeemedAt || Date.now(),
        }));
    }

    function loadRedeemSession() {
        try {
            const raw = localStorage.getItem(REDEEM_SESSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.code ? parsed : null;
        } catch {
            return null;
        }
    }

    function clearRedeemSession() {
        localStorage.removeItem(REDEEM_SESSION_KEY);
    }

    function savePendingSubmission(payload) {
        localStorage.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(payload));
    }

    function loadPendingSubmission() {
        try {
            const raw = localStorage.getItem(PENDING_SUBMISSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && Object.keys(parsed).length ? parsed : null;
        } catch {
            return null;
        }
    }

    function clearPendingSubmission() {
        localStorage.removeItem(PENDING_SUBMISSION_KEY);
    }

    function resetIncompletePaymentSession() {
        clearPendingSubmission();
        localStorage.removeItem('tempOrderId');
        if (unsubscribePaymentListener) {
            unsubscribePaymentListener();
            unsubscribePaymentListener = null;
        }
    }

    async function resumeRedeemSession() {
        const redeemSession = loadRedeemSession();
        if (!redeemSession?.code) return false;

        setRedeemSectionVisible(false);
        if (unsubscribePaymentListener) {
            unsubscribePaymentListener();
            unsubscribePaymentListener = null;
        }

        initSelfieSegmentation();
        const cameraReady = await startCamera();
        if (!cameraReady) {
            clearRedeemSession();
            setRedeemSectionVisible(true);
            return false;
        }

        return true;
    }

    async function handleRedeemCode() {
        const code = redeemCodeInput?.value?.trim();
        if (!code) {
            showError('Masukkan kode redeem terlebih dahulu.');
            return;
        }

        const originalLabel = btnRedeemCode?.innerText || 'Redeem';
        btnRedeemCode.disabled = true;
        btnRedeemCode.innerText = 'Memeriksa...';

        try {
            const response = await fetch('/api/verify-photobox-redeem-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Kode redeem tidak valid.');
            }

            redeemCodeInput.value = '';
            saveRedeemSession(code, result.data);
            setRedeemSectionVisible(false);
            syncSubmitButtonLabel();

            await Swal.fire({
                icon: 'success',
                title: 'Kode berhasil ditukarkan',
                text: 'Biaya photobox Anda berubah menjadi gratis.',
                confirmButtonColor: '#171717'
            });
        } catch (error) {
            await showError(error.message || 'Gagal memverifikasi kode redeem.');
        } finally {
            btnRedeemCode.disabled = false;
            btnRedeemCode.innerText = originalLabel;
        }
    }

    function stopCameraStream() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        cameraActive = false;
        video.pause();
        video.srcObject = null;
    }

    async function startCamera() {
        const sessionId = ++cameraSessionId;
        stopCameraStream();
        updateSwitchCameraLabel();

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: {
                    facingMode: currentFacingMode === "environment"
                        ? { ideal: "environment" }
                        : "user",
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
            video.srcObject = localStream;
            video.onloadedmetadata = async () => {
                if (sessionId !== cameraSessionId) return;
                await video.play();
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                
                const PHOTO_WIDTH = 700;
                const PHOTO_HEIGHT = 1002;
                const targetRatio = PHOTO_WIDTH / PHOTO_HEIGHT;
                let cw, ch;

                if ((vw / vh) > targetRatio) {
                    ch = vh;
                    cw = ch * targetRatio;
                } else {
                    cw = vw;
                    ch = cw / targetRatio;
                }

                outputCanvas.width = cw;
                outputCanvas.height = ch;
                updateFrameProcessing();
            };

            btnMulai.classList.add('hidden');
            areaAksiFoto.classList.remove('hidden');
            backgroundSelector.classList.remove('hidden');
            frameSelector.classList.remove('hidden');
            framePreviewMeta?.classList.add('hidden');
            stopFrameCarouselAutoplay();
            setRedeemSectionVisible(false);
            cameraActive = true;
            return true;
        } catch (err) {
            showError("Gagal mengakses kamera: " + err.message);
            return false;
        }
    }

    let processingCamera = false;
    async function updateFrameProcessing() {
        if (processingCamera) return;
        processingCamera = true;
        const sessionId = cameraSessionId;
        while (video.srcObject && !video.paused && !video.ended) {
            if (sessionId !== cameraSessionId) break;
            await selfieSegmentation.send({ image: video });
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        processingCamera = false;

        if (video.srcObject && !video.paused && !video.ended && sessionId !== cameraSessionId) {
            updateFrameProcessing();
        }
    }

    btnSwitchCamera?.addEventListener('click', async () => {
        btnSwitchCamera.disabled = true;
        btnSwitchCamera.classList.add('opacity-60', 'cursor-wait');
        const previousFacingMode = currentFacingMode;
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

        try {
            const switched = await startCamera();
            if (!switched) {
                currentFacingMode = previousFacingMode;
                await startCamera();
            }
        } finally {
            updateSwitchCameraLabel();
            btnSwitchCamera.disabled = false;
            btnSwitchCamera.classList.remove('opacity-60', 'cursor-wait');
        }
    });

    btnRedeemCode?.addEventListener('click', handleRedeemCode);
    redeemCodeInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleRedeemCode();
        }
    });

    function loadImageDataUrl(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Gagal memuat frame'));
            image.src = src;
        });
    }

    async function resolveFrameTextColor(frameSrc) {
        const lightTextColor = '#F8FAFC';
        const darkTextColor = '#1F2937';

        try {
            const image = await loadImageDataUrl(frameSrc || fallbackFrames[0].frameImage);
            const tempCanvas = document.createElement('canvas');
            const sampleSize = 32;
            tempCanvas.width = sampleSize;
            tempCanvas.height = sampleSize;

            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(image, 0, 0, sampleSize, sampleSize);

            const { data } = tempCtx.getImageData(0, 0, sampleSize, sampleSize);
            let totalR = 0;
            let totalG = 0;
            let totalB = 0;
            let pixelCount = 0;

            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha === 0) continue;
                totalR += data[i];
                totalG += data[i + 1];
                totalB += data[i + 2];
                pixelCount += 1;
            }

            if (!pixelCount) return darkTextColor;

            const avgR = totalR / pixelCount;
            const avgG = totalG / pixelCount;
            const avgB = totalB / pixelCount;
            const brightness = (0.2126 * avgR) + (0.7152 * avgG) + (0.0722 * avgB);

            return brightness > 160 ? darkTextColor : lightTextColor;
        } catch (error) {
            return darkTextColor;
        }
    }

    function updateFrameSelectionUI() {
        frameOptions.querySelectorAll('.frame-thumb').forEach((item) => {
            item.classList.toggle('active', item.dataset.frameId === selectedFrame?.id);
        });
    }

    function stopFrameCarouselAutoplay() {
        if (carouselTimer) {
            clearInterval(carouselTimer);
            carouselTimer = null;
        }
    }

    function updateFrameCarousel(nextIndex) {
        if (!availableFrames.length || !frameOverlay) return;

        carouselIndex = (nextIndex + availableFrames.length) % availableFrames.length;

        const activeFrame = availableFrames[carouselIndex];
        if (activeFrame) {
            selectedFrame = activeFrame;
            frameOverlay.src = activeFrame.previewImage;
            frameOverlay.classList.remove('opacity-0');
        }
        if (framePreviewCaption) {
            framePreviewCaption.textContent = activeFrame?.name || 'Frame photobox';
        }

        updateFrameSelectionUI();

        if (framePreviewDots) {
            framePreviewDots.querySelectorAll('[data-dot-index]').forEach((dot) => {
                const isActive = Number(dot.dataset.dotIndex) === carouselIndex;
                dot.classList.toggle('bg-neutral-900', isActive);
                dot.classList.toggle('w-4', isActive);
                dot.classList.toggle('bg-neutral-300', !isActive);
                dot.classList.toggle('w-2', !isActive);
            });
        }
    }

    function startFrameCarouselAutoplay() {
        stopFrameCarouselAutoplay();
        if (cameraActive || availableFrames.length <= 1) return;
        carouselTimer = setInterval(() => {
            updateFrameCarousel(carouselIndex + 1);
        }, 2500);
    }

    function renderFrameCarousel(frames) {
        if (!framePreviewMeta || !framePreviewDots || !framePreviewCaption) return;

        framePreviewDots.innerHTML = '';

        if (!frames.length) {
            framePreviewMeta.classList.add('hidden');
            return;
        }

        framePreviewMeta.classList.remove('hidden');

        frames.forEach((frame, index) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.dataset.dotIndex = String(index);
            dot.className = 'h-2 w-2 rounded-full bg-neutral-300 transition-all';
            dot.addEventListener('click', () => {
                updateFrameCarousel(index);
                const clickedFrame = availableFrames[index];
                if (clickedFrame) {
                    selectedFrame = clickedFrame;
                    updateFrameSelectionUI();
                }
                if (!cameraActive) {
                    startFrameCarouselAutoplay();
                }
            });
            framePreviewDots.appendChild(dot);
        });

        const initialIndex = Math.max(0, frames.findIndex((frame) => frame.id === selectedFrame?.id));
        updateFrameCarousel(initialIndex);
        if (!cameraActive) {
            startFrameCarouselAutoplay();
        }
    }

    function selectFrame(frameId) {
        const frame = availableFrames.find((item) => item.id === frameId) || availableFrames[0] || fallbackFrames[0];
        selectedFrame = frame;
        frameOverlay.src = frame.previewImage;
        frameOverlay.classList.remove('opacity-0');
        updateFrameSelectionUI();

        const frameSource = selectedFrame?.frameImage || selectedFrame?.previewImage || fallbackFrames[0].frameImage;
        resolveFrameTextColor(frameSource).then((resolvedColor) => {
            frameTextColor = resolvedColor;
        });

        const linkedIndex = availableFrames.findIndex((item) => item.id === frame.id);
        if (linkedIndex >= 0) {
            updateFrameCarousel(linkedIndex);
            if (!cameraActive) {
                startFrameCarouselAutoplay();
            }
        }
    }

    function renderFrameOptions(frames) {
        frameOptions.innerHTML = '';

        frames.forEach((frame) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'frame-thumb flex-shrink-0 rounded-lg border-2 border-transparent bg-white p-1 text-left';
            button.dataset.frameId = frame.id;

            const image = document.createElement('img');
            image.src = frame.previewImage;
            image.alt = frame.name || 'Frame photobox';
            image.className = 'w-16 h-20 rounded-md object-cover';

            button.appendChild(image);
            button.addEventListener('click', () => selectFrame(frame.id));
            frameOptions.appendChild(button);
        });

        selectFrame(selectedFrame?.id || frames[0]?.id);
    }

    async function loadFrameOptions() {
        frameLoadingMessage.textContent = 'Memuat daftar frame...';

        try {
            const response = await fetch('/api/get-photobox-frames');
            const result = await response.json();
            const framesFromDb = response.ok && result.success && Array.isArray(result.data)
                ? result.data.filter((frame) => frame.previewImage && frame.frameImage)
                : [];

            availableFrames = framesFromDb.length ? framesFromDb : fallbackFrames;
            renderFrameCarousel(availableFrames);
            renderFrameOptions(availableFrames);

            frameLoadingMessage.textContent = framesFromDb.length
                ? 'Pilih frame favoritmu.'
                : 'Belum ada frame dari admin, memakai frame bawaan.';
        } catch (error) {
            availableFrames = fallbackFrames;
            renderFrameCarousel(availableFrames);
            renderFrameOptions(availableFrames);
            frameLoadingMessage.textContent = 'Gagal memuat dari server, memakai frame bawaan.';
        }
    }

    loadFrameOptions();

    const getSupportedAudioMimeType = () => {
        const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav'];
        if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
        return '';
    };

    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) {
        recordBtn.disabled = true;
        recordBtn.classList.add('opacity-50', 'cursor-not-allowed');
        recordText.innerText = 'Pesan suara tidak didukung perangkat ini';
    }

    recordBtn.addEventListener('click', async () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = getSupportedAudioMimeType();
                mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = event => {
                    if (event.data && event.data.size > 0) audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    const type = audioChunks[0]?.type || mediaRecorder.mimeType || 'audio/webm';
                    const audioBlob = new Blob(audioChunks, { type });
                    player.src = URL.createObjectURL(audioBlob);
                    audioPreview.classList.remove('hidden');
                    
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = () => { audioBase64 = reader.result; };
                };

                mediaRecorder.start();
                recordText.innerText = 'Berhenti Merekam';
                recordIcon.innerText = 'stop';
                recordingStatus.classList.remove('hidden');
                recordBtn.classList.add('bg-neutral-100', 'text-red-600');
            } catch (err) {
                showError('Gagal mengakses mikrofon Anda.');
            }
        } else {
            mediaRecorder.stop();
            recordText.innerText = 'Rekam Ulang';
            recordIcon.innerText = 'refresh';
            recordingStatus.classList.add('hidden');
            recordBtn.classList.remove('bg-neutral-100', 'text-red-600');
        }
    });

    async function finalizePaidPhotobox(orderId) {
        const orderDoc = await getDoc(doc(db, "orders", orderId));
        const orderData = orderDoc.data() || {};

        if (!orderDoc.exists() || (orderData.status || orderData.paymentStatus) !== 'PAID') {
            hideReturnLoading();
            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
            return;
        }

        const pendingPayload = loadPendingSubmission();
        if (!pendingPayload) {
            showReturnLoading('Menyelesaikan pesanan...', 'Sedang menyiapkan halaman sukses...');
            window.location.href = `photobox-success.html?orderId=${orderId}`;
            return;
        }

        showReturnLoading('Menyelesaikan pembayaran...', 'Sedang menyimpan data pesanan dan menyiapkan halaman sukses...');

        try {
            const response = await fetch('/api/submit-photobox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...pendingPayload,
                    orderId,
                    status: 'PAID',
                    paymentStatus: 'PAID',
                    paidAt: Date.now(),
                    redeemCode: pendingPayload.redeemCode || loadRedeemSession()?.code || null,
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Gagal menyimpan data photobox setelah pembayaran.');
            }

            clearPendingSubmission();
            localStorage.removeItem('tempOrderId');
            clearRedeemSession();
            hideReturnLoading();

            await Swal.fire({
                icon: 'success',
                title: 'Pembayaran Berhasil',
                text: 'Data pesanan Anda sudah dibuat dan siap diproses.',
                confirmButtonColor: '#171717'
            });

            window.location.href = `photobox-success.html?orderId=${orderId}`;
        } catch (error) {
            hideReturnLoading();
            await showError('Gagal: ' + error.message);
            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
        }
    }

    function listenToPayment(orderId) {
        if (!orderId) return;

        let finalized = false;
        btnMulai.innerText = "Mengecek status pembayaran...";
        btnMulai.disabled = true;

        if (unsubscribePaymentListener) {
            unsubscribePaymentListener();
        }

        const finalizeIfPaid = async () => {
            if (finalized) return;
            finalized = true;
            if (unsubscribePaymentListener) {
                unsubscribePaymentListener();
                unsubscribePaymentListener = null;
            }

            const orderDoc = await getDoc(doc(db, "orders", orderId));
            const orderData = orderDoc.data() || {};
            if ((orderData.status || orderData.paymentStatus) === 'PAID') {
                await finalizePaidPhotobox(orderId);
                return;
            }

            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
        };

        unsubscribePaymentListener = onSnapshot(doc(db, "orders", orderId), async (docSnapshot) => {
           const orderData = docSnapshot.data() || {};
           const paymentStatus = orderData.status || orderData.paymentStatus;

           if (paymentStatus === "PAID") {
                await finalizeIfPaid();
                return;
            }

            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
        }, () => {
            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const orderIdFromUrl = urlParams.get('orderId');
    const storedOrderId = localStorage.getItem('tempOrderId');
    const redeemSession = loadRedeemSession();

    if (redeemSession) {
        syncSubmitButtonLabel();
    }

    if (orderIdFromUrl || storedOrderId) {
        const activeOrderId = orderIdFromUrl || storedOrderId;
        const pendingPayload = loadPendingSubmission();

        setTimeout(async () => {
            const orderDoc = await getDoc(doc(db, "orders", activeOrderId));
            const orderData = orderDoc.data() || {};
            const paymentStatus = orderData.status || orderData.paymentStatus;

            if (paymentStatus === 'PAID') {
                if (pendingPayload) {
                    showReturnLoading('Menyelesaikan pembayaran...', 'Sedang menyiapkan pesanan Anda...');
                    await finalizePaidPhotobox(activeOrderId);
                    return;
                }
                listenToPayment(activeOrderId);
                return;
            }

            resetIncompletePaymentSession();

            if (orderIdFromUrl) {
                const cleanUrl = window.location.pathname;
                window.history.replaceState({}, '', cleanUrl);
            }
        }, 300);
    }

    btnMulai.onclick = async () => {
        btnMulai.innerText = 'Memuat kamera...';
        btnMulai.disabled = true;
        try {
            initSelfieSegmentation();
            const started = await startCamera();
            if (!started) {
                throw new Error('Kamera tidak bisa diaktifkan.');
            }
        } catch (err) {
            showError('Kesalahan: ' + err.message);
            btnMulai.innerText = 'Mulai Buat Kenangan';
            btnMulai.disabled = false;
        }
    };

    function captureSnapshot(){
        flashOverlay.classList.remove("opacity-0");
        flashOverlay.classList.add("opacity-100");
        setTimeout(()=>{
            flashOverlay.classList.remove("opacity-100");
            flashOverlay.classList.add("opacity-0");
        },150);

        const snapshotCanvas = document.createElement("canvas");
        snapshotCanvas.width = outputCanvas.width;
        snapshotCanvas.height = outputCanvas.height;
        const snapshotCtx = snapshotCanvas.getContext("2d");
        snapshotCtx.drawImage(outputCanvas, 0, 0);

        rawCapturedImage = snapshotCanvas.toDataURL("image/png");
        photoPreview.src = rawCapturedImage;

        outputCanvas.classList.add("hidden");
        photoPreview.classList.remove("hidden");
        btnSwitchCamera.classList.add("hidden");
        btnFoto.classList.add("hidden");
        areaRetake.classList.remove("hidden");
    }

    btnFoto.onclick = () => {
        btnFoto.disabled = true;
        let timeLeft = 5;
        countdownDisplay.innerText = timeLeft;
        countdownDisplay.classList.remove('hidden');

        const timer = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(timer);
                countdownDisplay.classList.add('hidden');
                captureSnapshot();
            } else {
                countdownDisplay.innerText = timeLeft;
            }
        }, 1000);
    };

    btnRetake.onclick = () => {
        outputCanvas.classList.remove("hidden");
        photoPreview.classList.add("hidden");
        btnSwitchCamera.classList.remove("hidden");
        btnFoto.classList.remove("hidden");
        areaRetake.classList.add("hidden");
        rawCapturedImage = null;
        btnFoto.disabled = false;
        updateFrameProcessing();
    };

    btnLanjut.onclick = () => {
        areaAksiFoto.classList.add('hidden');
        backgroundSelector.classList.add('hidden');
        frameSelector.classList.add('hidden');
        formData.classList.remove('hidden');
        setRedeemSectionVisible(true);
        stopCameraStream();
        processingCamera = false;
    };

    formData.onsubmit = async (e) => {
        e.preventDefault();
        const btnKirim = document.getElementById('btnKirim');
        const nama = document.getElementById('senderName').value.trim();
        const tujuan = document.getElementById('receiverName').value.trim();
        const pesan = document.getElementById('messageContent').value.trim();
        const email = document.getElementById('email').value.trim();
        const whatsapp = document.getElementById('whatsapp').value.trim();
        const showOnHome = showOnHomeToggle ? showOnHomeToggle.checked : true;

        if (!rawCapturedImage) {
            await showError('Silakan ambil foto terlebih dahulu sebelum melanjutkan.');
            return;
        }

        if (!nama || !tujuan || !email || !whatsapp) {
            await showError('Lengkapi semua data identitas dan kontak sebelum lanjut ke pembayaran.');
            return;
        }

        const redeemSession = loadRedeemSession();
        const paymentAmount = getPaymentAmount();
        const previousTempOrderId = localStorage.getItem('tempOrderId');
        const generatedOrderId = previousTempOrderId && !loadPendingSubmission() ? previousTempOrderId : 'GAMON-' + Date.now();

        if (!localStorage.getItem('tempOrderId') || !loadPendingSubmission()) {
            localStorage.setItem('tempOrderId', generatedOrderId);
        }

        btnKirim.innerText = paymentAmount === 0 ? 'Menyelesaikan order gratis...' : 'Memproses pembayaran...';
        btnKirim.disabled = true;

        const polaroidCanvas = document.createElement('canvas');
        const ctx = polaroidCanvas.getContext('2d');
        const selectedFrameSource = selectedFrame?.frameImage || selectedFrame?.previewImage || fallbackFrames[0].frameImage;
        const frameTextColorResolved = await resolveFrameTextColor(selectedFrameSource);
        frameTextColor = frameTextColorResolved;

        polaroidCanvas.width = 900;
        polaroidCanvas.height = 1560;

        const frame = new Image();
        const img = new Image();

        await Promise.all([
            new Promise((resolve, reject) => {
                frame.onload = resolve;
                frame.onerror = reject;
                frame.src = selectedFrame?.frameImage || fallbackFrames[0].frameImage;
            }),
            new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = rawCapturedImage;
            })
        ]);

        const photoX = 100;
        const photoY = 100;
        const photoWidth = 700;
        const photoHeight = 1002;

        const imgRatio = img.width / img.height;
        const frameRatio = photoWidth / photoHeight;
        let sx, sy, sw, sh;

        if (imgRatio > frameRatio) {
            sh = img.height;
            sw = sh * frameRatio;
            sx = (img.width - sw) / 2;
            sy = 0;
        } else {
            sw = img.width;
            sh = sw / frameRatio;
            sx = 0;
            sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, photoX, photoY, photoWidth, photoHeight);
        ctx.drawImage(frame, 0, 0, polaroidCanvas.width, polaroidCanvas.height);

        await document.fonts.ready;

        ctx.fillStyle = frameTextColor;
        ctx.font = "italic 500 22px 'Playfair Display', serif";

        ctx.textAlign = "left";
        ctx.fillText(`Dear: ${tujuan}`, 100, 1145);

        ctx.textAlign = "right";
        ctx.fillText(`â€” Dari: ${nama}`, 800, 1145);

        ctx.strokeStyle = frameTextColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(100, 1165);
        ctx.lineTo(800, 1165);
        ctx.stroke();

        let textMaxWidth = 700;
        if (audioBase64) {
            const qrContainer = document.getElementById('qrcode');
            qrContainer.innerHTML = '';
            const domainProduksi = 'https://gamon-tawing.vercel.app';
            const listenUrl = `${domainProduksi}/suara.html?orderId=${generatedOrderId}`;

            new QRCode(qrContainer, {
                text: listenUrl,
                width: 150,
                height: 150,
                correctLevel: QRCode.CorrectLevel.H
            });

            await new Promise(resolve => setTimeout(resolve, 400));
            const qrCanvas = qrContainer.querySelector('canvas');

            if (qrCanvas) {
                const qrSize = 120;
                const qrX = 650;
                const qrY = 1195;
                ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
                textMaxWidth = 520;
            }
        }

        if (pesan && pesan.trim() !== '') {
            ctx.fillStyle = frameTextColor;
            ctx.font = "italic 500 24px 'Playfair Display', serif";
            ctx.textAlign = 'left';

            const words = pesan.split(' ');
            let line = '';
            let lineCount = 0;
            let currentY = 1200;
            const lineHeight = 34;

            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = ctx.measureText(testLine);
                if (metrics.width > textMaxWidth && n > 0) {
                    ctx.fillText(line, 100, currentY);
                    line = words[n] + ' ';
                    currentY += lineHeight;
                    lineCount++;
                    if (lineCount >= 3) break;
                } else {
                    line = testLine;
                }
            }
            if (lineCount < 3) {
                ctx.fillText(line, 100, currentY);
            }
        }

        const polaroidBase64 = polaroidCanvas.toDataURL('image/jpeg', 0.92);
        const payload = {
            nama, tujuan, pesan, email, whatsapp, alamat: pickupAddress, koordinat: '', showOnHome,
            photoBase64: polaroidBase64,
            audioUrl: audioBase64,
            orderId: generatedOrderId,
            frameId: selectedFrame?.id || null,
            frameName: selectedFrame?.name || null,
            framePreviewImage: selectedFrame?.previewImage || null,
            paymentAmount: paymentAmount,
            status: paymentAmount === 0 ? 'PAID' : 'PENDING_PAYMENT',
            paymentStatus: paymentAmount === 0 ? 'PAID' : 'PENDING_PAYMENT',
            redeemCode: redeemSession?.code || null,
            paidAt: paymentAmount === 0 ? Date.now() : null,
        };

        try {
            if (paymentAmount === 0) {
                clearPendingSubmission();
                localStorage.removeItem('tempOrderId');

                const successResponse = await fetch('/api/submit-photobox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const successResult = await successResponse.json().catch(() => ({}));
                if (!successResponse.ok || !successResult.success) {
                    throw new Error(successResult.message || 'Gagal menyimpan data photobox gratis.');
                }

                clearRedeemSession();
                await showSuccess('Berhasil! Pesanan photobox Anda sudah dibuat dan gratis karena kode redeem aktif.');
                window.location.href = `photobox-success.html?orderId=${generatedOrderId}`;
                return;
            }

            savePendingSubmission(payload);
            await setDoc(doc(db, "orders", generatedOrderId), {
                orderId: generatedOrderId,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                amount: paymentAmount,
                updatedAt: Date.now(),
            }, { merge: true });

            const orderDoc = await getDoc(doc(db, "orders", generatedOrderId));
            if (orderDoc.exists() && (orderDoc.data().status === 'PAID' || orderDoc.data().paymentStatus === 'PAID')) {
                throw new Error('Order ID sudah dipakai untuk pembayaran yang sudah dibayar. Silakan mulai dari awal dengan form baru.');
            }

            const paymentResponse = await fetch('/api/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: paymentAmount, orderId: generatedOrderId })
            });

            const paymentData = await paymentResponse.json();
            if (!paymentResponse.ok || !paymentData.response?.payment?.url) {
                throw new Error(paymentData.message || paymentData.error || 'Gagal mendapatkan link pembayaran.');
            }

            window.location.replace(paymentData.response.payment.url);
        } catch (err) {
            await showError('Gagal: ' + err.message);
            btnKirim.innerText = getPaymentAmount() === 0 ? 'Kirim & Gratis' : 'Kirim & Bayar 5K';
            btnKirim.disabled = false;
        }
    };

