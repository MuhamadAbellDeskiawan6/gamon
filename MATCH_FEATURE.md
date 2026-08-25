# Mutual Match Feature

## Skema Firestore yang dipakai

Project ini tetap murni client-side. Tidak ada file baru di folder `/api`. Semua logic berjalan dari browser langsung ke Firebase Web SDK.

Dokumen utama yang dipakai:

- `gamon` — curhat yang sudah ada sebelumnya.
- `matchRequests` — request pencocokan identitas untuk mutual match.
  - `selfIdentityHash`: hash SHA-256 dari kontak diri sendiri setelah normalisasi.
  - `exIdentityHash`: hash SHA-256 dari kontak mantan setelah normalisasi.
  - `curhatId`: referensi ke dokumen curhat asal.
  - `status`: `pending` -> `matched` -> `confirmed`.
  - `createdAt`: timestamp.
  - `matchId`: id dokumen `matches` saat sudah cocok.
- `matches` — dokumen hasil mutual match yang siap dikonfirmasi.
  - `requestIds`: array `[requestIdA, requestIdB]`.
  - `curhatIds`: array `[curhatIdA, curhatIdB]`.
  - `status`: `pending_confirmation` saat menunggu keduanya mengonfirmasi, lalu `confirmed` setelah keduanya setuju.
  - `confirmedBy`: objek map seperti `{ [requestIdA]: true, [requestIdB]: false }`.
- `matchContacts` — kontak milik masing-masing pihak yang baru dibuka setelah match terkonfirmasi.
  - `requestId`: request dari pemilik kontak tersebut.
  - `matchId`: id dokumen `matches`.
  - `ownerIdentityHash`: hash dari identitas pemilik kontak, untuk pengecekan keterkaitan.
  - `contactText`: teks kontak asli yang nanti dapat dibuka bila match sudah confirmed.

## Firestore Security Rules

Proyek Firebase biasanya menaruh file `firestore.rules` di root project, di samping file `firebase.json` saat deploy via Firebase CLI. File ini dibuat di repo root untuk di-deploy ke Firebase:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /gamon/{docId} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if false;
    }

    match /matchRequests/{requestId} {
      allow create: if true;
      allow read: if true;
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'matchId', 'matchedWithRequestId', 'updatedAt', 'confirmedBy']) && (
        request.resource.data.status == 'matched' ||
        request.resource.data.status == 'confirmed' ||
        request.resource.data.status == 'pending'
      );
    }

    match /matches/{matchId} {
      allow create: if true;
      allow read: if true;
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'confirmedBy', 'updatedAt']) &&
        request.resource.data.confirmedBy is map &&
        request.resource.data.status in ['pending_confirmation', 'confirmed'];
    }

    match /matchContacts/{contactId} {
      allow create: if true;
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['matchId', 'updatedAt']) && resource.data.matchId == null;
      allow read: if resource.data.matchId != null &&
        exists(/databases/$(database)/documents/matches/$(resource.data.matchId)) &&
        get(/databases/$(database)/documents/matches/$(resource.data.matchId)).data.status == 'confirmed' &&
        (
          get(/databases/$(database)/documents/matches/$(resource.data.matchId)).data.requestIds[0] == resource.data.requestId ||
          get(/databases/$(database)/documents/matches/$(resource.data.matchId)).data.requestIds[1] == resource.data.requestId
        );
    }
  }
}
```

## Catatan keamanan

Ini adalah pendekatan best-effort untuk demo/prototype. Semua logic run di browser, identitas di-normalisasi lalu di-hash dengan SHA-256, tapi hash dibuat dari data yang bisa dilihat oleh siapa pun. Karena tidak ada auth server-side yang valid dan tidak ada secret key yang benar-benar rahasia, pendekatan ini BUKAN solusi production-grade untuk data sensitif. Tujuannya adalah mencegah akses iseng dan menyederhanakan prototype mutual match, bukan melindungi data sensitif dari serangan terarah.

## Konfirmasi tentang API

Tidak ada file baru ditambahkan ke folder `/api`. Fitur mutual match diimplementasikan sepenuhnya dari browser ke Firebase Web SDK seperti pola submit curhat yang sudah ada di halaman submit.
