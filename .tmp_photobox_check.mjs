
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
    const guestEmailCapture = document.getElementById('guestEmailCapture');
    const guestEmailInput = document.getElementById('guestEmailInput');
    const toggleDataForm = document.getElementById('toggleDataForm');
    const modePesanKenanganCard = document.getElementById('modePesanKenanganCard');
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
    syncDataFormRequiredState();

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
    let frameProcessingRaf = null;
    let lastCameraFrameDraw = 0;
    let ctxOutput = outputCanvas.getContext("2d");
    let countdownVideoRecorder = null;
    let countdownVideoChunks = [];
    let countdownVideoBase64 = null;
    let countdownVideoMimeType = 'video/mp4';
    let countdownVideoRecordingInterval = null;
    let countdownVideoCanvas = null;
    let countdownVideoDataReady = Promise.resolve(null);
    let selectedFrameImage = null;
    let selectedFrameImageLoadPromise = null;
    let countdownFrameAsset = null;
    let countdownAnimationFrame = null;
    const COUNTDOWN_SECONDS = 5;

    // Window foto pada layout master polaroid (900x1560): X:100 Y:100 W:700 H:1002
    // Dipakai bersama oleh: hasil foto final (canvas polaroid) DAN video countdown,
    // supaya keduanya menampilkan area foto yang identik (tidak zoom/crop berbeda).
    const MASTER_CANVAS_WIDTH = 900;
    const MASTER_CANVAS_HEIGHT = 1560;
    const PHOTO_WINDOW_X = 100;
    const PHOTO_WINDOW_Y = 100;
    const PHOTO_WINDOW_W = 700;
    const PHOTO_WINDOW_H = 1002;
    const PHOTO_X_RATIO = PHOTO_WINDOW_X / MASTER_CANVAS_WIDTH;
    const PHOTO_Y_RATIO = PHOTO_WINDOW_Y / MASTER_CANVAS_HEIGHT;
    const PHOTO_W_RATIO = PHOTO_WINDOW_W / MASTER_CANVAS_WIDTH;
    const PHOTO_H_RATIO = PHOTO_WINDOW_H / MASTER_CANVAS_HEIGHT;

    document.querySelectorAll(".bg-thumb").forEach(item => {
        item.addEventListener("click", () => {
            document.querySelectorAll(".bg-thumb").forEach(bg => bg.classList.remove("active"));
            item.classList.add("active");
            currentBackground = item.dataset.bg;
        });
    });

    const fallbackFrames = [
        {
            id: 'default-ldr',
            name: 'Dual Virtual LDR',
            previewImage: 'image/assets/frame-ldr.png',
            frameImage: 'image/assets/frame-ldr.png'
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

    function isDataFormEnabled() {
        return !!toggleDataForm && toggleDataForm.checked;
    }

    function syncDataFormRequiredState() {
        const requiredFields = ['email'];
        document.querySelectorAll('#formData input, #formData textarea').forEach((field) => {
            const shouldRequire = requiredFields.includes(field.id);
            if (shouldRequire) {
                field.setAttribute('required', 'required');
            } else {
                field.removeAttribute('required');
            }
        });

        if (btnLanjut) {
            btnLanjut.textContent = 'Kirim Gratis';
        }
    }

    function updatePhotoActionExtras() {
        const showExtras = !!rawCapturedImage;
        if (modePesanKenanganCard) {
            modePesanKenanganCard.classList.toggle('hidden', true);
        }
        if (redeemSection) {
            redeemSection.classList.toggle('hidden', true);
        }
        if (guestEmailCapture) {
            guestEmailCapture.classList.toggle('hidden', !showExtras);
        }
    }

    function restoreCameraActionControls() {
        areaAksiFoto?.classList.remove('hidden');
        backgroundSelector?.classList.remove('hidden');
        frameSelector?.classList.remove('hidden');

        if (rawCapturedImage) {
            btnFoto?.classList.add('hidden');
            btnSwitchCamera?.classList.add('hidden');
            areaRetake?.classList.remove('hidden');
        } else {
            btnFoto?.classList.remove('hidden');
            btnSwitchCamera?.classList.remove('hidden');
            areaRetake?.classList.add('hidden');
        }
    }

    function hideCameraActionControls() {
        btnFoto?.classList.add('hidden');
        btnSwitchCamera?.classList.add('hidden');
    }

    function scrollCameraIntoView() {
        const boothColumn = document.getElementById('boothColumn') || document.getElementById('cameraContainer');
        if (!boothColumn) return;

        const rect = boothColumn.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.4 || rect.bottom > window.innerHeight * 0.95) {
            boothColumn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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

    function isLowPowerDevice() {
        const userAgent = navigator.userAgent || '';
        const lowerAgent = userAgent.toLowerCase();
        const tabletPattern = /(redmi.*pad|xiaomi.*pad|pad.*android|galaxy tab|sm-t|lenovo tab|surface|tablet)/i.test(userAgent);
        const lowCoreCount = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
        const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
        const olderAndroid = /android\s+[0-9](?:\.[0-9])?\s*(?:;|$)/i.test(userAgent) && !/android\s+1[0-9]/i.test(userAgent);
        return tabletPattern || (!!lowCoreCount && !/iphone|ipod/i.test(lowerAgent)) || !!lowMemory || !!olderAndroid;
    }

    function shouldUseSegmentation() {
        return !!selfieSegmentation && !isLowPowerDevice();
    }

    function initSelfieSegmentation() {
        if (isLowPowerDevice()) {
            selfieSegmentation = null;
            return;
        }

        try {
            selfieSegmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
            });
            selfieSegmentation.setOptions({ modelSelection: 1 });
            selfieSegmentation.onResults(onSegmentationResults);
        } catch (error) {
            console.warn('Selfie segmentation failed to initialize:', error);
            selfieSegmentation = null;
        }
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

    async function ensureSelectedFrameImage() {
        if (selectedFrameImage) return selectedFrameImage;
        if (!selectedFrameImageLoadPromise) {
            selectedFrameImageLoadPromise = new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    selectedFrameImage = img;
                    resolve(img);
                };
                img.onerror = () => reject(new Error('Gagal memuat frame untuk video countdown.'));
                img.src = selectedFrame?.frameImage || selectedFrame?.previewImage || fallbackFrames[0].frameImage;
            });
        }

        return selectedFrameImageLoadPromise;
    }

    function renderCountdownVideoFrame() {
        if (!countdownVideoCanvas || !outputCanvas || !selectedFrame) return;

        const targetCtx = countdownVideoCanvas.getContext('2d');
        targetCtx.clearRect(0, 0, countdownVideoCanvas.width, countdownVideoCanvas.height);
        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillRect(0, 0, countdownVideoCanvas.width, countdownVideoCanvas.height);

        // PENTING: posisi & ukuran window foto dihitung PROPORSIONAL terhadap
        // ukuran countdownVideoCanvas yang sebenarnya (bukan angka pixel tetap),
        // memakai rasio yang SAMA dengan window foto final di polaroid
        // (X:100 Y:100 W:700 H:1002 dari kanvas master 900x1560).
        // Ini memastikan video countdown menampilkan foto secara utuh sampai
        // dagu, sama persis seperti hasil foto final, tidak ke-zoom/terpotong.
        const photoX = countdownVideoCanvas.width * PHOTO_X_RATIO;
        const photoY = countdownVideoCanvas.height * PHOTO_Y_RATIO;
        const photoWidth = countdownVideoCanvas.width * PHOTO_W_RATIO;
        const photoHeight = countdownVideoCanvas.height * PHOTO_H_RATIO;

        targetCtx.drawImage(
            outputCanvas,
            0,
            0,
            outputCanvas.width,
            outputCanvas.height,
            photoX,
            photoY,
            photoWidth,
            photoHeight
        );

        try {
            const frameSource = selectedFrame?.frameImage || selectedFrame?.previewImage || fallbackFrames[0].frameImage;
            if (!countdownFrameAsset) {
                countdownFrameAsset = new Image();
                countdownFrameAsset.src = frameSource;
            }

            if (countdownFrameAsset && countdownFrameAsset.complete) {
                targetCtx.drawImage(countdownFrameAsset, 0, 0, countdownVideoCanvas.width, countdownVideoCanvas.height);
            }
        } catch (error) {
            console.warn('Countdown frame render failed:', error);
        }

        // Keep the live UI watermark only in the browser preview layer.
        // Do not render it into the exported countdown video so the softfile stays clean.
    }

    function startCountdownRenderLoop() {
        if (countdownAnimationFrame) {
            cancelAnimationFrame(countdownAnimationFrame);
        }

        const tick = () => {
            renderCountdownVideoFrame();
            if (countdownVideoRecorder && countdownVideoRecorder.state === 'recording') {
                countdownAnimationFrame = requestAnimationFrame(tick);
            }
        };

        countdownAnimationFrame = requestAnimationFrame(tick);
    }

    function renderRawCameraFrame() {
        if (!outputCanvas || !ctxOutput || !video || video.readyState < 2) return;
        ctxOutput.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
        ctxOutput.save();
        if (currentFacingMode === 'user') {
            ctxOutput.translate(outputCanvas.width, 0);
            ctxOutput.scale(-1, 1);
        }
        ctxOutput.drawImage(video, 0, 0, outputCanvas.width, outputCanvas.height);
        ctxOutput.restore();
    }

    function scheduleCameraRefresh() {
        if (!cameraActive || !video || !video.srcObject || video.paused || video.ended) return;
        if (frameProcessingRaf) {
            cancelAnimationFrame(frameProcessingRaf);
        }
        frameProcessingRaf = requestAnimationFrame(() => updateFrameProcessing());
    }

    function onSegmentationResults(results) {
        if (!outputCanvas || !ctxOutput || !shouldUseSegmentation()) {
            renderRawCameraFrame();
            return;
        }

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
        if (frameProcessingRaf) {
            cancelAnimationFrame(frameProcessingRaf);
            frameProcessingRaf = null;
        }
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
            const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const maxWidth = isIOS ? 1280 : 1600;
            const maxHeight = isIOS ? 1280 : 1600;

            localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: currentFacingMode === "environment"
                        ? { ideal: "environment" }
                        : { ideal: "user" },
                    width: { ideal: maxWidth, max: maxWidth },
                    height: { ideal: maxHeight, max: maxHeight },
                    frameRate: { ideal: 24, max: 30 }
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

                const safeWidth = Math.min(Math.max(Math.round(cw), 480), maxWidth || 1280);
                const safeHeight = Math.min(Math.max(Math.round(ch), 680), maxHeight || 1280);

                outputCanvas.width = safeWidth;
                outputCanvas.height = safeHeight;
                updateFrameProcessing();
            };

            renderFrameWatermark();
            frameWatermark?.classList.remove('hidden');
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
        if (!video || !video.srcObject || video.paused || video.ended || !cameraActive) {
            return;
        }

        const sessionId = cameraSessionId;
        const now = performance.now();
        const frameInterval = isLowPowerDevice() ? 180 : 45;

        if (now - lastCameraFrameDraw < frameInterval) {
            scheduleCameraRefresh();
            return;
        }

        lastCameraFrameDraw = now;

        if (!shouldUseSegmentation()) {
            renderRawCameraFrame();
            scheduleCameraRefresh();
            return;
        }

        if (processingCamera) return;
        processingCamera = true;

        try {
            await selfieSegmentation.send({ image: video });
        } catch (error) {
            console.warn('Segmentation frame skipped:', error);
            renderRawCameraFrame();
        } finally {
            processingCamera = false;
        }

        if (sessionId === cameraSessionId && video.srcObject && !video.paused && !video.ended && cameraActive) {
            scheduleCameraRefresh();
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

    function renderFrameWatermark() {
        const layer = document.getElementById('frameWatermark');
        if (!layer) return;

        const watermarkWords = ['GAMON TAWING', 'FRAME BARU', 'PHOTO BOOTH'];
        const positions = [
            { x: 4, y: 8, r: -19 }, { x: 22, y: 12, r: 17 }, { x: 40, y: 10, r: -18 }, { x: 58, y: 13, r: 16 }, { x: 75, y: 9, r: -18 },
            { x: 10, y: 26, r: 18 }, { x: 29, y: 29, r: -17 }, { x: 47, y: 27, r: 18 }, { x: 68, y: 30, r: -18 }, { x: 82, y: 25, r: 18 },
            { x: 4, y: 45, r: -16 }, { x: 22, y: 48, r: 16 }, { x: 40, y: 45, r: -17 }, { x: 58, y: 49, r: 18 }, { x: 76, y: 46, r: -16 },
            { x: 12, y: 64, r: 18 }, { x: 30, y: 67, r: -18 }, { x: 48, y: 65, r: 17 }, { x: 66, y: 68, r: -17 }, { x: 82, y: 64, r: 18 },
            { x: 4, y: 83, r: -18 }, { x: 23, y: 85, r: 18 }, { x: 41, y: 83, r: -18 }, { x: 60, y: 86, r: 18 }, { x: 78, y: 83, r: -17 }
        ];

        layer.innerHTML = positions.map((pos, index) => {
            const word = watermarkWords[index % watermarkWords.length];
            const opacity = 0.2 + ((index % 3) * 0.06);
            return `<span class="watermark-word" style="left:${pos.x}%; top:${pos.y}%; transform: rotate(${pos.r}deg); opacity:${opacity};">${word}</span>`;
        }).join('');
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
    renderFrameWatermark();

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
        const sourceCanvas = outputCanvas && outputCanvas.width && outputCanvas.height ? outputCanvas : video;
        const baseWidth = sourceCanvas && sourceCanvas.videoWidth ? sourceCanvas.videoWidth : (sourceCanvas ? sourceCanvas.width : 0);
        const baseHeight = sourceCanvas && sourceCanvas.videoHeight ? sourceCanvas.videoHeight : (sourceCanvas ? sourceCanvas.height : 0);
        const maxCaptureWidth = 1280;
        const maxCaptureHeight = 1920;

        if (!baseWidth || !baseHeight) {
            showError('Gagal menangkap gambar. Silakan coba lagi dengan kamera yang aktif.');
            return;
        }

        const ratio = Math.min(maxCaptureWidth / baseWidth, maxCaptureHeight / baseHeight, 1);
        snapshotCanvas.width = Math.max(1, Math.round(baseWidth * ratio));
        snapshotCanvas.height = Math.max(1, Math.round(baseHeight * ratio));

        const snapshotCtx = snapshotCanvas.getContext("2d");
        snapshotCtx.clearRect(0, 0, snapshotCanvas.width, snapshotCanvas.height);

        if (sourceCanvas === video) {
            snapshotCtx.save();
            if (currentFacingMode === 'user') {
                snapshotCtx.translate(snapshotCanvas.width, 0);
                snapshotCtx.scale(-1, 1);
            }
            snapshotCtx.drawImage(video, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
            snapshotCtx.restore();
        } else {
            snapshotCtx.drawImage(outputCanvas, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
        }

        rawCapturedImage = snapshotCanvas.toDataURL("image/jpeg", 0.86);
        photoPreview.src = rawCapturedImage;

        outputCanvas.classList.add("hidden");
        photoPreview.classList.remove("hidden");
        btnSwitchCamera.classList.add("hidden");
        btnFoto.classList.add("hidden");
        areaRetake.classList.remove("hidden");
        updatePhotoActionExtras();
        syncDataFormRequiredState();
    }

    function getSupportedVideoMimeType() {
        const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const preferredType = 'video/mp4';
        const types = isIOS
            ? [
                preferredType,
                'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
                'video/mp4;codecs=h264,mp4a.40.2',
                'video/quicktime',
                'video/webm',
                'video/x-matroska'
            ]
            : [
                preferredType,
                'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
                'video/mp4;codecs=h264,mp4a.40.2',
                'video/mp4',
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus',
                'video/webm',
                'video/x-matroska'
            ];

        if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') {
            return preferredType;
        }

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return preferredType;
    }

    async function startCountdownVideoRecording() {
        if (!window.MediaRecorder || !selectedFrame) {
            countdownVideoBase64 = null;
            countdownVideoDataReady = Promise.resolve(null);
            return;
        }

        const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const lowPowerPreference = isLowPowerDevice();
        countdownVideoCanvas = document.createElement('canvas');
        // Ukuran kanvas video mengikuti rasio yang sama dengan kanvas master polaroid
        // (900x1560), supaya window foto proporsional (PHOTO_X_RATIO dkk) selalu
        // pas dengan area transparan pada frame, tidak peduli device iOS/non-iOS.
        countdownVideoCanvas.width = isIOS ? 480 : lowPowerPreference ? 420 : 640;
        countdownVideoCanvas.height = Math.round(
            countdownVideoCanvas.width * (MASTER_CANVAS_HEIGHT / MASTER_CANVAS_WIDTH)
        );

        const stream = countdownVideoCanvas.captureStream ? countdownVideoCanvas.captureStream(lowPowerPreference ? 12 : isIOS ? 12 : 24) : null;
        if (!stream) {
            countdownVideoBase64 = null;
            countdownVideoDataReady = Promise.resolve(null);
            return;
        }

        const mimeType = getSupportedVideoMimeType();
        countdownVideoRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        countdownVideoChunks = [];
        countdownVideoBase64 = null;
        countdownVideoMimeType = countdownVideoRecorder.mimeType || 'video/mp4';

        countdownVideoDataReady = new Promise((resolve) => {
            countdownVideoRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    countdownVideoChunks.push(event.data);
                }
            };

            countdownVideoRecorder.onstop = () => {
                const blob = new Blob(countdownVideoChunks, { type: countdownVideoMimeType });
                if (!blob.size) {
                    countdownVideoBase64 = null;
                    resolve(null);
                    return;
                }

                const reader = new FileReader();
                reader.onloadend = () => {
                    countdownVideoBase64 = reader.result;
                    resolve(reader.result);
                };
                reader.readAsDataURL(blob);
            };
        });

        const frameAsset = selectedFrame?.frameImage || selectedFrame?.previewImage || fallbackFrames[0].frameImage;
        countdownFrameAsset = new Image();
        countdownFrameAsset.src = frameAsset;

        await new Promise((resolve, reject) => {
            countdownFrameAsset.onload = resolve;
            countdownFrameAsset.onerror = reject;
        });

        countdownVideoRecorder.start(250);
        startCountdownRenderLoop();
        renderCountdownVideoFrame();
    }

    function stopCountdownVideoRecording() {
        return new Promise((resolve) => {
            if (countdownAnimationFrame) {
                cancelAnimationFrame(countdownAnimationFrame);
                countdownAnimationFrame = null;
            }

            if (countdownVideoRecorder && countdownVideoRecorder.state !== 'inactive') {
                const finalize = () => {
                    if (countdownVideoRecordingInterval) {
                        clearInterval(countdownVideoRecordingInterval);
                        countdownVideoRecordingInterval = null;
                    }
                    resolve(countdownVideoDataReady);
                };

                const previousStopHandler = countdownVideoRecorder.onstop;
                countdownVideoRecorder.onstop = () => {
                    if (typeof previousStopHandler === 'function') {
                        previousStopHandler();
                    }
                    finalize();
                };

                countdownVideoRecorder.stop();
                return;
            }

            if (countdownVideoRecordingInterval) {
                clearInterval(countdownVideoRecordingInterval);
                countdownVideoRecordingInterval = null;
            }
            resolve(countdownVideoDataReady);
        });
    }

    btnFoto.onclick = async () => {
        btnFoto.disabled = true;
        btnSwitchCamera.disabled = true;
        btnSwitchCamera.classList.add('opacity-50', 'cursor-not-allowed');
        scrollCameraIntoView();
        let timeLeft = COUNTDOWN_SECONDS;
        countdownDisplay.innerText = timeLeft;
        countdownDisplay.classList.remove('hidden');
        await startCountdownVideoRecording();

        countdownVideoRecordingInterval = setInterval(() => {
            renderCountdownVideoFrame();
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(countdownVideoRecordingInterval);
                countdownVideoRecordingInterval = null;
                countdownDisplay.classList.add('hidden');
                renderCountdownVideoFrame();
                btnSwitchCamera.disabled = false;
                btnSwitchCamera.classList.remove('opacity-50', 'cursor-not-allowed');
                stopCountdownVideoRecording().then(() => {
                    captureSnapshot();
                });
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
        btnSwitchCamera.disabled = false;
        btnSwitchCamera.classList.remove('opacity-50', 'cursor-not-allowed');
        frameWatermark?.classList.remove('hidden');
        updatePhotoActionExtras();
        formData.classList.add('hidden');
        updateFrameProcessing();
    };

    toggleDataForm?.addEventListener('change', () => {
        syncDataFormRequiredState();
        updatePhotoActionExtras();
        if (isDataFormEnabled()) {
            formData.classList.remove('hidden');
            formData.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setRedeemSectionVisible(true);
        } else {
            formData.classList.add('hidden');
            restoreCameraActionControls();
            setRedeemSectionVisible(true);
        }
    });

    btnLanjut.onclick = async () => {
        if (!rawCapturedImage) {
            await showError('Silakan ambil foto terlebih dahulu sebelum melanjutkan.');
            return;
        }

        const guestEmail = guestEmailInput?.value.trim() || document.getElementById('email')?.value.trim();
        if (!guestEmail) {
            await showError('Masukkan email untuk menerima softfile Anda sebelum mengirim.');
            (guestEmailInput || document.getElementById('email'))?.focus();
            return;
        }

        if (document.getElementById('email')) {
            document.getElementById('email').value = guestEmail;
        }

        stopCameraStream();
        processingCamera = false;
        frameWatermark?.classList.remove('hidden');
        formData.classList.remove('hidden');
        formData.scrollIntoView({ behavior: 'smooth', block: 'start' });
        formData.requestSubmit();
    };

    formData.onsubmit = async (e) => {
        e.preventDefault();
        const btnKirim = document.getElementById('btnKirim');
        const email = document.getElementById('email').value.trim();

        if (!rawCapturedImage) {
            await showError('Silakan ambil foto terlebih dahulu sebelum melanjutkan.');
            return;
        }

        if (!email) {
            await showError('Email wajib diisi untuk menerima softfile.');
            document.getElementById('email').focus();
            return;
        }

        const paymentAmount = 0;
        const generatedOrderId = 'GAMON-LDR-' + Date.now();

        btnKirim.innerText = 'Mengirim foto gratis...';
        btnKirim.disabled = true;
        showReturnLoading('Mengirim softfile...', 'Sedang menyusun hasil lead photo dual virtual dan mengirim ke email Anda...');

        try {
            const polaroidCanvas = document.createElement('canvas');
            const ctx = polaroidCanvas.getContext('2d');
            polaroidCanvas.width = MASTER_CANVAS_WIDTH;
            polaroidCanvas.height = MASTER_CANVAS_HEIGHT;

            const img = new Image();
            const frame = new Image();

            await Promise.all([
                new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = rawCapturedImage;
                }),
                new Promise((resolve, reject) => {
                    frame.onload = resolve;
                    frame.onerror = reject;
                    frame.src = 'image/assets/frame-ldr.png';
                })
            ]);

            const splitY = 100;
            const splitH = 450;
            const gap = 40;
            const boxX = 100;
            const boxW = 700;
            const topY = splitY;
            const bottomY = splitY + splitH + gap;

            const drawPhotoToBox = (destY, destH) => {
                const imgRatio = img.width / img.height;
                const boxRatio = boxW / destH;
                let sx = 0;
                let sy = 0;
                let sw = img.width;
                let sh = img.height;

                if (imgRatio > boxRatio) {
                    sh = img.height;
                    sw = sh * boxRatio;
                    sx = (img.width - sw) / 2;
                } else {
                    sw = img.width;
                    sh = sw / boxRatio;
                    sy = (img.height - sh) / 2;
                }

                ctx.drawImage(img, sx, sy, sw, sh, boxX, destY, boxW, destH);
            };

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
            drawPhotoToBox(topY, splitH);
            drawPhotoToBox(bottomY, splitH);
            ctx.drawImage(frame, 0, 0, polaroidCanvas.width, polaroidCanvas.height);

            const polaroidBase64 = polaroidCanvas.toDataURL('image/jpeg', 0.92);
            const payload = {
                nama: '',
                tujuan: '',
                pesan: '',
                email,
                whatsapp: '000000000000',
                alamat: pickupAddress,
                koordinat: '',
                showOnHome: false,
                photoBase64: polaroidBase64,
                audioUrl: null,
                countdownVideoBase64: null,
                countdownVideoMimeType: 'video/mp4',
                orderId: generatedOrderId,
                frameId: 'default-ldr',
                frameName: 'Dual Virtual LDR',
                framePreviewImage: 'image/assets/frame-ldr.png',
                paymentAmount: paymentAmount,
                status: 'PAID',
                paymentStatus: 'PAID',
                redeemCode: null,
                paidAt: Date.now(),
            };

            const response = await fetch('/api/submit-photobox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Gagal mengirim softfile ke email.');
            }

            hideReturnLoading();
            await showSuccess('Berhasil! Foto dual virtual LDR telah dibuat dan dikirim ke email Anda secara gratis.');
            window.location.href = `photobox-success.html?orderId=${generatedOrderId}`;
        } catch (err) {
            hideReturnLoading();
            await showError('Gagal: ' + err.message);
            btnKirim.innerText = 'Kirim Gratis';
            btnKirim.disabled = false;
        }
    };

    // SCROLL TO TOP BUTTON
    const btnScrollTop = document.getElementById('btnScrollTop');
    if (btnScrollTop) {
        const toggleScrollTopVisibility = () => {
            btnScrollTop.classList.toggle('visible', window.scrollY > 320);
        };
        toggleScrollTopVisibility();
        window.addEventListener('scroll', toggleScrollTopVisibility, { passive: true });
        btnScrollTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const originalPageBeforeSubmit = window.onbeforeunload;
    window.onbeforeunload = function () {
        frameWatermark?.classList.add('hidden');
        if (typeof originalPageBeforeSubmit === 'function') {
            return originalPageBeforeSubmit();
        }
    };
