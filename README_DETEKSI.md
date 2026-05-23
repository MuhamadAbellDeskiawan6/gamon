# 🤚 Sistem Deteksi Angka Tangan - GAMON TAWING

## Status: ✅ SIAP DIGUNAKAN

Fitur deteksi angka tangan telah berhasil diperbaiki dan siap untuk digunakan!

## 📋 Komponen Sistem

### 1. **Frontend (reaksi.html)**
- ✅ UI modern dengan Tailwind CSS
- ✅ Live video capture dari kamera
- ✅ Real-time display angka tangan dengan emoji
- ✅ Tombol Start/Stop untuk kontrol deteksi
- ✅ Status monitor dan informasi tangan

### 2. **Backend (server/main.py)**
- ✅ FastAPI server pada port 8000
- ✅ Endpoint `/deteksi-angka` untuk deteksi real-time
- ✅ Dual detection method:
  - MediaPipe (jika tersedia)
  - Fallback: Skin color detection menggunakan OpenCV
- ✅ Error handling yang robust

### 3. **HTTP Server (untuk development)**
- ✅ Simple HTTP server pada port 8080
- ✅ Melayani file static (HTML, CSS, JS)

## 🚀 Cara Menggunakan

### **Langkah 1: Pastikan semua terminal terbuka**

**Terminal 1 - FastAPI Server (Port 8000):**
```powershell
cd c:\laragon\www\gamon\server
python main.py
```

**Terminal 2 - HTTP Server (Port 8080):**
```powershell
cd c:\laragon\www\gamon
python -m http.server 8080
```

### **Langkah 2: Buka di Browser**
```
http://127.0.0.1:8080/reaksi.html
```

### **Langkah 3: Gunakan Aplikasi**
1. Berikan izin akses kamera saat browser meminta
2. Klik tombol **"Mulai Deteksi"** (akan berubah menjadi "⏸ Hentikan")
3. Tunjukkan jari Anda ke kamera
4. Sistem akan:
   - Mendeteksi jumlah tangan
   - Menghitung jumlah jari terbuka per tangan
   - Menampilkan emoji yang sesuai (✊ ☝️ ✌️ 🤟 🖐️ ✋)
   - Update status real-time

## 🎯 Emoji yang Ditampilkan

| Jari | Emoji | Arti |
|------|-------|------|
| 0 | ✊ | Kepalan Tangan |
| 1 | ☝️ | Satu Jari |
| 2 | ✌️ | Dua Jari (Peace) |
| 3 | 🤟 | Tiga Jari (Horns) |
| 4 | 🖐️ | Empat Jari |
| 5 | ✋ | Lima Jari (Open Hand) |

## 📊 API Endpoints

### POST `/deteksi-angka`
**Request:**
```json
{
  "image": "data:image/jpeg;base64,...image_data..."
}
```

**Response:**
```json
{
  "hands": [
    {
      "fingers": 5,
      "emoji": "✋"
    },
    {
      "fingers": 2,
      "emoji": "✌️"
    }
  ],
  "status": "success",
  "message": "Detected 2 hand(s)",
  "method": "mediapipe"
}
```

## 🔧 Troubleshooting

### **Masalah: "Kamera tidak tersedia"**
- ✅ Periksa apakah browser sudah memberi izin akses kamera
- ✅ Coba refresh halaman
- ✅ Gunakan HTTPS atau localhost untuk akses kamera

### **Masalah: "Gagal koneksi"**
- ✅ Pastikan FastAPI server berjalan di port 8000
- ✅ Cek di terminal: harus menampilkan "Application startup complete"

### **Masalah: Port sudah dipakai**
```powershell
# Cari process yang menggunakan port
netstat -ano | findstr :8000

# Kill process (ganti XXXX dengan PID)
taskkill /PID XXXX /F
```

## 📂 File Structure

```
c:\laragon\www\gamon\
├── reaksi.html              # Frontend (deteksi angka tangan)
├── ai.html                  # (existing)
├── index.html               # (existing)
└── server\
    ├── main.py              # FastAPI backend
    └── http_server.py       # HTTP server helper
```

## ✨ Fitur Tambahan

- **Real-time Performance**: ~3 frame per detik
- **Multi-hand Detection**: Bisa mendeteksi 2 tangan sekaligus
- **Fallback Detection**: Jika MediaPipe tidak tersedia, gunakan skin detection
- **Responsive UI**: Bekerja di desktop dan mobile (dengan akses kamera)

## 🎓 Penjelasan Teknis

### Cara Menghitung Jari Terbuka:

1. **MediaPipe** menggunakan 21 landmarks per tangan
2. **Untuk setiap jari**, kami bandingkan:
   - Posisi ujung jari (tip) vs knuckle (pip)
   - Jari terbuka = tip lebih tinggi (Y lebih kecil) dari pip
3. **Hasil**: Jumlah jari yang terbuka (0-5)

### Format Data Image:
- Resolusi: 480x360 pixel
- Format: JPEG dengan kompresi 0.6
- Encoding: Base64 via data URI
- Rate limit: 333ms antar request (~3 fps)

## 📝 Catatan

- Server menggunakan **error handling yang robust**
- Jika MediaPipe tidak tersedia, fallback ke **skin color detection**
- CORS sudah dikonfigurasi untuk semua origin
- Response rate dibatasi untuk mencegah overload

---

**Dibuat untuk:** Gamon Tawing - Hand Detection System  
**Status:** ✅ Produksi Ready  
**Last Updated:** 2026-05-23
