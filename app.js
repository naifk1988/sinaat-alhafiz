"use strict";

/* ============ التخزين ============ */
const STORE_KEY = "halaqa-tracker-v1";
const DEFAULT_TEMPLATE =
`السلام عليكم ورحمة الله وبركاته
الأخ الكريم {الاسم} حفظه الله
نذكّرك بموعد {الحلقة}: {الموعد}
{الواجب}
{الأخطاء}
وفقك الله وجعلك من أهل القرآن.
{المعلم}`;
const DEFAULT_SESSION_TEMPLATE =
`السلام عليكم ورحمة الله وبركاته
{الاسم} حفظه الله
تقرير تسميع {التاريخ} — {الحلقة}
📖 {التسميع}
🎙️ الرواية: {الرواية}
⭐ التقدير: {التقدير}
{الأخطاء}
{الملاحظات}
{الواجب}
{الموعد}
{المعلم}`;

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const GRADES = ["ممتاز", "جيد جداً", "جيد", "مقبول", "يُعاد"];
const SESSION_TYPES = { hifz: "حفظ جديد", murajaa: "مراجعة", tathbit: "تثبيت" };
const MISTAKE_KINDS = ["نسيان/حفظ", "تشكيل", "تجويد", "تبديل كلمة", "تردد", "خلط بين الروايات", "أخرى"];
// القرّاء العشرة وراويا كل منهم
const QURRA = [
  ["نافع", ["قالون", "ورش"]], ["ابن كثير", ["البزي", "قنبل"]], ["أبو عمرو", ["الدوري", "السوسي"]],
  ["ابن عامر", ["هشام", "ابن ذكوان"]], ["عاصم", ["شعبة", "حفص"]], ["حمزة", ["خلف", "خلاد"]],
  ["الكسائي", ["أبو الحارث", "الدوري"]], ["أبو جعفر", ["ابن وردان", "ابن جماز"]],
  ["يعقوب", ["رويس", "روح"]], ["خلف العاشر", ["إسحاق", "إدريس"]]
];
const DEFAULT_RIWAYA = "حفص عن عاصم";

function emptyDb() {
  return {
    settings: {
      halaqaName: "صناعة الحافظ", teacherName: "", countryCode: "966", template: DEFAULT_TEMPLATE,
      sessionTemplate: DEFAULT_SESSION_TEMPLATE, repeatThreshold: 2,
      programName: "برنامج صناعة الحافظ", programDays: [0, 1, 2, 3], makeupDay: 4, dailyPages: 1, passMistakes: 0,
      teachers: [], supervisorName: "", supervisorPhone: "", examMax: 100
    },
    students: [], sessions: [], mistakes: [], notes: [], daily: [], sard: [], exams: []
  };
}

let db = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyDb();
    const data = JSON.parse(raw);
    const base = emptyDb();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  } catch (e) {
    console.error(e);
    return emptyDb();
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast("تعذّر الحفظ في المتصفح"); }
  syncSoon();
}

/* ============ أدوات مساعدة ============ */
const riwayaOf = (st) => (st && st.riwaya) || DEFAULT_RIWAYA;
function riwayaOptions(selected = DEFAULT_RIWAYA) {
  return QURRA.map(([qari, rawis]) => `<optgroup label="قراءة ${qari}">${rawis.map((r) => {
    const v = `${r} عن ${qari}`;
    return `<option ${v === selected ? "selected" : ""}>${v}</option>`;
  }).join("")}</optgroup>`).join("");
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const surahName = (n) => (SURAHS[n - 1] || ["؟"])[0];
const surahAyahs = (n) => (SURAHS[n - 1] || [0, 0])[1];

function todayStr(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });
}

// تطبيع الكلمة لمقارنة الأخطاء المتكررة: إزالة التشكيل وتوحيد الهمزات
function normalizeWord(w) {
  return String(w || "")
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ\u08F0-\u08F2ـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}
const timesAr = (n) => (n === 1 ? "مرة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`);
const mistakeKey = (m) => `${m.surah}|${m.ayah}|${normalizeWord(m.word)}`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function surahOptions(selected) {
  return SURAHS.map(([name, n], i) =>
    `<option value="${i + 1}" ${i + 1 === Number(selected) ? "selected" : ""}>${i + 1}. ${name} (${n})</option>`).join("");
}

/* ============ استعلامات البيانات ============ */
const getStudent = (id) => db.students.find((s) => s.id === id);
const studentSessions = (id) => db.sessions.filter((s) => s.studentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const studentMistakes = (id) => db.mistakes.filter((m) => m.studentId === id);
// التسميع الجاري (لم يُنهَ بعد) يُحفظ مسودة حتى يضغط الشيخ «إنهاء التسميع»
const finishedSessions = (id) => studentSessions(id).filter((s) => !s.draft);
const draftSession = (id) => studentSessions(id).find((s) => s.draft);
// نهاية المقطع؛ قد يمتد التسميع عبر أكثر من سورة
const sesEnd = (s) => [s.toSurah || s.surah, s.toAyah || s.fromAyah];
function rangeText(s) {
  const [ts, ta] = sesEnd(s);
  return ts === s.surah ? `${surahName(s.surah)} ${s.fromAyah}–${ta}` : `${surahName(s.surah)} ${s.fromAyah} ← ${surahName(ts)} ${ta}`;
}
function rangeLong(s) {
  const [ts, ta] = sesEnd(s);
  return ts === s.surah ? `سورة ${surahName(s.surah)} من آية ${s.fromAyah} إلى ${ta}`
    : `من سورة ${surahName(s.surah)} آية ${s.fromAyah} إلى سورة ${surahName(ts)} آية ${ta}`;
}

// تجميع أخطاء الطالب حسب الموضع (السورة + الآية + الكلمة)
function groupMistakes(list) {
  const groups = new Map();
  for (const m of list) {
    const k = mistakeKey(m);
    if (!groups.has(k)) groups.set(k, { key: k, surah: m.surah, ayah: m.ayah, word: m.word, items: [] });
    groups.get(k).items.push(m);
  }
  const out = [...groups.values()].map((g) => {
    g.items.sort((a, b) => b.date.localeCompare(a.date));
    g.count = g.items.length;
    g.lastDate = g.items[0].date;
    g.kinds = [...new Set(g.items.map((i) => i.kind))];
    g.resolved = g.items.every((i) => i.resolved);
    g.repeated = g.count >= db.settings.repeatThreshold;
    return g;
  });
  return out.sort((a, b) => (a.resolved - b.resolved) || (b.count - a.count) || b.lastDate.localeCompare(a.lastDate));
}

// الموعد القادم للطالب حسب أيام الحلقة ووقتها
function nextAppointment(st, from = new Date()) {
  if (!st.days || !st.days.length) return null;
  const [h, m] = (st.time || "00:00").split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m);
    if (st.days.includes(d.getDay()) && d > from) return d;
  }
  return null;
}
function fmtAppointment(d) {
  if (!d) return "لم يُحدَّد موعد";
  const today = todayStr(), tomorrow = todayStr(new Date(Date.now() + 864e5));
  const day = todayStr(d) === today ? "اليوم" : todayStr(d) === tomorrow ? "غداً" : "";
  const name = d.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });
  return `${day ? day + " " : ""}${name} الساعة ${time}`;
}

function hifzAyahCount(id) {
  // عدد الآيات المحفوظة (بدون تكرار) من جلسات الحفظ الجديد
  const set = new Set();
  for (const s of db.sessions) {
    if (s.studentId !== id || s.type !== "hifz" || s.draft) continue;
    const end = toGlobal(...sesEnd(s));
    for (let g = toGlobal(s.surah, s.fromAyah); g <= end; g++) set.add(g);
  }
  return set.size;
}

/* ============ رسالة التذكير ============ */
function buildMessage(st, opts = {}) {
  const s = db.settings;
  const { includeMistakes = true, includeAssignment = true, onlyRepeated = false, extra = "" } = opts;
  const last = finishedSessions(st.id)[0];
  const assignment = includeAssignment && last && last.assignment ? `الواجب المطلوب: ${last.assignment}` : "";

  let mistakesText = "";
  if (includeMistakes) {
    const groups = groupMistakes(studentMistakes(st.id)).filter((g) => !g.resolved && (!onlyRepeated || g.repeated)).slice(0, 10);
    if (groups.length) {
      mistakesText = "مواضع تحتاج إلى مراجعة وتثبيت:\n" + groups.map((g) =>
        `• ${surahName(g.surah)} آية ${g.ayah}${g.word ? `: «${g.word}»` : ""} (${g.kinds.join("، ")})${g.count > 1 ? ` — تكرر ${timesAr(g.count)}` : ""}`
      ).join("\n");
    }
  }

  return fillTemplate(s.template, st, {
    "{الموعد}": fmtAppointment(nextAppointment(st)),
    "{الواجب}": assignment,
    "{الأخطاء}": mistakesText
  }, extra);
}

function fillTemplate(template, st, vars, extra = "") {
  const s = db.settings;
  const all = {
    "{الاسم}": st.name,
    "{الحلقة}": s.halaqaName || "الحلقة",
    "{الرواية}": riwayaOf(st),
    "{المعلم}": (teacherOf(st) || {}).name || s.teacherName ? `معلمك: ${(teacherOf(st) || {}).name || s.teacherName}` : "",
    ...vars
  };
  // السطر الذي ليس فيه إلا متغير فارغ يُحذف كله
  let text = template.split("\n").filter((l) => !(l.trim() in all) || all[l.trim()]).join("\n");
  for (const [k, v] of Object.entries(all)) text = text.replaceAll(k, v);
  if (extra.trim()) text += "\n" + extra.trim();
  // حذف الأسطر الفارغة المتتالية الناتجة عن المتغيرات الفارغة
  return text.split("\n").filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim())).join("\n").trim();
}

/* ============ رسالة الجلسة ============ */
// أخطاء التسميع: المرتبطة به، ومعها ما سُجّل بلا ربط في اليوم نفسه إن لم يكن للطالب تسميع آخر ذلك اليوم
function sessionMistakes(ses) {
  const sameDay = db.sessions.filter((x) => x.studentId === ses.studentId && x.date === ses.date).length;
  return db.mistakes
    .filter((m) => m.sessionId === ses.id || (!m.sessionId && sameDay === 1 && m.studentId === ses.studentId && m.date === ses.date))
    .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah || (a.wordIndex ?? 0) - (b.wordIndex ?? 0));
}

// عدد مرات الخطأ في الموضع نفسه حتى تاريخ معيّن (شاملاً)
function occurrencesUntil(m, date) {
  const k = mistakeKey(m);
  return db.mistakes.filter((x) => x.studentId === m.studentId && x.date <= date && mistakeKey(x) === k).length;
}

function buildSessionMessage(st, ses, opts = {}) {
  const { includeNotes = true, includeAssignment = true, includeAppointment = true, extra = "" } = opts;
  const ms = sessionMistakes(ses);
  let mistakesText;
  if (ms.length) {
    mistakesText = `📌 الأخطاء (${ms.length}):\n` + ms.map((m, i) => {
      const n = occurrencesUntil(m, ses.date);
      return `${i + 1}. ${surahName(m.surah)} آية ${m.ayah}${m.word ? `: «${m.word}»` : " (الآية كاملة)"} — ${m.kind}` +
        `${m.note ? ` (${m.note})` : ""}${n > 1 ? ` ⚠️ تكرر ${timesAr(n)}` : ""}`;
    }).join("\n");
  } else {
    mistakesText = "✅ لا أخطاء في هذا التسميع، بارك الله فيك.";
  }
  const appt = nextAppointment(st);
  return fillTemplate(db.settings.sessionTemplate || DEFAULT_SESSION_TEMPLATE, st, {
    "{التاريخ}": fmtDate(ses.date),
    "{التسميع}": `${SESSION_TYPES[ses.type] || "تسميع"}: ${rangeLong(ses)}`,
    "{التقدير}": ses.grade || "",
    "{الأخطاء}": mistakesText,
    "{الملاحظات}": includeNotes && ses.notes ? `📝 ملاحظات الشيخ: ${ses.notes}` : "",
    "{الواجب}": includeAssignment && ses.assignment ? `📚 الواجب القادم: ${ses.assignment}` : "",
    "{الموعد}": includeAppointment && appt ? `🗓️ موعدك القادم: ${fmtAppointment(appt)}` : ""
  }, extra);
}

function normalizePhone(phone) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.startsWith("0")) return (db.settings.countryCode || "") + p.slice(1);
  return p;
}
const waLink = (phone, text) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
const smsLink = (phone, text) => `sms:${String(phone).replace(/[^\d+]/g, "")}?body=${encodeURIComponent(text)}`;

/* ============ النوافذ المنبثقة ============ */
const dlg = $("#dlg");
// النموذج نفسه يُعاد استخدامه، لذا تُسند المعالجات بالتعيين لا بـ addEventListener حتى لا تتراكم
function openDialog(html, onSubmit, onClick = null) {
  const form = $("#dlg-form");
  form.innerHTML = html;
  form.onclick = onClick;
  form.onchange = form.oninput = null;
  form.onsubmit = (e) => {
    e.preventDefault();
    if (onSubmit(new FormData(form), form, e.submitter) !== false) dlg.close();
  };
  $$("[data-close]", form).forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.showModal();
  return form;
}
const dlgActions = (label = "حفظ") =>
  `<div class="dlg-actions"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">${label}</button></div>`;

function studentForm(st = {}) {
  const days = st.days || (st.id ? [] : programDays());
  openDialog(`
    <h2>${st.id ? "تعديل بيانات الطالب" : "إضافة طالب"}</h2>
    <label><span>اسم الطالب</span><input name="name" required value="${esc(st.name)}"></label>
    <label><span>جوال الطالب (للواتساب)</span><input name="phone" type="tel" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(st.phone)}"></label>
    ${studentProgramFields(st)}
    <details class="more"><summary>خيارات إضافية</summary>
      <label><span>جوال ولي الأمر</span><input name="guardianPhone" type="tel" inputmode="tel" value="${esc(st.guardianPhone)}"></label>
      <label><span>أيام الحلقة</span>
        <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div>
      </label>
      <div class="grid2">
        <label><span>الرواية التي يقرأ بها</span><select name="riwaya">${riwayaOptions(riwayaOf(st))}</select></label>
        <label><span>وقت الحلقة</span><input name="time" type="time" value="${esc(st.time || "16:00")}"></label>
      </div>
      ${studentDirectionField(st)}
      <label><span>ملاحظات عامة</span><textarea name="notes">${esc(st.notes)}</textarea></label>
    </details>
    ${dlgActions(st.id ? "حفظ" : cloudActive() ? "حفظ وإرسال رابط الدخول 📤" : "حفظ")}`, (fd) => {
    const data = {
      name: fd.get("name").trim(), phone: fd.get("phone").trim(), guardianPhone: fd.get("guardianPhone").trim(),
      days: fd.getAll("days").map(Number), time: fd.get("time"), riwaya: fd.get("riwaya"), notes: fd.get("notes").trim(),
      ...readStudentProgramFields(fd), updatedAt: Date.now()
    };
    let invite = null;
    if (st.id) { Object.assign(st, data); setTeacher(st, fd.get("teacherId")); }
    else {
      const n = { id: uid(), createdAt: Date.now(), ...data, teacherId: fd.get("teacherId") };
      // مع المزامنة: يُنشأ رمز الطالب تلقائياً ويُرسل له رابط دخول مباشر
      if (cloudActive()) { n.loginCode = newCode(); invite = n.id; }
      db.students.push(n); location.hash = `#/student/${n.id}`;
    }
    save(); render(); toast("تم الحفظ");
    if (invite) setTimeout(() => inviteDialog(invite));
  });
}

// خيارات بشكل أزرار (بدل القوائم) لتسريع الإدخال
function chips(name, options, selected) {
  return `<div class="chips">${options.map(([v, label]) =>
    `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}" ${v === selected ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>`;
}

// ورقة إنهاء التسميع: كل شيء معبأ مسبقاً، ويكفي الضغط على «حفظ»
function finishSheet(ses, { afterSave } = {}) {
  const st = getStudent(ses.studentId);
  const ms = sessionMistakes(ses);
  const [ts, ta] = sesEnd(ses);
  const prev = finishedSessions(st.id).find((x) => x.id !== ses.id);
  const type = ses.type || (prev ? prev.type : "hifz");
  const form = openDialog(`
    <h2>${ses.draft ? "إنهاء التسميع" : "تعديل التسميع"} — ${esc(st.name)}</h2>
    <div class="sheet-summary">
      <div class="row between"><b>📖 ${rangeText({ ...ses, toSurah: ts, toAyah: ta })}</b>
        <button type="button" class="btn sm" data-edit-range>تعديل المقطع</button></div>
      <div class="range-edit" hidden>
        <div class="grid2">
          <label><span>من سورة</span><select name="surah">${surahOptions(ses.surah)}</select></label>
          <label><span>آية</span><input name="fromAyah" type="number" min="1" value="${ses.fromAyah}"></label>
          <label><span>إلى سورة</span><select name="toSurah">${surahOptions(ts)}</select></label>
          <label><span>آية</span><input name="toAyah" type="number" min="1" value="${ta}"></label>
        </div>
        <label><span>التاريخ</span><input name="date" type="date" value="${esc(ses.date)}"></label>
      </div>
      <div class="small" style="margin-top:6px">${ms.length
        ? `الأخطاء (${ms.length}): ${ms.map((m) => `<span class="badge warn">${m.word ? `<span class="qw">${esc(m.word)}</span>` : `آية ${m.ayah} كاملة`}</span>`).join(" ")}`
        : `<span class="badge ok">✅ بلا أخطاء</span>`}</div>
    </div>
    <p class="field-label">النوع</p>
    ${chips("type", Object.entries(SESSION_TYPES), type)}
    <p class="field-label">التقدير</p>
    ${chips("grade", GRADES.map((g) => [g, g]), ses.grade || (ms.length === 0 ? "ممتاز" : ms.length <= 2 ? "جيد جداً" : ms.length <= 5 ? "جيد" : "مقبول"))}
    <label style="margin-top:12px"><span>ملاحظات الشيخ للطالب (اختياري، تُرسل معه)</span><textarea name="notes" placeholder="مثال: أحسنت في المدود، انتبه للغنة">${esc(ses.notes || "")}</textarea></label>
    <label><span>الواجب القادم (اختياري)</span><input name="assignment" value="${esc(ses.assignment || "")}"></label>
    <label><span>ملاحظة خاصة بالشيخ (لا تُرسل)</span><input name="privateNote" value="${esc(ses.privateNote || "")}"></label>
    <div class="dlg-actions">
      <button type="button" class="btn" data-close>رجوع</button>
      <button class="btn primary">حفظ</button>
      <button class="btn whatsapp" data-send-after>حفظ وإرسال 📤</button>
    </div>`, (fd, f, submitter) => {
    const surah = Number(fd.get("surah")), fromAyah = Number(fd.get("fromAyah"));
    const toSurah = Number(fd.get("toSurah")), toAyah = Number(fd.get("toAyah"));
    if (!fromAyah || fromAyah > surahAyahs(surah) || !toAyah || toAyah > surahAyahs(toSurah)) {
      $(".range-edit", f).hidden = false;
      toast("تحقق من أرقام الآيات في المقطع"); return false;
    }
    if (toGlobal(toSurah, toAyah) < toGlobal(surah, fromAyah)) {
      $(".range-edit", f).hidden = false;
      toast("نهاية المقطع قبل بدايته"); return false;
    }
    Object.assign(ses, {
      date: fd.get("date") || ses.date, type: fd.get("type"), grade: fd.get("grade"),
      surah, fromAyah, toSurah, toAyah,
      notes: fd.get("notes").trim(), assignment: fd.get("assignment").trim(), privateNote: fd.get("privateNote").trim()
    });
    // تاريخ أخطاء التسميع يتبع تاريخه
    db.mistakes.forEach((m) => { if (m.sessionId === ses.id) m.date = ses.date; });
    delete ses.draft;
    save();
    toast("تم حفظ التسميع");
    if (afterSave) afterSave(); else render();
    if (submitter && "sendAfter" in submitter.dataset) setTimeout(() => sessionSendDialog(ses.id));
  }, (e) => {
    if (e.target.closest("[data-edit-range]")) {
      const box = $(".range-edit", form);
      box.hidden = !box.hidden;
    }
  });
}

// نافذة إرسال عامة: معاينة نص قابل للتعديل ثم واتساب أو SMS أو نسخ
function messageDialog(st, { title, toggles = [], build, onSent }) {
  const hasPhone = st.phone || st.guardianPhone;
  const form = openDialog(`
    <h2>${title}</h2>
    ${toggles.length ? `<div class="row small">${toggles.map((t) =>
      `<label class="row" style="margin:0"><input type="checkbox" name="${t.name}" ${t.checked ? "checked" : ""} style="width:auto;min-height:0"> ${t.label}</label>`).join("")}</div>` : ""}
    <label style="margin-top:10px"><span>إرسال إلى</span>
      <select name="to">
        ${st.phone ? `<option value="phone">الطالب (${esc(st.phone)})</option>` : ""}
        ${st.guardianPhone ? `<option value="guardianPhone">ولي الأمر (${esc(st.guardianPhone)})</option>` : ""}
      </select></label>
    <label><span>نص الرسالة (يمكنك تعديله)</span><textarea name="text" rows="12" style="min-height:260px"></textarea></label>
    ${hasPhone ? "" : `<p class="badge warn">لا يوجد رقم جوال لهذا الطالب — أضفه من البيانات، أو انسخ الرسالة</p>`}
    <div class="row">
      ${hasPhone ? `<a class="btn whatsapp" data-send="wa" target="_blank" rel="noopener" href="#">واتساب</a><a class="btn" data-send="sms" href="#">رسالة SMS</a>` : ""}
      <button type="button" class="btn" data-send="copy">نسخ</button>
      <span class="grow"></span>
      <button type="button" class="btn" data-close>إغلاق</button>
    </div>`, () => false);
  const refresh = () => {
    const opts = {};
    for (const t of toggles) opts[t.name] = $(`[name=${t.name}]`, form).checked;
    $("[name=text]", form).value = build(opts);
  };
  // روابط الإرسال تتحدث مع كل تعديل في النص أو المستلم
  const updateLinks = () => {
    const text = $("[name=text]", form).value;
    const phone = st[$("[name=to]", form).value] || st.phone || st.guardianPhone;
    const wa = $("[data-send=wa]", form), sms = $("[data-send=sms]", form);
    if (wa) wa.href = waLink(phone, text);
    if (sms) sms.href = smsLink(phone, text);
  };
  toggles.forEach((t) => $(`[name=${t.name}]`, form).addEventListener("change", () => { refresh(); updateLinks(); }));
  $("[name=text]", form).addEventListener("input", updateLinks);
  $("[name=to]", form).addEventListener("change", updateLinks);
  refresh();
  updateLinks();
  form.onclick = async (e) => {
    const mode = e.target.closest("[data-send]")?.dataset.send;
    if (!mode) return;
    if (mode === "copy") {
      const text = $("[name=text]", form).value;
      try { await navigator.clipboard.writeText(text); toast("تم نسخ الرسالة"); }
      catch { $("[name=text]", form).select(); document.execCommand("copy"); toast("تم النسخ"); }
      return;
    }
    // الرابط نفسه يفتح واتساب أو الرسائل؛ هنا نسجّل الإرسال فقط
    if (onSent) { onSent(); save(); }
    setTimeout(() => { dlg.close(); render(); }, 300);
  };
}

// تأكيد داخل التطبيق (نوافذ confirm في المتصفح لا تعمل في كل البيئات)
function confirmDialog(message, onYes, yesLabel = "حذف") {
  openDialog(`
    <h2>${esc(message)}</h2>
    <div class="dlg-actions"><button type="button" class="btn" data-close>إلغاء</button><button class="btn danger solid">${yesLabel}</button></div>`,
  () => { onYes(); });
}

function backupDialog() {
  const json = JSON.stringify(db);
  let href = "";
  try { href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: "application/json" })); } catch {}
  const form = openDialog(`
    <h2>نسخة احتياطية</h2>
    <p class="small muted">انسخ النص واحفظه في مكان آمن (رسالة لنفسك في واتساب أو ملاحظة)، أو نزّله ملفاً. تستعيده لاحقاً من «استعادة».</p>
    <textarea name="backup" readonly style="min-height:120px;font-family:monospace;font-size:.75rem" dir="ltr">${esc(json)}</textarea>
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn primary" data-copy>نسخ النص</button>
      ${href ? `<a class="btn" href="${href}" download="halaqa-backup-${todayStr()}.json">تنزيل ملف</a>` : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>إغلاق</button>
    </div>`, () => false, async (e) => {
    if (!e.target.closest("[data-copy]")) return;
    try { await navigator.clipboard.writeText(json); toast("تم نسخ النسخة الاحتياطية"); }
    catch { $("[name=backup]", form).select(); document.execCommand("copy"); toast("تم النسخ"); }
  });
}

// دمج نسخة من جهاز آخر (معلم آخر مثلاً): تُضاف السجلات الجديدة، ويُؤخذ الأحدث عند التعارض
const stamp = (x) => x.updatedAt || x.createdAt || 0;
function mergeData(data) {
  for (const k of ["students", "sessions", "mistakes", "notes", "daily", "sard", "exams"]) {
    const map = new Map((db[k] || []).map((x) => [x.id, x]));
    for (const x of data[k] || []) if (!map.has(x.id) || stamp(x) > stamp(map.get(x.id))) map.set(x.id, x);
    db[k] = [...map.values()];
  }
  const ts = new Map(teachers().map((t) => [t.id, t]));
  for (const t of (data.settings && data.settings.teachers) || []) if (!ts.has(t.id)) ts.set(t.id, t);
  db.settings.teachers = [...ts.values()];
}

function restoreData(text, merge = false) {
  let data;
  try { data = JSON.parse(text); if (!Array.isArray(data.students)) throw 0; }
  catch { toast("النص أو الملف ليس نسخة احتياطية صالحة"); return; }
  if (merge) {
    return confirmDialog(`دمج النسخة (${data.students.length} طالب) مع البيانات الحالية؟`, () => {
      mergeData(data); save(); render(); toast("تم الدمج");
    }, "دمج");
  }
  confirmDialog(`استبدال البيانات الحالية بالنسخة المستعادة (${data.students.length} طالب)؟`, () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    const base = emptyDb();
    db = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
    save(); render(); toast("تمت الاستعادة");
  }, "استعادة");
}

function restoreDialog() {
  const form = openDialog(`
    <h2>استعادة نسخة احتياطية</h2>
    <label><span>اختر ملف النسخة</span><input type="file" id="restore-file" accept="application/json,.json"></label>
    <label><span>أو الصق نص النسخة هنا</span><textarea name="paste" dir="ltr" style="font-family:monospace;font-size:.75rem"></textarea></label>
    <label class="row" style="margin:0 0 10px"><input type="checkbox" name="merge" id="restore-merge" checked style="width:auto;min-height:0"> دمج مع البيانات الحالية (لجمع سجلات المعلمين من أجهزتهم) بدل استبدالها</label>
    <div class="dlg-actions"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">استعادة</button></div>`,
  (fd) => {
    const text = fd.get("paste").trim();
    if (!text) { toast("الصق النص أو اختر ملفاً"); return false; }
    setTimeout(() => restoreData(text, fd.get("merge") === "on"));
  });
  $("#restore-file", form).addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    const merge = $("#restore-merge", form).checked;
    reader.onload = () => { dlg.close(); restoreData(reader.result, merge); };
    reader.readAsText(f);
  });
}

function reminderDialog(st) {
  messageDialog(st, {
    title: `رسالة تذكير — ${esc(st.name)}`,
    toggles: [
      { name: "includeMistakes", label: "الأخطاء", checked: true },
      { name: "onlyRepeated", label: "المتكررة فقط", checked: false },
      { name: "includeAssignment", label: "الواجب", checked: true }
    ],
    build: (o) => buildMessage(st, o),
    onSent: () => { st.lastReminder = Date.now(); }
  });
}

function sessionSendDialog(sesId) {
  const ses = db.sessions.find((x) => x.id === sesId);
  const st = ses && getStudent(ses.studentId);
  if (!st) return;
  messageDialog(st, {
    title: `إرسال تقرير التسميع — ${esc(st.name)}`,
    toggles: [
      { name: "includeNotes", label: "ملاحظات الشيخ", checked: true },
      { name: "includeAssignment", label: "الواجب", checked: true },
      { name: "includeAppointment", label: "الموعد القادم", checked: true }
    ],
    build: (o) => buildSessionMessage(st, ses, o),
    onSent: () => { ses.sentAt = Date.now(); }
  });
}

function noteForm(studentId, note = {}) {
  openDialog(`
    <h2>${note.id ? "تعديل الملاحظة" : "ملاحظة جديدة"} — ${esc(getStudent(studentId).name)}</h2>
    <label><span>التاريخ</span><input name="date" type="date" required value="${esc(note.date || todayStr())}"></label>
    <label><span>نص الملاحظة</span><textarea name="text" required style="min-height:140px" placeholder="مثال: تحسّن واضح في المراجعة، ويحتاج إلى ضبط أحكام الميم الساكنة">${esc(note.text || "")}</textarea></label>
    <label class="row" style="margin:0 0 10px"><input type="checkbox" name="private" ${note.private ? "checked" : ""} style="width:auto;min-height:0"> ملاحظة خاصة بالشيخ (لا تُرسل للطالب)</label>
    ${dlgActions()}`, (fd) => {
    const data = { date: fd.get("date"), text: fd.get("text").trim(), private: fd.get("private") === "on" };
    if (note.id) Object.assign(note, data);
    else db.notes.push({ id: uid(), studentId, createdAt: Date.now(), ...data });
    save(); render(); toast("تم حفظ الملاحظة");
  });
}

function noteSendDialog(noteId) {
  const note = db.notes.find((n) => n.id === noteId);
  const st = note && getStudent(note.studentId);
  if (!st) return;
  const s = db.settings;
  messageDialog(st, {
    title: `إرسال ملاحظة — ${esc(st.name)}`,
    build: () => fillTemplate(
      `السلام عليكم ورحمة الله وبركاته\n{الاسم} حفظه الله\n📝 ملاحظة من شيخك (${fmtDate(note.date)}):\n${note.text}\n{المعلم}`, st, {}),
    onSent: () => { note.sentAt = Date.now(); }
  });
}

/* ============ الصفحات ============ */
const view = $("#view");

function initials(name) { return esc((name || "؟").trim().charAt(0)); }

function studentRow(st, extra = "", recite = false) {
  return `<li class="row between">
    <a class="student-link grow" href="#/student/${st.id}">
      <span class="avatar">${initials(st.name)}</span>
      <span class="grow"><b>${esc(st.name)}</b><br><span class="muted small">${extra}</span></span>
    </a>
    ${recite ? `<a class="btn sm primary" href="${reciteHash(st.id)}">📖 تسميع</a>` : ""}
    <button class="btn sm" data-remind="${st.id}">🔔 تذكير</button>
  </li>`;
}

function pageHome() {
  const now = new Date();
  const todayDow = now.getDay(), tomorrowDow = (todayDow + 1) % 7;
  const today = db.students.filter((s) => (s.days || []).includes(todayDow));
  const tomorrow = db.students.filter((s) => (s.days || []).includes(tomorrowDow));
  const openRepeated = db.students.map((s) => ({ s, g: groupMistakes(studentMistakes(s.id)).filter((g) => g.repeated && !g.resolved) }))
    .filter((x) => x.g.length).sort((a, b) => b.g.length - a.g.length);
  const weekAgo = todayStr(new Date(Date.now() - 7 * 864e5));
  const unsent = db.sessions.filter((x) => x.date === todayStr() && !x.sentAt && !x.draft && getStudent(x.studentId));

  return `
    <h1>${esc(db.settings.halaqaName)}</h1>
    <p class="muted">${now.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    <div class="stats">
      <div class="stat"><b>${db.students.length}</b><span>طالب</span></div>
      <div class="stat"><b>${db.sessions.filter((s) => s.date >= weekAgo && !s.draft).length + db.daily.filter((x) => x.date >= weekAgo).length}</b><span>تسميع هذا الأسبوع</span></div>
      <div class="stat"><b>${openRepeated.reduce((a, x) => a + x.g.length, 0)}</b><span>خطأ متكرر لم يُتقن</span></div>
    </div>
    ${db.students.length === 0 ? `<div class="card empty">ابدأ بإضافة طلاب حلقتك<br><br><button class="btn primary" data-action="add-student">+ إضافة طالب</button></div>` : ""}
    ${programHomeSection()}
    ${unsent.length ? `<h2>تقارير تسميع اليوم لم تُرسل (${unsent.length})</h2>
      <div class="card"><ul class="list">${unsent.map((x) => `<li class="row between">
        <span class="grow"><b>${esc(getStudent(x.studentId).name)}</b><br><span class="muted small">${rangeText(x)} · ${sessionMistakes(x).length} خطأ</span></span>
        <button class="btn sm whatsapp" data-send-session="${x.id}">📤 إرسال</button></li>`).join("")}</ul></div>` : ""}
    ${tomorrow.length ? `<h2>حلقة الغد (${DAYS[tomorrowDow]}) — ذكّرهم الليلة</h2>
      <div class="card"><ul class="list">${tomorrow.map((s) => studentRow(s, `الساعة ${fmtTime(s.time)}`)).join("")}</ul></div>` : ""}
    ${openRepeated.length ? `<h2>طلاب لديهم أخطاء متكررة</h2>
      <div class="card"><ul class="list">${openRepeated.slice(0, 8).map((x) => studentRow(x.s, `${x.g.length} موضع متكرر: ${x.g.slice(0, 2).map((g) => `${surahName(g.surah)} ${g.ayah}`).join("، ")}`)).join("")}</ul></div>` : ""}
  `;
}

function pageStudents() {
  const q = pageStudents.q || "";
  const list = db.students.filter((s) => !q || s.name.includes(q)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return `
    <div class="row between"><h1>الطلاب (${db.students.length})</h1>
      <div class="row">${teachers().length ? `<a class="btn" href="#/assign">🔀 توزيع المعلمين</a>` : ""}<button class="btn primary" data-action="add-student">+ طالب</button></div></div>
    <input id="search" placeholder="بحث بالاسم…" value="${esc(q)}" style="margin-bottom:12px">
    <div class="card">${list.length ? `<ul class="list">${list.map((s) => {
      const last = studentDaily(s.id)[0];
      const rep = groupMistakes(studentMistakes(s.id)).filter((g) => g.repeated && !g.resolved).length;
      const info = [teacherOf(s) ? `👤 ${esc(teacherOf(s).name)}` : "",
        last ? `آخر تسميع: ${DAYS[dowOf(last.date)]}${pagesOf(last) ? ` ${pageRangeText(last)}` : ""}` : "لا يوجد تسميع بعد",
        rep ? `<span class="badge danger">${rep} متكرر</span>` : ""].filter(Boolean).join(" · ");
      return studentRow(s, info);
    }).join("")}</ul>` : `<p class="empty">لا يوجد طلاب</p>`}</div>`;
}

function pageStudent(id, tab) {
  const st = getStudent(id);
  if (!st) return `<p class="empty">الطالب غير موجود</p>`;
  tab = tab || "program";
  if (isStudent() && !["program", "sard"].includes(tab)) tab = "program";
  const sessions = finishedSessions(id);
  const draft = draftSession(id);
  const groups = groupMistakes(studentMistakes(id));
  const repeated = groups.filter((g) => g.repeated && !g.resolved);
  const appt = nextAppointment(st);

  let body = "";
  if (tab === "program") body = studentProgramTab(st);
  else if (tab === "sard") body = studentSardTab(st);
  else if (tab === "log") {
    body = (draft ? `<div class="card draft-card">
        <div class="row between"><b>⏳ تسميع لم يُنهَ بعد</b><span class="badge danger">${sessionMistakes(draft).length} خطأ</span></div>
        <div class="muted small">${fmtDate(draft.date)} · بدأ من ${surahName(draft.surah)} ${draft.fromAyah}</div>
        <div class="row" style="margin-top:8px">
          <a class="btn sm primary" href="${reciteHash(id)}">متابعة في المصحف</a>
          <button class="btn sm danger" data-del-session="${draft.id}">حذف</button>
        </div></div>` : "") +
    (sessions.length ? sessions.map((s) => {
      const ms = sessionMistakes(s);
      const gradeCls = s.grade === "يُعاد" ? "danger" : s.grade === "مقبول" ? "warn" : "ok";
      return `<div class="card">
        <div class="row between">
          <b>${SESSION_TYPES[s.type] || ""}: ${rangeText(s)}</b>
          <span class="badge ${gradeCls}">${esc(s.grade)}</span>
        </div>
        <div class="muted small">${fmtDate(s.date)}${s.sentAt ? ` · <span class="badge ok">أُرسل للطالب ✓</span>` : ""}</div>
        ${ms.length ? `<div class="small" style="margin-top:6px">الأخطاء (${ms.length}): ${ms.map((m) => `<span class="badge warn">${m.ayah}${m.word ? `: <span class="qw">${esc(m.word)}</span>` : " كاملة"}</span>`).join(" ")}</div>` : `<div class="small" style="margin-top:6px"><span class="badge ok">بلا أخطاء</span></div>`}
        ${s.assignment ? `<div class="small" style="margin-top:6px">📝 الواجب: ${esc(s.assignment)}</div>` : ""}
        ${s.notes ? `<div class="small" style="margin-top:4px">💬 ملاحظات الشيخ: ${esc(s.notes)}</div>` : ""}
        ${s.privateNote ? `<div class="small muted" style="margin-top:4px">🔒 ${esc(s.privateNote)}</div>` : ""}
        <div class="row" style="margin-top:8px">
          <button class="btn sm whatsapp" data-send-session="${s.id}">📤 ${s.sentAt ? "إعادة إرسال" : "إرسال للطالب"}</button>
          <a class="btn sm" href="${mushafHash(`${s.surah}-${s.fromAyah}`, id, s.id)}">📖 أخطاؤه في المصحف</a>
          <button class="btn sm" data-edit-session="${s.id}">تعديل</button>
          <button class="btn sm danger" data-del-session="${s.id}">حذف</button>
        </div>
      </div>`;
    }).join("") : draft ? "" : `<div class="card empty">لا يوجد تسميع مسجّل بعد. اضغط «📖 تسميع جديد» وسجّل الأخطاء بالضغط على الكلمات.</div>`);
  } else if (tab === "mistakes") {
    const filter = pageStudent.filter || "open";
    const shown = groups.filter((g) => filter === "all" || (filter === "repeated" ? g.repeated && !g.resolved : !g.resolved));
    body = `
      <div class="row" style="margin-bottom:10px">
        <div class="tabs" style="margin:0">
          ${[["open", "غير المتقنة"], ["repeated", "المتكررة"], ["all", "الكل"]].map(([k, v]) => `<button data-mfilter="${k}" class="${filter === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
        <span class="grow"></span>
        <a class="btn sm primary" href="${reciteHash(id)}">📖 تسجيل من المصحف</a>
      </div>
      ${shown.length ? shown.map(mistakeGroupCard).join("") : `<div class="card empty">لا توجد أخطاء هنا</div>`}`;
  } else if (tab === "notes") {
    const notes = db.notes.filter((n) => n.studentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    body = `
      <div class="row between" style="margin-bottom:10px">
        <span class="small muted">ملاحظات الشيخ على الطالب، ويمكن إرسالها له بواتساب.</span>
        <button class="btn sm primary" data-action="add-note">+ ملاحظة</button>
      </div>
      ${notes.length ? notes.map((n) => `<div class="card">
        <div class="row between"><span class="muted small">${fmtDate(n.date)}</span>
          ${n.private ? `<span class="badge">🔒 خاصة</span>` : n.sentAt ? `<span class="badge ok">أُرسلت ✓</span>` : ""}</div>
        <div class="note-text">${esc(n.text)}</div>
        <div class="row" style="margin-top:8px">
          ${n.private ? "" : `<button class="btn sm whatsapp" data-send-note="${n.id}">📤 إرسال</button>`}
          <button class="btn sm" data-edit-note="${n.id}">تعديل</button>
          <button class="btn sm danger" data-del-note="${n.id}">حذف</button>
        </div></div>`).join("") : `<div class="card empty">لا توجد ملاحظات بعد</div>`}`;
  } else if (tab === "info") {
    body = `<div class="card">
      <p><b>الجوال:</b> ${esc(st.phone) || "—"}</p>
      <p><b>ولي الأمر:</b> ${esc(st.guardianPhone) || "—"}</p>
      <p><b>الرواية:</b> ${esc(riwayaOf(st))}</p>
      <p><b>المعلم:</b> ${esc((teacherOf(st) || {}).name || "—")}</p>
      ${teacherHistoryHtml(st)}
      <p><b>المقدار اليومي:</b> ${wajhAr(dailyPagesOf(st))} · <b>المحفوظ قبل البرنامج:</b> ${wajhAr(Number(st.memorizedBefore) || 0)}</p>
      <p><b>أيام الحلقة:</b> ${(st.days || []).map((d) => DAYS[d]).join("، ") || "—"} ${st.time ? "— " + fmtTime(st.time) : ""}</p>
      <p><b>آخر تذكير:</b> ${st.lastReminder ? new Date(st.lastReminder).toLocaleString("ar") : "—"}</p>
      ${st.notes ? `<p><b>ملاحظات:</b> ${esc(st.notes)}</p>` : ""}
      ${cloudActive() ? `<div class="row" style="margin-bottom:10px"><button class="btn whatsapp" data-invite="${st.id}">📤 إرسال رابط الدخول للطالب</button></div>` : ""}
      <div class="row"><button class="btn" data-action="edit-student">تعديل البيانات</button><button class="btn danger" data-action="delete-student">حذف الطالب</button></div>
    </div>`;
  }

  return `
    <div class="card">
      <div class="row">
        <span class="avatar">${initials(st.name)}</span>
        <div class="grow"><h1 style="margin:0">${esc(st.name)}</h1>
          <div class="small"><span class="badge">🎙️ ${esc(riwayaOf(st))}</span></div>
          <div class="muted small">الموعد القادم: ${fmtAppointment(appt)}</div></div>
      </div>
      <div class="stats" style="margin:12px 0 0">
        <div class="stat"><b>${memorizedSet(st).size}</b><span>وجه محفوظ</span></div>
        <div class="stat"><b>${owedRecords(id).length}</b><span>تعويض مستحق</span></div>
        <div class="stat"><b>${repeated.length}</b><span>خطأ متكرر</span></div>
      </div>
      ${isStudent() ? `<div class="row" style="margin-top:12px">
        <button class="btn primary grow" data-daily-new="${st.id}">📝 سجّل تسميعك</button>
        <button class="btn grow" data-sard-new="${st.id}">📚 سرد</button>
        <button class="btn" data-action="logout">خروج</button>
      </div>` : `<div class="row" style="margin-top:12px">
        <button class="btn primary grow" data-daily-new="${st.id}">📝 تسجيل</button>
        <button class="btn grow" data-sard-new="${st.id}">📚 سرد</button>
        <a class="btn grow" href="${reciteHash(id)}">📖 ${draft ? "متابعة التسميع" : "المصحف"}</a>
        <button class="btn" data-remind="${st.id}" aria-label="تذكير">🔔</button>
      </div>`}
    </div>
    <div class="tabs">
      ${[["program", "البرنامج"], ["sard", `السرد (${studentSard(id).length})`], ...(isStudent() ? [] : [["log", "تسميع المصحف"], ["mistakes", `الأخطاء (${groups.filter((g) => !g.resolved).length})`],
        ["notes", `الملاحظات (${db.notes.filter((n) => n.studentId === id).length})`], ["info", "البيانات"]])]
        .map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? "active" : ""}">${v}</button>`).join("")}
    </div>
    ${body}`;
}

function mistakeGroupCard(g, showStudent) {
  const st = showStudent ? getStudent(g.items[0].studentId) : null;
  return `<div class="card mistake ${g.repeated && !g.resolved ? "repeated" : ""} ${g.resolved ? "resolved" : ""}">
    <div class="row between">
      <div class="grow">
        ${st ? `<a href="#/student/${st.id}/mistakes" class="small">${esc(st.name)}</a><br>` : ""}
        <span class="word qw">${esc(g.word) || "الآية كاملة"}</span>
        <span class="muted"> · ${surahName(g.surah)} آية ${g.ayah}</span>
      </div>
      ${g.resolved ? `<span class="badge ok">أُتقن ✓</span>` : g.count > 1 ? `<span class="badge danger">تكرر ×${g.count}</span>` : `<span class="badge warn">مرة واحدة</span>`}
    </div>
    <div class="small muted">${g.kinds.join("، ")} · ${g.items.map((i) => fmtDate(i.date)).join(" | ")}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm" data-resolve="${esc(g.key)}" data-sid="${g.items[0].studentId}">${g.resolved ? "إعادة فتح" : "تم الإتقان ✓"}</button>
      <a class="btn sm" href="${mushafHash(`${g.surah}-${g.ayah}`, g.items[0].studentId)}">📖 في المصحف</a>
      <button class="btn sm danger" data-del-mistake="${g.items[0].id}">حذف آخر تسجيل</button>
    </div>
  </div>`;
}

function pageMistakes() {
  const all = [];
  for (const s of db.students) all.push(...groupMistakes(studentMistakes(s.id)).filter((g) => !g.resolved));
  all.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  // أكثر المواضع خطأً على مستوى الحلقة كلها
  const byPlace = new Map();
  for (const m of db.mistakes) {
    const k = `${m.surah}|${m.ayah}`;
    if (!byPlace.has(k)) byPlace.set(k, { surah: m.surah, ayah: m.ayah, students: new Set(), n: 0 });
    const p = byPlace.get(k); p.n++; p.students.add(m.studentId);
  }
  const hot = [...byPlace.values()].filter((p) => p.students.size > 1).sort((a, b) => b.students.size - a.students.size || b.n - a.n).slice(0, 10);
  return `
    <h1>الأخطاء</h1>
    ${hot.length ? `<h2>مواضع يخطئ فيها أكثر من طالب</h2><div class="card"><ul class="list">
      ${hot.map((p) => `<li class="row between"><span>${surahName(p.surah)} آية ${p.ayah}</span><span class="badge danger">${p.students.size} طلاب · ${p.n} مرة</span></li>`).join("")}
      </ul><p class="small muted">مواضع تستحق التنبيه عليها للحلقة كلها.</p></div>` : ""}
    <h2>الأخطاء غير المتقنة لجميع الطلاب</h2>
    ${all.length ? all.map((g) => mistakeGroupCard(g, true)).join("") : `<div class="card empty">لا توجد أخطاء مفتوحة 🎉</div>`}`;
}

function pageReminders() {
  const now = new Date();
  const withAppt = db.students.map((s) => ({ s, d: nextAppointment(s, now) }))
    .sort((a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity));
  return `
    <h1>التذكير</h1>
    <p class="muted small">اضغط على "تذكير" لتجهيز رسالة فيها موعد الطالب وواجبه ومواضع أخطائه، ثم أرسلها بواتساب أو SMS.</p>
    <div class="card">${withAppt.length ? `<ul class="list">${withAppt.map(({ s, d }) =>
      studentRow(s, `${fmtAppointment(d)}${s.lastReminder ? ` · آخر تذكير: ${new Date(s.lastReminder).toLocaleDateString("ar")}` : ""}`)).join("")}</ul>`
      : `<p class="empty">أضف طلاباً أولاً</p>`}</div>`;
}

function pageSettings() {
  const s = db.settings;
  return `
    <h1>الإعدادات</h1>
    <form id="settings-form" class="card">
      ${programSettingsHtml()}
      <label><span>اسم الحلقة</span><input name="halaqaName" value="${esc(s.halaqaName)}"></label>
      <label><span>اسم المعلم</span><input name="teacherName" value="${esc(s.teacherName)}"></label>
      <div class="grid2">
        <label><span>مفتاح الدولة للجوال</span><input name="countryCode" inputmode="numeric" value="${esc(s.countryCode)}"></label>
        <label><span>يُعدّ الخطأ متكرراً بعد</span><select name="repeatThreshold">${[2, 3, 4].map((n) => `<option value="${n}" ${n === s.repeatThreshold ? "selected" : ""}>${n} مرات</option>`).join("")}</select></label>
      </div>
      <label><span>قالب رسالة التذكير</span><textarea name="template" rows="9" style="min-height:200px">${esc(s.template)}</textarea></label>
      <p class="small muted">المتغيرات المتاحة: {الاسم} {الحلقة} {الرواية} {الموعد} {الواجب} {الأخطاء} {المعلم}</p>
      <button type="button" class="btn sm" data-action="reset-template">استعادة القالب الافتراضي</button>
      <label style="margin-top:14px"><span>قالب تقرير التسميع (يُرسل بعد كل جلسة)</span><textarea name="sessionTemplate" rows="11" style="min-height:240px">${esc(s.sessionTemplate)}</textarea></label>
      <p class="small muted">المتغيرات المتاحة: {الاسم} {الحلقة} {الرواية} {التاريخ} {التسميع} {التقدير} {الأخطاء} {الملاحظات} {الواجب} {الموعد} {المعلم}</p>
      <button type="button" class="btn sm" data-action="reset-session-template">استعادة القالب الافتراضي</button>
      <div class="row" style="margin-top:14px"><button class="btn primary">حفظ الإعدادات</button></div>
    </form>
    ${syncSettingsHtml()}
    <h2>النسخ الاحتياطي</h2>
    <div class="card">
      <p class="small muted">${auth ? "البيانات محفوظة على الخادم ومتزامنة بين الأجهزة، ويمكنك مع ذلك تنزيل نسخة احتياطية للاحتفاظ بها." : "البيانات محفوظة في هذا الجهاز فقط. صدّر نسخة احتياطية بانتظام، ويمكنك استيرادها في جهاز آخر."}</p>
      <div class="row">
        <button class="btn" data-action="export">⬇️ نسخة احتياطية</button>
        <button class="btn" data-action="import">⬆️ استعادة</button>
      </div>
    </div>`;
}

/* ============ المصحف ============ */
// بداية كل سورة برقم الآية التراكمي (يبدأ من 1)
const SURAH_STARTS = SURAHS.reduce((acc, s, i) => (acc.push(i ? acc[i - 1] + SURAHS[i - 1][1] : 1), acc), []);
const toGlobal = (s, a) => SURAH_STARTS[s - 1] + a - 1;
function fromGlobal(g) {
  let s = SURAHS.length;
  while (SURAH_STARTS[s - 1] > g) s--;
  return [s, g - SURAH_STARTS[s - 1] + 1];
}
function lastStartAtOrBefore(starts, g) {
  let i = starts.length - 1;
  while (i > 0 && starts[i] > g) i--;
  return i + 1;
}
// ترقيم الصفحات واحد في كل التطبيق: ترقيم مصحف المدينة كما في Quran.com
const pageOf = (s, a) => lastStartAtOrBefore(QPC_PAGES, toGlobal(s, a));
const juzOf = (s, a) => lastStartAtOrBefore(JUZ_STARTS, toGlobal(s, a));
const quarterOf = (g) => lastStartAtOrBefore(HIZB_QUARTERS, g);
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

let quranLoading = null;
function loadQuran() {
  if (quranReady()) return Promise.resolve();
  const load = (src) => new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = resolve;
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
  quranLoading = quranLoading || Promise.all([load("quran-data.js"), load("mushaf-lines.js")]).catch((e) => { quranLoading = null; throw e; });
  return quranLoading;
}
const quranReady = () => typeof QURAN_TEXT !== "undefined" && typeof MUSHAF_LINES !== "undefined";
// النص المصدر بترميز خط مجمع الملك فهد للتنوين المتتابع؛ يُحوَّل عند العرض إلى رموز يونيكود القياسية التي يدعمها خط المصحف
const OPEN_TANWEEN = { "\u0657": "\u08F0", "\u065E": "\u08F1", "\u0656": "\u08F2" };
const ayahText = (s, a) => ((QURAN_TEXT[s - 1] || [])[a - 1] || "").replace(/[\u0656\u0657\u065E]/g, (c) => OPEN_TANWEEN[c]);

function mushafHash(page, sid, ses) {
  return `#/mushaf/${page}/${sid || "-"}/${ses || "-"}`;
}

// حالة كل كلمة في الصفحة لطالب معيّن: "s:a:i" للكلمات، و"s:a" للآية كاملة
function mushafMarks(sid, sesId) {
  const marks = new Map();
  if (!sid) return marks;
  const add = (k, cls) => marks.set(k, ((marks.get(k) || "") + " " + cls).trim());
  for (const g of groupMistakes(studentMistakes(sid))) {
    const cls = g.resolved ? "m-ok" : g.repeated ? "m-rep" : "m-once";
    const words = quranReady() ? ayahText(g.surah, g.ayah).split(" ") : [];
    const target = normalizeWord(g.word);
    for (const m of g.items) {
      const c = sesId && m.sessionId === sesId ? `${cls} m-now` : cls;
      if (Number.isInteger(m.wordIndex)) add(`${m.surah}:${m.ayah}:${m.wordIndex}`, c);
      else if (!target) add(`${m.surah}:${m.ayah}`, c);
      // أخطاء مكتوبة يدوياً بلا رقم كلمة: تُطابق بالكلمة نفسها داخل الآية
      else words.forEach((w, i) => { if (normalizeWord(w) === target) add(`${m.surah}:${m.ayah}:${i}`, c); });
    }
  }
  for (const [k, v] of marks) marks.set(k, [...new Set(v.split(" "))].join(" "));
  return marks;
}

// نوع الخطأ الذي يُسجَّل عند الضغط على الكلمة (يختاره الشيخ من شريط المصحف)
let mushafKind = MISTAKE_KINDS[0];
try { if (MISTAKE_KINDS.includes(localStorage.getItem("halaqa-kind"))) mushafKind = localStorage.getItem("halaqa-kind"); } catch {}
// موضع بداية التسميع عند فتحه من «تسميع جديد»
let mushafStart = null;

// أين يبدأ التسميع الجديد: بعد نهاية آخر تسميع
function nextStart(sid) {
  const last = finishedSessions(sid)[0];
  if (!last) return [1, 1];
  return fromGlobal(Math.min(6236, toGlobal(...sesEnd(last)) + 1));
}
function reciteHash(sid) {
  const d = draftSession(sid);
  if (d) return mushafHash(d.lastPage || `${d.surah}-${d.fromAyah}`, sid, d.id);
  const [s, a] = nextStart(sid);
  return mushafHash(`${s}-${a}`, sid);
}
const pageRange = (page) => [QPC_PAGES[page - 1], page < 604 ? QPC_PAGES[page] - 1 : 6236];

const JUZ_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر",
  "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر", "السادس عشر", "السابع عشر", "الثامن عشر", "التاسع عشر", "العشرون",
  "الحادي والعشرون", "الثاني والعشرون", "الثالث والعشرون", "الرابع والعشرون", "الخامس والعشرون", "السادس والعشرون", "السابع والعشرون",
  "الثامن والعشرون", "التاسع والعشرون", "الثلاثون"];

// حالة شاشة المصحف الحالية (تُستعمل لتحديث الألوان دون إعادة رسم الصفحة)
let mushafView = null;

/* ---------- صفحات مصحف المدينة بخط مجمع الملك فهد من Quran.com (كما في مصحف الوقوف) ---------- */
const QPC_API = "https://api.quran.com/api/v4/verses/by_page/";
const QPC_FONT_URLS = (p) => [
  `https://static.qurancdn.com/fonts/quran/hafs/v2/woff2/p${p}.woff2`,
  `https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/p${p}.woff2`
];
const liveData = {};          // صفحات جاهزة للعرض بخط المجمع
const liveLoading = {};
let liveDownUntil = 0;        // بعد فشل الاتصال يُعرض الخط البديل دقيقة قبل المحاولة مجدداً
let basmGlyph;                // البسملة بحروف صفحة 1

function loadPageFont(p) {
  return (async () => {
    for (const u of QPC_FONT_URLS(p)) {
      try {
        const f = new FontFace("qpc" + p, `url(${u}) format("woff2")`);
        await f.load();
        document.fonts.add(f);
        return true;
      } catch {}
    }
    return false;
  })();
}

function fetchLivePage(p) {
  if (liveData[p]) return Promise.resolve(liveData[p]);
  if (liveLoading[p]) return liveLoading[p];
  liveLoading[p] = (async () => {
    const url = `${QPC_API}${p}?words=true&per_page=all&fields=text_uthmani&word_fields=code_v2,text_uthmani,line_number,page_number,position,char_type_name`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("api " + r.status);
    const j = await r.json();
    if (!(await loadPageFont(p))) throw new Error("font");
    liveData[p] = j.verses;
    return j.verses;
  })().catch((e) => { liveDownUntil = Date.now() + 60000; throw e; }).finally(() => { delete liveLoading[p]; });
  return liveLoading[p];
}
async function ensureBasmala() {
  if (basmGlyph !== undefined) return;
  try {
    const v = (await fetchLivePage(1)).find((x) => x.verse_key === "1:1");
    basmGlyph = v.words.filter((w) => w.char_type_name === "word").map((w) => w.code_v2).join(" ");
  } catch { basmGlyph = null; }
}
function prefetchLive(p) {
  [p + 1, p - 1, p + 2].forEach((q) => { if (q >= 1 && q <= 604 && !liveData[q] && Date.now() > liveDownUntil) fetchLivePage(q).catch(() => {}); });
}

// مطابقة كلمات Quran.com بكلمات نصنا (قد تُكتب الكلمة الواحدة كلمتين، وقد تكون علامة السجدة رمزاً مستقلاً)
const skel = (t) => String(t).normalize("NFC")
  .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ​-‏\d]/g, "")
  .replace(/[ٱأإآءؤئاويىۥۦ\s]/g, "").replace(/ة/g, "ه");
function alignTokens(mine, toks) {
  const ms = mine.map(skel), ts = toks.map(skel);
  const tryFrom = (i0) => {
    const map = [];
    let i = i0;
    for (let j = 0; j < ts.length; j++) {
      if (i >= ms.length) return null;
      if (!ts[j]) { map.push(Math.max(i0, i - 1)); continue; }          // رمز بلا حروف (كعلامة السجدة) يتبع ما قبله
      if (ts[j] === ms[i]) { map.push(i++); continue; }
      if (j + 1 < ts.length && ts[j] + ts[j + 1] === ms[i]) { map.push(i, i); j++; i++; continue; }
      return null;
    }
    return map;
  };
  // كلمات الآية في الصفحة قد تبدأ من وسطها إذا ابتدأت الآية في الصفحة السابقة
  for (let i0 = 0; i0 < ms.length; i0++) { const m = tryFrom(i0); if (m) return m; }
  return toks.map((_, k) => Math.min(k, mine.length - 1));
}

function pageHead(page, surahs) {
  const first = pageRange(page)[0];
  const q = quarterOf(first);
  const hizb = Math.ceil(q / 4), part = (q - 1) % 4;
  return `<div class="phead"><span>الجزء ${JUZ_NAMES[juzOf(...fromGlobal(first)) - 1]}، ${["", "ربع ", "نصف ", "ثلاثة أرباع "][part]}الحزب ${toArabicDigits(hizb)}</span>
    <span class="ps">${surahs.map((x) => "سورة " + surahName(x)).join(" · ")}</span></div>`;
}
const sheadHtml = (s) => `<div class="line shead"><span class="ro r1"></span><span class="nm">سورة ${surahName(s)}</span><span class="ro r2"></span></div>`;
const pageFoot = (page) => `<div class="pfoot"><span>${toArabicDigits(page)}</span></div>`;

// الصفحة بخط المجمع: 15 سطراً كما في Quran.com، وفراغات العناوين والبسملة تُملأ بحسب موضعها
function livePageHtml(p) {
  const verses = liveData[p];
  const lines = {};
  const surahs = [];
  for (const v of verses) {
    const [s, a] = v.verse_key.split(":").map(Number);
    if (!surahs.includes(s)) surahs.push(s);
    const toks = v.words.filter((w) => w.page_number == null || w.page_number === p);
    const wordToks = toks.filter((w) => w.char_type_name === "word");
    const map = alignTokens(ayahText(s, a).split(" "), wordToks.map((w) => w.text_uthmani || ""));
    let k = 0;
    for (const w of toks) {
      const L = (lines[w.line_number] = lines[w.line_number] || []);
      if (w.char_type_name === "word") L.push(`<span class="w" data-base="w" data-s="${s}" data-a="${a}" data-i="${map[k++]}">${w.code_v2}</span>`);
      else if (w.char_type_name === "end") L.push(`<span class="ayah-no glyph" data-base="ayah-no glyph" data-s="${s}" data-a="${a}">${w.code_v2}</span>`);
    }
  }
  const nums = Object.keys(lines).map(Number).sort((x, y) => x - y);
  const lastL = p <= 2 ? nums[nums.length - 1] : 15;
  const slot = {};
  const startsNext = (q) => { const g = QPC_PAGES[q - 1]; const [s, a] = fromGlobal(g); return a === 1 ? s : 0; };
  for (let L = 1; L <= lastL;) {
    if (lines[L]) { L++; continue; }
    let e = L;
    while (e + 1 <= lastL && !lines[e + 1]) e++;
    const nextLine = lines[e + 1];
    let s = 0;
    if (nextLine) { const m = /data-s="(\d+)" data-a="1"/.exec(nextLine[0]); s = m ? Number(m[1]) : 0; }
    else if (p < 604) s = startsNext(p + 1);  // سورة تبدأ في الصفحة التالية وعنوانها في آخر هذه
    if (s) {
      const gap = e - L + 1;
      if (nextLine) {
        if (s === 1 || s === 9) slot[e] = ["h", s];
        else if (gap >= 2) { slot[e - 1] = ["h", s]; slot[e] = ["b"]; } else slot[e] = ["b"];
      } else {
        if (s !== 9 && gap >= 2) { slot[L] = ["h", s]; slot[L + 1] = ["b"]; } else slot[L] = ["h", s];
      }
    }
    L = e + 1;
  }
  let html = "";
  for (let L = 1; L <= lastL; L++) {
    const arr = lines[L];
    if (!arr) {
      const sl = slot[L];
      if (sl && sl[0] === "h") html += sheadHtml(sl[1]);
      else if (sl) html += basmGlyph ? `<div class="line basm" style="font-family:qpc1">${basmGlyph}</div>` : `<div class="line basm amiri">${ayahText(1, 1)}</div>`;
      else html += `<div class="line"></div>`;
      continue;
    }
    html += `<div class="line${p <= 2 || arr.length < 4 ? " center" : ""}">${arr.join("")}</div>`;
  }
  return `<div class="mpage mushaf-page qpc">${pageHead(p, surahs)}<div class="lines" style="font-family:qpc${p}">${html}</div>${pageFoot(p)}</div>`;
}

// الخط البديل (دون إنترنت أو في المعاينة): أسطر طبعة 1441 حين تطابق حدود الصفحة، وإلا نص متصل
function localPageHtml(page) {
  const [first, last] = pageRange(page);
  const q = MUSHAF_LINE_PAGE_STARTS.indexOf(first) + 1;
  const sameBounds = q > 0 && (q < 604 ? MUSHAF_LINE_PAGE_STARTS[q] - 1 : 6236) === last;
  const surahs = [...new Set([fromGlobal(first)[0], fromGlobal(last)[0]])];
  for (let s = surahs[0] + 1; s < surahs[surahs.length - 1]; s++) surahs.splice(-1, 0, s);
  const wordSpan = (s, a, i, w) => `<span class="w" data-base="w" data-s="${s}" data-a="${a}" data-i="${i}">${w}</span>`;
  const endSpan = (s, a) => `<span class="ayah-no" data-base="ayah-no" data-s="${s}" data-a="${a}">${toArabicDigits(a)}</span>`;
  let html = "";
  if (sameBounds) {
    for (const l of MUSHAF_LINES[q - 1]) {
      if (!l) { html += `<div class="line"></div>`; continue; }
      if (l[0] === "h") { html += sheadHtml(l[1]); continue; }
      if (l[0] === "b") { html += `<div class="line basm">${ayahText(1, 1)}</div>`; continue; }
      let [g, w] = l;
      let n = 0, parts = "";
      while (true) {
        const [s, a] = fromGlobal(g);
        const words = ayahText(s, a).split(" ");
        parts += wordSpan(s, a, w, words[w]);
        n++;
        const lastOfAyah = w === words.length - 1;
        if (lastOfAyah) parts += endSpan(s, a);
        if (g === l[2] && w === l[3]) break;
        if (lastOfAyah) { g++; w = 0; } else w++;
      }
      html += `<div class="line${page <= 2 || n <= 2 ? " center" : ""}">${parts}</div>`;
    }
    return `<div class="mpage mushaf-page">${pageHead(page, surahs)}<div class="lines">${html}</div>${pageFoot(page)}</div>`;
  }
  html = `<div class="flow">`;
  for (let g = first; g <= last; g++) {
    const [s, a] = fromGlobal(g);
    if (a === 1) html += `</div>${sheadHtml(s)}${s !== 1 && s !== 9 ? `<div class="line basm">${ayahText(1, 1)}</div>` : ""}<div class="flow">`;
    html += ayahText(s, a).split(" ").map((w, i) => wordSpan(s, a, i, w)).join(" ") + " " + endSpan(s, a) + " ";
  }
  html += `</div>`;
  return `<div class="mpage mushaf-page flowing">${pageHead(page, surahs)}<div class="lines">${html}</div>${pageFoot(page)}</div>`;
}

function pageMushaf(pageArg, sidArg, sesArg) {
  document.body.classList.add("mushaf-mode");
  if (!quranReady()) {
    loadQuran().then(render, () => { view.innerHTML = `<div class="card empty">تعذّر تحميل المصحف، تأكد من الاتصال ثم أعد المحاولة</div>`; });
    return `<div class="mapp"><div class="mloading">جارٍ تحميل المصحف…</div></div>`;
  }
  // فتح تبويب المصحف مباشرة يعود إلى آخر صفحة وطالب
  if (!pageArg) {
    let last = {};
    try { last = JSON.parse(localStorage.getItem("halaqa-mushaf-last") || "{}"); } catch {}
    const sid = getStudent(last.sid) ? last.sid : "";
    location.replace(sid ? reciteHash(sid) : mushafHash(last.page || 1, ""));
    return "";
  }
  const ref = /^(\d+)-(\d+)$/.exec(pageArg || "");
  const sid = getStudent(sidArg) ? sidArg : "";
  if (ref) {
    const rs = Math.min(114, Math.max(1, Number(ref[1]))), ra = Math.min(surahAyahs(rs), Math.max(1, Number(ref[2])));
    mushafStart = { sid, s: rs, a: ra };
  }
  const page = ref ? pageOf(mushafStart.s, mushafStart.a) : Math.min(604, Math.max(1, Number(pageArg) || 1));
  const ses = sesArg && db.sessions.find((x) => x.id === sesArg && x.studentId === sid);
  if (ses && ses.draft && ses.lastPage !== page) { ses.lastPage = page; save(); }
  try { localStorage.setItem("halaqa-mushaf-last", JSON.stringify({ page, sid })); } catch {}
  mushafView = { page, sid, sesId: ses ? ses.id : "" };
  const st = sid && getStudent(sid);
  const [first] = pageRange(page);
  const [s0] = fromGlobal(first);

  return `
  <div class="mapp${st ? " has-student" : ""}">
    <header class="mbar">
      <a class="ibtn" href="${st ? `#/student/${sid}` : "#/"}" aria-label="رجوع">
        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></a>
      <button class="ibtn" data-action="mushaf-index" aria-label="فهرس السور واختيار الطالب">
        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
      <div class="mtitle">
        <span class="sname">${st ? `🎙️ ${esc(st.name)}` : `سورة ${surahName(s0)}`}</span>
        <span class="meta" id="mushaf-sub"></span>
      </div>
      ${st ? `<span class="mcount" id="mushaf-count"></span>
        <button class="mfinish" data-action="finish-session" id="mushaf-finish"></button>`
        : `<button class="mfinish" data-action="mushaf-index">اختر الطالب</button>`}
    </header>
    ${st ? `<div class="kbar" role="radiogroup" aria-label="نوع الخطأ">
      ${MISTAKE_KINDS.map((k) => `<button class="kchip ${k === mushafKind ? "on" : ""}" data-set-kind="${k}" role="radio" aria-checked="${k === mushafKind}">${k}</button>`).join("")}
    </div>` : ""}
    ${st && riwayaOf(st) !== DEFAULT_RIWAYA ? `<div class="mnote">🎙️ الطالب يقرأ برواية ${esc(riwayaOf(st))}، والمصحف المعروض برواية حفص.</div>` : ""}
    <main class="mstage" id="mstage"></main>
    <nav class="mpager" aria-label="التنقل بين الصفحات">
      <button data-page="${page + 1}" ${page >= 604 ? "disabled" : ""} aria-label="الصفحة التالية">التالية ‹</button>
      <input id="mushaf-page" inputmode="numeric" value="${page}" aria-label="رقم الصفحة">
      <button data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="الصفحة السابقة">› السابقة</button>
    </nav>
  </div>`;
}

// بعد الرسم: ملاءمة الأسطر للعرض، وتلوين الأخطاء، وحركة الانتقال
function afterMushafRender() {
  if (!mushafView || !$("#mstage")) return;
  refreshMushafMarks();
  const p = mushafView.page, stage = $("#mstage");
  const show = (html, live) => {
    if (!mushafView || mushafView.page !== p || !$("#mstage")) return;
    $("#mstage").innerHTML = html;
    refreshMushafMarks();
    fitLines();
    if (document.fonts) document.fonts.load(live ? `20px qpc${p}` : '20px "Amiri Quran"').then(fitLines).catch(() => {});
    setTimeout(fitLines, 250);
    slideIn();
    if (live) prefetchLive(p);
  };
  if (liveData[p] && basmGlyph !== undefined) return show(livePageHtml(p), true);
  if (Date.now() < liveDownUntil) return show(localPageHtml(p), false);
  const t = setTimeout(() => { if (!stage.firstChild) stage.innerHTML = `<div class="mloading">جارٍ تحميل الصفحة…</div>`; }, 300);
  fetchLivePage(p).then(ensureBasmala).then(
    () => { clearTimeout(t); show(livePageHtml(p), true); },
    () => { clearTimeout(t); show(localPageHtml(p), false); }
  );
}

// تحديث ألوان الكلمات والعداد فقط، دون إعادة بناء الصفحة (حتى يبقى التسميع سلساً)
function refreshMushafMarks() {
  if (!mushafView) return;
  const { sid } = mushafView;
  const ses = mushafView.sesId && db.sessions.find((x) => x.id === mushafView.sesId);
  const marks = mushafMarks(sid, ses && ses.id);
  $$(".mpage .w").forEach((el) => {
    el.className = el.dataset.base + " " + (marks.get(`${el.dataset.s}:${el.dataset.a}:${el.dataset.i}`) || "");
  });
  $$(".mpage .ayah-no").forEach((el) => {
    el.className = el.dataset.base + " " + (marks.get(`${el.dataset.s}:${el.dataset.a}`) || "");
  });
  const count = ses ? sessionMistakes(ses).length : 0;
  const c = $("#mushaf-count");
  if (c) { c.textContent = `${toArabicDigits(count)} خطأ`; c.classList.toggle("zero", !count); }
  const f = $("#mushaf-finish");
  if (f) f.textContent = ses && !ses.draft ? "تم ✓" : "إنهاء ✓";
  const sub = $("#mushaf-sub");
  if (sub) {
    const { page } = mushafView;
    const where = `الصفحة ${toArabicDigits(page)} · الجزء ${toArabicDigits(juzOf(...fromGlobal(pageRange(page)[0])))}`;
    sub.textContent = !sid ? where : ses && !ses.draft ? `تعديل أخطاء تسميع ${fmtDate(ses.date)}` : ses ? `${where} · تسميع جارٍ` : `${where} · اضغط على الكلمة عند الخطأ`;
  }
}

// تكبير الخط حتى يملأ أطول سطر عرض الصفحة، مع بقاء الأسطر الخمسة عشر داخل الشاشة
function fitLines() {
  const box = $(".mpage .lines");
  if (!box) return;
  const stage = $("#mstage");
  const avail = box.clientWidth;
  let fs = parseFloat(box.style.fontSize) || 22;
  let max = 0;
  if (box.closest(".flowing")) {
    // النص المتصل: يُصغَّر الخط حتى تتسع الصفحة كلها في الشاشة
    const flow = $(".flow", box) || box;
    let f = 24;
    flow.style.fontSize = f + "px";
    $$(".flow", box).forEach((x) => (x.style.fontSize = f + "px"));
    while (f > 14 && stage.scrollHeight > stage.clientHeight + 1) {
      f -= 1;
      $$(".flow, .shead, .basm", box).forEach((x) => (x.style.fontSize = f + "px"));
    }
    return;
  }
  $$(".line:not(.shead):not(.basm)", box).forEach((l) => {
    // الأسطر المتوسطة بينها فراغات ثابتة بين الكلمات تُحسب ضمن العرض
    let w = (parseFloat(getComputedStyle(l).columnGap) || 0) * Math.max(0, l.children.length - 1);
    for (const c of l.children) w += c.getBoundingClientRect().width;
    if (w > max) max = w;
  });
  if (!max) return;
  let nf = fs * (avail * 0.97) / max;
  const n = $$(".line", box).length || 15;
  const free = stage.clientHeight - ($(".phead", stage)?.offsetHeight || 0) - ($(".pfoot", stage)?.offsetHeight || 0) - 24;
  // خط المجمع أسطره متقاربة كالمطبوع، والخط البديل يحتاج مسافة أكبر للتشكيل
  const hMax = free / (n * (box.closest(".qpc") ? 1.3 : 1.9));
  if (hMax > 10) nf = Math.min(nf, hMax);
  nf = Math.max(13, Math.min(44, nf));
  if (Math.abs(nf - fs) > 0.3) box.style.fontSize = nf.toFixed(2) + "px";
  // تحقق فعلي: إن خرج أي سطر عن حدود الصفحة لأي سبب يُصغَّر الخط حتى يتسع
  for (let k = 0; k < 6; k++) {
    const boxRect = box.getBoundingClientRect();
    let worst = 1;
    $$(".line:not(.shead)", box).forEach((l) => {
      if (!l.children.length) return;
      let lo = Infinity, hi = -Infinity;
      for (const c of l.children) { const r = c.getBoundingClientRect(); lo = Math.min(lo, r.left); hi = Math.max(hi, r.right); }
      worst = Math.max(worst, (hi - lo) / boxRect.width, (boxRect.left - lo > 0.5 || hi - boxRect.right > 0.5) ? 1.02 : 1);
    });
    if (worst <= 1.001) break;
    nf = Math.max(12, nf / worst * 0.99);
    box.style.fontSize = nf.toFixed(2) + "px";
  }
}
// أعد الملاءمة بعد اكتمال تحميل الخطوط وتغيّر حجم الشاشة الفعلي (دوران الجوال أو ظهور شريط العنوان)
if (window.visualViewport) visualViewport.addEventListener("resize", () => { if (mushafView) fitLines(); });
window.addEventListener("resize", () => { if (mushafView) fitLines(); });

// حركة دخول الصفحة الجديدة من جهة الانتقال
let slideFrom = 0;
function slideIn() {
  const d = slideFrom; slideFrom = 0;
  const pg = $(".mpage");
  if (!d || !pg || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const w = $("#mstage").clientWidth;
  pg.style.transition = "none";
  pg.style.transform = `translate3d(${d * w * 0.6}px,0,0)`;
  pg.style.opacity = ".4";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    pg.style.transition = "transform .24s cubic-bezier(.2,.8,.2,1), opacity .24s";
    pg.style.transform = "translate3d(0,0,0)";
    pg.style.opacity = "1";
  }));
}
function goPage(d) {
  if (!mushafView) return;
  const n = mushafView.page + d;
  if (n < 1 || n > 604) return;
  slideFrom = d > 0 ? -1 : 1;
  location.hash = mushafHash(n, mushafView.sid, mushafView.sesId);
}

// السحب بين الصفحات: الصفحة تتبع الإصبع، والتالية في المصحف إلى اليسار فيكشفها السحب إلى اليمين
let swipeBlockClick = 0;
(function () {
  let x0 = null, y0 = null, dx = 0, drag = false, pg = null;
  view.addEventListener("touchstart", (e) => {
    if (!e.target.closest("#mstage") || e.touches.length !== 1 || dlg.open) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; drag = false; pg = $(".mpage");
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (x0 == null || !pg) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (!drag) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { drag = true; clearTimeout(longPressTimer); }
      else { if (Math.abs(dy) > 14) x0 = null; return; }
    }
    const edge = (dx > 0 && mushafView.page >= 604) || (dx < 0 && mushafView.page <= 1);
    pg.style.transition = "none";
    pg.style.transform = `translate3d(${edge ? dx * 0.25 : dx}px,0,0)`;
  }, { passive: true });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    if (!drag || !pg) return;
    drag = false;
    swipeBlockClick = Date.now();
    const d = dx > 0 ? 1 : -1, n = mushafView.page + d, w = $("#mstage").clientWidth;
    if (Math.abs(dx) > Math.min(90, w * 0.22) && n >= 1 && n <= 604) {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return goPage(d);
      pg.style.transition = "transform .16s ease-in";
      pg.style.transform = `translate3d(${dx > 0 ? w : -w}px,0,0)`;
      setTimeout(() => goPage(d), 150);
    } else {
      pg.style.transition = "transform .2s ease-out";
      pg.style.transform = "translate3d(0,0,0)";
    }
  };
  view.addEventListener("touchend", end, { passive: true });
  view.addEventListener("touchcancel", end, { passive: true });
})();
document.addEventListener("keydown", (e) => {
  if (!mushafView || dlg.open || e.target.matches("input, textarea, select")) return;
  if (e.key === "ArrowLeft") goPage(1);
  if (e.key === "ArrowRight") goPage(-1);
});

// فهرس السور واختيار الطالب في ورقة سفلية
function mushafIndexSheet() {
  const { sid } = mushafView;
  const form = openDialog(`
    <div class="grip"></div>
    <h2>المصحف</h2>
    <label><span>الطالب</span>
      <select id="mushaf-student"><option value="">— بلا طالب (تصفح فقط) —</option>
        ${db.students.slice().sort((x, y) => x.name.localeCompare(y.name, "ar")).map((x) => `<option value="${x.id}" ${x.id === sid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
      </select></label>
    <p class="field-label">فهرس السور</p>
    <div class="slist">${SURAHS.map(([n], i) => `<button type="button" class="sitem" data-surah="${i + 1}">
      <span class="no">${toArabicDigits(i + 1)}</span><span class="nm">${n}</span><span class="pg">${toArabicDigits(pageOf(i + 1, 1))}</span></button>`).join("")}</div>
    <div class="dlg-actions"><button type="button" class="btn" data-close>إغلاق</button></div>`, () => false, (e) => {
    const b = e.target.closest("[data-surah]");
    if (!b) return;
    dlg.close();
    const sel = $("#mushaf-student", form).value;
    location.hash = mushafHash(`${b.dataset.surah}-1`, sel, sel === sid ? mushafView.sesId : "");
  });
  $("#mushaf-student", form).addEventListener("change", (e) => {
    dlg.close();
    const sel = e.target.value;
    location.hash = sel ? reciteHash(sel) : mushafHash(mushafView.page, "");
  });
}

// يعيد التسميع الذي تُسجَّل فيه الأخطاء، وينشئ تسميعاً جارياً عند أول خطأ
function ensureSession(sid, sesId, page) {
  let ses = sesId && db.sessions.find((x) => x.id === sesId && x.studentId === sid);
  if (ses) return ses;
  ses = draftSession(sid);
  if (ses) return ses;
  const [first, last] = pageRange(page);
  const startG = mushafStart && mushafStart.sid === sid ? toGlobal(mushafStart.s, mushafStart.a) : 0;
  const [s, a] = fromGlobal(startG >= first && startG <= last ? startG : first);
  const prev = finishedSessions(sid)[0];
  ses = { id: uid(), studentId: sid, createdAt: Date.now(), date: todayStr(), type: prev ? prev.type : "hifz",
    surah: s, fromAyah: a, lastPage: page, draft: true };
  db.sessions.push(ses);
  return ses;
}

// ضغطة على كلمة: تسجيل الخطأ فوراً، أو إلغاؤه إن كان مسجلاً في هذا التسميع
function mushafTap(el) {
  const r = parseRoute();
  const sid = r.tab;
  if (!getStudent(sid)) return toast("اختر الطالب أولاً من أسفل الصفحة");
  const page = mushafView.page;
  const s = Number(el.dataset.s), a = Number(el.dataset.a);
  const i = el.classList.contains("ayah-no") ? null : Number(el.dataset.i);
  const ses = ensureSession(sid, r.extra !== "-" ? r.extra : "", page);
  const word = i === null ? "" : ayahText(s, a).split(" ")[i];
  const same = (m) => m.sessionId === ses.id && m.surah === s && m.ayah === a &&
    (i === null ? !Number.isInteger(m.wordIndex) && !m.word : m.wordIndex === i);
  const existing = db.mistakes.find(same);
  if (existing) {
    db.mistakes = db.mistakes.filter((m) => m !== existing);
    toast(`أُلغي الخطأ${word ? `: «${word}»` : ""}`);
  } else {
    const m = { id: uid(), studentId: sid, sessionId: ses.id, date: ses.date, surah: s, ayah: a, word,
      wordIndex: i === null ? undefined : i, kind: mushafKind, note: "", resolved: false };
    db.mistakes.push(m);
    // خطأ جديد في موضع سبق إتقانه يعيد فتحه
    const key = mistakeKey(m);
    const past = studentMistakes(sid).filter((x) => mistakeKey(x) === key);
    past.forEach((x) => (x.resolved = false));
    toast(`✓ ${mushafKind}${word ? `: «${word}»` : ` — الآية ${a} كاملة`}${past.length > 1 ? ` ⚠️ تكرر ${timesAr(past.length)}` : ""}`);
    if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
  }
  save();
  // تحديث العنوان دون إطلاق hashchange حتى لا تقفز الصفحة إلى الأعلى
  const target = mushafHash(page, sid, ses.id);
  if (location.hash !== target) history.replaceState(null, "", target);
  mushafView.sesId = ses.id;
  refreshMushafMarks();
}
const refreshAfterChange = () => (mushafView ? refreshMushafMarks() : render());

// ضغطة مطوّلة: تفاصيل الموضع وسجله وتغيير نوع الخطأ
function mushafWordDialog(sid, sesId, s, a, i) {
  const st = getStudent(sid);
  const words = ayahText(s, a).split(" ");
  const whole = i === null;
  const word = whole ? "" : words[i];
  const key = mistakeKey({ surah: s, ayah: a, word });
  const history = studentMistakes(sid).filter((m) => mistakeKey(m) === key).sort((x, y) => y.date.localeCompare(x.date));
  const current = sesId && history.find((m) => m.sessionId === sesId && (whole || m.wordIndex === i));
  const resolved = history.length && history.every((m) => m.resolved);

  const form = openDialog(`
    <h2 class="row between"><span>${esc(st.name)}</span><span class="badge">${surahName(s)} · آية ${a}</span></h2>
    <div class="dlg-word">${whole ? `<span class="small muted">الآية كاملة</span><br>${ayahText(s, a)}` : word}</div>
    ${current ? `
      <p class="field-label">نوع الخطأ في هذا التسميع</p>
      <div class="kind-grid">${MISTAKE_KINDS.map((k) => `<button type="button" class="btn ${k === current.kind ? "primary" : ""}" data-kind="${k}">${k}</button>`).join("")}</div>
      <label style="margin-top:10px"><span>ملاحظة على هذا الخطأ (اختياري)</span><input name="note" value="${esc(current.note || "")}" placeholder="مثال: قرأها بالفتح"></label>
      <button type="button" class="btn sm danger" data-del-id="${current.id}">إلغاء هذا الخطأ</button>`
    : `<p class="small muted">لا يوجد خطأ مسجل هنا في هذا التسميع. اضغط على الكلمة ضغطة عادية لتسجيله.</p>`}
    ${history.length ? `<div class="card" style="margin:10px 0">
        <div class="row between"><b>سجل هذا الموضع</b>
          ${history.length > 1 ? `<span class="badge danger">تكرر ${timesAr(history.length)}</span>` : ""}
          ${resolved ? `<span class="badge ok">أُتقن ✓</span>` : ""}</div>
        <ul class="list small">${history.map((m) => `<li>${fmtDate(m.date)} — ${esc(m.kind)}${m.note ? ` (${esc(m.note)})` : ""}</li>`).join("")}</ul>
        <button type="button" class="btn sm" data-toggle-resolve>${resolved ? "إعادة فتح" : "تم الإتقان ✓"}</button>
      </div>` : ""}
    <div class="dlg-actions"><button class="btn primary">تم</button></div>`, () => {
    if (current) { current.note = $("[name=note]", form).value.trim(); save(); refreshAfterChange(); }
  }, (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.kind && current) {
      current.kind = b.dataset.kind;
      $$("[data-kind]", form).forEach((x) => x.classList.toggle("primary", x === b));
      save();
    } else if (b.dataset.delId) {
      db.mistakes = db.mistakes.filter((m) => m.id !== b.dataset.delId);
      save(); dlg.close(); refreshAfterChange(); toast("أُلغي الخطأ");
    } else if ("toggleResolve" in b.dataset) {
      history.forEach((m) => (m.resolved = !resolved));
      save(); dlg.close(); refreshAfterChange(); toast(resolved ? "أُعيد فتح الخطأ" : "أحسنت! تم تعليمه كمُتقَن");
    }
  });
}

// الضغط المطوّل على الكلمة (للجوال) أو الزر الأيمن (للحاسوب)
let longPressTimer = null, longPressFired = false, pressStart = null;
view.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".mushaf-page .w, .mushaf-page .ayah-no");
  longPressFired = false;
  if (!el) return;
  pressStart = [e.clientX, e.clientY];
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    const r = parseRoute();
    if (!getStudent(r.tab)) return;
    longPressFired = true;
    mushafWordDialog(r.tab, r.extra !== "-" ? r.extra : "", Number(el.dataset.s), Number(el.dataset.a),
      el.classList.contains("ayah-no") ? null : Number(el.dataset.i));
  }, 550);
});
view.addEventListener("pointermove", (e) => {
  if (pressStart && Math.hypot(e.clientX - pressStart[0], e.clientY - pressStart[1]) > 10) clearTimeout(longPressTimer);
});
["pointerup", "pointercancel"].forEach((t) => view.addEventListener(t, () => clearTimeout(longPressTimer)));
view.addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".mushaf-page .w, .mushaf-page .ayah-no");
  if (!el) return;
  e.preventDefault();
  clearTimeout(longPressTimer);
  if (longPressFired) return;
  longPressFired = true;
  const r = parseRoute();
  if (getStudent(r.tab)) mushafWordDialog(r.tab, r.extra !== "-" ? r.extra : "", Number(el.dataset.s), Number(el.dataset.a),
    el.classList.contains("ayah-no") ? null : Number(el.dataset.i));
});

/* ============ التوجيه والأحداث ============ */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "home", id: parts[1], tab: parts[2], extra: parts[3] };
}

function render() {
  document.body.classList.toggle("login-mode", loginRequired());
  document.body.classList.toggle("student-mode", isStudent());
  // الدخول بالضغط على رابط الدخول المرسل بواتساب
  const link = location.hash.match(/^#\/login\/([^/]+)/);
  if (link) {
    history.replaceState(null, "", "#/");
    const code = decodeURIComponent(link[1]);
    if (!auth) { document.body.classList.add("login-mode"); view.innerHTML = pageLogin(true); login(code); return; }
    if (auth.code !== code) setTimeout(() => linkLogin(code));
  }
  if (loginRequired()) { view.innerHTML = pageLogin(); return; }
  // الطالب يرى صفحته وحدها
  if (isStudent() && !location.hash.startsWith(`#/student/${auth.studentId}`)) {
    history.replaceState(null, "", `#/student/${auth.studentId}`);
  }
  const r = parseRoute();
  $("#brand-name").textContent = isStudent() ? programName() : db.settings.halaqaName || "صناعة الحافظ";
  const pages = { home: pageHome, students: pageStudents, mistakes: pageMistakes, reminders: pageReminders, settings: pageSettings };
  if (r.page !== "student") studentProgramTab.more = false;
  if (r.page !== "mushaf") { mushafView = null; document.body.classList.remove("mushaf-mode", "chrome-hidden"); }
  view.innerHTML = r.page === "student" ? pageStudent(r.id, r.tab)
    : r.page === "mushaf" ? pageMushaf(r.id, r.tab, r.extra)
    : r.page === "stats" ? pageStats(r.id, r.tab)
    : r.page === "assign" ? pageAssign()
    : (pages[r.page] || pageHome)();
  if (r.page === "mushaf") afterMushafRender();
  const navKey = r.page === "student" || r.page === "assign" ? "students" : r.page;
  $$(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
}

view.addEventListener("click", (e) => {
  if (Date.now() - swipeBlockClick < 400) return;
  const word = e.target.closest(".mushaf-page .w, .mushaf-page .ayah-no");
  if (word) {
    if (longPressFired) { longPressFired = false; return; }
    return mushafTap(word);
  }
  if (e.target.closest("#mstage")) {
    document.body.classList.toggle("chrome-hidden");
    requestAnimationFrame(() => requestAnimationFrame(fitLines));
    return;
  }
  const t = e.target.closest("button, [data-action]");
  if (!t) return;
  const r = parseRoute();
  const st = r.page === "student" ? getStudent(r.id) : null;
  const d = t.dataset;

  if (programClick(t) || syncClick(t)) return;
  if (d.remind) return reminderDialog(getStudent(d.remind));
  if (d.sendSession) return sessionSendDialog(d.sendSession);
  if (d.sendNote) return noteSendDialog(d.sendNote);
  if (d.editNote) return noteForm(r.id, db.notes.find((n) => n.id === d.editNote));
  if (d.delNote) {
    return confirmDialog("حذف هذه الملاحظة؟", () => {
      db.notes = db.notes.filter((n) => n.id !== d.delNote);
      save(); render();
    });
  }
  if (d.page) return goPage(Number(d.page) - mushafView.page);
  if (d.tab) { location.hash = `#/student/${r.id}/${d.tab}`; return; }
  if (d.mfilter) { pageStudent.filter = d.mfilter; return render(); }
  if (d.editSession) return finishSheet(db.sessions.find((s) => s.id === d.editSession));
  if (d.setKind) {
    mushafKind = d.setKind;
    try { localStorage.setItem("halaqa-kind", mushafKind); } catch {}
    $$("[data-set-kind]").forEach((b) => { b.classList.toggle("on", b === t); b.setAttribute("aria-checked", b === t); });
    return;
  }
  if (d.delSession) {
    return confirmDialog("حذف هذا التسميع وأخطائه؟", () => {
      db.sessions = db.sessions.filter((s) => s.id !== d.delSession);
      db.mistakes = db.mistakes.filter((m) => m.sessionId !== d.delSession);
      save(); render();
    });
  }
  if (d.resolve) {
    const items = db.mistakes.filter((m) => m.studentId === d.sid && mistakeKey(m) === d.resolve);
    const val = !items.every((m) => m.resolved);
    items.forEach((m) => (m.resolved = val));
    save(); render(); return toast(val ? "أحسنت! تم تعليمه كمُتقَن" : "أُعيد فتح الخطأ");
  }
  if (d.delMistake) {
    return confirmDialog("حذف آخر تسجيل لهذا الخطأ؟", () => {
      db.mistakes = db.mistakes.filter((m) => m.id !== d.delMistake);
      save(); render();
    });
  }

  switch (d.action) {
    case "add-student": return studentForm();
    case "edit-student": return studentForm(st);
    case "delete-student":
      return confirmDialog(`حذف الطالب ${st.name} وجميع سجلاته؟`, () => {
        db.students = db.students.filter((s) => s.id !== st.id);
        db.sessions = db.sessions.filter((s) => s.studentId !== st.id);
        db.mistakes = db.mistakes.filter((m) => m.studentId !== st.id);
        db.notes = db.notes.filter((n) => n.studentId !== st.id);
        db.daily = db.daily.filter((x) => x.studentId !== st.id);
        db.sard = db.sard.filter((x) => x.studentId !== st.id);
        db.exams = db.exams.filter((x) => x.studentId !== st.id);
        save(); location.hash = "#/students";
      });
    case "mushaf-index": return mushafIndexSheet();
    case "finish-session": {
      const sid = r.tab;
      const page = mushafView.page;
      const ses = ensureSession(sid, r.extra !== "-" ? r.extra : "", page);
      if (ses.draft) {
        // نهاية المقطع المقترحة: آخر آية في الصفحة الحالية، أو آخر خطأ إن كان أبعد
        const lastG = Math.max(pageRange(page)[1], ...sessionMistakes(ses).map((m) => toGlobal(m.surah, m.ayah)));
        const [ts, ta] = fromGlobal(Math.max(lastG, toGlobal(ses.surah, ses.fromAyah)));
        ses.toSurah = ts; ses.toAyah = ta;
      }
      save();
      return finishSheet(ses, { afterSave: () => { location.hash = `#/student/${sid}`; } });
    }
    case "add-note": return noteForm(r.id);
    case "reset-session-template":
      $("[name=sessionTemplate]").value = DEFAULT_SESSION_TEMPLATE; return;
    case "reset-template":
      $("[name=template]").value = DEFAULT_TEMPLATE; return;
    case "export": return backupDialog();
    case "import": return restoreDialog();
  }
});

view.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    pageStudents.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos);
  }
});

view.addEventListener("submit", (e) => {
  if (e.target.id === "login-form") {
    e.preventDefault();
    return login(new FormData(e.target).get("code"));
  }
  if (e.target.id === "assign-form") { e.preventDefault(); return saveAssign(e.target); }
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  Object.assign(db.settings, {
    halaqaName: fd.get("halaqaName").trim(), teacherName: fd.get("teacherName").trim(),
    countryCode: fd.get("countryCode").replace(/\D/g, ""), template: fd.get("template"), sessionTemplate: fd.get("sessionTemplate"),
    repeatThreshold: Number(fd.get("repeatThreshold")), ...readProgramSettings(fd)
  });
  save(); render(); toast("تم حفظ الإعدادات");
});

view.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "mushaf-page") {
    const v = parseInt(String(e.target.value).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), 10);
    if (v >= 1 && v <= 604) goPage(v - mushafView.page);
    else e.target.value = mushafView.page;
  }
});

window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();
syncInit();

try {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
} catch {}
