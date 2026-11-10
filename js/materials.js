// Вкладка «Матеріали»: завантаження файлів, перевірка й редагування тексту, розбивка на блоки.
import * as st from "./store.js";
import { extractFile, toBlocks, kindOf } from "./extract.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const newId = () => "m" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
const MAX_DOC = 900000;                 // межа документа Firestore з запасом (≈1 МБ)
const WARN_TOTAL = 250000;              // довгий матеріал — дорожча співбесіда

let CTX, QUEUE = [], EDIT = null, BUSY = false;
// ctx: { app, mats, settings, warn, tabs, reload }
export function renderMaterials(ctx){
  CTX = ctx;
  if (EDIT) return renderEditor();
  const mats = ctx.mats, courses = [...new Set(mats.map(m => m.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk"));
  const used = usage();
  ctx.app.innerHTML = ctx.tabs() + `<div class="card"><h3 style="margin-top:0">Завантажити матеріал</h3>
    <p class="hint">PDF, Word (.docx), PowerPoint (.pptx), фото сторінок (.jpg, .png) або .txt. Текст витягується тут, у браузері. Сторінки-скани без тексту розпізнає ШІ (≈1–3 ¢ за 10 сторінок). Перед збереженням ви побачите текст і зможете його виправити.</p>
    <label>Предмет (курс)</label>
    <input type="text" id="mCourse" list="mCourses" placeholder="Напр.: Біологія" value="${esc(courses.length === 1 ? courses[0] : "")}">
    <datalist id="mCourses">${courses.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <label>Файли</label>
    <input type="file" id="mFiles" multiple accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,.txt">
    <label class="chk"><input type="checkbox" id="mSep" checked> Кожен файл — окремий матеріал (тема). Зніміть, щоб об'єднати файли в один матеріал — напр. фото кількох сторінок однієї лекції.</label>
    <label class="chk"><input type="checkbox" id="mOcr" checked> Розпізнавати скани і фото за допомогою ШІ</label>
    <div class="row" style="margin-top:10px"><span class="hint" id="mLog"></span><span class="sp"></span><button data-mact="process">Обробити файли</button></div></div>
    <div class="card"><h3 style="margin-top:0">Матеріали</h3>
    ${mats.length ? courses.concat(mats.some(m => !m.course) ? [""] : []).map(c => `<h4 style="margin:12px 0 4px">${esc(c || "Без предмета")}</h4>
      <table class="rep"><tr><th>Матеріал</th><th>Блоків</th><th>Обсяг</th><th>У співбесідах</th><th></th></tr>
      ${mats.filter(m => (m.course || "") === c).sort((a, b) => (a.title || "").localeCompare(b.title || "", "uk", { numeric: true })).map(m => `<tr>
        <td><b>${esc(m.title)}</b><br><span class="hint">${esc((m.src || []).join(", "))}</span></td><td>${(m.blocks || []).length}</td>
        <td>${Math.round((m.chars || 0) / 1000)} тис. симв.</td><td>${(used[m.id] || []).map(esc).join(", ") || '<span class="hint">—</span>'}</td>
        <td style="white-space:nowrap"><button class="sm sec" data-mact="edit" data-v="${m.id}">Переглянути / змінити</button> <button class="sm sec" data-mact="del" data-v="${m.id}">✕</button></td></tr>`).join("")}</table>`).join("")
      : '<p class="hint">Матеріалів ще немає. Завантажте перший файл вище.</p>'}</div>`;
}
function usage(){
  const u = {};
  Object.values((CTX.settings && CTX.settings.ai) || {}).forEach(c => (c && c.topics || []).forEach(t => (u[t] ||= []).push(c.title || "без назви")));
  return u;
}
const log = m => { const el = $("mLog"); if (el) el.textContent = m; };

async function process(){
  if (BUSY) return;
  const files = [...$("mFiles").files], course = $("mCourse").value.trim();
  if (!course) { CTX.warn("Вкажіть предмет (курс) — за ним матеріали групуються у співбесідах."); return; }
  if (!files.length) { CTX.warn("Оберіть файли."); return; }
  const bad = files.filter(f => !kindOf(f));
  if (bad.length) { CTX.warn("Не підтримується: " + bad.map(f => esc(f.name)).join(", ") + ". Старі .doc / .ppt збережіть як .docx / .pptx або PDF."); return; }
  const sep = $("mSep").checked, ocr = $("mOcr").checked;
  BUSY = true; document.querySelector('[data-mact="process"]').disabled = true;
  try {
    const results = [];
    for (const f of files) { const r = await extractFile(f, log, { ocr }); results.push({ f, ...r }); }
    const mk = list => {
      const segs = list.flatMap(r => list.length > 1 && !sep ? [{ title: "", text: "" }, ...r.segs] : r.segs).filter(s => s.text);
      // назва: заголовок 1-го рівня з Word, інакше — ім'я файлу
      const title = (list.length === 1 && list[0].title) || list[0].f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
      return { id: newId(), title, course, blocks: toBlocks(segs), src: list.map(r => r.f.name), notes: list.map(r => `${r.f.name}: ${r.note}`) };
    };
    QUEUE = sep ? results.map(r => mk([r])) : [mk(results)];
    const empty = QUEUE.filter(q => !q.blocks.length);
    QUEUE = QUEUE.filter(q => q.blocks.length);
    if (empty.length) CTX.warn("Не знайдено тексту в: " + empty.map(q => esc(q.src.join(", "))).join("; ") + (ocr ? "" : ". Можливо, це скан — увімкніть розпізнавання."));
    if (QUEUE.length) { EDIT = QUEUE.shift(); EDIT.isNew = true; renderEditor(); }
  } catch(e){ CTX.warn("Помилка обробки: " + esc(e.message || e)); }
  finally { BUSY = false; const b = document.querySelector('[data-mact="process"]'); if (b) b.disabled = false; log(""); }
}

// ---------- редактор матеріалу
function stats(){
  const n = EDIT.blocks.length, chars = EDIT.blocks.reduce((a, b) => a + b.text.length, 0);
  const short = EDIT.blocks.filter(b => b.text.length < 300).length, long = EDIT.blocks.filter(b => b.text.length > 6000).length;
  return { n, chars, short, long };
}
function statLine(){
  const s = stats();
  return `${s.n} блоків · ${Math.round(s.chars / 100) / 10} тис. символів${s.short ? ` · <span class="bad">коротких блоків (менше 300 симв.): ${s.short} — об'єднайте з сусідніми</span>` : ""}${s.long ? ` · <span class="bad">задовгих (понад 6000): ${s.long}</span>` : ""}${s.chars > WARN_TOTAL ? ` · <span class="bad">матеріал дуже великий — співбесіда буде дорожчою; краще розділити на кілька тем</span>` : ""}`;
}
function renderEditor(){
  const left = QUEUE.length;
  CTX.app.innerHTML = CTX.tabs() + `<div class="card">
    <div class="row"><h3 style="margin:0">${EDIT.isNew ? "Новий матеріал — перевірте текст" : "Матеріал"}</h3><span class="sp"></span>${left ? `<span class="hint">ще в черзі: ${left}</span>` : ""}</div>
    ${(EDIT.notes || []).length ? `<p class="hint">${EDIT.notes.map(esc).join("<br>")}</p>` : ""}
    <p class="hint">ШІ ставить питання з різних <b>блоків</b>, тож кожен блок має бути змістовною частиною теми (≈1–4 тис. символів) з назвою. Виправте помилки розпізнавання, видаліть зайве (титульна сторінка, зміст, список літератури), об'єднайте дрібні блоки.</p>
    <label>Назва матеріалу (теми)</label><input type="text" id="eTitle" value="${esc(EDIT.title)}">
    <label>Предмет (курс)</label><input type="text" id="eCourse" value="${esc(EDIT.course)}">
    <p id="eStat" class="hint" style="margin:10px 0">${statLine()}</p>
    <div id="eBlocks">${EDIT.blocks.map((b, i) => blockHtml(b, i)).join("")}</div>
    <div class="row" style="margin-top:8px"><button class="sm sec" data-mact="addBlock">+ Додати блок</button></div>
    <div class="row" style="margin-top:16px"><button class="sec" data-mact="cancel">${EDIT.isNew ? (left ? "Пропустити цей файл" : "Скасувати") : "← До списку"}</button><span class="sp"></span>${EDIT.isNew && left ? `<button class="sec" data-mact="saveAll" title="Зберегти цей і всі файли з черги одразу, з назвами з файлів. Перевірити й виправити текст можна згодом: «Переглянути / змінити».">Зберегти всі ${left + 1} без перегляду</button>` : ""}<button data-mact="save">Зберегти матеріал</button></div></div>`;
  CTX.app.querySelectorAll(".bt,.bx").forEach(el => el.addEventListener("input", () => { sync(); $("eStat").innerHTML = statLine(); const c = el.closest(".blk").querySelector(".bc"); if (c) c.textContent = el.closest(".blk").querySelector(".bx").value.length + " симв."; }));
}
function blockHtml(b, i){
  return `<div class="blk tp" data-i="${i}"><div class="row"><b>Блок ${i + 1}</b><span class="hint bc">${b.text.length} симв.</span><span class="sp"></span>
    ${i > 0 ? `<button class="sm sec" data-mact="merge" data-v="${i}" title="Додати цей блок у кінець попереднього">↑ Об'єднати з попереднім</button>` : ""}
    <button class="sm sec" data-mact="delBlock" data-v="${i}">✕</button></div>
    <input type="text" class="bt" placeholder="Назва блоку" value="${esc(b.title)}">
    <textarea class="bx" style="min-height:${Math.min(420, 80 + Math.round(b.text.length / 6))}px;font-size:14px;line-height:1.45">${esc(b.text)}</textarea></div>`;
}
function sync(){
  if (!$("eTitle")) return;
  EDIT.title = $("eTitle").value.trim(); EDIT.course = $("eCourse").value.trim();
  EDIT.blocks = [...CTX.app.querySelectorAll(".blk")].map(el => ({ title: el.querySelector(".bt").value.trim(), text: el.querySelector(".bx").value.trim() }));
}
// зберегти всі з черги одразу (напр., 60 параграфів підручника)
async function saveAll(){
  sync();
  const all = [EDIT, ...QUEUE];
  if (!confirm(`Зберегти ${all.length} матеріалів без перегляду? Перевірити кожен можна згодом кнопкою «Переглянути / змінити».`)) return;
  let ok = 0; const bad = [];
  for (const m of all) {
    const blocks = (m.blocks || []).filter(b => b.text).map((b, i) => ({ title: b.title || b.text.split("\n")[0].slice(0, 80) || `Частина ${i + 1}`, text: b.text }));
    const data = { title: m.title, course: m.course, blocks, src: m.src || [], chars: blocks.reduce((a, b) => a + b.text.length, 0), created: new Date().toISOString() };
    if (!m.title || !m.course || !blocks.length || JSON.stringify(data).length > MAX_DOC) { bad.push(m.title || (m.src || []).join(", ")); continue; }
    log(`Зберігаю ${ok + 1} з ${all.length}…`);
    try { await st.saveMaterial(m.id, data); ok++; } catch(e){ bad.push(m.title); }
  }
  QUEUE = []; EDIT = null;
  CTX.warn(`Збережено матеріалів: ${ok}${bad.length ? `. Не збережено: ${bad.map(esc).join(", ")}` : ""}`);
  await CTX.reload();
}
async function saveEdit(){
  sync();
  const blocks = EDIT.blocks.filter(b => b.text);
  if (!EDIT.title) { CTX.warn("Вкажіть назву матеріалу."); return; }
  if (!EDIT.course) { CTX.warn("Вкажіть предмет."); return; }
  if (!blocks.length) { CTX.warn("Немає жодного блоку з текстом."); return; }
  blocks.forEach((b, i) => { if (!b.title) b.title = b.text.split("\n")[0].slice(0, 80) || `Частина ${i + 1}`; });
  const data = { title: EDIT.title, course: EDIT.course, blocks, src: EDIT.src || [], chars: blocks.reduce((a, b) => a + b.text.length, 0), created: EDIT.created || new Date().toISOString() };
  if (JSON.stringify(data).length > MAX_DOC) { CTX.warn("Матеріал завеликий для одного документа (понад ≈900 тис. символів). Розділіть його на кілька матеріалів: видаліть частину блоків, збережіть, потім завантажте решту окремо."); return; }
  const used = usage()[EDIT.id];
  if (!EDIT.isNew && used && !confirm(`Цей матеріал використовується у співбесідах: ${used.join(", ")}. Зміни одразу діятимуть і в них. Зберегти?`)) return;
  try { await st.saveMaterial(EDIT.id, data); }
  catch(e){ CTX.warn("Не вдалося зберегти: " + esc(e.message || e)); return; }
  CTX.warn(`Матеріал «${esc(data.title)}» збережено ✓`);
  EDIT = QUEUE.length ? { ...QUEUE.shift(), isNew: true } : null;
  await CTX.reload();
}

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-mact]"); if (!b || !CTX) return;
  const act = b.dataset.mact, v = b.dataset.v;
  if (act === "process") return process();
  if (act === "edit") { const m = await st.getMaterial(v); if (!m) { CTX.warn("Матеріал не знайдено."); return; } EDIT = { id: v, ...m }; return renderEditor(); }
  if (act === "del") {
    const used = usage()[v], m = CTX.mats.find(x => x.id === v);
    if (used) { CTX.warn(`Матеріал використовується у співбесідах: ${used.map(esc).join(", ")}. Спершу приберіть його з них.`); return; }
    if (!confirm(`Видалити матеріал «${m ? m.title : v}»?`)) return;
    await st.deleteMaterial(v); await CTX.reload(); return;
  }
  if (!EDIT) return;
  if (act === "merge") { sync(); const i = +v; const a = EDIT.blocks[i - 1], c = EDIT.blocks[i]; a.text += "\n\n" + (c.title ? c.title + "\n" : "") + c.text; EDIT.blocks.splice(i, 1); return renderEditor(); }
  if (act === "delBlock") { sync(); EDIT.blocks.splice(+v, 1); return renderEditor(); }
  if (act === "addBlock") { sync(); EDIT.blocks.push({ title: "", text: "" }); renderEditor(); CTX.app.querySelector(".blk:last-child .bt").focus(); return; }
  if (act === "cancel") { EDIT = QUEUE.length ? { ...QUEUE.shift(), isNew: true } : null; return CTX.reload(); }
  if (act === "save") return saveEdit();
  if (act === "saveAll") return saveAll();
});
export const editing = () => !!EDIT;
