// Налаштування Firebase нового проєкту: Firebase → Project settings → General → Your apps → Web app → SDK setup (Config).
// Скопіюйте сюди значення зі свого проєкту. Поки apiKey = "ВСТАВТЕ", сайт працює в демо-режимі (дані лише в цьому браузері).
export const firebaseConfig = {
  apiKey: "AIzaSyB62MXb3ZgujMD8aG-7fX-bIpXaI_HJwpE",
  authDomain: "spivbesida-ai.firebaseapp.com",
  projectId: "spivbesida-ai",
  storageBucket: "spivbesida-ai.firebasestorage.app",
  messagingSenderId: "748823028206",
  appId: "1:748823028206:web:5aee9d56516b438abaaeff"
};
// Пошта викладача — та сама, що в Firebase → Authentication → Users і у firestore.rules
export const TEACHER_EMAIL = "yurchenko09@gmail.com";
