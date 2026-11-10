import * as st from "./store.js";
import { WORKER_URL, AI_SUBJECT, EXAM_BANK } from "./ai-config.js";

const START = "Починаймо співбесіду.";
const MAX_ANSWER = 2000;
const AWAY_LIMIT = 5;      // с поза сторінкою під час питання, після яких питання анулюється
const ANNUL_MAX = 2;       // скільки разів анулюємо; далі — «не зараховано»
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const params = new URLSearchParams(location.search);
const TID = (params.get("i") || "").trim();

let SETTINGS, CFG, TITLE = "", TLIST = "", A = null, AID = null, UID = null;
let busy = false, askedAt = 0, timerId = null, finishing = false, TRAIN = false, GROUP = "", NAME = "";
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

const local = {
  get(id){ try { return JSON.parse(localStorage.getItem("ai:"+id)); } catch(e){ return null; } },
  set(id,d){ try { localStorage.setItem("ai:"+id, JSON.stringify(d)); } catch(e){} }
};
function net(msg){ const n=$("net"); if(!msg){ n.classList.remove("show"); return; } n.textContent=msg; n.classList.add("show"); }
function warn(m){ const a=$("alert"); a.innerHTML=m; a.classList.add("show"); }
function unwarn(){ $("alert").classList.remove("show"); }

let pending = false, retryT = null;
async function save(){
  A.updatedAt = new Date().toISOString();
  local.set(AID, A);
  try { await st.saveAttempt(AID, A); pending = false; }
  catch(e){ pending = true; clearTimeout(retryT); retryT = setTimeout(()=>{ if(pending) save(); }, 15000); }
}
window.addEventListener("online", ()=>{ if(pending) save(); });

// ---------- старт
async function start(){
  if (!/^[a-z0-9_-]{1,40}$/i.test(TID)) { $("app").innerHTML = `<div class="card">Посилання неповне. Попросіть у викладача правильне посилання.</div>`; return; }
  try {
    [SETTINGS, UID] = await Promise.all([st.getSettings(), st.studentInit()]);
  } catch(e){ $("app").innerHTML = `<div class="card">Не вдалося завантажити сторінку. Перевірте інтернет і оновіть сторінку.<br><span class="hint">${esc(e.message||e)}</span></div>`; return; }
  CFG = (SETTINGS.ai || {})[TID] || {};
  TRAIN = CFG.mode === "train";
  const names = CFG.topicNames || {};
  const tl = (CFG.topics || []).map(id => names[id]).filter(Boolean);
  TITLE = CFG.title || (tl.length === 1 ? tl[0] : TRAIN ? "Підготовка" : "Співбесіда");
  TLIST = (CFG.course ? esc(CFG.course) + (tl.length ? ": " : "") : "") + (tl.length > 8 ? `${tl.length} тем` : tl.map(esc).join("; "));
  $("htitle").textContent = (TRAIN ? "Підготовка · " : "Співбесіда · ") + TITLE;
  if (!CFG.open) { $("app").innerHTML = `<div class="card"><div class="tq">${esc(TITLE)}</div><p>Ця співбесіда зараз закрита.</p></div>`; return; }
  renderLogin();
}

function renderLogin(){
  const groups = (CFG.groups && CFG.groups.length ? CFG.groups : SETTINGS.groups) || [];
  const nq = CFG.nq || (TRAIN ? 10 : 6);
  if (TRAIN) { renderTrainLogin(groups, nq); return; }
  $("app").innerHTML = `<div class="card">
    <div class="hint">Співбесіда з ШІ-екзаменатором</div><div class="tq">${esc(TITLE)}</div><div class="hint" style="margin-bottom:10px">${TLIST}</div>
    <ol class="hint" style="padding-left:20px;margin:0">
      <li>ШІ поставить <b>${nq} ${nq % 10 >= 2 && nq % 10 <= 4 && (nq % 100 < 12 || nq % 100 > 14) ? "питання" : nq % 10 === 1 && nq % 100 !== 11 ? "питання" : "питань"}</b> за матеріалом ${(CFG.topics||[]).length > 1 ? "цих тем" : "лекції"} і може уточнювати ваші відповіді.</li>
      <li>Відповідайте <b>своїми словами</b>, як на усному занятті. Вставляти скопійований текст не можна.</li>
      ${CFG.minutes ? `<li>На всю співбесіду — <b>${CFG.minutes} хв</b>. Коли час мине, співбесіда завершиться автоматично.</li>` : ""}
      ${CFG.adaptive !== false ? `<li>Якщо питання здається складним — так і напишіть «не знаю» або «не зрозумів». ШІ запропонує <b>простіший варіант</b> (навідне питання або варіанти на вибір). Краще відповісти з підказкою, ніж не відповісти зовсім.</li>` : ""}
      ${CFG.annul !== false ? `<li><b>Не виходьте зі сторінки</b> під час питання (інша вкладка, програма, згорнутий браузер). Якщо вийти довше ніж на ${AWAY_LIMIT} с, <b>питання анулюється</b> і ШІ поставить інше. Після ${ANNUL_MAX} анулювань наступне питання, під час якого ви вийдете, <b>не зараховується</b> (0 балів). Перед початком закрийте зайві програми й вимкніть сповіщення; не давайте екрану телефона згаснути.</li>` : `<li>Перемикання на інші вкладки і програми фіксується.</li>`}
      <li>Якщо зник зв'язок чи світло, відкрийте посилання знову з <b>того самого пристрою і браузера</b>, введіть ті самі групу і ПІБ — продовжите з того ж місця${CFG.annul !== false ? " (питання, на якому сталася перерва, заміниться іншим; у ліміт анулювань це не рахується)" : ""}.</li>
    </ol>
    <div class="info" style="margin-top:14px">
      <b>⚠ Питання ставить штучний інтелект, а не викладач.</b>
      <ul style="margin:6px 0 0;padding-left:20px">
        <li>Співбесіду веде мовна модель Claude (компанія Anthropic). Вона ставить питання за лекціями курсу і пропонує <b>попередню</b> оцінку за критеріями.</li>
        <li><b>Остаточну оцінку виставляє викладач.</b> Він бачить увесь діалог і може змінити оцінку ШІ в будь-який бік.</li>
        <li>ШІ отримує лише текст ваших відповідей. Ваше прізвище, ім'я і група йому <b>не передаються</b>, вони зберігаються тільки в базі сайту. Відповіді не використовуються для навчання моделі.</li>
        <li>ШІ може помилятися. Якщо питання здалося некоректним або незрозумілим, так і напишіть у відповіді, а якщо не згодні з результатом — зверніться до викладача.</li>
        <li>Не пишіть у відповідях особистих даних (телефон, адресу тощо) — вони не потрібні.</li>
      </ul>
    </div>
    <label class="chk" style="margin:6px 0 4px"><input type="checkbox" id="agree"> Я ознайомився(-лася) і розумію, що співбесіду веде ШІ, а оцінку виставляє викладач</label>
    <label>Група</label><select id="grp"><option value="">— оберіть —</option>${groups.map(g=>`<option>${esc(g)}</option>`).join("")}</select>
    <label>Прізвище та ім'я</label>${st.nameField()}
    <div class="row" style="margin-top:16px"><span class="bad" id="regErr"></span><span class="sp"></span><button id="go">Почати / продовжити</button></div></div>`;
  $("go").onclick = login;

}

function renderTrainLogin(groups, nq){
  $("app").innerHTML = `<div class="card">
    <div class="hint">Підготовка до екзамену з ШІ-помічником</div><div class="tq">${esc(TITLE)}</div><div class="hint" style="margin-bottom:10px">${TLIST}</div>
    <ol class="hint" style="padding-left:20px;margin:0">
      <li>ШІ-помічник дасть <b>${nq} ${plural(nq, "завдання", "завдання", "завдань")}</b>${CFG.kinds && CFG.kinds.length ? ` (${CFG.kinds.map(k => ({ test: "тести", match: "на відповідність", task: "задачі" }[k])).filter(Boolean).join(", ")})` : ""}${EXAM_BANK ? " — такі, як будуть на екзамені" : " за лекціями курсу"}.</li>
      <li><b>Помилятися можна.</b> Якщо відповідь неправильна чи ви не знаєте — ШІ підкаже і допоможе дійти до правильної відповіді, а потім пояснить її.</li>
      <li>${(() => { const k = EXAM_BANK ? (CFG.kinds && CFG.kinds.length ? CFG.kinds : ["task"]) : ["block"];
        return [k.includes("test") ? "тест — відповідайте літерою (А, Б, В, Г)" : "", k.includes("match") ? "відповідність — парами «1–А, 2–В…»" : "",
          k.includes("task") ? "задачу розв'язуйте покроково: формула → числа → відповідь; якщо не знаєте, з чого почати, — так і напишіть, ШІ підкаже" : "",
          k.includes("block") ? "відповідайте своїми словами; не знаєте — напишіть «не знаю», ШІ підкаже" : ""].filter(Boolean).join("; ").replace(/^./, c => c.toUpperCase()); })()}.</li>
      <li>Це <b>тренування, оцінка не ставиться</b>. Викладач бачить лише, скільки завдань ви пройшли і що варто повторити.</li>
      <li>Тренуватися можна скільки завгодно: після завершення натисніть «Ще одне тренування» — завдання будуть інші.</li>
      <li>Якщо зник зв'язок чи світло, відкрийте посилання знову з того самого пристрою — продовжите з того ж місця.</li>
    </ol>
    <div class="info" style="margin-top:14px">
      <b>⚠ Завдання дає і пояснює штучний інтелект.</b>
      <ul style="margin:6px 0 0;padding-left:20px">
        <li>Помічник — мовна модель Claude (Anthropic). ${EXAM_BANK ? "Правильні відповіді він бере з банку екзаменаційних завдань викладача, а пояснення — з лекцій курсу." : "Питання і пояснення він бере з лекцій курсу."}</li>
        <li>ШІ отримує лише текст ваших відповідей; прізвище, ім'я і група йому <b>не передаються</b>. Відповіді не використовуються для навчання моделі.</li>
        <li>ШІ може помилитися в поясненні. Якщо щось здається неправильним — запитайте викладача.</li>
      </ul>
    </div>
    <label class="chk" style="margin:6px 0 4px"><input type="checkbox" id="agree"> Я ознайомився(-лася) і розумію, що завдання дає і пояснює ШІ</label>
    <label>Група</label><select id="grp"><option value="">— оберіть —</option>${groups.map(g=>`<option>${esc(g)}</option>`).join("")}</select>
    <label>Прізвище та ім'я</label>${st.nameField()}
    <div class="row" style="margin-top:16px"><span class="bad" id="regErr"></span><span class="sp"></span><button id="go">Почати / продовжити</button></div></div>`;
  $("go").onclick = login;
}
// тренування: шукаємо незавершену сесію або наступний вільний номер (base, base__s2, base__s3 …)
async function findSession(base){
  for (let k = 1; k <= 99; k++) {
    const id = k === 1 ? base : base + "__s" + k;
    let server; try { server = await st.getAttempt(id); } catch(e){ server = undefined; }
    if (server && server.__locked) return { id, locked: true };
    const loc = local.get(id);
    if (server === undefined && loc && !loc.done) return { id };
    if (!server && !(server === undefined && loc)) return { id };
    if (server && !server.done) return { id };
  }
  return { id: base + "__s" + Date.now() };
}

async function login(){
  let g = $("grp").value, n = $("nm").value.trim().replace(/\s+/g," ");
  const er = $("regErr");
  if (!$("agree").checked) { er.textContent = "Підтвердіть, що ознайомилися з умовами співбесіди."; return; }
  if (!g) { er.textContent = "Оберіть групу."; return; }
  if (!st.isUkrainian(n) || n.split(" ").length < 2) { er.textContent = "Введіть прізвище та ім'я українською."; return; }
  if (st.hasRosterFor(SETTINGS, g)) {
    er.textContent = "Перевіряємо…";
    const m = await st.matchName(SETTINGS, g, n);
    if (m.status === "none") { er.textContent = "Такого студента немає у списку групи. Перевірте групу і введіть прізвище та ім'я українською, як у журналі."; return; }
    if (m.status === "hint") {
      er.innerHTML = `Можливо, ви — ${m.names.map(x => `<button class="sm sec" data-pick="${esc(x)}">${esc(x)}</button>`).join(" ")}? Натисніть своє ім'я.`;
      er.querySelectorAll("[data-pick]").forEach(b => b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); $("nm").value = b.dataset.pick; login(); });
      return;
    }
    n = m.name;          // точне написання зі списку
  }
  er.textContent = "Зачекайте…"; $("go").disabled = true;
  GROUP = g; NAME = n;
  AID = st.attemptId("ai-"+TID, g, n);
  if (TRAIN) {
    const fsn = await findSession(AID);
    if (fsn.locked) { er.innerHTML = "Тренування вже розпочато на <b>іншому пристрої чи браузері</b>. Продовжіть там або попросіть викладача дозволити продовження тут."; $("go").disabled = false; return; }
    AID = fsn.id;
  }
  let server;
  try { server = await st.getAttempt(AID); } catch(e){ server = undefined; }
  if (server && server.__locked) { er.innerHTML = "Цю співбесіду ви вже почали на <b>іншому пристрої чи браузері</b>. Продовжіть там або попросіть викладача дозволити продовження тут."; $("go").disabled = false; return; }
  let loc = local.get(AID);
  if (server === null && loc && loc.done) loc = null;     // викладач дозволив пройти заново
  // беремо новішу копію (локальна може бути новішою, якщо зник зв'язок)
  A = server && loc ? ((loc.messages||[]).length > (server.messages||[]).length ? loc : server) : (server || loc);
  if (A && A.done) { if (TRAIN) { renderChat(); renderTrainDone(); } else renderDone(); return; }
  if (!A) {
    A = { topic: "ai-"+TID, t: TID, topics: CFG.topics || [], group: g, name: n, uid: UID, messages: [], sig: "", done: false, ...(TRAIN ? { mode: "train", session: AID.includes("__s") ? Number(AID.split("__s").pop()) || 2 : 1 } : {}),
          meta: { startedAt: new Date().toISOString(), blur: 0, pastes: 0, secs: [], aiNoticeAccepted: new Date().toISOString(), seed: Math.random().toString(36).slice(2, 12) } };
  }
  A.uid = UID; A.meta ||= { startedAt: new Date().toISOString(), blur: 0, pastes: 0, secs: [] };
  // сторінку закривали, поки чекало питання: перерва рахується як вихід зі сторінки
  const hid = Math.max((loc && loc.meta && loc.meta.hiddenAt) || 0, (server && server.meta && server.meta.hiddenAt) || 0);
  delete A.meta.hiddenAt;
  await save();
  renderChat();
  if (!A.messages.length) send(START);
  else if (A.messages.length % 2 === 0) {                               // останнє — питання ШІ, чекаємо відповідь
    askedAt = Date.now();
    const away = hid ? Math.round((Date.now() - hid) / 1000) : 0;
    if (away >= AWAY_LIMIT) onAway(away, true);
  }
  else send(null);                                                     // відповідь студента не дійшла — надсилаємо ще раз
}

// ---------- чат
function bubble(m, i){
  if (i === 0) return "";
  const text = m.role === "assistant" ? (m.content.split(/<eval>/i)[0].trim() || "Дякую! Співбесіду завершено.") : m.content;
  if (isSysMsg(m)) return `<div class="msg sys">${esc(text)}</div>`;
  return `<div class="msg ${m.role==="user"?"me":"ai"}">${esc(text)}</div>`;
}
function renderChat(){
  unwarn();
  $("app").innerHTML = `<div class="card">
    <div class="hint">${esc(TITLE)}</div>
    <div class="hint" style="margin-bottom:8px">${esc(A.name)} · ${esc(A.group)}${TRAIN && A.session > 1 ? ` · тренування № ${A.session}` : ""}</div>
    <div class="chat" id="chat">${A.messages.map(bubble).join("")}</div>
    <div class="composer" id="composer">
      <textarea id="ans" maxlength="${MAX_ANSWER}" placeholder="${TRAIN ? "Ваша відповідь (літера, пари або розв'язок)…" : "Ваша відповідь своїми словами…"}" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
      <div class="row" style="margin-top:8px"><span class="cnt" id="cnt">0 / ${MAX_ANSWER}</span><span class="bad" id="sendErr"></span><span class="sp"></span>
        <button id="send">Надіслати</button></div>
      <div class="hint" style="margin-top:6px">Ctrl+Enter — надіслати</div>
    </div></div>`;
  const ta = $("ans");
  if (!TRAIN) {
    ta.addEventListener("paste", noPaste); ta.addEventListener("drop", noPaste);
    ta.addEventListener("beforeinput", e => { if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") noPaste(e); });
  }
  ta.addEventListener("input", () => { $("cnt").textContent = `${ta.value.length} / ${MAX_ANSWER}`; try { localStorage.setItem("ai-draft:"+AID, ta.value); } catch(e){} });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); } });
  try { ta.value = localStorage.getItem("ai-draft:"+AID) || ""; $("cnt").textContent = `${ta.value.length} / ${MAX_ANSWER}`; } catch(e){}
  $("send").onclick = onSend;
  wake();
  startTimer();
  scrollEnd();
}
function noPaste(e){
  e.preventDefault();
  A.meta.pastes = (A.meta.pastes||0) + 1;
  $("sendErr").textContent = "Вставляти текст не можна — пишіть своїми словами.";
  setTimeout(()=>{ const s=$("sendErr"); if (s && s.textContent.startsWith("Вставляти")) s.textContent=""; }, 4000);
}
function scrollEnd(){ window.scrollTo(0, document.body.scrollHeight); }
function typing(on){
  const c = $("chat"); if (!c) return;
  const t = c.querySelector(".typing"); if (t) t.remove();
  if (on) { c.insertAdjacentHTML("beforeend", `<div class="typing"><i></i><i></i><i></i></div>`); scrollEnd(); }
}
function lockInput(on){ const b=$("send"), t=$("ans"); if (b) b.disabled = on; if (t) t.disabled = on; }

function onSend(){
  if (busy) return;
  const text = $("ans").value.trim();
  if (!text) { $("sendErr").textContent = "Напишіть відповідь."; return; }
  send(text);
}

// text: рядок — нове повідомлення; null — повторити надсилання останнього
async function send(text, finish = false){
  if (busy) return;
  busy = true; lockInput(true); $("sendErr") && ($("sendErr").textContent = "");
  if (text !== null) {
    if (text !== START) A.meta.secs.push(askedAt ? Math.max(1, Math.round((Date.now() - askedAt) / 1000)) : 0);
    A.messages.push({ role: "user", content: text });
    if (text !== START) $("chat").insertAdjacentHTML("beforeend", bubble(A.messages[A.messages.length-1], 1));
    try { localStorage.removeItem("ai-draft:"+AID); } catch(e){}
    $("ans").value = ""; $("cnt").textContent = `0 / ${MAX_ANSWER}`;
    await save();
  }
  typing(true);
  try {
    const r = await fetch(WORKER_URL.replace(/\/$/,"") + "/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: AI_SUBJECT, topic: TID, sid: AID, seed: A.meta.seed || "", messages: A.messages, sig: A.sig, finish: finish || timeIsUp(),
        annul: isSysMsg(A.messages[A.messages.length-1]), stats: { blur: A.meta.blur || 0, away: A.meta.away || [], secs: A.meta.secs || [] } })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || ("Помилка " + r.status)), { status: r.status });
    typing(false); net("");
    A.messages.push({ role: "assistant", content: d.reply });
    A.sig = d.sig;
    $("chat").insertAdjacentHTML("beforeend", bubble(A.messages[A.messages.length-1], 1));
    if (d.done) {
      A.done = true; A.eval = d.eval; A.score = d.eval ? d.eval.total : null;
      A.meta.finishedAt = new Date().toISOString();
      await save();
      if (TRAIN) { busy = false; renderTrainDone(); return; }
      setTimeout(renderDone, 1500);
      return;
    }
    await save();
    askedAt = Date.now();
    busy = false; lockInput(false); $("ans").focus(); scrollEnd();
  } catch(e){
    typing(false); busy = false;
    if (e.status) {
      // сервер відповів помилкою: повідомлення студента повертаємо в поле, щоб не втратити
      const last = A.messages[A.messages.length-1];
      if (last && isSysMsg(last)) { A.messages.pop(); A.meta.secs.pop(); const bs = $("chat").querySelectorAll(".msg.sys"); if (bs.length) bs[bs.length-1].remove(); }
      else if (last && last.role === "user" && last.content !== START) {
        A.messages.pop(); A.meta.secs.pop();
        const bs = $("chat").querySelectorAll(".msg.me"); if (bs.length) bs[bs.length-1].remove();
        $("ans").value = last.content;
      } else if (last && last.content === START) { A.messages.pop(); }
      await save();
      lockInput(false);
      $("sendErr").textContent = e.message;
    } else {
      // немає зв'язку: повідомлення збережено, пропонуємо повторити
      net("Немає зв'язку з сервером. Відповідь збережено.");
      $("sendErr").innerHTML = `Не вдалося надіслати. <button class="sm sec" id="retry">Надіслати ще раз</button>`;
      $("retry").onclick = () => send(null, finish);
    }
  }
}

// ---------- таймер
function deadline(){ return CFG.minutes ? new Date(A.meta.startedAt).getTime() + CFG.minutes * 60000 : 0; }
function timeIsUp(){ const d = deadline(); return !!d && Date.now() >= d; }
function startTimer(){
  clearInterval(timerId);
  if (!CFG.minutes) return;
  const el = $("timer"); el.style.display = "";
  const tick = () => {
    const left = Math.max(0, Math.round((deadline() - Date.now()) / 1000));
    el.textContent = `${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`;
    el.classList.toggle("low", left < 120);
    if (left === 0 && !finishing && !A.done) {
      finishing = true; clearInterval(timerId);
      const wait = setInterval(() => {
        if (busy) return;
        clearInterval(wait);
        if (A.messages.length % 2 === 0) { const t = ($("ans").value || "").trim(); send(t || "(час вичерпано, відповіді немає)", true); }
        else send(null, true);
      }, 500);
    }
  };
  tick(); timerId = setInterval(tick, 1000);
}

// ---------- кінець тренування: діалог лишається на екрані, знизу — кнопка нового тренування
function renderTrainDone(){
  clearInterval(timerId); $("timer").style.display = "none";
  const c = $("composer"); if (!c) return;
  const e = A.eval || {};
  c.innerHTML = `<div class="info" style="margin-top:8px"><b>Тренування завершено.</b>${e.n ? ` Самостійно: ${e.first || 0} з ${e.n}${e.hinted ? `, з підказкою: ${e.hinted}` : ""}.` : ""}
    ${e.review && e.review.length ? `<br>Що повторити: ${e.review.map(esc).join("; ")}.` : ""}</div>
    <div class="row" style="margin-top:10px"><span class="sp"></span><button id="again">Ще одне тренування</button></div>`;
  $("again").onclick = async () => {
    $("again").disabled = true; $("again").textContent = "Готуємо нові завдання…";
    const fsn = await findSession(st.attemptId("ai-"+TID, GROUP || A.group, NAME || A.name));
    AID = fsn.id; askedAt = 0;
    A = { topic: "ai-"+TID, t: TID, topics: CFG.topics || [], group: A.group, name: A.name, uid: UID, messages: [], sig: "", done: false, mode: "train",
          session: AID.includes("__s") ? Number(AID.split("__s").pop()) || 2 : 1,
          meta: { startedAt: new Date().toISOString(), blur: 0, pastes: 0, secs: [], aiNoticeAccepted: new Date().toISOString(), seed: Math.random().toString(36).slice(2, 12) } };
    await save(); renderChat(); send(START);
  };
  scrollEnd();
}

// ---------- кінець
function renderDone(){
  clearInterval(timerId); $("timer").style.display = "none";
  const e = A.eval;
  const show = CFG.showScore && e && !e.error;
  $("app").innerHTML = `<div class="card">
    <div class="tq">Співбесіду завершено</div>
    <p>Дякуємо! Ваші відповіді збережено і передано викладачу.</p>
    ${show ? `<p class="big">${e.total} / ${e.max}</p><p class="hint">Попередня оцінка ШІ. Остаточну оцінку виставляє викладач.</p>
      ${e.gaps && e.gaps.length ? `<p><b>Що варто повторити:</b></p><ul>${e.gaps.map(g=>`<li>${esc(g)}</li>`).join("")}</ul>` : ""}` : ""}
  </div>`;
}

// ---------- перемикання вкладок: облік виходів під час питань і анулювання
function isSysMsg(m){ return !!m && m.role === "user" && typeof m.content === "string" && m.content.startsWith("⛔"); }
function waitingAnswer(){ return A && !A.done && !busy && A.messages.length >= 2 && A.messages.length % 2 === 0; }
function currentQ(){
  for (let i = A.messages.length - 1; i >= 0; i--) {
    const m = A.messages[i];
    if (m.role !== "assistant") continue;
    const all = [...m.content.matchAll(/(?:Питання|Завдання)\s+(\d+)\s+з\s+\d+/g)];
    if (all.length) return Number(all[all.length - 1][1]);
  }
  return 1;
}
let hideAt = 0;
document.addEventListener("visibilitychange", () => {
  if (!A || A.done || !A.messages.length) return;
  if (document.hidden) {
    A.meta.blur = (A.meta.blur||0) + 1;
    hideAt = Date.now();
    if (!TRAIN && waitingAnswer()) A.meta.hiddenAt ||= hideAt;   // якщо сторінку закриють — врахуємо при поверненні
    save();
  } else {
    wake();
    if (!hideAt) return;
    const from = Math.max(hideAt, askedAt || 0);
    hideAt = 0;
    const away = Math.round((Date.now() - from) / 1000);
    delete A.meta.hiddenAt;
    if (waitingAnswer() && away >= 2) onAway(away, false);
    else save();
  }
});
// вихід під час питання: записуємо, а в співбесіді (не тренуванні) — анулюємо питання
function onAway(away, reopened){
  const q = currentQ();
  (A.meta.away ||= []).push({ q, s: away, at: new Date().toISOString(), m: A.messages.length, ...(reopened ? { r: 1 } : {}) });
  if (TRAIN || CFG.annul === false || away < AWAY_LIMIT || finishing) { save(); return; }
  const used = A.messages.filter(m => isSysMsg(m) && m.content.includes("анульовано: вихід")).length;
  const text = reopened ? `⛔ Питання ${q} анульовано: повторний вхід після перерви на ${away} с.`
    : used < ANNUL_MAX ? `⛔ Питання ${q} анульовано: вихід зі сторінки на ${away} с.`
    : `⛔ Питання ${q} не зараховано: вихід зі сторінки на ${away} с.`;
  A.meta.away[A.meta.away.length - 1].a = text.includes("не зараховано") ? "0" : "ан";
  const ta = $("ans"); if (ta) { ta.value = ""; $("cnt").textContent = `0 / ${MAX_ANSWER}`; }
  try { localStorage.removeItem("ai-draft:"+AID); } catch(e){}
  send(text);
}
// не даємо екрану телефона згаснути під час співбесіди (інакше це виглядало б як вихід зі сторінки)
let wakeLock = null;
async function wake(){
  try { if ("wakeLock" in navigator && !document.hidden && A && !A.done && (!wakeLock || wakeLock.released)) wakeLock = await navigator.wakeLock.request("screen"); } catch(e){}
}

start();
