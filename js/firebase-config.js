// Налаштування Firebase нового проєкту: Firebase → Project settings → General → Your apps → Web app → SDK setup (Config).
// Скопіюйте сюди значення зі свого проєкту. Поки apiKey = "ВСТАВТЕ", сайт працює в демо-режимі (дані лише в цьому браузері).
export const firebaseConfig = {
  apiKey: "ВСТАВТЕ",
  authDomain: "ВСТАВТЕ.firebaseapp.com",
  projectId: "ВСТАВТЕ",
  storageBucket: "ВСТАВТЕ.appspot.com",
  messagingSenderId: "ВСТАВТЕ",
  appId: "ВСТАВТЕ"
};
// Пошта викладача — та сама, що в Firebase → Authentication → Users і у firestore.rules
export const TEACHER_EMAIL = "yurchenko09@gmail.com";
