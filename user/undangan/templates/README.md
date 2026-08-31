# Struktur template undangan

Tujuan: satu invitation bisa punya banyak desain, tapi tetap memakai data yang sama dari Firestore.

## Prinsip

- Setiap template punya `templateId` unik.
- `templateId` disimpan di dokumen undangan.
- Link publik dibuat berdasarkan template yang dipilih.
- Data undangan tetap satu sumber: Firestore.

## Template yang dipakai

1. `classic` — elegan, warm, premium
2. `lavender` — lembut, romantis, feminine
3. `sunset` — hangat, soft, modern
4. `forest` — natural, tenang, outdoor

## Struktur folder

```text
user/
  undangan/
    form.html
    dashboard.html
    preview.html         # fallback sementara
    templates/
      README.md
      classic.html
      lavender.html
      sunset.html
      forest.html
    assets/
      app.js
      style.css
```

## Alur public URL

URL publik yang ideal:

```text
/templates/classic.html?slug=rizki-sinta
/templates/lavender.html?slug=rizki-sinta
/templates/sunset.html?slug=rizki-sinta
/templates/forest.html?slug=rizki-sinta
```

Alternatif singkat:

```text
/preview.html?slug=rizki-sinta&template=classic
```

Untuk project ini, kita bisa mulai dengan pendekatan berikut:
- gunakan `preview.html` sebagai fallback sementara,
- lalu pindah ke route khusus per template di `templates/*.html`.

## Data yang dibagikan ke tiap template

Setiap template menerima data yang sama dari Firestore, contohnya:

- `groomName`
- `brideName`
- `parentGroom`
- `parentBride`
- `akadDate`, `akadTime`, `akadPlace`
- `receptionDate`, `receptionTime`, `receptionPlace`
- `address`
- `mapLink`, `locationLat`, `locationLng`
- `openingPhoto`
- `galleryImages`
- `musicUrl`
- `story`
- `shareSlug`
- `templateId`

## Flow logika

```text
Form -> pilih template -> simpan templateId -> Firestore
URL public -> baca slug -> cari undangan
-> baca templateId -> render template yang sesuai
```

## Penjelasan

Ini memungkinkan satu desain undangan yang berbeda-beda sesuai template, tapi tetap memakai data yang sama.

Saat siap, tiap file template akan dipisah dan hanya menampilkan layout + styling yang relevan.
