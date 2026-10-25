// يولّد quran-data.js
// الاستعمال: npm pack quran-json@3.1.2 quran-meta@7.0.0 ثم فك الحزمتين، ثم:
//   node tools/build-quran-data.mjs <quran-json>/dist/quran.json <quran-meta>/dist/HafsLists-*.js quran-data.js
import fs from "node:fs";
const [quranJson, hafsLists, out] = process.argv.slice(2);
const q = JSON.parse(fs.readFileSync(quranJson, "utf8"));
const { t: H } = await import(hafsLists);
if (H.meta.numPages !== 604 || H.meta.numAyahs !== 6236) throw new Error("bad meta");
const text = q.map((s) => s.verses.map((v) => v.text));
const pages = H.PageList.slice(1, 605); // بدايات صفحات مصحف المدينة كما في Quran.com (604 صفحات)
const juz = H.JuzList.slice(1, 31);
const quarters = H.HizbQuarterList.slice(1, 241);
if (pages.length !== 604 || juz.length !== 30 || quarters.length !== 240) throw new Error("bad lists " + juz.length + " " + quarters.length);
const header = `// نص المصحف بالرسم العثماني (رواية حفص) — المصدر: موسوعة القرآن الكريم QuranEnc عبر حزمة quran-json@3.1.2 (رخصة CC BY-SA 4.0)
// بدايات الصفحات (ترقيم Quran.com) والأجزاء وأرباع الأحزاب — المصدر: حزمة quran-meta@7.0.0 (رخصة MIT). تخطيط الصفحات في mushaf-lines.js
// ملف مولَّد آلياً، لا يُعدَّل يدوياً.
`;
fs.writeFileSync(out, header +
  `const QURAN_TEXT = ${JSON.stringify(text)};\n` +
  `const QPC_PAGES = ${JSON.stringify(pages)};\n` +
  `const JUZ_STARTS = ${JSON.stringify(juz)};\n` +
  `const HIZB_QUARTERS = ${JSON.stringify(quarters)};\n`);
