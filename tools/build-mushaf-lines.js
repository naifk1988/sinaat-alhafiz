// الاستعمال: npm pack quran-qcf4@1.1.0 ثم فك الحزمة، ثم:
//   node tools/build-mushaf-lines.js <quran-qcf4>/package quran-data.js data.js mushaf-lines.js
// يبني تخطيط أسطر مصحف المدينة (15 سطراً) من بيانات quran-qcf4، مع ربط كل كلمة بنص QuranEnc المعتمد
const fs = require("fs");
const [qcfDir, quranData, dataJs, out] = process.argv.slice(2);
eval(fs.readFileSync(quranData, "utf8").replace(/const (\w+)/g, "global.$1"));
eval(fs.readFileSync(dataJs, "utf8").replace("const SURAHS", "global.SURAHS"));
const starts = []; { let c = 1; for (const s of SURAHS) { starts.push(c); c += s[1]; } }
const G = (s, a) => starts[s - 1] + a - 1;
const skel = (t) => String(t).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).normalize("NFC")
  .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ\u200B-\u200F#\d]/g, "")
  .replace(/[ٱأإآءؤئاويىۥۦ\s]/g, "").replace(/ة/g, "ه");

const pages = [];
const placed = new Set();
let problems = 0;
for (let p = 1; p <= 604; p++) {
  const j = JSON.parse(fs.readFileSync(`${qcfDir}/pages/${String(p).padStart(3, "0")}.json`, "utf8"));
  // تسلسل الرموز مع رقم السطر
  const toks = [];
  for (const l of j.lines) for (const w of l.words) toks.push({ ...w, line: l.line });
  pages.push({ p, lines: j.lines.map((l) => l.line), toks });
}
// مطابقة كلمات كل آية: رمز QCF أو رمزان متتاليان = كلمة واحدة في النص المعتمد
const wordLine = {}; // "p" -> map g:i -> line
const byAyah = {};
for (const pg of pages) for (const t of pg.toks) if (t.type === "word") (byAyah[t.verse_key] = byAyah[t.verse_key] || []).push({ t, p: pg.p });
const loc = {}; // `${g}:${i}` -> [page, line]
for (let s = 1; s <= 114; s++) for (let a = 1; a <= SURAHS[s - 1][1]; a++) {
  const enc = QURAN_TEXT[s - 1][a - 1].split(" ");
  const q = (byAyah[`${s}:${a}`] || []).filter((x) => !/^#/.test(x.t.text)); // علامة السجدة ليست كلمة
  let j = 0;
  for (let i = 0; i < enc.length; i++) {
    const target = skel(enc[i]);
    if (j < q.length && skel(q[j].t.text) === target) { loc[`${G(s, a)}:${i}`] = [q[j].p, q[j].t.line]; j++; continue; }
    if (j + 1 < q.length && skel(q[j].t.text + q[j + 1].t.text) === target) { loc[`${G(s, a)}:${i}`] = [q[j].p, q[j].t.line]; j += 2; continue; }
    problems++; if (problems < 15) console.error("unmatched", `${s}:${a}`, i, enc[i], q[j] && q[j].t.text, "|", target, q[j] && skel(q[j].t.text));
    j++;
  }
  if (j !== q.length) { problems++; if (problems < 15) console.error("leftover", `${s}:${a}`, j, q.length); }
}
// بناء أسطر كل صفحة: عنوان سورة، بسملة، أو مدى كلمات [g1,w1,g2,w2]
const layout = [];
for (const pg of pages) {
  const lines = {};
  for (const t of pg.toks) {
    const L = (lines[t.line] = lines[t.line] || []);
    if (t.type === "surah_header") L.push(["h", t.sura]);
    else if (t.type === "bismillah") L.push(["b"]);
  }
  layout.push({ p: pg.p, lines });
}
for (const [k, [p, line]] of Object.entries(loc)) {
  const [g, i] = k.split(":").map(Number);
  const L = (layout[p - 1].lines[line] = layout[p - 1].lines[line] || []);
  L.push([g, i]);
}
// علامات نهاية الآية: يجب أن تكون في سطر آخر كلمة من الآية
let endMoved = 0;
for (const pg of pages) for (const t of pg.toks) if (t.type === "end") {
  const [s, a] = t.verse_key.split(":").map(Number);
  const last = loc[`${G(s, a)}:${QURAN_TEXT[s - 1][a - 1].split(" ").length - 1}`];
  if (!last || last[0] !== pg.p || last[1] !== t.line) endMoved++;
}
const compact = layout.map(({ lines }) => {
  const nums = Object.keys(lines).map(Number).sort((x, y) => x - y);
  const maxL = Math.max(...nums);
  const outLines = [];
  for (let L = 1; L <= maxL; L++) {
    const items = lines[L] || [];
    if (!items.length) { outLines.push(0); continue; }
    if (items[0][0] === "h") { outLines.push(["h", items[0][1]]); continue; }
    if (items[0][0] === "b") { outLines.push(["b"]); continue; }
    const ws = items.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    outLines.push([ws[0][0], ws[0][1], ws[ws.length - 1][0], ws[ws.length - 1][1]]);
  }
  return outLines;
});
// تحقق: كل كلمة في النص لها موضع واحد، والمدى في كل سطر متصل
let total = 0; for (const s of QURAN_TEXT) for (const v of s) total += v.split(" ").length;
console.log("words placed", Object.keys(loc).length, "/", total, "problems", problems, "end-markers off-line", endMoved);
const pageStarts = compact.map((ls) => { for (const l of ls) if (Array.isArray(l) && typeof l[0] === "number") return l[0]; return null; });
fs.writeFileSync(out, `// تخطيط أسطر مصحف المدينة (طبعة 1441هـ، 15 سطراً) — مأخوذ من بيانات حزمة quran-qcf4@1.1.0 (رخصة MIT، صفحاتها JSON فقط دون الخطوط)
// كل صفحة مصفوفة أسطر: ["h", سورة] عنوان سورة، ["b"] بسملة، 0 سطر فارغ، [آية1, كلمة1, آية2, كلمة2] مدى كلمات (رقم الآية تراكمي، الكلمة من 0)
// ملف مولَّد آلياً، لا يُعدَّل يدوياً.
const MUSHAF_LINES = ${JSON.stringify(compact)};
const MUSHAF_LINE_PAGE_STARTS = ${JSON.stringify(pageStarts)};
`);
