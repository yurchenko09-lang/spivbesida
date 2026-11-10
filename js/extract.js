// Витягування тексту з файлів у браузері викладача: PDF, Word (.docx), PowerPoint (.pptx), фото/скани.
// Звичайний текст береться безкоштовно прямо в браузері; сторінки без тексту (скани, фото)
// розпізнає ШІ через воркер (лише для викладача). Результат — список сегментів {title, text}.
import { WORKER_URL } from "./ai-config.js";
import * as st from "./store.js";

const LIBS = {
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
  jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
};
const loaded = {};
export function loadLib(k){
  return loaded[k] ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = LIBS[k]; s.onload = res; s.onerror = () => rej(new Error("Не вдалося завантажити бібліотеку " + k + " (перевірте інтернет)")); document.head.appendChild(s); });
}
const clean = t => String(t || "").replace(/­/g, "").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
export const kindOf = f => {
  const n = f.name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pptx")) return "pptx";
  if (/\.(jpe?g|png|webp)$/.test(n)) return "img";
  if (n.endsWith(".txt")) return "txt";
  return null;
};

// ---------- розпізнавання скану через воркер
async function ocr(dataUrl, hint){
  const r = await fetch(WORKER_URL.replace(/\/$/, "") + "/ocr", { method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + await st.idToken() },
    body: JSON.stringify({ image: dataUrl, hint: hint || "" }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ("Розпізнавання не вдалося: " + r.status));
  return clean(d.text);
}
// зображення → JPEG не більше maxW пікселів по ширині
async function toJpeg(src, maxW = 1600){
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Не вдалося відкрити зображення")); i.src = src; });
  const k = Math.min(1, maxW / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
const fileUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

// ---------- PDF
async function fromPdf(file, log, opt){
  await loadLib("pdf");
  const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const segs = []; let scans = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    log(`PDF «${file.name}»: сторінка ${i} з ${doc.numPages}`);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = "", lastY = null;
    for (const it of tc.items) {
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith("\n")) text += "\n";
      text += it.str; if (it.hasEOL) text += "\n";
      lastY = y;
    }
    text = clean(text);
    if (text.replace(/\s/g, "").length < 40 && opt.ocr) {           // сторінка без тексту — скан
      const vp = page.getViewport({ scale: 1 }), scale = Math.min(2.2, 1600 / Math.max(vp.width, vp.height));
      const v2 = page.getViewport({ scale }), c = document.createElement("canvas"); c.width = v2.width; c.height = v2.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: v2 }).promise;
      log(`PDF «${file.name}»: розпізнаю скан сторінки ${i}…`);
      text = await ocr(c.toDataURL("image/jpeg", 0.82), `сторінка ${i} документа ${file.name}`); scans++;
    }
    if (text) segs.push({ title: "", text, page: i });
  }
  return { segs, scans, note: `${doc.numPages} стор.${scans ? `, розпізнано сканів: ${scans}` : ""}` };
}

// ---------- Word
async function fromDocx(file, log, opt){
  await loadLib("mammoth");
  log(`Word «${file.name}»: читаю…`);
  const images = [];
  const res = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() },
    { convertImage: window.mammoth.images.imgElement(img => img.read("base64").then(b => { images.push("data:" + img.contentType + ";base64," + b); return { src: "" }; })) });
  const dom = new DOMParser().parseFromString(res.value, "text/html");
  const segs = []; let cur = { title: "", text: "" };
  const push = () => { if (clean(cur.text)) segs.push({ title: cur.title, text: clean(cur.text) }); };
  for (const el of dom.body.children) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) { push(); cur = { title: clean(el.textContent).slice(0, 120), text: "", head: true }; continue; }
    if (tag === "table") { cur.text += "\n" + [...el.querySelectorAll("tr")].map(tr => [...tr.children].map(td => clean(td.textContent)).join(" | ")).join("\n") + "\n"; continue; }
    if (tag === "ul" || tag === "ol") { cur.text += "\n" + [...el.querySelectorAll("li")].map(li => "• " + clean(li.textContent)).join("\n") + "\n"; continue; }
    const t = clean(el.textContent);
    // жирний короткий абзац без крапки — схоже на заголовок
    if (t && t.length < 90 && !/[.:;]$/.test(t) && el.querySelector("strong") && clean(el.querySelector("strong").textContent) === t) { push(); cur = { title: t, text: "" }; continue; }
    if (t) cur.text += "\n" + t;
  }
  push();
  let scans = 0;
  const textLen = segs.reduce((a, s) => a + s.text.length, 0);
  if (textLen < 300 && images.length && opt.ocr) {                  // у Word вставлено фото сторінок
    for (let i = 0; i < images.length; i++) {
      log(`Word «${file.name}»: розпізнаю зображення ${i + 1} з ${images.length}…`);
      const t = await ocr(await toJpeg(images[i]), `зображення ${i + 1} з документа ${file.name}`);
      if (t) segs.push({ title: "", text: t }); scans++;
    }
  }
  return { segs, scans, note: `${segs.length} розділів${scans ? `, розпізнано зображень: ${scans}` : ""}` };
}

// ---------- PowerPoint
async function fromPptx(file, log, opt){
  await loadLib("jszip");
  log(`PowerPoint «${file.name}»: читаю…`);
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const segs = []; let empty = 0, scans = 0;
  for (const [k, name] of slides.entries()) {
    const xml = new DOMParser().parseFromString(await zip.file(name).async("text"), "application/xml");
    const paras = [...xml.getElementsByTagName("a:p")].map(p => [...p.getElementsByTagName("a:t")].map(t => t.textContent).join("")).map(clean).filter(Boolean);
    const num = +name.match(/\d+/)[0];
    const noteF = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
    let notes = "";
    if (noteF) { const nx = new DOMParser().parseFromString(await noteF.async("text"), "application/xml");
      notes = [...nx.getElementsByTagName("a:p")].map(p => [...p.getElementsByTagName("a:t")].map(t => t.textContent).join("")).map(clean).filter(t => t && !/^\d+$/.test(t)).join("\n"); }
    if (!paras.length && opt.ocr) {                                  // слайд — картинка без тексту
      const rels = zip.file(`ppt/slides/_rels/slide${num}.xml.rels`);
      const media = rels ? [...(await rels.async("text")).matchAll(/Target="\.\.\/media\/([^"]+\.(?:png|jpe?g))"/gi)].map(m => "ppt/media/" + m[1]) : [];
      if (media.length) {
        log(`PowerPoint «${file.name}»: розпізнаю слайд ${k + 1}…`);
        const b = await zip.file(media[0]).async("base64");
        const t = await ocr(await toJpeg(`data:image/${/png$/i.test(media[0]) ? "png" : "jpeg"};base64,${b}`), `слайд ${k + 1} презентації ${file.name}`);
        if (t) { segs.push({ title: `Слайд ${k + 1}`, text: t }); scans++; continue; }
      }
    }
    if (!paras.length && !notes) { empty++; continue; }
    segs.push({ title: paras[0] ? paras[0].slice(0, 120) : `Слайд ${k + 1}`, text: [paras.slice(1).join("\n"), notes ? "Нотатки: " + notes : ""].filter(Boolean).join("\n") || paras[0], slide: true });
  }
  return { segs, scans, note: `${slides.length} слайдів${scans ? `, розпізнано слайдів-зображень: ${scans}` : ""}${empty ? `, без тексту пропущено: ${empty}` : ""}` };
}

// ---------- фото / текст
async function fromImage(file, log){ log(`Фото «${file.name}»: розпізнаю…`); const t = await ocr(await toJpeg(await fileUrl(file)), file.name); return { segs: t ? [{ title: "", text: t }] : [], scans: 1, note: "фото, розпізнано" }; }
async function fromTxt(file){ const t = clean(await file.text()); return { segs: t ? [{ title: "", text: t }] : [], scans: 0, note: "текст" }; }

export async function extractFile(file, log = () => {}, opt = { ocr: true }){
  const k = kindOf(file);
  if (k === "pdf") return fromPdf(file, log, opt);
  if (k === "docx") return fromDocx(file, log, opt);
  if (k === "pptx") return fromPptx(file, log, opt);
  if (k === "img") return fromImage(file, log);
  if (k === "txt") return fromTxt(file);
  throw new Error(`«${file.name}»: такий формат не підтримується. Можна PDF, Word (.docx), PowerPoint (.pptx), фото (.jpg, .png) або .txt. Старі .doc / .ppt збережіть у новому форматі.`);
}

// Сегменти → блоки для співбесіди: кожен блок 1–4 тис. символів, з назвою.
// ШІ бере питання з різних блоків, тому блоки мають бути змістовними частинами, а не окремими рядками.
export function toBlocks(segs, { min = 900, max = 4000 } = {}){
  const out = []; let cur = null;
  const firstLine = t => { const l = t.split("\n").find(x => x.trim().length > 3) || ""; return l.length > 90 ? l.slice(0, 87).replace(/\s+\S*$/, "") + "…" : l; };
  const flush = () => { if (cur && cur.text.trim()) { cur.text = clean(cur.text); cur.title ||= firstLine(cur.text); out.push(cur); } cur = null; };
  for (const s of segs) {
    const parts = s.text.length > max ? splitLong(s.text, max) : [s.text];
    parts.forEach((p, i) => {
      const title = i === 0 ? s.title : (s.title ? s.title + " (продовження)" : "");
      if (cur && (title && cur.text.length >= min || cur.text.length + p.length > max)) flush();
      if (!cur) cur = { title, text: "" };
      else if (title && !s.slide) cur.text += "\n\n" + title + "\n";
      else if (title && s.slide) cur.text += "\n\n[" + title + "]\n";
      cur.text += (cur.text ? "\n" : "") + p;
    });
  }
  flush();
  // хвостик, коротший за половину мінімуму, — до попереднього блоку
  if (out.length > 1 && out[out.length - 1].text.length < min / 2) { const t = out.pop(); out[out.length - 1].text += "\n\n" + (t.title ? t.title + "\n" : "") + t.text; }
  return out;
}
function splitLong(t, max){
  const paras = t.split(/\n+/), res = []; let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > max) { res.push(cur); cur = ""; }
    if (p.length > max) { for (let i = 0; i < p.length; i += max) res.push(p.slice(i, i + max)); continue; }
    cur += (cur ? "\n" : "") + p;
  }
  if (cur) res.push(cur);
  return res;
}
