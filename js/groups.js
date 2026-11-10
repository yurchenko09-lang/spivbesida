// Вкладка «Групи і списки»: назви груп (класів) і списки студентів з Excel, CSV, Word, тексту.
// Повний список бачить лише викладач; студентам сайт його не показує — лише звіряє введене ПІБ.
import * as st from "./store.js";
import { loadLib } from "./extract.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
let CTX, IMPORT = null;

const fixApos = s => s.replace(/[’ʼ`´‘]/g, "'");
const capWord = w => w.split("-").map(p => p ? p[0].toLocaleUpperCase("uk") + p.slice(1).toLocaleLowerCase("uk") : p).join("-");
function cleanPart(x){
  x = fixApos(String(x || "").replace(/\s+/g, " ").trim());
  return x.split(" ").map(w => (w === w.toLocaleUpperCase("uk") || w === w.toLocaleLowerCase("uk")) && /[a-zа-яіїєґ]/i.test(w) ? capWord(w) : w).join(" ");
}
const normName = n => st.attemptId("", "", n);
const G = () => CTX.settings.groups;
function mapGroup(code){
  const k = x => String(x).toLowerCase().replace(/[\s\-–—_.]/g, "");
  if (G().includes(code)) return { name: code, how: "exists" };
  let hits = G().filter(g => k(g) === k(code));
  if (!hits.length && /^\d+$/.test(code.trim())) hits = G().filter(g => (g.match(/\d+/g) || []).includes(code.trim()));
  if (hits.length === 1) return { name: hits[0], how: "mapped" };
  return { name: code, how: hits.length > 1 ? "ambiguous" : "new" };
}
const isWord = t => /^[A-Za-zА-Яа-яІіЇїЄєҐґ'’ʼ-]+$/.test(t);
// рядок → { group, sur, first } ; формати: «Група · № · Прізвище · Ім'я», «Прізвище Ім'я [По батькові]» (тоді група — обрана)
function parseLine(line, def){
  let p = line.split(/\t|;|\|/).map(x => x.trim()).filter(Boolean);
  if (p.length === 1) p = p[0].split(/\s+/);
  let group = null;
  if (p.length >= 3) {
    const m = mapGroup(p[0]), num = /^\d+[.)]?$/.test(p[0]);
    // перший стовпчик — група, якщо така група є, або це не слово і не просто номер (напр. «10-А»), або номер без обраної групи
    if (m.how === "exists" || m.how === "mapped" || (!isWord(p[0]) && !num) || (num && !def)) { group = p[0]; p = p.slice(1); }
  }
  p = p.filter(x => !/^\d+[.)]?$/.test(x)).map(x => x.replace(/^\d+[.)]\s*/, ""));   // номери «1», «1.», «1)»
  group ||= def;
  if (!group) return null;
  const words = p.join(" ").split(/\s+/).filter(Boolean);
  return { group, sur: words[0], first: words.slice(1).join(" ") };
}
function parseRoster(text, def, noPatr){
  const groups = {}, problems = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (/^(група|клас|group|№|п\/п|прізвище|піб)(?=[\s\t;,|]|$)/i.test(line.trim())) return;      // заголовок таблиці
    const r = parseLine(line, def);
    if (!r) { problems.push(`Рядок ${i + 1}: не вказано групу — оберіть групу для списку вище або додайте стовпчик з групою: «${line.trim()}»`); return; }
    let sur = cleanPart(r.sur), first = cleanPart(r.first);
    if (noPatr) first = first.split(" ")[0] || "";
    if (!sur || !first || !isWord(sur.replace(/ /g, ""))) { problems.push(`Рядок ${i + 1}: бракує прізвища чи імені — «${line.trim()}»`); return; }
    (groups[r.group] ||= []).push({ name: `${sur} ${first}`, line: i + 1 });
  });
  const result = Object.entries(groups).map(([code, list]) => {
    const warn = [], seen = new Map(), names = [];
    list.forEach(r => { const k = normName(r.name); if (seen.has(k)) { warn.push(`дубль «${r.name}» (рядки ${seen.get(k)} і ${r.line}) — пропущено`); return; } seen.set(k, r.line); names.push(r.name); });
    const g = mapGroup(code), old = CTX.roster[g.name] || [];
    const oldK = new Set(old.map(normName)), newK = new Set(names.map(normName));
    return { code, group: g.name, how: g.how, names, warn, added: names.filter(n => !oldK.has(normName(n))), removed: old.filter(n => !newK.has(normName(n))) };
  });
  return { groups: result, problems };
}

// файл → текст рядками (стовпці через табуляцію)
async function fileToText(f){
  const n = f.name.toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(n)) {
    await loadLib("xlsx");
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map(s => window.XLSX.utils.sheet_to_csv(wb.Sheets[s], { FS: "\t", blankrows: false })).join("\n");
  }
  if (n.endsWith(".docx")) {
    await loadLib("mammoth");
    const res = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    const dom = new DOMParser().parseFromString(res.value, "text/html"), out = [];
    for (const el of dom.body.children) {
      if (el.tagName === "TABLE") el.querySelectorAll("tr").forEach(tr => out.push([...tr.children].map(td => td.textContent.trim()).join("\t")));
      else if (el.tagName === "OL" || el.tagName === "UL") el.querySelectorAll("li").forEach(li => out.push(li.textContent.trim()));
      else out.push(el.textContent.trim());
    }
    return out.join("\n");
  }
  if (/\.(csv|txt)$/.test(n)) return (await f.text()).replace(/,/g, "\t");
  throw new Error("Підтримуються Excel (.xlsx), CSV, Word (.docx) або .txt");
}

async function persistRoster(){
  await st.saveRoster(CTX.roster);
  CTX.settings.rosterH = await st.buildRosterH(CTX.roster); delete CTX.settings.roster;
  await st.saveSettings(CTX.settings);
}

export function renderGroups(ctx){
  CTX = ctx;
  const R = ctx.roster, gs = G().slice().sort((a, b) => a.localeCompare(b, "uk", { numeric: true }));
  ctx.app.innerHTML = ctx.tabs() + `<div class="card"><h3 style="margin-top:0">Групи (класи)</h3>
    <p class="hint">Одна назва в рядку, напр. «10-А» чи «101-О». Ці назви студенти обирають при вході на співбесіду.</p>
    <textarea id="gList" style="min-height:110px">${esc(G().join("\n"))}</textarea>
    <div class="row" style="margin-top:8px"><span class="sp"></span><button class="sec" data-gact="saveGroups">Зберегти групи</button></div></div>
  <div class="card"><h3 style="margin-top:0">Завантажити список студентів</h3>
    <p class="hint">Файл Excel, CSV, Word чи .txt — або вставте текст. Підходять два формати: <b>«Прізвище Ім'я»</b> в кожному рядку (тоді оберіть групу нижче) або таблиця <b>«Група · № · Прізвище · Ім'я»</b> — одразу кілька груп. Нумерацію і заголовки сайт пропустить сам. Студенти вводять ПІБ самі, а сайт звіряє його зі списком; сам список вони не бачать. Повторне завантаження <b>замінює</b> список групи.</p>
    <label>Група для списку без стовпчика «Група»</label>
    <select id="gDef"><option value="">— група вказана в самому списку —</option>${gs.map(g => `<option>${esc(g)}</option>`).join("")}<option value="__new">+ нова група…</option></select>
    <input type="text" id="gNew" placeholder="Назва нової групи" style="display:none;margin-top:6px">
    <label>Файл</label><input type="file" id="gFile" accept=".xlsx,.xls,.ods,.csv,.docx,.txt">
    <label>Або вставте список</label>
    <textarea id="rosterIn" style="min-height:150px;font-family:ui-monospace,monospace;font-size:14px" placeholder="Бабакова Анастасія&#10;Гнатюк Олег&#10;…"></textarea>
    <label class="chk"><input type="checkbox" id="gNoPatr" checked> Не зберігати по батькові (лише «Прізвище Ім'я», як вводять студенти)</label>
    <div class="row" style="margin-top:8px"><span class="sp"></span><button class="sec" data-gact="check">Перевірити</button></div>
    <div id="rosterPrev"></div></div>
  <div class="card"><h3 style="margin-top:0">Поточні списки</h3>
    ${Object.keys(R).length ? Object.keys(R).sort((a, b) => a.localeCompare(b, "uk", { numeric: true })).map(g => `<details class="tp" data-g="${esc(g)}"><summary><b>${esc(g)}</b> — ${R[g].length} студ.${G().includes(g) ? "" : ' <span class="bad">(групи немає в переліку вище)</span>'}</summary>
      <p class="hint">Один студент у рядку: «Прізвище Ім'я».</p><textarea class="rl" style="min-height:200px">${esc(R[g].join("\n"))}</textarea>
      <div class="row" style="margin-top:6px"><button class="sm sec" data-gact="del" data-v="${esc(g)}">Видалити список</button><span class="sp"></span><button class="sm" data-gact="saveList" data-v="${esc(g)}">Зберегти</button></div></details>`).join("")
      : '<p class="hint">Списків ще немає. Поки списку групи немає, ПІБ студентів цієї групи не перевіряється.</p>'}</div>`;
  $("gDef").onchange = () => { $("gNew").style.display = $("gDef").value === "__new" ? "" : "none"; };
  $("gFile").onchange = async () => {
    const f = $("gFile").files[0]; if (!f) return;
    try { $("rosterIn").value = await fileToText(f); check(); } catch(e){ CTX.warn(esc(e.message || e)); }
  };
}
function defGroup(){ const v = $("gDef").value; return v === "__new" ? $("gNew").value.trim() : v; }
function check(){
  if ($("gDef").value === "__new" && !defGroup()) { CTX.warn("Вкажіть назву нової групи."); return; }
  IMPORT = parseRoster($("rosterIn").value, defGroup(), $("gNoPatr").checked);
  const { groups, problems } = IMPORT;
  if (!groups.length) { $("rosterPrev").innerHTML = `<p class="bad">Не знайдено жодного студента.</p>${problems.slice(0, 8).map(p => `<div class="hint">${esc(p)}</div>`).join("")}`; return; }
  $("rosterPrev").innerHTML = `<h4>Перевірка</h4>
    ${problems.length ? `<div class="alert show">${problems.slice(0, 12).map(esc).join("<br>")}${problems.length > 12 ? `<br>… і ще ${problems.length - 12}` : ""}</div>` : ""}
    <table class="rep"><tr><th>Група</th><th>Студентів</th><th>Зміни</th><th>Зауваження</th></tr>
    ${groups.map(g => `<tr><td><b>${esc(g.group)}</b><br><span class="hint">${g.how === "new" ? "нова група — буде додана" : g.how === "ambiguous" ? '<span class="bad">кілька груп з таким номером — вкажіть точну назву</span>' : g.how === "mapped" ? `«${esc(g.code)}» → наявна група` : "наявна група"}</span></td>
      <td>${g.names.length}</td>
      <td>${!CTX.roster[g.group] ? '<span class="hint">новий список</span>' : (g.added.length || g.removed.length) ? `${g.added.length ? `<span class="ok">+ ${g.added.map(esc).join(", ")}</span><br>` : ""}${g.removed.length ? `<span class="bad">− ${g.removed.map(esc).join(", ")}</span>` : ""}` : '<span class="hint">без змін</span>'}</td>
      <td>${g.warn.length ? g.warn.map(w => `<div class="bad" style="font-weight:400">${esc(w)}</div>`).join("") : '<span class="ok">✓</span>'}</td></tr>`).join("")}</table>
    <details style="margin-top:8px" open><summary class="hint" style="cursor:pointer">Як будуть записані імена</summary>${groups.map(g => `<p><b>${esc(g.group)}:</b> ${g.names.map(esc).join(", ")}</p>`).join("")}</details>
    <div class="row" style="margin-top:10px"><span class="sp"></span><button data-gact="apply">Зберегти ${groups.length > 1 ? `списки (${groups.length} групи)` : "список"}</button></div>`;
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-gact]"); if (!b || !CTX) return;
  const act = b.dataset.gact, v = b.dataset.v;
  try {
    if (act === "saveGroups") {
      const list = [...new Set($("gList").value.split("\n").map(s => s.trim()).filter(Boolean))];
      CTX.settings.groups = list; await st.saveSettings(CTX.settings); CTX.warn("Групи збережено ✓"); renderGroups(CTX);
    }
    if (act === "check") check();
    if (act === "apply" && IMPORT) {
      if (IMPORT.groups.some(g => g.how === "ambiguous")) { CTX.warn("Є неоднозначні назви груп — виправте їх у списку."); return; }
      const rem = IMPORT.groups.reduce((s, g) => s + g.removed.length, 0);
      if (rem && !confirm(`Із наявних списків буде видалено студентів: ${rem}. Їхні результати залишаться. Продовжити?`)) return;
      IMPORT.groups.forEach(g => { CTX.roster[g.group] = g.names; if (!G().includes(g.group)) G().push(g.group); });
      await persistRoster(); IMPORT = null; CTX.warn("Списки збережено ✓"); renderGroups(CTX);
    }
    if (act === "saveList") {
      const box = document.querySelector(`details[data-g="${CSS.escape(v)}"]`);
      const seen = new Set(), list = [], dup = [];
      box.querySelector(".rl").value.split("\n").map(cleanPart).filter(Boolean).forEach(n => {
        if (n.split(" ").length < 2) { dup.push(`«${n}» — потрібні прізвище та ім'я`); return; }
        const k = normName(n); if (seen.has(k)) { dup.push(`дубль «${n}»`); return; } seen.add(k); list.push(n);
      });
      if (dup.length && !confirm("Пропущено:\n" + dup.join("\n") + "\n\nЗберегти решту?")) return;
      CTX.roster[v] = list; await persistRoster(); CTX.warn("Збережено ✓"); renderGroups(CTX);
    }
    if (act === "del") {
      if (!confirm(`Видалити список групи ${v}? Студенти цієї групи вводитимуть ПІБ без перевірки. Результати не зміняться.`)) return;
      delete CTX.roster[v]; await persistRoster(); CTX.warn("Список видалено"); renderGroups(CTX);
    }
  } catch(err){ CTX.warn("Помилка: " + esc(err.message || err)); }
});
