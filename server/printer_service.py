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

def cetak_ke_printer_canon(image_bytes):
    try:
        # Konfigurasi nama printer sesuai dengan yang tertera di Windows system Anda
        printer_name = "Canon E470 series"
        
        # Load gambar dari bytes
        img = Image.open(io.BytesIO(image_bytes))
        
        # Inisialisasi proses cetak ke Windows Spooler
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)
        
        hdc.StartDoc("Polaroid Gamon Tawing")
        hdc.StartPage()
        
        # 🔥 PERBAIKAN: Menggunakan ImageWin.Dib untuk menggantikan Win32Raw yang error
        dib = ImageWin.Dib(img)
        
        # Menggambar/mencetak gambar ke printer context
        # Parameter: (handle_output, (posisi_x, posisi_y, lebar_gambar, tinggi_gambar))
        dib.draw(hdc.GetHandleOutput(), (0, 0, img.size[0], img.size[1]))
        
        hdc.EndPage()
        hdc.EndDoc()
        hdc.DeleteDC()
        print("📝 Sukses mengirim dokumen ke antrean Spooler Canon E470!")
    except Exception as e:
        print(f"❌ Gagal mencetak dokumen ke printer: {str(e)}")

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