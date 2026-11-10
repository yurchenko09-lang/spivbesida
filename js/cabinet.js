import * as st from "./store.js";
import * as AICFG from "./ai-config.js";
import { renderMaterials } from "./materials.js";
import { renderGroups } from "./groups.js";
const { WORKER_URL, AI_SUBJECT, EXAM_BANK } = AICFG;
const TASK_TOPICS = AICFG.TASK_TOPICS || null;   // теми, у яких є практичні задачі

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const fmt = s => { s = Math.round(s||0); return Math.floor(s/60) + " хв " + String(s%60).padStart(2,"0") + " с"; };
const DEFAULT_CRITERIA = [
  { name: "Знання матеріалу", desc: "повнота і точність фактів, понять, термінів з лекції", max: 4 },
  { name: "Розуміння зв'язків", desc: "пояснює причини і наслідки, а не лише називає", max: 3 },
  { name: "Застосування", desc: "наводить власні приклади, переносить знання на нову ситуацію", max: 3 },
  { name: "Самостійність", desc: "відповідає своїми словами, аргументує, справляється з уточнювальними питаннями", max: 2 }
];
let COURSE, SETTINGS, MATS = [], TAB = "setup", ROWS = [], SEL = { topic: "", group: "", id: "" }, VER = {}, OVL = {};

let warnT = null;
function warn(m){ const a=$("alert"); a.innerHTML=m; a.classList.add("show"); clearTimeout(warnT); warnT = setTimeout(()=>a.classList.remove("show"), 8000); }
// повідомлення в картці співбесіди, біля кнопки «Зберегти» (видно, навіть коли сторінку прокручено вниз)
function boxMsg(id, m, bad = true){ const els = document.querySelectorAll(`.tp[data-t="${id}"] .boxmsg`); if (!els.length) { warn(m); return; } els.forEach(el => { el.className = "boxmsg " + (bad ? "bad" : "ok"); el.textContent = m; }); }
const allTopics = () => COURSE.sections.flatMap(s => s.topics);
const readyTopics = () => allTopics().filter(t => t.ready);
const link = id => new URL(`interview.html?i=${id}`, location.href).href;
const workerReady = () => !/ВСТАВТЕ/.test(WORKER_URL);

async function start(){
  if (st.DEMO) $("demo").innerHTML = '<span class="demo">Демо-режим: Firebase ще не підключено</span>';
  let u = null;
  try { u = await st.teacherCurrent(); } catch(e){ warn(esc(e.message||e)); }
  if (!u){
    $("app").innerHTML = `<div class="card" style="max-width:420px"><h3 style="margin-top:0">Вхід викладача</h3>
      <label>Пошта</label><input type="email" id="lEmail" autocomplete="username">
      <label>Пароль</label><input type="password" id="lPass" autocomplete="current-password">
      <div class="row" style="margin-top:12px"><button class="sm sec" id="lReset" type="button">Забули пароль?</button><span class="sp"></span><button id="lGo">Увійти</button></div>
      <p class="hint" style="margin-bottom:0">Браузер запам'ятає вхід — наступного разу входити не доведеться, доки не натиснете «Вийти».</p></div>`;
    await new Promise(res => {
      const go = async () => { try { u = await st.teacherSignIn($("lEmail").value, $("lPass").value); res(); } catch(e){ warn(esc(e.message||e)); } };
      $("lGo").onclick = go; $("lPass").onkeydown = e => { if (e.key === "Enter") go(); };
      $("lReset").onclick = async () => { const em = $("lEmail").value.trim(); if (!em) { warn("Введіть пошту, і ми надішлемо лист для зміни пароля."); return; }
        try { await st.teacherReset(em); warn("Лист для зміни пароля надіслано на " + esc(em) + "."); } catch(e){ warn(esc(e.message||e)); } };
    });
  }
  $("who").innerHTML = `${esc(u.email)} · <a href="#" id="logout">Вийти</a>`;
  $("logout").onclick = async ev => { ev.preventDefault(); await st.teacherSignOut(); location.reload(); };
  SETTINGS = await st.getSettings(); SETTINGS.groups ||= []; SETTINGS.topics ||= {}; SETTINGS.ai ||= {}; snap();
  try { ROSTER = await st.getRoster(); } catch(e){ ROSTER = {}; }
  await loadMats();
  TAB = MATS.length ? "setup" : "mat";
  render();
}
// матеріали → «теми» для вибору у співбесідах, згруповані за предметами
async function loadMats(){
  MATS = await st.listMaterials();
  const courses = [...new Set(MATS.map(m => m.course || ""))].sort((a, b) => a.localeCompare(b, "uk"));
  COURSE = { sections: courses.map(c => ({ title: c || "Без предмета", topics: MATS.filter(m => (m.course || "") === c)
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "uk", { numeric: true }))
    .map((m, i) => ({ id: m.id, num: i + 1, title: m.title, course: m.course || "", ready: true })) })) };
}
function tabs(){ return `<div class="tabs">${[["mat","Матеріали"],["groups","Групи і списки"],["setup","Співбесіди"],["results","Результати"]].map(([k,l])=>`<button class="${TAB===k?'on':''}" data-act="tab" data-v="${k}">${l}</button>`).join("")}</div>`; }
const ctx = () => ({ app: $("app"), mats: MATS, settings: SETTINGS, roster: ROSTER, warn, tabs, reload: async () => { await loadMats(); render(); } });
function render(){
  if (TAB === "mat") return renderMaterials(ctx());
  if (TAB === "groups") return renderGroups(ctx());
  TAB === "setup" ? renderSetup() : renderResults();
}

// ---------- налаштування
function critRows(list){
  return list.map(c => `<tr><td><input type="text" class="crn" value="${esc(c.name)}"></td><td><input type="text" class="cd" value="${esc(c.desc||"")}"></td>
    <td><input type="text" class="cm num" value="${esc(c.max)}" inputmode="numeric"></td><td><button class="sm sec" data-act="delCrit">✕</button></td></tr>`).join("");
}
const MAX_TOPICS = 6;
// ---------- стан співбесід: що збережено, що змінено, що ще не зроблено
let SAVED = {}, ATT = {};
const snap = () => { SAVED = JSON.parse(JSON.stringify(SETTINGS.ai || {})); };
function formOf(box){
  return {
    title: box.querySelector(".ti").value.trim(),
    topics: [...box.querySelectorAll(".tc:checked")].map(i => i.value),
    open: box.querySelector(".op").checked,
    nq: parseInt(box.querySelector(".nq").value, 10), minutes: parseInt(box.querySelector(".mn").value, 10),
    showScore: box.querySelector(".ss").checked, adaptive: box.querySelector(".ad").checked, annul: box.querySelector(".an").checked,
    mode: box.querySelector(".md").value, kinds: [...box.querySelectorAll(".kd:checked")].map(i => i.value),
    groups: [...box.querySelectorAll(".gr:checked")].map(i => i.value),
    criteria: [...box.querySelectorAll(".crit tbody tr")].map(tr => ({ name: tr.querySelector(".crn").value.trim(), desc: tr.querySelector(".cd").value.trim(), max: parseInt(tr.querySelector(".cm").value, 10) })).filter(c => c.name)
  };
}
const cmpKeys = ["title","topics","open","nq","minutes","showScore","adaptive","annul","mode","kinds","groups","criteria"];
const norm = o => o ? { title: o.title || "", topics: o.topics || [], open: !!o.open, nq: o.nq || 6, minutes: o.minutes ?? 20, showScore: !!o.showScore, adaptive: o.adaptive !== false, annul: o.annul !== false, mode: o.mode === "train" ? "train" : "exam", kinds: o.mode === "train" && EXAM_BANK ? (o.kinds && o.kinds.length ? o.kinds : ["task"]) : [], groups: o.groups || [],
  criteria: (o.criteria && o.criteria.length ? o.criteria : DEFAULT_CRITERIA).map(c => ({ name: c.name, desc: c.desc || "", max: Number(c.max) })) } : null;
const pick = o => { const n = norm(o); return JSON.stringify(cmpKeys.map(k => n ? n[k] : null)); };
// стан збереженої співбесіди (для огляду і плашки)
function stateOf(id){
  const s = SAVED[id];
  if (!s || s.unsaved) return { key: "new", label: "Не збережено", cls: "st-warn" };
  const miss = [];
  if (!s.title) miss.push("назва"); if (!(s.topics||[]).length) miss.push("теми"); if (!(s.groups||[]).length) miss.push("групи");
  if (s.open && !miss.length && workerReady()) return { key: "open", label: "Відкрита — студенти можуть заходити", cls: "st-ok" };
  if (s.open) return { key: "broken", label: "Відкрита, але не працює: " + (miss.length ? "бракує — " + miss.join(", ") : "немає адреси воркера"), cls: "st-bad" };
  return { key: "closed", label: "Закрита — студенти не можуть зайти", cls: "st-off" };
}
function paintStatus(id){
  const box = document.querySelector(`.tp[data-t="${id}"]`); if (!box) return;
  const f = formOf(box), s = SAVED[id], saved = s && !s.unsaved, dirty = saved && pick(f) !== pick(s);
  const st0 = stateOf(id);
  const head = !saved ? { label: "Не збережено — студенти поки не можуть зайти", cls: "st-warn" }
    : dirty ? { label: "Є незбережені зміни — натисніть «Зберегти». Зараз діє: " + st0.label.toLowerCase(), cls: "st-warn" } : st0;
  const it = (ok, text, warnOnly) => `<li class="${ok ? "ok" : warnOnly ? "wn" : "no"}">${ok ? "✓" : warnOnly ? "!" : "✗"} ${text}</li>`;
  const tl = f.topics.length, a = ATT[id], train = f.mode === "train";
  box.querySelectorAll(".examonly").forEach(el => el.style.display = train ? "none" : "");
  box.querySelectorAll(".trainonly").forEach(el => el.style.display = train ? "" : "none");
  const list = [
    train ? it(true, "Тип: підготовка до екзамену (без оцінки)") : "",
    train && EXAM_BANK ? it(f.kinds.length > 0, f.kinds.length ? "Завдання: " + f.kinds.map(k => ({ test: "тести", match: "відповідність", task: "задачі" }[k])).join(", ") : "Оберіть види завдань") : "",
    it(!!f.title, f.title ? "Назва вказана" : "Вкажіть назву"),
    it(tl > 0, tl ? `Теми: ${tl}` : "Оберіть хоча б одну тему"),
    it(f.groups.length > 0, f.groups.length ? `Групи: ${f.groups.map(esc).join(", ")}` : "Відмітьте групи"),
    train && TASK_TOPICS && f.kinds.length === 1 && f.kinds[0] === "task" ? it(f.topics.some(t => TASK_TOPICS.includes(t)), f.topics.some(t => TASK_TOPICS.includes(t)) ? `Тем із задачами: ${f.topics.filter(t => TASK_TOPICS.includes(t)).length}` : "У вибраних темах немає задач — оберіть теми з позначкою «задачі»") : "",
    train ? it(f.nq >= 3 && f.nq <= 30, `Завдань за одне тренування: ${f.nq}`) :
    tl ? it(f.nq >= tl, f.nq >= tl ? `Питань: ${f.nq} (≈${Math.max(1, Math.floor(f.nq / tl))} на тему)` : `Питань (${f.nq}) менше, ніж тем (${tl}) — частина тем без питань`, true) : "",
    it(f.open, f.open ? "Відмічено «Відкрита»" : "Не відмічено «Відкрита» — студенти побачать «закрита»"),
    it(saved && !dirty, saved && !dirty ? "Збережено" : "Не збережено — натисніть «Зберегти»"),
    workerReady() ? "" : it(false, "Не вказано адресу воркера в js/ai-config.js")
  ].join("");
  box.querySelector(".ivstat").innerHTML = `<div class="stbar ${head.cls}">${esc(head.label)}</div>
    <ul class="chkl">${list}</ul>
    ${saved ? `<div class="hint">Результати: ${a ? `<b>${a.done}</b> завершили · <b>${a.prog}</b> в процесі` : "…"}</div>` : ""}`;
  box.className = "tp " + head.cls;
}
async function loadCounts(){
  await Promise.all(interviews().filter(([id]) => SAVED[id] && !SAVED[id].unsaved).map(async ([id]) => {
    try { const rows = await st.listAttempts("ai-" + id); ATT[id] = { done: rows.filter(r => r.done).length, prog: rows.filter(r => !r.done).length }; }
    catch(e){ ATT[id] = null; }
  }));
  if (TAB === "setup") { interviews().forEach(([id]) => { paintStatus(id); applyLock(id); }); paintOverview(); }
}
function paintOverview(){
  const el = $("overview"); if (!el) return;
  const list = interviews();
  el.innerHTML = list.length ? `<table class="rep"><tr><th>Співбесіда</th><th>Стан</th><th>Групи</th><th>Результати</th></tr>${list.map(([id, c]) => {
    const s = SAVED[id] || c, st0 = stateOf(id), a = ATT[id];
    return `<tr class="clk" data-act="goto" data-v="${id}"><td><b>${esc(s.title || "без назви")}</b><br><span class="hint">${s.mode === "train" ? `підготовка · ${(s.topics||[]).length} тем · ${s.nq||10} завдань` : `${(s.topics||[]).length} тем · ${s.nq||"?"} питань`}</span></td>
      <td><span class="pill ${st0.cls}">${esc(st0.label)}</span></td><td>${(s.groups||[]).map(esc).join(", ") || '<span class="bad">не вибрано</span>'}</td>
      <td>${a ? `${a.done} завершили${a.prog ? ` · ${a.prog} в процесі` : ""}` : (st0.key === "new" ? "—" : "…")}</td></tr>`; }).join("")}</table>` : "";
}
const interviews = () => Object.entries(SETTINGS.ai).filter(([id,c]) => c && Array.isArray(c.topics)).sort((x,y) => (y[1].created||0) - (x[1].created||0));
const tTitle = id => { const t = allTopics().find(x => x.id === id); return t ? `${t.num}. ${t.title}` : id; };
function renderSetup(){
  const G = SETTINGS.groups, list = interviews();
  $("app").innerHTML = tabs() +
    (workerReady() ? "" : `<div class="info">Ще не вказано адресу воркера у файлі <code>js/ai-config.js</code> — співбесіди не працюватимуть, доки ви її не вставите.</div>`) +
    `<div class="card"><div class="row"><h3 style="margin:0">Співбесіди</h3><span class="sp"></span><button data-act="new">+ Нова співбесіда</button></div>
    <p class="hint">Співбесіда може охоплювати один або кілька матеріалів (до ${MAX_TOPICS}). ШІ розподілить питання між ними. Матеріали — у вкладці «Матеріали», групи і списки — у «Групи і списки».</p>
    ${MATS.length ? "" : `<div class="info">Спершу завантажте матеріал у вкладці «Матеріали» — питання ШІ ставить лише за ним.</div>`}
    ${list.length ? '<div id="overview"></div>' : '<p class="hint">Ще немає жодної співбесіди. Натисніть «+ Нова співбесіда».</p>'}
    ${list.map(([id, c]) => {
      const crit = c.criteria && c.criteria.length ? c.criteria : DEFAULT_CRITERIA;
      const sum = crit.reduce((s,x)=>s+Number(x.max||0),0);
      const sv = SAVED[id] && !SAVED[id].unsaved;
      return `<div class="tp" data-t="${id}">
        <div class="row" style="margin-bottom:6px"><h3 style="margin:0">${esc(c.title || "Нова співбесіда")}</h3><span class="sp"></span>
          ${sv ? `<button class="sm ${c.open ? "sec" : ""}" data-act="toggleOpen" data-v="${id}">${c.open ? "Закрити співбесіду" : "Відкрити співбесіду"}</button>
          <button class="sm sec" data-act="dup" data-v="${id}" title="Нова співбесіда з тими самими налаштуваннями">Копія</button>` : ""}</div>
        <div class="ivstat"></div>
        <div class="row">${c.unsaved ? '<span class="hint">Посилання з\'явиться після збереження</span>' : `<code>${esc(link(id))}</code><button class="sm sec" data-act="copy" data-v="${esc(link(id))}">Копіювати</button>`}<span class="sp"></span><span class="boxmsg"></span></div>
        <details class="ivform" data-f="${id}" ${!sv || EDIT.has(id) ? "open" : ""}><summary>Налаштування співбесіди</summary>
        <div class="lockmsg"></div>
        <label>Тип</label><select class="md" style="width:auto"><option value="exam" ${c.mode !== "train" ? "selected" : ""}>Співбесіда — оцінювання знань</option><option value="train" ${c.mode === "train" ? "selected" : ""}>Підготовка до екзамену — пояснення і підказки, без оцінки</option></select>
        <div class="trainonly hint" style="margin-top:4px">ШІ дає завдання${EXAM_BANK ? " з банку екзаменаційних тестів і задач" : " за лекціями обраних тем"}, підказує, підводить до правильної відповіді і пояснює її. Студент може тренуватися скільки завгодно разів, щоразу з новими завданнями.</div>
        ${EXAM_BANK ? `<div class="trainonly"><span class="hint">Завдання: </span>${[["test","тести (одна відповідь)"],["match","на відповідність"],["task","задачі"]].map(([k,l]) => `<label class="chk"><input type="checkbox" class="kd" value="${k}" ${(c.kinds && c.kinds.length ? c.kinds.includes(k) : k === "task") ? "checked" : ""}> ${l}</label>`).join("")}</div>` : ""}
        <label>Назва</label><input type="text" class="ti" value="${esc(c.title||"")}" placeholder="Напр., Контрольна: Клітина (теми 1–3)">
        <label>Матеріали (теми)</label>
        <div>${COURSE.sections.map(sec => { const ts = sec.topics.filter(t => t.ready); return ts.length ? `<div class="hint" style="margin-top:6px">${esc(sec.title)}</div>${ts.map(t =>
          `<label class="chk"><input type="checkbox" class="tc" value="${t.id}" ${c.topics.includes(t.id)?'checked':''}> ${t.num}. ${esc(t.title.length > 70 ? t.title.slice(0,70) + "…" : t.title)}${TASK_TOPICS && TASK_TOPICS.includes(t.id) ? ' <span class="pill st-ok trainonly">задачі</span>' : ""}</label>`).join("")}` : ""; }).join("")}</div>
        <div class="row" style="margin-top:10px">
          <label class="chk"><input type="checkbox" class="op" ${c.open?'checked':''}> Відкрита</label>
          <span class="hint"><span class="examonly">Питань:</span><span class="trainonly">Завдань:</span></span><input type="text" class="nq num" value="${esc(c.nq || (c.mode === "train" ? 10 : 6))}" inputmode="numeric">
          <span class="hint">Час, хв (0 — без обмеження):</span><input type="text" class="mn num" value="${esc(c.minutes ?? 20)}" inputmode="numeric">
          <label class="chk examonly"><input type="checkbox" class="ss" ${c.showScore?'checked':''}> Показувати студенту бал ШІ</label>
          <label class="chk examonly" title="ШІ починає з простих питань, ускладнює для сильних, а слабшим дає одне спрощення (навідне питання або 3 варіанти). Спрощення знижують бал."><input type="checkbox" class="ad" ${c.adaptive !== false ? 'checked' : ''}> Адаптивна складність</label>
          <label class="chk examonly" title="Якщо під час питання студент виходить зі сторінки довше ніж на 5 с, питання анулюється і ШІ ставить інше; анульовані питання не впливають на оцінку. Після 2 анулювань наступне питання з виходом не зараховується (0 балів)."><input type="checkbox" class="an" ${c.annul !== false ? 'checked' : ''}> Анулювати питання при виході зі сторінки</label>
        </div>
        <div><span class="hint">Групи: </span>${G.map(g=>`<label class="chk"><input type="checkbox" class="gr" value="${esc(g)}" ${(c.groups||[]).includes(g)?'checked':''}> ${esc(g)}</label>`).join("") || '<span class="hint">спершу додайте групи у вкладці «Групи і списки»</span>'}</div>
        <details class="cfg examonly"><summary>Критерії оцінювання (разом ${sum} б.)</summary>
          <table class="rep crit" style="margin-top:6px"><thead><tr><th>Критерій</th><th>Що оцінюється</th><th>Макс</th><th></th></tr></thead><tbody>${critRows(crit)}</tbody></table>
          <div class="row" style="margin-top:6px"><button class="sm sec" data-act="addCrit">+ критерій</button><button class="sm sec" data-act="resetCrit">Стандартні</button></div>
        </details>
        <div class="row" style="margin-top:8px"><button class="sm sec" data-act="delIv" data-v="${id}">Видалити</button><span class="sp"></span><span class="boxmsg"></span>
          <button class="sm" data-act="save" data-v="${id}">Зберегти</button></div>
        </details>
      </div>`;
    }).join("")}</div>`;
  interviews().forEach(([id]) => { paintStatus(id); applyLock(id); }); paintOverview(); loadCounts();
  document.querySelectorAll("details.ivform").forEach(d => d.addEventListener("toggle", () => { d.open ? EDIT.add(d.dataset.f) : EDIT.delete(d.dataset.f); }));
}
// Коли співбесіду вже хтось проходить, зміст (теми, кількість питань, критерії) змінювати не можна:
// інакше студенти отримають різні питання й оцінюватимуться за різними правилами.
// Можна: відкрити/закрити, групи, час, показ балу. Для іншого змісту — «Копія».
const isLocked = id => { if ((SAVED[id] || {}).mode === "train") return false; const a = ATT[id]; return !!(SAVED[id] && !SAVED[id].unsaved && a && (a.done + a.prog) > 0); };
function applyLock(id){
  const box = document.querySelector(`.tp[data-t="${id}"]`); if (!box) return;
  const lock = isLocked(id);
  box.querySelectorAll(".tc, .nq, .ad, .crit input, [data-act=addCrit], [data-act=resetCrit], [data-act=delCrit]").forEach(el => el.disabled = lock);
  const a = ATT[id];
  box.querySelector(".lockmsg").innerHTML = lock ? `<div class="info">🔒 Співбесіду вже проходили (${a.done} завершили, ${a.prog} в процесі), тому <b>теми, кількість питань, адаптивність і критерії заблоковано</b> — інакше студенти отримали б різні питання й оцінювалися б за різними правилами. Змінювати можна групи, час, показ балу, відкриття/закриття. Щоб змінити зміст — натисніть «Копія» і налаштуйте нову співбесіду.</div>` : "";
}
let EDIT = new Set();
async function newInterview(){
  const id = "s" + Date.now().toString(36);
  SETTINGS.ai[id] = { title: "", topics: [], open: false, nq: 6, minutes: 20, showScore: false, adaptive: true, annul: true, groups: [], criteria: DEFAULT_CRITERIA, created: Date.now(), unsaved: true };
  render();
  const box = document.querySelector(`.tp[data-t="${id}"]`); box.scrollIntoView({ behavior: "smooth", block: "center" }); box.querySelector(".ti").focus();
}
async function saveTopic(id){
  const box = document.querySelector(`.tp[data-t="${id}"]`);
  const crit = [...box.querySelectorAll(".crit tbody tr")].map(tr => ({
    name: tr.querySelector(".crn").value.trim(), desc: tr.querySelector(".cd").value.trim(), max: parseInt(tr.querySelector(".cm").value, 10)
  })).filter(c => c.name);
  const topics = [...box.querySelectorAll(".tc:checked")].map(i => i.value);
  const title = box.querySelector(".ti").value.trim();
  if (!title) { boxMsg(id, "Вкажіть назву співбесіди — її бачитимуть студенти."); return; }
  if (!topics.length) { boxMsg(id, "Оберіть хоча б одну тему."); return; }
  const mode = box.querySelector(".md").value, train = mode === "train";
  const kinds = [...box.querySelectorAll(".kd:checked")].map(i => i.value);
  if (!train && topics.length > MAX_TOPICS) { boxMsg(id, `Не більше ${MAX_TOPICS} тем в одній співбесіді (для підготовки — без обмежень).`); return; }
  if (train && EXAM_BANK && !kinds.length) { boxMsg(id, "Оберіть хоча б один вид завдань."); return; }
  if (!crit.length) { boxMsg(id, "Потрібен хоча б один критерій."); return; }
  if (crit.some(c => !(c.max >= 1 && c.max <= 100))) { boxMsg(id, "Максимальний бал критерію — ціле число від 1 до 100."); return; }
  if (new Set(crit.map(c=>c.name)).size !== crit.length) { boxMsg(id, "Назви критеріїв не повинні повторюватися."); return; }
  const nq = parseInt(box.querySelector(".nq").value, 10), mn = parseInt(box.querySelector(".mn").value, 10);
  if (train ? !(nq >= 3 && nq <= 30) : !(nq >= 3 && nq <= 12)) { boxMsg(id, train ? "Кількість завдань — від 3 до 30." : "Кількість питань — від 3 до 12."); return; }
  if (!(mn >= 0 && mn <= 180)) { boxMsg(id, "Час — від 0 до 180 хвилин."); return; }
  if (!train && nq < topics.length) { if (!confirm(`Тем (${topics.length}) більше, ніж питань (${nq}) — деякі теми залишаться без питання. Зберегти так?`)) return; }
  const tn = {}; topics.forEach(t => { const m = MATS.find(x => x.id === t); if (m) tn[t] = m.title; });
  const course = [...new Set(topics.map(t => (MATS.find(x => x.id === t) || {}).course).filter(Boolean))].join(", ");
  SETTINGS.ai[id] = { title, topics, topicNames: tn, course, open: box.querySelector(".op").checked, nq, minutes: mn, showScore: box.querySelector(".ss").checked, adaptive: box.querySelector(".ad").checked, annul: box.querySelector(".an").checked,
    mode, ...(train && EXAM_BANK ? { kinds } : {}),
    groups: [...box.querySelectorAll(".gr:checked")].map(i => i.value), criteria: crit, created: (SETTINGS.ai[id] && SETTINGS.ai[id].created) || Date.now() };
  await st.saveSettings(SETTINGS); snap(); render(); boxMsg(id, "Збережено ✓ Зміни діють приблизно за 30 секунд.", false);
}
async function toggleOpen(id){
  const c = SETTINGS.ai[id]; if (!c) return;
  if (!c.open) {
    const miss = []; if (!c.title) miss.push("назву"); if (!(c.topics||[]).length) miss.push("теми"); if (!(c.groups||[]).length) miss.push("групи");
    if (miss.length) { EDIT.add(id); render(); boxMsg(id, "Щоб відкрити, вкажіть " + miss.join(", ") + " і збережіть."); return; }
  } else if (ATT[id] && ATT[id].prog && !confirm(`Зараз ${ATT[id].prog} студ. посеред співбесіди. Після закриття вони не зможуть продовжити. Закрити?`)) return;
  c.open = !c.open; delete c.unsaved;
  await st.saveSettings(SETTINGS); snap(); render();
  warn(c.open ? "Співбесіду відкрито" : "Співбесіду закрито");
}
function duplicate(id){
  const c = SAVED[id] || SETTINGS.ai[id], nid = "s" + Date.now().toString(36);
  SETTINGS.ai[nid] = { ...JSON.parse(JSON.stringify(c)), title: (c.title || "") + " (копія)", open: false, created: Date.now(), unsaved: true };
  EDIT.add(nid); render();
  document.querySelector(`.tp[data-t="${nid}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function deleteInterview(id){
  const c = SETTINGS.ai[id] || {};
  if (!confirm(`Видалити співбесіду «${c.title || "без назви"}»? Студенти більше не зможуть її пройти. Уже збережені результати залишаться в базі.`)) return;
  delete SETTINGS.ai[id]; await st.saveSettings(SETTINGS); snap(); warn("Співбесіду видалено."); render();
}

// ---------- результати
async function loadRows(){
  ROWS = SEL.topic ? await st.listAttempts("ai-" + SEL.topic) : [];
  ROWS.sort((a,b) => a.group.localeCompare(b.group, "uk") || a.name.localeCompare(b.name, "uk"));
  VER = {}; OVL = {};
  if (workerReady()) {
    ROWS.forEach(r => verify(r));
    if ((SAVED[SEL.topic] || {}).mode !== "train") loadOverlaps();
  }
}
// збіг відповідей з текстом лекції: рахує воркер (без ШІ), щоб студент не міг підправити результат
async function loadOverlaps(){
  const topic = SEL.topic;
  await Promise.all(ROWS.filter(r => (r.messages || []).length > 2).map(async r => {
    try {
      const d = await fetch(WORKER_URL.replace(/\/$/,"") + "/overlap", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: AI_SUBJECT, topic: r.t, messages: (r.messages || []).map(m => ({ role: m.role, content: m.content })) }) }).then(x => x.json());
      OVL[r.id] = d.answers || [];
    } catch(e){ OVL[r.id] = null; }
  }));
  if (TAB === "results" && SEL.topic === topic) render();
}
function ovlSummary(id){
  const a = OVL[id];
  if (a === undefined) return '<span class="hint">…</span>';
  if (!a || !a.length) return '<span class="hint">—</span>';
  const words = a.reduce((x, y) => x + y.words, 0), cov = a.reduce((x, y) => x + y.words * y.pct / 100, 0);
  const pct = words ? Math.round(100 * cov / words) : 0, longest = Math.max(...a.map(x => x.longest)), flag = a.some(x => x.flag);
  return `<span class="pill ${flag ? "p-hi" : pct >= 20 ? "p-mid" : "p-lo"}" title="Частка слів у відповідях, дослівно взятих з лекції фразами від 5 слів; найдовший дослівний фрагмент">${flag ? "⚠ " : ""}${pct} %</span>${longest ? ` <span class="hint">до ${longest} сл.</span>` : ""}`;
}
// підсвітити дослівно переписані з лекції фрагменти у відповіді студента
function markCopied(text, o){
  if (!o || !o.spans || !o.spans.length) return esc(text);
  let out = "", pos = 0;
  o.spans.forEach(([a, b]) => { out += esc(text.slice(pos, a)) + `<mark class="cp">${esc(text.slice(a, b))}</mark>`; pos = b; });
  return out + esc(text.slice(pos));
}
async function verify(r){
  if (!r.messages || r.messages.length < 2 || !r.sig) { VER[r.id] = "none"; return; }
  try {
    const res = await fetch(WORKER_URL.replace(/\/$/,"") + "/verify", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: AI_SUBJECT, topic: r.t, sid: r.id, seed: (r.meta && r.meta.seed) || "", messages: r.messages, sig: r.sig, eval: r.done ? (r.eval ?? null) : null }) }).then(x => x.json());
    VER[r.id] = res.ok ? "ok" : "bad";
  } catch(e){ VER[r.id] = "err"; }
  if (TAB === "results") paintVer(r.id);
}
function verLabel(v){
  return v === "ok" ? '<span class="ok" title="Протокол підписаний сервером і не змінювався">✓</span>'
    : v === "bad" ? '<span class="bad" title="Протокол або оцінку змінено поза співбесідою">⚠ змінено</span>'
    : v === "none" ? '<span class="hint">—</span>' : v === "err" ? '<span class="hint">?</span>' : '<span class="hint">…</span>';
}
function paintVer(id){ document.querySelectorAll(`[data-ver="${CSS.escape(id)}"]`).forEach(el => el.innerHTML = verLabel(VER[id])); }
function suspect(v){
  const s = String(v||"").toLowerCase();
  return s.startsWith("вис") ? '<span class="pill p-hi">висока</span>' : s.startsWith("сер") ? '<span class="pill p-mid">середня</span>' : s.startsWith("низ") ? '<span class="pill p-lo">низька</span>' : '<span class="hint">—</span>';
}
const nqOf = r => (SETTINGS.ai[r.t] || {}).nq || ((SETTINGS.ai[r.t] || {}).mode === "train" ? 10 : 6);
function asked(r){ return Math.max(0, ...(r.messages||[]).filter(m => m.role === "assistant").flatMap(m => [...m.content.matchAll(/(?:Питання|Завдання)\s+(\d+)\s+з\s+\d+/g)].map(x => +x[1]))); }
// службові повідомлення сайту (анулювання питання через вихід зі сторінки)
const isSys = m => !!m && m.role === "user" && typeof m.content === "string" && m.content.startsWith("⛔");
function annOf(r){
  const sys = (r.messages||[]).filter(isSys);
  return { ann: sys.filter(m => m.content.includes("анульовано")).length, zero: sys.filter(m => m.content.includes("не зараховано")).length };
}
// швидкість набору кожної відповіді: символи / секунди від появи питання до надсилання (разом із читанням)
const FAST = 4, FAST_LEN = 80, TABS_WARN = 3;
function speeds(r){
  const secs = (r.meta && r.meta.secs) || [], out = {};
  let k = 0;
  (r.messages||[]).forEach((m, i) => {
    if (m.role !== "user" || i === 0) return;
    const sec = secs[k++];
    if (isSys(m) || !sec) return;
    const cps = m.content.length / sec;
    out[i] = { sec, cps, fast: cps > FAST && m.content.length >= FAST_LEN };
  });
  return out;
}
function maxSpeed(r){ const long = Object.entries(speeds(r)).filter(([i]) => r.messages[i].content.length >= FAST_LEN).map(([, x]) => x.cps); return long.length ? Math.max(...long) : 0; }
const cpsFmt = v => v ? v.toFixed(1).replace(".", ",") : "—";
function tabsCell(r){
  const b = (r.meta && r.meta.blur) || 0, a = annOf(r);
  return `${b >= TABS_WARN ? `<span class="pill p-mid" title="Часті виходи зі сторінки">${b}</span>` : b}${a.ann || a.zero ? ` <span class="hint" title="Анульовано питань · не зараховано">ан. ${a.ann}${a.zero ? ` · 0 б.: ${a.zero}` : ""}</span>` : ""}`;
}
function speedCell(r){ const v = maxSpeed(r); return v > FAST ? `<span class="pill p-mid" title="Швидше ${FAST} симв./с на довгій відповіді">${cpsFmt(v)}</span>` : cpsFmt(v); }
function duration(r){ const a = r.meta && r.meta.startedAt, b = (r.meta && r.meta.finishedAt) || r.updatedAt; return a && b ? (new Date(b) - new Date(a)) / 1000 : 0; }
function avgSecs(r){ const s = (r.meta && r.meta.secs) || []; return s.length ? s.reduce((x,y)=>x+y,0) / s.length : 0; }

// рівень, якого студент досяг сам, і скільки спрощень знадобилося
function lvl(e){
  if (!e || (!e.level && e.hints == null)) return "—";
  const l = String(e.level || "").toLowerCase(), cls = l.startsWith("вис") ? "p-lo" : l.startsWith("сер") ? "p-mid" : l.startsWith("баз") ? "p-hi" : "";
  return `${e.level ? `<span class="pill ${cls}">${esc(e.level)}</span>` : ""}${e.hints != null ? ` <span class="hint">${e.hints} спрощ.</span>` : ""}`;
}
// стан спроби студента
function attemptState(r){
  if (!r) return { label: "не розпочинав", cls: "st-off", order: 3 };
  const e = r.eval || evalFromText(r);
  if (VER[r.id] === "bad") return { label: "⚠ протокол змінено", cls: "st-bad", order: 0 };
  if (r.done && e && e.error) return { label: "завершено, оцінку не сформовано", cls: "st-bad", order: 1 };
  if (r.done) return { label: "завершено", cls: "st-ok", order: 4 };
  if (e) return { label: "обірвано (стара версія)", cls: "st-bad", order: 1 };
  const k = asked(r), n = nqOf(r), idle = (Date.now() - new Date(r.updatedAt || 0)) / 60000;
  return { label: !k ? "увійшов, питань ще не було" : `в процесі · питання ${k} з ${n}` + (idle > 30 ? " · без активності " + Math.round(idle) + " хв" : ""), cls: "st-warn", order: 2 };
}
const normN = n => st.normPart(n).split(" ").filter(Boolean).sort().join(" ");
// усі студенти співбесіди: хто проходив + хто зі списку групи ще не почав
function allRows(){
  const cfg = SAVED[SEL.topic] || SETTINGS.ai[SEL.topic] || {};
  const rows = ROWS.map(r => ({ r, group: r.group, name: r.name }));
  const have = new Set(ROWS.map(r => r.group + "|" + normN(r.name)));
  (cfg.groups || []).forEach(g => (ROSTER[g] || []).forEach(n => { if (!have.has(g + "|" + normN(n))) rows.push({ r: null, group: g, name: n }); }));
  return rows.filter(x => !SEL.group || x.group === SEL.group)
    .sort((x, y) => x.group.localeCompare(y.group, "uk", { numeric: true }) || x.name.localeCompare(y.name, "uk"));
}
function renderResults(){
  if ((SAVED[SEL.topic] || {}).mode === "train") return renderTrainResults();
  const list = interviews();
  if (SEL.topic && !list.some(([id]) => id === SEL.topic)) list.push([SEL.topic, { title: "(видалена співбесіда)" }]);
  const cfg = SAVED[SEL.topic] || {};
  const groups = [...new Set([...(cfg.groups || []), ...ROWS.map(r => r.group)])];
  const rows = SEL.topic ? allRows() : [];
  const att = rows.filter(x => x.r).map(x => x.r);
  // підсумок по групах
  const sum = groups.filter(g => !SEL.group || g === SEL.group).map(g => {
    const gr = rows.filter(x => x.group === g), c = { done: 0, prog: 0, none: 0, bad: 0 };
    gr.forEach(x => { const s0 = attemptState(x.r); if (s0.cls === "st-ok") c.done++; else if (s0.cls === "st-warn") c.prog++; else if (s0.cls === "st-bad") c.bad++; else c.none++; });
    return `<div class="gsum"><b>${esc(g)}</b> <span class="pill st-ok">${c.done} завершили</span>${c.prog ? ` <span class="pill st-warn">${c.prog} в процесі</span>` : ""}${c.bad ? ` <span class="pill st-bad">${c.bad} з проблемою</span>` : ""}${c.none ? ` <span class="pill st-off">${c.none} не розпочинали</span>` : ""}${!ROSTER[g] ? ' <span class="hint">(списку групи немає — видно лише тих, хто заходив)</span>' : ""}</div>`;
  }).join("");
  $("app").innerHTML = tabs() + `<div class="card">
    <div class="row"><select id="selT" style="width:auto;flex:1;min-width:240px"><option value="">— співбесіда —</option>${list.map(([id,c])=>`<option value="${id}" ${SEL.topic===id?'selected':''}>${esc(c.title||"без назви")}</option>`).join("")}</select>
      <select id="selG" style="width:auto"><option value="">Усі групи</option>${groups.map(g=>`<option ${SEL.group===g?'selected':''}>${esc(g)}</option>`).join("")}</select>
      <button class="sec sm" data-act="reload">Оновити</button><button class="sec sm" data-act="csv" ${att.length?'':'disabled'}>CSV</button><button class="sec sm" data-act="json" ${att.length?'':'disabled'}>JSON (протоколи)</button></div>
    ${SEL.topic ? `<div style="margin-top:12px">${sum}</div>` + (rows.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="rep"><thead><tr><th>Студент</th><th>Група</th><th>Стан</th><th>Бал ШІ</th><th title="Найвищий рівень, на якому студент упевнено відповідав сам · кількість спрощень">Рівень · спрощень</th><th>Підозра ШІ</th><th title="Дослівний збіг відповідей з текстом лекції">Збіг з лекцією</th><th title="Виходи зі сторінки за співбесіду (жовтим — ${TABS_WARN} і більше) · анульовані питання">Вкладки</th><th title="Спроби вставити текст">Вставки</th><th title="Найбільша швидкість набору довгої відповіді, символів за секунду, разом із читанням питання (жовтим — понад ${FAST})">Швидкість, симв./с</th><th>Сер. час відповіді</th><th>Тривалість</th><th title="Цілісність протоколу">Протокол</th></tr></thead><tbody>
      ${rows.map(({ r, group, name }) => { const s0 = attemptState(r); if (!r) return `<tr class="none"><td>${esc(name)}</td><td>${esc(group)}</td><td><span class="pill st-off">не розпочинав</span></td><td colspan="10"></td></tr>`;
        const e = r.eval || evalFromText(r) || {}; return `<tr class="clk" data-act="open" data-v="${esc(r.id)}">
        <td>${esc(r.name)}</td><td>${esc(r.group)}</td><td><span class="pill ${s0.cls}">${esc(s0.label)}</span></td>
        <td>${e.max ? `<b>${e.total}</b> / ${e.max}` : "—"}</td><td>${lvl(e)}</td><td>${e.ai_suspect ? suspect(e.ai_suspect) : "—"}</td><td>${ovlSummary(r.id)}</td>
        <td>${tabsCell(r)}</td><td>${(r.meta&&r.meta.pastes)||0}</td><td>${speedCell(r)}</td><td>${fmt(avgSecs(r))}</td><td>${fmt(duration(r))}</td>
        <td data-ver="${esc(r.id)}">${verLabel(VER[r.id])}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<p class="hint" style="margin-top:12px">Ще ніхто не проходив цю співбесіду, а списків груп немає.</p>') : `<p class="hint" style="margin-top:12px">Оберіть співбесіду.</p>`}
  </div>
  ${att.length ? `<div class="card"><div class="row"><h3 style="margin:0">Протоколи (${att.length})</h3><span class="sp"></span><button class="sm sec" data-act="regradeAll">Переоцінити всіх завершених</button><button class="sm sec" data-act="expandAll">Розгорнути всі</button><button class="sm sec" data-act="collapseAll">Згорнути всі</button></div>
    ${rows.filter(x => x.r).map(({ r }) => { const s0 = attemptState(r), e = r.eval || evalFromText(r);
      return `<details class="proto" id="p-${esc(r.id)}" ${COLLAPSED.has(r.id) ? "" : "open"} data-pid="${esc(r.id)}"><summary><b>${esc(r.name)}</b> · ${esc(r.group)} <span class="pill ${s0.cls}">${esc(s0.label)}</span>${e && e.max ? ` <b>${e.total} / ${e.max}</b>` : ""}</summary>${detailHtml(r)}</details>`; }).join("")}</div>` : ""}`;
  $("selT").onchange = async e => { SEL = { topic: e.target.value, group: "", id: "" }; await loadRows(); render(); };
  $("selG").onchange = e => { SEL.group = e.target.value; SEL.id = ""; render(); };
  document.querySelectorAll("details.proto").forEach(d => d.addEventListener("toggle", () => { d.open ? COLLAPSED.delete(d.dataset.pid) : COLLAPSED.add(d.dataset.pid); }));
  if (SEL.id) { const d = document.getElementById("p-" + SEL.id); if (d) { d.open = true; COLLAPSED.delete(SEL.id); d.scrollIntoView({ behavior: "smooth", block: "start" }); } SEL.id = ""; }
}
let COLLAPSED = new Set(), ROSTER = {};
// ---------- результати підготовки: по студенту — кількість тренувань і сума за всі
function renderTrainResults(){
  const list = interviews(), cfg = SAVED[SEL.topic] || {};
  const groups = [...new Set([...(cfg.groups || []), ...ROWS.map(r => r.group)])];
  const key = (g, n) => g + "|" + normN(n);
  const by = new Map();
  ROWS.forEach(r => { const k = key(r.group, r.name); if (!by.has(k)) by.set(k, { group: r.group, name: r.name, att: [] }); by.get(k).att.push(r); });
  (cfg.groups || []).forEach(g => (ROSTER[g] || []).forEach(n => { const k = key(g, n); if (!by.has(k)) by.set(k, { group: g, name: n, att: [] }); }));
  const studs = [...by.values()].filter(x => !SEL.group || x.group === SEL.group)
    .sort((x, y) => x.group.localeCompare(y.group, "uk", { numeric: true }) || x.name.localeCompare(y.name, "uk"));
  const sumOf = att => att.reduce((a, r) => { const e = r.eval || {}; if (r.done) { a.done++; a.n += e.n || 0; a.first += e.first || 0; a.hinted += e.hinted || 0; a.shown += e.shown || 0; } else a.prog++; return a; }, { done: 0, prog: 0, n: 0, first: 0, hinted: 0, shown: 0 });
  const pct = (x, n) => n ? Math.round(100 * x / n) + "%" : "—";
  const gsum = groups.filter(g => !SEL.group || g === SEL.group).map(g => {
    const ss = studs.filter(x => x.group === g), active = ss.filter(x => x.att.length).length;
    return `<div class="gsum"><b>${esc(g)}</b> <span class="pill st-ok">${active} тренувалися</span>${ROSTER[g] ? ` <span class="pill st-off">${ss.length - active} ще ні</span>` : ' <span class="hint">(списку групи немає — видно лише тих, хто заходив)</span>'}</div>`;
  }).join("");
  const att = studs.flatMap(x => x.att);
  $("app").innerHTML = tabs() + `<div class="card">
    <div class="row"><select id="selT" style="width:auto;flex:1;min-width:240px"><option value="">— співбесіда —</option>${list.map(([id,c])=>`<option value="${id}" ${SEL.topic===id?'selected':''}>${esc(c.title||"без назви")}${c.mode === "train" ? " (підготовка)" : ""}</option>`).join("")}</select>
      <select id="selG" style="width:auto"><option value="">Усі групи</option>${groups.map(g=>`<option ${SEL.group===g?'selected':''}>${esc(g)}</option>`).join("")}</select>
      <button class="sec sm" data-act="reload">Оновити</button><button class="sec sm" data-act="csvTrain" ${att.length?'':'disabled'}>CSV</button><button class="sec sm" data-act="json" ${att.length?'':'disabled'}>JSON (протоколи)</button></div>
    <p class="hint" style="margin:10px 0 4px">Підготовка без оцінки. «Самостійно» — частка завдань, на які студент відповів правильно з першої спроби, за всі тренування.</p>
    <div>${gsum}</div>
    ${studs.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="rep"><thead><tr><th>Студент</th><th>Група</th><th>Тренувань</th><th>Завдань</th><th>Самостійно</th><th>З підказкою</th><th>Показано відповідь</th><th>Повторити (останнє тренування)</th><th>Останнє</th></tr></thead><tbody>
      ${studs.map(x => { if (!x.att.length) return `<tr class="none"><td>${esc(x.name)}</td><td>${esc(x.group)}</td><td><span class="pill st-off">не тренувався</span></td><td colspan="6"></td></tr>`;
        const t = sumOf(x.att), last = [...x.att].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0], le = last.eval || {};
        return `<tr class="clk" data-act="open" data-v="${esc(last.id)}"><td>${esc(x.name)}</td><td>${esc(x.group)}</td>
          <td>${t.done}${t.prog ? ` <span class="pill st-warn">+${t.prog} в процесі</span>` : ""}</td><td>${t.n || "—"}</td>
          <td><b>${pct(t.first, t.n)}</b> <span class="hint">${t.n ? `(${t.first})` : ""}</span></td><td>${t.n ? t.hinted : "—"}</td><td>${t.n ? t.shown : "—"}</td>
          <td>${(le.review || []).map(esc).join("; ") || "—"}</td><td>${last.updatedAt ? new Date(last.updatedAt).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<p class="hint" style="margin-top:12px">Ще ніхто не тренувався.</p>'}
  </div>
  ${att.length ? `<div class="card"><div class="row"><h3 style="margin:0">Протоколи тренувань (${att.length})</h3><span class="sp"></span><button class="sm sec" data-act="expandAll">Розгорнути всі</button><button class="sm sec" data-act="collapseAll">Згорнути всі</button></div>
    ${studs.flatMap(x => [...x.att].sort((a, b) => (a.session || 1) - (b.session || 1))).map(r => { const e = r.eval || {};
      return `<details class="proto" id="p-${esc(r.id)}" ${COLLAPSED.has(r.id) ? "" : "open"} data-pid="${esc(r.id)}"><summary><b>${esc(r.name)}</b> · ${esc(r.group)} · тренування № ${r.session || 1}
        ${r.done ? `<span class="pill st-ok">завершено</span> самостійно ${e.first || 0} з ${e.n || "?"}` : `<span class="pill st-warn">в процесі · завдання ${asked(r)} з ${nqOf(r)}</span>`}</summary>${trainDetail(r)}</details>`; }).join("")}</div>` : ""}`;
  $("selT").onchange = async e => { SEL = { topic: e.target.value, group: "", id: "" }; await loadRows(); render(); };
  $("selG").onchange = e => { SEL.group = e.target.value; SEL.id = ""; render(); };
  document.querySelectorAll("details.proto").forEach(d => d.addEventListener("toggle", () => { d.open ? (OPENED_TRAIN.add(d.dataset.pid), COLLAPSED.delete(d.dataset.pid)) : (OPENED_TRAIN.delete(d.dataset.pid), COLLAPSED.add(d.dataset.pid)); }));
  if (SEL.id) { const d = document.getElementById("p-" + SEL.id); if (d) { d.open = true; OPENED_TRAIN.add(SEL.id); d.scrollIntoView({ behavior: "smooth", block: "start" }); } SEL.id = ""; }
}
let OPENED_TRAIN = new Set();
function trainDetail(r){
  const e = r.eval || null, secs = (r.meta && r.meta.secs) || [];
  let ui = 0;
  const st2 = { "сам": "✓ сам", "підказка": "з підказкою", "показано": "показано відповідь", "пропущено": "пропущено" };
  return `<div class="pbody">
    ${e ? `<p>${(e.items || []).map(x => `<span class="pill ${x.status === "сам" ? "p-lo" : x.status === "підказка" ? "p-mid" : "p-hi"}">${x.n}: ${st2[x.status] || x.status}</span>`).join(" ")}</p>
      ${e.review && e.review.length ? `<p><b>Повторити:</b> ${e.review.map(esc).join("; ")}</p>` : ""}
      ${e.summary ? `<p><b>Коментар ШІ:</b> ${esc(e.summary)}</p>` : ""}` : `<p class="hint">Тренування ще не завершене.</p>`}
    <p class="hint">Тривалість: ${fmt(duration(r))}</p>
    ${(r.messages||[]).slice(1).map(m => m.role === "user"
        ? `<div class="msg me">${esc(m.content)}${secs[ui] != null ? `<small>${fmt(secs[ui++])}</small>` : ""}</div>`
        : `<div class="msg ai">${esc(m.content.split(/<eval>/i)[0].trim() || "(підсумок — вище)")}</div>`).join("")}
    <div class="row" style="margin-top:12px"><span class="sp"></span>
      ${!r.done && r.uid ? `<button class="sm sec" data-act="unbind" data-v="${esc(r.id)}">Дозволити продовжити з іншого пристрою</button>` : ""}
      <button class="sm sec" data-act="del" data-v="${esc(r.id)}">Видалити це тренування</button></div>
  </div>`;
}
function exportTrainCsv(){
  const q = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const rows = ROWS.filter(r => !SEL.group || r.group === SEL.group);
  const head = ["Група","Студент","Тренування №","Стан","Завдань","Самостійно","З підказкою","Показано","Пропущено","Повторити","Дата"];
  const lines = rows.sort((a, b) => a.group.localeCompare(b.group, "uk") || a.name.localeCompare(b.name, "uk") || (a.session || 1) - (b.session || 1)).map(r => { const e = r.eval || {};
    return [r.group, r.name, r.session || 1, r.done ? "завершено" : "в процесі", e.n ?? "", e.first ?? "", e.hinted ?? "", e.shown ?? "", e.skipped ?? "", (e.review || []).join("; "), r.updatedAt || ""].map(q).join(";"); });
  download(`pidgotovka_${SEL.topic}${SEL.group?"_"+SEL.group:""}.csv`, "\ufeff" + [head.map(q).join(";"), ...lines].join("\r\n"), "text/csv;charset=utf-8");
}
function detailHtml(r){
  const e = r.eval || evalFromText(r), secs = (r.meta && r.meta.secs) || [];
  let ui = 0;
  const ov = {}; (OVL[r.id] || []).forEach(o => ov[o.i] = o);
  const sp = speeds(r), an = annOf(r), aw = {};
  ((r.meta && r.meta.away) || []).forEach(x => { if (!x.a) (aw[x.m - 1] ||= []).push(x); });
  const awayLine = mi => (aw[mi] || []).map(x => `<div class="awy">↗ вихід зі сторінки на ${fmt(x.s)}${x.r ? " (сторінку закривали)" : ""}${x.s < 5 ? " — коротко, питання не анульовано" : ""}</div>`).join("");
  return `<div class="pbody">
    <div class="row"><span class="sp"></span><span data-ver="${esc(r.id)}">${verLabel(VER[r.id])}</span></div>
    ${e ? `${e.error ? '<div class="alert show">ШІ не зміг коректно сформувати оцінку — оцініть за протоколом вручну.</div>' : ""}
      <table class="rep"><thead><tr><th>Критерій</th><th>Бал</th><th>Коментар ШІ</th></tr></thead><tbody>
      ${(e.criteria||[]).map(c=>`<tr><td>${esc(c.name)}</td><td style="white-space:nowrap"><b>${c.score}</b> / ${c.max}</td><td>${esc(c.comment)}</td></tr>`).join("")}</tbody></table>
      <p><b>Підсумок:</b> ${esc(e.summary)}</p>
      ${e.gaps && e.gaps.length ? `<p><b>Прогалини:</b> ${e.gaps.map(esc).join("; ")}</p>` : ""}
      ${e.level || e.hints != null ? `<p><b>Рівень:</b> ${lvl(e)} ${esc(e.level_why || "")}</p>` : ""}
      ${e.ai_suspect ? `<p><b>Ймовірність використання ШІ:</b> ${suspect(e.ai_suspect)} ${esc(e.ai_suspect_why)}</p>` : ""}` : `<p class="hint">Співбесіда ще не завершена — оцінки поки немає.</p>`}
    <p class="hint">Вкладки: ${tabsCell(r)}${(r.meta && r.meta.away && r.meta.away.length) ? ` · виходів під час питань: ${r.meta.away.length}` : ""}${an.ann ? ` · анульовано питань: ${an.ann}` : ""}${an.zero ? ` · не зараховано: ${an.zero}` : ""} · Спроби вставки: ${(r.meta&&r.meta.pastes)||0} · Тривалість: ${fmt(duration(r))}${r.meta&&r.meta.aiNoticeAccepted ? ` · Попередження про ШІ прийнято: ${new Date(r.meta.aiNoticeAccepted).toLocaleString("uk-UA")}` : ""}</p>
    ${r.evalPrev && r.eval ? `<p class="hint">Переоцінено ${r.regradedAt ? new Date(r.regradedAt).toLocaleString("uk-UA") : ""}: спершу було <b>${r.evalPrev.total} / ${r.evalPrev.max}</b>.</p>` : ""}
    ${e && !r.eval ? '<div class="info">Оцінку відновлено з тексту діалогу (стара версія воркера). Протокол не завершено — за потреби дозвольте пройти заново.</div>' : ""}
    ${OVL[r.id] && OVL[r.id].some(o => o.pct) ? '<p class="hint">Жовтим підсвічено фрагменти, дослівно (від 5 слів поспіль) збіжні з текстом лекції. Окремі терміни й визначення — нормально; ⚠ — відповідь значною мірою переписана.</p>' : ""}
    ${(r.messages||[]).map((m, mi) => mi === 0 ? "" : isSys(m) ? (ui++, `<div class="msg sys">${esc(m.content)}</div>`) : m.role === "user"
        ? `<div class="msg me">${markCopied(m.content, ov[mi])}${secs[ui] != null || (ov[mi] && ov[mi].pct) ? `<small>${secs[ui] != null ? `${fmt(secs[ui++])} · ` : ""}${m.content.length} симв.${sp[mi] && m.content.length >= FAST_LEN ? ` · ${sp[mi].fast ? "<b>⚠ " : ""}${cpsFmt(sp[mi].cps)} симв./с${sp[mi].fast ? "</b>" : ""}` : ""}${ov[mi] && ov[mi].pct ? ` · збіг з лекцією ${ov[mi].pct} %, до ${ov[mi].longest} слів поспіль${ov[mi].src ? " (" + esc(ov[mi].src) + ")" : ""}${ov[mi].flag ? " ⚠" : ""}` : ""}</small>` : ""}</div>`
        : `<div class="msg ai">${esc(m.content.split(/<eval>/i)[0].trim() || "(оцінка — вище)")}</div>${awayLine(mi)}`).join("")}
    <div class="row" style="margin-top:12px"><span class="sp"></span>
      ${!r.done && r.uid ? `<button class="sm sec" data-act="unbind" data-v="${esc(r.id)}">Дозволити продовжити з іншого пристрою</button>` : ""}
      ${r.done && r.sig ? `<button class="sm sec" data-act="regrade" data-v="${esc(r.id)}">Переоцінити за поточними правилами</button>` : ""}
      <button class="sm sec" data-act="del" data-v="${esc(r.id)}">Дозволити пройти заново</button></div>
  </div>`;
}
// переоцінити завершену спробу: воркер перевіряє підпис, оцінює протокол заново і підписує нову оцінку
async function regradeOne(r){
  const res = await fetch(WORKER_URL.replace(/\/$/,"") + "/regrade", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: AI_SUBJECT, topic: r.t, sid: r.id, seed: (r.meta && r.meta.seed) || "", messages: r.messages, sig: r.sig, eval: r.eval ?? null,
      stats: { blur: (r.meta && r.meta.blur) || 0, away: (r.meta && r.meta.away) || [], secs: (r.meta && r.meta.secs) || [] } }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || ("Помилка " + res.status));
  const prev = r.evalPrev || r.eval || null;
  await st.updateAttempt(r.id, { eval: d.eval, score: d.eval.total, sig: d.sig, evalPrev: prev, regradedAt: new Date().toISOString() });
  return { from: r.eval ? r.eval.total : null, to: d.eval.total, max: d.eval.max };
}
// оцінка, що потрапила в текст повідомлення ШІ (обрізана чи без тега) → об'єкт для показу
function evalFromText(r){
  const last = [...(r.messages||[])].reverse().find(m => m.role === "assistant" && /<eval>/i.test(m.content));
  if (!last) return null;
  let raw = last.content.split(/<eval>/i)[1].replace(/<\/eval>[\s\S]*$/i, "").trim(), o = null;
  try { o = JSON.parse(raw); } catch(e) {
    const crit = [...raw.matchAll(/"name"\s*:\s*"([^"]*)"\s*,\s*"score"\s*:\s*(\d+)\s*,\s*"max"\s*:\s*(\d+)\s*,\s*"comment"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map(m => ({ name: m[1], score: +m[2], max: +m[3], comment: m[4].replace(/\\"/g, '"') }));
    const sm = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);
    o = { criteria: crit, summary: sm ? sm[1] + (raw.includes('"gaps"') ? "" : "…") : "", gaps: [] };
  }
  const c = o.criteria || [];
  return { criteria: c, total: c.reduce((a, x) => a + (x.score||0), 0), max: c.reduce((a, x) => a + (x.max||0), 0) || o.max || 0,
    summary: o.summary || "", gaps: o.gaps || [], ai_suspect: o.ai_suspect || "", ai_suspect_why: o.ai_suspect_why || "", recovered: true };
}
function download(name, text, type){
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
function exportCsv(){
  const rows = ROWS.filter(r => !SEL.group || r.group === SEL.group);
  const crit = [...new Set(rows.flatMap(r => ((r.eval||{}).criteria||[]).map(c => c.name)))];
  const q = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const head = ["Група","Студент","Стан","Бал","Макс",...crit,"Рівень","Спрощень","Підозра ШІ","Макс. збіг з лекцією, %","Вкладки","Анульовано питань","Не зараховано","Вставки","Макс. швидкість набору, симв./с","Сер. час відповіді, с","Тривалість, с","Протокол","Підсумок"];
  const lines = rows.map(r => { const e = r.eval || {}; return [r.group, r.name, r.done?"завершено":"в процесі", e.total ?? "", e.max ?? "",
    ...crit.map(n => { const c = (e.criteria||[]).find(x => x.name === n); return c ? c.score : ""; }),
    e.level || "", e.hints ?? "", e.ai_suspect || "", OVL[r.id] && OVL[r.id].length ? Math.max(...OVL[r.id].map(x => x.pct)) : "", (r.meta&&r.meta.blur)||0, annOf(r).ann, annOf(r).zero, (r.meta&&r.meta.pastes)||0, maxSpeed(r) ? maxSpeed(r).toFixed(1).replace(".", ",") : "", Math.round(avgSecs(r)), Math.round(duration(r)),
    VER[r.id] === "ok" ? "ок" : VER[r.id] === "bad" ? "змінено" : "", e.summary || ""].map(q).join(";"); });
  download(`spivbesida_${SEL.topic}${SEL.group?"_"+SEL.group:""}.csv`, "﻿" + [head.map(q).join(";"), ...lines].join("\r\n"), "text/csv;charset=utf-8");
}
function exportJson(){
  const rows = ROWS.filter(r => !SEL.group || r.group === SEL.group).map(r => ({ group: r.group, name: r.name, done: !!r.done, eval: r.eval || null,
    meta: r.meta || {}, integrity: VER[r.id] || "", dialog: (r.messages||[]).slice(1).map(m => ({ who: m.role === "user" ? "студент" : "ШІ", text: m.content })) }));
  download(`spivbesida_${SEL.topic}${SEL.group?"_"+SEL.group:""}.json`, JSON.stringify(rows, null, 1), "application/json");
}

// ---------- події
["input","change"].forEach(t => document.addEventListener(t, ev => { const b = ev.target.closest && ev.target.closest(".tp[data-t]"); if (b) paintStatus(b.dataset.t); }));
// новий тип «підготовка»: без обмеження часу і 10 завдань за замовчуванням
document.addEventListener("change", ev => {
  if (!ev.target.classList || !ev.target.classList.contains("md")) return;
  const b = ev.target.closest(".tp[data-t]"), tr = ev.target.value === "train";
  b.querySelector(".mn").value = tr ? 0 : 20; b.querySelector(".nq").value = tr ? (EXAM_BANK ? 5 : 10) : 6; paintStatus(b.dataset.t);
});
document.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, v = el.dataset.v;
  try {
    if (act === "tab") { TAB = v; if (TAB === "results" && SEL.topic) await loadRows(); render(); }
    else if (act === "save") await saveTopic(v);
    else if (act === "copy") { await navigator.clipboard.writeText(v); warn("Посилання скопійовано"); }
    else if (act === "new") await newInterview();
    else if (act === "toggleOpen") await toggleOpen(v);
    else if (act === "dup") duplicate(v);
    else if (act === "goto") document.querySelector(`.tp[data-t="${v}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (act === "delIv") await deleteInterview(v);
    else if (act === "addCrit") el.closest(".tp").querySelector(".crit tbody").insertAdjacentHTML("beforeend", critRows([{ name: "", desc: "", max: 2 }]));
    else if (act === "delCrit") el.closest("tr").remove();
    else if (act === "resetCrit") el.closest(".tp").querySelector(".crit tbody").innerHTML = critRows(DEFAULT_CRITERIA);
    else if (act === "reload") { await loadRows(); render(); }
    else if (act === "open") { SEL.id = v; render(); }
    else if (act === "regrade") {
      const r = ROWS.find(x => x.id === v); el.disabled = true; el.textContent = "Переоцінюю…";
      const x = await regradeOne(r); warn(`${esc(r.name)}: ${x.from ?? "—"} → <b>${x.to}</b> / ${x.max}`); SEL.id = v; await loadRows(); render();
    }
    else if (act === "regradeAll") {
      const list = ROWS.filter(r => r.done && r.sig && (!SEL.group || r.group === SEL.group));
      if (!list.length) { warn("Немає завершених співбесід"); return; }
      if (!confirm(`Переоцінити ${list.length} завершених співбесід за поточними правилами? Попередні оцінки збережуться для порівняння. Це займе приблизно ${Math.ceil(list.length * 8 / 60)} хв.`)) return;
      el.disabled = true; let ok = 0, fail = 0;
      for (const r of list) { el.textContent = `Переоцінюю ${ok + fail + 1} з ${list.length}…`; try { await regradeOne(r); ok++; } catch(e){ fail++; } }
      warn(`Переоцінено: ${ok}${fail ? `, з помилкою: ${fail} (спробуйте ще раз)` : ""}.`); await loadRows(); render();
    }
    else if (act === "expandAll") { COLLAPSED.clear(); document.querySelectorAll("details.proto").forEach(d => d.open = true); }
    else if (act === "collapseAll") { document.querySelectorAll("details.proto").forEach(d => { d.open = false; COLLAPSED.add(d.dataset.pid); }); }
    else if (act === "csv") exportCsv();
    else if (act === "csvTrain") exportTrainCsv();
    else if (act === "json") exportJson();
    else if (act === "unbind") { await st.updateAttempt(v, { uid: null }); warn("Тепер студент може продовжити з іншого пристрою."); await loadRows(); render(); }
    else if (act === "del") {
      const r = ROWS.find(x => x.id === v);
      if (!confirm(`Видалити спробу «${r ? r.name : ""}»? Протокол і оцінку буде втрачено, студент зможе пройти співбесіду заново.`)) return;
      await st.deleteAttempt(v); SEL.id = ""; warn("Спробу видалено."); await loadRows(); render();
    }
  } catch(e){ warn(esc(e.message || e)); }
});

start();
