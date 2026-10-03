import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ',
  authDomain: 'gamon-tawing.firebaseapp.com',
  projectId: 'gamon-tawing',
  storageBucket: 'gamon-tawing.firebasestorage.app',
  messagingSenderId: '370162915989',
  appId: '1:370162915989:web:76779062da83aa0c5c999c',
  measurementId: 'G-DDRQKDZXV7'
};

export const app = initializeApp(firebaseConfig, 'admin');
export const auth = getAuth(app);
export const db = getFirestore(app);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

export function formatRupiah(value) {
  const raw = Number(value || 0);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(raw);
}

export function formatDate(value) {
  if (!value) return '-';
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.readAsDataURL(file);
  });
}

export async function prepareImageForUpload(file) {
  const src = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memproses gambar'));
    img.src = src;
  });

  const maxWidth = 1200;
  const maxHeight = 1200;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  return dataURLToFile(dataUrl, file.name || 'product.jpg');
}

function dataURLToFile(dataUrl, fileName) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mime, lastModified: Date.now() });
}

export function estimateDataUrlBytes(dataUrl = '') {
  const base = dataUrl.split(',')[1] || '';
  return Math.ceil((base.length * 3) / 4);
}

export const adminCollection = collection(db, 'marketplace_products');

export async function fetchMarketplaceProducts() {
  const snapshot = await getDocs(adminCollection);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function requireAdmin() {
  try {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok || !result.success) {
      window.location.href = '/admin/login.html';
      return null;
    }
    return result;
  } catch (error) {
    window.location.href = '/admin/login.html';
    return null;
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    const currentPath = window.location.pathname;
    if (!currentPath.endsWith('/admin/login.html')) {
      window.location.href = '/admin/login.html';
    }
  }
});

export async function updateMarketplaceProductStatus(id, status) {
  await updateDoc(doc(db, 'marketplace_products', id), {
    status,
    updatedAt: Date.now()
  });
}

export async function deleteMarketplaceProduct(id) {
  await deleteDoc(doc(db, 'marketplace_products', id));
}
