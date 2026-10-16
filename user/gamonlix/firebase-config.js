// user/gamonlix/firebase-config.js
// Dipakai halaman publik Gamonlix (user/gamonlix/index.html).
// Halaman admin TIDAK memakai file ini; admin memakai /admin/admin-firebase.js.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC247K8yyL67aWV95KNQy8CkMZsjgGCudQ",
  authDomain: "gamon-tawing.firebaseapp.com",
  projectId: "gamon-tawing",
  storageBucket: "gamon-tawing.firebasestorage.app",
  messagingSenderId: "370162915989",
  appId: "1:370162915989:web:76779062da83aa0c5c999c",
  measurementId: "G-DDRQKDZXV7"
};

export const app = getApps().some(a => a.name === "gamonlix")
  ? getApp("gamonlix")
  : initializeApp(firebaseConfig, "gamonlix");
export const db = getFirestore(app);
export const FILMS = "gamonlixFilms";