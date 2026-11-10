// Сховище: Firebase (робочий режим) або localStorage (демо-режим)
import * as CFG from "./firebase-config.js";
const { firebaseConfig, TEACHER_EMAIL } = CFG;
// Предмет: якщо в firebase-config.js є SUBJECT, налаштування і списки зберігаються окремо (config/settings_<SUBJECT>, keys/roster_<SUBJECT>)
const SETTINGS_DOC = CFG.SUBJECT ? "settings_" + CFG.SUBJECT : "settings";
const ROSTER_DOC = CFG.SUBJECT ? "roster_" + CFG.SUBJECT : "roster";
export const DEMO = !firebaseConfig.apiKey || firebaseConfig.apiKey === "ВСТАВТЕ";
const V = "10.12.2";
let fb = null;
async function F(){
  if (fb) return fb;
  const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const auth = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const a = app.initializeApp(firebaseConfig);
  fb = { auth, fs, A: auth.getAuth(a), D: fs.getFirestore(a) };
  return fb;
}
// ---- демо-сховище
const LS = {
  get(k){ try{ return JSON.parse(localStorage.getItem("demo:"+k)); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem("demo:"+k, JSON.stringify(v)); }catch(e){} },
  keys(p){ const r=[]; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.startsWith("demo:"+p)) r.push(k.slice(5)); } }catch(e){} return r; },
  del(k){ try{ localStorage.removeItem("demo:"+k); }catch(e){} }
};
const DEMO_SETTINGS = { groups:["Група А (демо)","Група Б (демо)"], topics:{}, ai:{} };

export function attemptId(topic, group, name){
  const norm = s => s.toLowerCase().replace(/[’'`ʼ]/g,"").replace(/\s+/g," ").trim().replace(/[^a-zа-яіїєґ0-9 ]/gi,"").replace(/ /g,"_");
  return `${topic}__${norm(group)}__${norm(name)}`;
}
// ---- студент
export async function studentInit(){
  if (DEMO) return "demo-uid";
  const f = await F();
  await f.A.authStateReady();
  if (!f.A.currentUser) await f.auth.signInAnonymously(f.A);
  return f.A.currentUser.uid;
}
export async function getSettings(){
  if (DEMO) return LS.get(SETTINGS_DOC) || DEMO_SETTINGS;
  const f = await F(); const s = await f.fs.getDoc(f.fs.doc(f.D,"config",SETTINGS_DOC));
  return s.exists() ? s.data() : { groups:[], topics:{} };
}
export async function getAttempt(id){
  if (DEMO) return LS.get("att:"+id);
  const f = await F();
  try { const s = await f.fs.getDoc(f.fs.doc(f.D,"attempts",id)); return s.exists() ? s.data() : null; }
  catch(e){ if (String(e.code||e).includes("permission")) return { __locked:true }; throw e; }
}
export async function saveAttempt(id, data){
  data.updatedAt = new Date().toISOString();
  if (DEMO) { LS.set("att:"+id, data); return; }
  const f = await F(); await f.fs.setDoc(f.fs.doc(f.D,"attempts",id), JSON.parse(JSON.stringify(data)));
}
// ---- викладач
export async function teacherCurrent(){
  if (DEMO) return { email:"demo" };
  const f = await F(); await f.A.authStateReady();
  const u = f.A.currentUser;
  return (u && !u.isAnonymous && u.email === TEACHER_EMAIL) ? u : null;
}
// вхід викладача за поштою і паролем; браузер запам'ятовує вхід (повторно входити не треба, доки не натиснете «Вийти»)
export async function teacherSignIn(email, password){
  if (DEMO) return { email:"demo" };
  const f = await F();
  await f.auth.setPersistence(f.A, f.auth.browserLocalPersistence);
  let r;
  try { r = await f.auth.signInWithEmailAndPassword(f.A, email.trim(), password); }
  catch(e){
    const c = String(e.code || "");
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) throw new Error("Неправильна пошта або пароль.");
    if (/too-many-requests/.test(c)) throw new Error("Забагато спроб. Зачекайте кілька хвилин.");
    if (/operation-not-allowed/.test(c)) throw new Error("У Firebase не ввімкнено вхід за паролем (Authentication → Sign-in method → Email/Password).");
    throw e;
  }
  if (r.user.email !== TEACHER_EMAIL) { await f.auth.signOut(f.A); throw new Error("Ця пошта не має прав викладача: "+r.user.email); }
  return r.user;
}
export async function teacherSignOut(){ if (DEMO) return; const f = await F(); await f.auth.signOut(f.A); }
export async function teacherReset(email){ const f = await F(); await f.auth.sendPasswordResetEmail(f.A, email.trim()); }
// токен для запитів до воркера, які дозволені лише викладачу (розпізнавання сканів)
export async function idToken(){ if (DEMO) return "demo"; const f = await F(); return f.A.currentUser ? f.A.currentUser.getIdToken() : ""; }
export async function saveSettings(s){
  if (DEMO) { LS.set(SETTINGS_DOC, s); return; }
  const f = await F(); await f.fs.setDoc(f.fs.doc(f.D,"config",SETTINGS_DOC), s);
}
// ---- матеріали (текст лекцій, розбитий на блоки)
export async function listMaterials(){
  if (DEMO) return LS.keys("mat:").map(k => ({ id: k.slice(4), ...LS.get(k) }));
  const f = await F(); const s = await f.fs.getDocs(f.fs.collection(f.D,"materials"));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function getMaterial(id){
  if (DEMO) return LS.get("mat:"+id);
  const f = await F(); const s = await f.fs.getDoc(f.fs.doc(f.D,"materials",id)); return s.exists() ? s.data() : null;
}
export async function saveMaterial(id, data){
  data.updatedAt = new Date().toISOString();
  if (DEMO) { LS.set("mat:"+id, data); return; }
  const f = await F(); await f.fs.setDoc(f.fs.doc(f.D,"materials",id), JSON.parse(JSON.stringify(data)));
}
export async function deleteMaterial(id){
  if (DEMO) { LS.del("mat:"+id); return; }
  const f = await F(); await f.fs.deleteDoc(f.fs.doc(f.D,"materials",id));
}
export async function listAttempts(topic){
  if (DEMO) return LS.keys("att:"+topic+"__").map(k=>({ id:k.slice(4), ...LS.get(k) }));
  const f = await F();
  const q = f.fs.query(f.fs.collection(f.D,"attempts"), f.fs.where("topic","==",topic));
  const s = await f.fs.getDocs(q); return s.docs.map(d=>({ id:d.id, ...d.data() }));
}
export async function updateAttempt(id, patch){
  if (DEMO) { const a=LS.get("att:"+id)||{}; LS.set("att:"+id,{...a,...patch}); return; }
  const f = await F(); await f.fs.updateDoc(f.fs.doc(f.D,"attempts",id), patch);
}
export async function deleteAttempt(id){
  if (DEMO) { LS.del("att:"+id); return; }
  const f = await F(); await f.fs.deleteDoc(f.fs.doc(f.D,"attempts",id));
}
export async function getKeys(topic){
  if (DEMO) { const k=LS.get("keys:"+topic); return k? { keys:k.keys, gems:k.gems||null } : null; }
  const f = await F(); const s = await f.fs.getDoc(f.fs.doc(f.D,"keys",topic)); if(!s.exists()) return null; const d=JSON.parse(s.data().keys); return Array.isArray(d)? {keys:d, gems:null} : d;
}
export async function saveKeys(topic, k){
  if (DEMO) { LS.set("keys:"+topic, k); return; }
  const f = await F(); await f.fs.setDoc(f.fs.doc(f.D,"keys",topic), { keys: JSON.stringify({ keys:k.keys, gems:k.gems||null }) });
}

// ---- завантаження теми (основний шлях topics/tXX/, запасний — tXX/ у корені репозиторію)
export async function loadTopic(id){
  for (const base of [`topics/${id}/`, `${id}/`]) {
    try { const r = await fetch(base + "topic.json", { cache: "no-cache" }); if (r.ok) { const t = await r.json(); t.__base = base; return t; } } catch(e){}
  }
  throw new Error("Тему не знайдено: " + id);
}

// ---- списки студентів
// Повний список лежить у keys/roster (читає лише викладач). У публічних налаштуваннях — тільки
// rosterH: для кожного студента хеш прізвища і ПІБ, зашифроване ключем із прізвища. Тож список
// не можна прочитати, але, знаючи прізвище, сайт перевіряє ім'я і може підказати правильне написання.
const ENC = new TextEncoder(), DEC = new TextDecoder();
export const normPart = s => String(s||"").toLowerCase().replace(/[’'`ʼ‘´-]/g,"").replace(/ё/g,"е").replace(/\s+/g," ").trim().replace(/[^a-zа-яіїєґ0-9 ]/gi,"");
const normFull = s => normPart(s).split(" ").filter(Boolean).sort().join(" ");
const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function sha(str){ return new Uint8Array(await crypto.subtle.digest("SHA-256", ENC.encode(str))); }
async function surHash(group, sur){ return [...(await sha("zemlia-s|" + normPart(group) + "|" + normPart(sur)))].slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join(""); }
async function surKey(group, sur){ return crypto.subtle.importKey("raw", await sha("zemlia-k|" + normPart(group) + "|" + normPart(sur)), "AES-GCM", false, ["encrypt","decrypt"]); }
export async function rosterEntry(group, name){
  const sur = name.split(" ")[0], iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await surKey(group, sur), ENC.encode(name));
  return { s: await surHash(group, sur), iv: b64(iv), c: b64(c) };
}
export async function buildRosterH(roster){
  const out = {};
  for (const [g, list] of Object.entries(roster || {})) out[g] = await Promise.all(list.map(n => rosterEntry(g, n)));
  return out;
}
export function hasRosterFor(settings, group){ const r = (settings && settings.rosterH || {})[group]; return Array.isArray(r) && r.length > 0; }
// → { status: "ok", name } | { status: "hint", names } | { status: "none" } | { status: "noroster" }
export async function matchName(settings, group, typed){
  if (!hasRosterFor(settings, group)) return { status: "noroster" };
  const list = settings.rosterH[group], w = normPart(typed).split(" ").filter(Boolean);
  const cands = [...new Set([w[0], w[w.length-1], w.length > 2 ? w[0] + w[1] : null].filter(Boolean))];
  const found = [];
  for (const sur of cands) {
    const h = await surHash(group, sur), hits = list.filter(e => e.s === h);
    if (!hits.length) continue;
    const key = await surKey(group, sur);
    for (const e of hits) { try { found.push(DEC.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, key, unb64(e.c)))); } catch(err){} }
  }
  const exact = found.find(n => normFull(n) === normFull(typed));
  if (exact) return { status: "ok", name: exact };
  if (found.length) return { status: "hint", names: [...new Set(found)] };
  return { status: "none" };
}
export const isUkrainian = s => !/[a-z]/i.test(s) && !/[ыэъё]/i.test(s) && /[а-яіїєґ]/i.test(s);
export async function getRoster(){
  if (DEMO) return LS.get(ROSTER_DOC) || {};
  const f = await F(); const d = await f.fs.getDoc(f.fs.doc(f.D,"keys",ROSTER_DOC));
  return d.exists() ? JSON.parse(d.data().data || "{}") : {};
}
export async function saveRoster(roster){
  if (DEMO) { LS.set(ROSTER_DOC, roster); return; }
  const f = await F(); await f.fs.setDoc(f.fs.doc(f.D,"keys",ROSTER_DOC), { data: JSON.stringify(roster) });
}
// поле ПІБ — завжди звичайне текстове (список студентам не показуємо)
export function nameField(){ return `<input type="text" id="nm" placeholder="Прізвище та ім'я, напр. Коваленко Олена" autocomplete="name">`; }
