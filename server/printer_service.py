import os
import time
import base64
import io
import win32print
import win32ui
import win32con
from PIL import Image, ImageWin
import firebase_admin
from firebase_admin import credentials, firestore

# 1. Inisialisasi Firebase Admin di Python menggunakan kredensial JSON Anda
if not firebase_admin._apps:
    # Membaca file JSON secara dinamis di dalam folder yang sama dengan script
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Menghubungkan langsung ke file serviceAccountKey.json di folder yang sama
    json_path = os.path.join(current_dir, 'serviceAccountKey.json')
    
    cred = credentials.Certificate(json_path)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# Ukuran area foto dalam casing, bukan ukuran luar casing.
TARGET_WIDTH_CM = 2.7
TARGET_HEIGHT_CM = 4.6

# Isi 0.0 untuk ukuran foto nominal. Nilai positif memperbesar area cetak
# secara simetris; jangan melebihi sekitar 0.15 cm agar tetap di dalam casing.
BLEED_CM = 0.0


def cetak_ke_printer_canon(image_bytes):
    hdc = None
    try:
        # Konfigurasi nama printer sesuai dengan yang tertera di Windows system Anda
        printer_name = "Canon E470 series"
        
        # Load gambar dari bytes
        img = Image.open(io.BytesIO(image_bytes))
        
        # Inisialisasi proses cetak ke Windows Spooler
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)

        # Gunakan DPI aktual dari printer agar ukuran fisik tidak bergantung
        # pada asumsi DPI tertentu.
        dpi_x = hdc.GetDeviceCaps(win32con.LOGPIXELSX)
        dpi_y = hdc.GetDeviceCaps(win32con.LOGPIXELSY)
        target_width_cm = TARGET_WIDTH_CM + (BLEED_CM * 2)
        target_height_cm = TARGET_HEIGHT_CM + (BLEED_CM * 2)
        target_width_px = max(1, round(target_width_cm / 2.54 * dpi_x))
        target_height_px = max(1, round(target_height_cm / 2.54 * dpi_y))

        print(
            f"🖨️ Source: {img.size[0]}x{img.size[1]} px | "
            f"Target: {target_width_cm:.2f}x{target_height_cm:.2f} cm | "
            f"DPI: {dpi_x}x{dpi_y} | "
            f"Target px: {target_width_px}x{target_height_px}"
        )

        # Mode cover: pertahankan rasio, crop bagian berlebih dari tengah,
        # lalu resize tepat ke ukuran device units target.
        source_ratio = img.width / img.height
        target_ratio = target_width_px / target_height_px
        if source_ratio > target_ratio:
            crop_width = round(img.height * target_ratio)
            left = (img.width - crop_width) // 2
            img = img.crop((left, 0, left + crop_width, img.height))
        else:
            crop_height = round(img.width / target_ratio)
            top = (img.height - crop_height) // 2
            img = img.crop((0, top, img.width, top + crop_height))

        img = img.resize((target_width_px, target_height_px), Image.Resampling.LANCZOS)

        # Pusatkan pada halaman fisik. PHYSICAL* tersedia pada printer DC;
        # fallback ke area printable jika driver tidak menyediakannya.
        page_width_px = hdc.GetDeviceCaps(win32con.PHYSICALWIDTH)
        page_height_px = hdc.GetDeviceCaps(win32con.PHYSICALHEIGHT)
        offset_x_px = hdc.GetDeviceCaps(win32con.PHYSICALOFFSETX)
        offset_y_px = hdc.GetDeviceCaps(win32con.PHYSICALOFFSETY)
        printable_width_px = hdc.GetDeviceCaps(win32con.HORZRES)
        printable_height_px = hdc.GetDeviceCaps(win32con.VERTRES)

        if page_width_px <= 0 or page_height_px <= 0:
            page_width_px = printable_width_px
            page_height_px = printable_height_px
            offset_x_px = 0
            offset_y_px = 0

        # Koordinat DC printer dimulai dari area printable, sehingga offset
        # fisik dikurangkan dari posisi tengah halaman.
        draw_x = (page_width_px - target_width_px) // 2 - offset_x_px
        draw_y = (page_height_px - target_height_px) // 2 - offset_y_px
        
        hdc.StartDoc("Polaroid Gamon Tawing")
        hdc.StartPage()
        
        dib = ImageWin.Dib(img)
        
        # Ukuran tuple ini adalah device units printer, bukan pixel sumber.
        dib.draw(
            hdc.GetHandleOutput(),
            (draw_x, draw_y, draw_x + target_width_px, draw_y + target_height_px),
        )
        
        hdc.EndPage()
        hdc.EndDoc()
        print("📝 Sukses mengirim dokumen ke antrean Spooler Canon E470!")
    except Exception as e:
        print(f"❌ Gagal mencetak dokumen ke printer: {str(e)}")
    finally:
        if hdc is not None:
            hdc.DeleteDC()

def monitor_antrean_cetak():
    print("🚀 Gamon Tawing Printer Service berjalan... Menunggu pesanan photobox masuk.")
    
    # Melakukan query real-time listen ke Firestore collection 'photobox_order'
    order_ref = db.collection('photobox_order').where('isPrinted', '==', False)
    
    # Callback function saat ada mutasi data baru di firestore
    def on_snapshot(col_snapshot, changes, read_time):
        for change in changes:
            if change.type.name == 'ADDED':
                doc = change.document
                data = doc.to_dict()
                print(f"📸 Menemukan Foto Baru siap cetak! ID Order: {data.get('orderId')}")
                
                # Ekstrak string base64 kembali menjadi bytes gambar
                photo_base64 = data.get('photoBase64')
                if photo_base64 and "base64," in photo_base64:
                    header, base64_data = photo_base64.split("base64,")
                    img_bytes = base64.b64decode(base64_data)
                    
                    # Eksekusi cetak silent fisik
                    cetak_ke_printer_canon(img_bytes)
                    
                    # Update status di Firestore menjadi True agar tidak tercetak berulang
                    db.collection('photobox_order').document(doc.id).update({
                        'isPrinted': True
                    })
                    print(f"✅ Status cetak fisik untuk Order {data.get('orderId')} telah diupdate ke Server.")

    # Daftarkan watcher listener
    order_ref.on_snapshot(on_snapshot)
    
    # Jaga agar background process tetap hidup
    while True:
        time.sleep(1)

if __name__ == "__main__":
    monitor_antrean_cetak()