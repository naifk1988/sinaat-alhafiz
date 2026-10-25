"use strict";

/* ============ برنامج صناعة الحافظ ============ */
// التسميع اليومي بالصفحات، والتعويض يوم الخميس، والسرد الشهري، والتقرير الشهري والإحصائيات.
// يُحمَّل قبل app.js ويستعمل أدواته (db وsave وopenDialog…) وقت التنفيذ فقط.

const TOTAL_PAGES = 604;
const DAILY_STATUS = { done: "أنجز", failed: "أخطأ", absent: "غاب" };
const STATUS_ICON = { done: "✅", failed: "❌", absent: "🚫" };
const SHORT_DAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

/* ---------- التواريخ ---------- */
const dateObj = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateObj(s); d.setDate(d.getDate() + n); return todayStr(d); };
const dowOf = (s) => dateObj(s).getDay();
const weekStartOf = (s) => addDays(s, -dowOf(s));
// التقارير الشهرية بالشهر الهجري (تقويم أم القرى)، والميلادي إن لم يدعمه المتصفح.
// مفتاح الشهر مثل "1448-05"
const HIJRI = (() => {
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric" });
    return f.resolvedOptions().calendar.startsWith("islamic") ? f : null;
  } catch { return null; }
})();
function monthOf(s) {
  if (!HIJRI) return s.slice(0, 7);
  const p = Object.fromEntries(HIJRI.formatToParts(dateObj(s)).map((x) => [x.type, x.value]));
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}
const monthCache = {};
function monthRange(key) {
  if (monthCache[key]) return monthCache[key];
  const [y, m] = key.split("-").map(Number);
  let first, last;
  if (!HIJRI) { first = `${key}-01`; last = todayStr(new Date(y, m, 0)); }
  else {
    // تقدير أولي (السنة الهجرية نحو 354.37 يوماً، وأولها 16 يوليو 622م) ثم تصحيح بالتقويم نفسه
    let d = todayStr(new Date(622, 6, 16 + Math.round((y - 1) * 354.367 + (m - 1) * 29.53 + 14)));
    for (let i = 0; i < 60 && monthOf(d) !== key; i++) d = addDays(d, monthOf(d) < key ? 10 : -10);
    first = last = d;
    while (monthOf(addDays(first, -1)) === key) first = addDays(first, -1);
    while (monthOf(addDays(last, 1)) === key) last = addDays(last, 1);
  }
  return (monthCache[key] = { key, first, last });
}
const currentMonth = () => monthOf(todayStr());
const shiftMonth = (key, n) => { const r = monthRange(key); return monthOf(n < 0 ? addDays(r.first, -1) : addDays(r.last, 1)); };
function fmtMonth(key) {
  const d = dateObj(monthRange(key).first);
  return HIJRI ? d.toLocaleDateString("ar-SA-u-ca-islamic-umalqura", { month: "long", year: "numeric" })
    : d.toLocaleDateString("ar", { month: "long", year: "numeric" });
}
function fmtKhatm(s) {
  const d = dateObj(s);
  let hijri = "";
  try { hijri = d.toLocaleDateString("ar-SA-u-ca-islamic-umalqura", { month: "long", year: "numeric" }); } catch {}
  return `${d.toLocaleDateString("ar", { month: "long", year: "numeric" })}${hijri ? ` (${hijri})` : ""}`;
}

/* ---------- الإعدادات ---------- */
const programName = () => db.settings.programName || "برنامج صناعة الحافظ";
const programDays = () => db.settings.programDays || [0, 1, 2, 3];
const makeupDay = () => db.settings.makeupDay ?? 4;
// التعويض في يوم التعويض من الأسبوع نفسه
const makeupDateFor = (s) => addDays(s, (makeupDay() - dowOf(s) + 7) % 7 || 7);
const teachers = () => db.settings.teachers || [];
const getTeacher = (id) => teachers().find((t) => t.id === id);
const teacherOf = (st) => st && getTeacher(st.teacherId);
const dailyPagesOf = (st) => Number(st.dailyPages) || Number(db.settings.dailyPages) || 1;
function teacherOptions(selected) {
  return `<option value="">—</option>` + teachers().map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`).join("");
}

/* ---------- السجلات ---------- */
const studentDaily = (id) => db.daily.filter((r) => r.studentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const studentSard = (id) => db.sard.filter((r) => r.studentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const pagesOf = (r) => (r.fromPage && r.toPage ? Math.abs(r.toPage - r.fromPage) + 1 : 0);
const sardPagesOf = (r) => Number(r.pages) || pagesOf(r);
const wajhAr = (n) => (!n ? "0 وجه" : n === 1 ? "وجه واحد" : n === 2 ? "وجهان" : n % 100 >= 3 && n % 100 <= 10 ? `${n} أوجه` : `${n} وجهاً`);
function pageRangeText(r) {
  if (!pagesOf(r)) return "";
  return r.fromPage === r.toPage ? `صفحة ${r.fromPage}` : `من صفحة ${r.fromPage} إلى صفحة ${r.toPage}`;
}
// الورد الذي لم يُنجز (خطأ أو غياب) ولم يُعوَّض بعد
const isOwed = (r) => r.kind !== "makeup" && (r.status === "failed" || r.status === "absent") && !r.madeUpBy;
const owedRecords = (id) => studentDaily(id).filter(isOwed).reverse();
// الطالب يعدّل ما سجّله بنفسه ما لم يعتمده الشيخ
const canEditRec = (r) => !isStudent() || (r.bySelf && !r.approved);
function selfBadge(r) {
  if (!r.bySelf) return "";
  return r.approved ? `<span class="badge ok">سجّله الطالب · اعتمده الشيخ ✓</span>` : `<span class="badge warn">سجّله الطالب · بانتظار الاعتماد</span>`;
}
// ما سجّله الطالب بنفسه يعتمده الشيخ، وتعديل الشيخ له اعتماد
function markAuthor(r) {
  if (isStudent()) Object.assign(r, { bySelf: true, approved: false });
  else if (r.bySelf) r.approved = true;
}
const regularOn = (id, date) => studentDaily(id).find((r) => r.date === date && r.kind !== "makeup");

function forEachPage(r, fn) {
  for (let p = Math.min(r.fromPage, r.toPage); p <= Math.max(r.fromPage, r.toPage); p++) fn(p);
}
// كل الصفحات المحفوظة: ما حفظه قبل البرنامج، وكل ورد أنجزه (يومياً أو تعويضاً)
function memorizedSet(st, until = "9999-12-31") {
  const set = new Set();
  const before = Math.min(TOTAL_PAGES, Number(st.memorizedBefore) || 0);
  for (let i = 0; i < before; i++) set.add(st.direction === "desc" ? TOTAL_PAGES - i : i + 1);
  for (const r of db.daily) if (r.studentId === st.id && r.status === "done" && pagesOf(r) && r.date <= until) forEachPage(r, (p) => set.add(p));
  return set;
}
// آخر ما وصل إليه في الحفظ: أبعد صفحة في اتجاه حفظه
function reachedPage(st, until) {
  const set = memorizedSet(st, until);
  if (!set.size) return 0;
  return st.direction === "desc" ? Math.min(...set) : Math.max(...set);
}
const reachedText = (p) => (p ? `صفحة ${p} (سورة ${surahName(PAGE_SURAH[p - 1])})` : "لم يبدأ بعد");

/* ---------- الاختبار الشهري ---------- */
const examMax = () => Number(db.settings.examMax) || 100;
const examFor = (id, key) => db.exams.find((e) => e.studentId === id && e.month === key);
function examGrade(e) {
  const x = e.score / (e.max || examMax());
  return x >= 0.9 ? "ممتاز" : x >= 0.8 ? "جيد جداً" : x >= 0.7 ? "جيد" : x >= 0.6 ? "مقبول" : "ضعيف";
}
const examText = (e) => (e ? `${e.score} من ${e.max || examMax()} (${examGrade(e)})` : "لم يُرصد");

// رصد درجات الاختبار الشهري لعدة طلاب دفعة واحدة
function examDialog(key, ids) {
  const sts = ids.map(getStudent).filter(Boolean);
  openDialog(`
    <h2>درجات الاختبار الشهري — ${fmtMonth(key)}</h2>
    <p class="small muted">الدرجة من ${examMax()}. اترك الخانة فارغة لمن لم يُختبر.</p>
    ${sts.map((st) => { const e = examFor(st.id, key); return `<div class="examrow">
      <span class="grow"><b>${esc(st.name)}</b></span>
      <input name="score" data-sid="${st.id}" type="number" min="0" max="${examMax()}" step="0.5" inputmode="decimal" aria-label="درجة ${esc(st.name)}" value="${e ? e.score : ""}">
    </div>`; }).join("") || `<p class="empty">لا يوجد طلاب</p>`}
    ${dlgActions()}`, (fd, form) => {
    for (const inp of $$("[name=score]", form)) {
      const v = inp.value.trim(), sid = inp.dataset.sid;
      const e = examFor(sid, key);
      if (v === "") { if (e) db.exams = db.exams.filter((x) => x !== e); continue; }
      const score = Number(v);
      if (!(score >= 0 && score <= examMax())) { toast(`الدرجة من 0 إلى ${examMax()}`); inp.focus(); return false; }
      if (e) Object.assign(e, { score, max: examMax(), updatedAt: Date.now() });
      else db.exams.push({ id: uid(), studentId: sid, month: key, score, max: examMax(), createdAt: Date.now(), updatedAt: Date.now() });
    }
    save(); render(); toast("تم حفظ الدرجات");
  });
}
function pagesInPeriod(id, from, to) {
  const set = new Set();
  for (const r of db.daily) {
    if (r.studentId === id && r.status === "done" && pagesOf(r) && r.date >= from && r.date <= to) forEachPage(r, (p) => set.add(p));
  }
  return set.size;
}

// الختم المتوقع بمعدل الأسابيع الأربعة الأخيرة، أو بالمقدار اليومي المقرر إن لم توجد سجلات
function khatmProjection(st) {
  const done = memorizedSet(st).size, left = TOTAL_PAGES - done;
  if (left <= 0) return { done, left: 0, finished: true };
  const today = todayStr();
  const first = db.daily.filter((r) => r.studentId === st.id && r.status === "done").reduce((m, r) => (r.date < m ? r.date : m), today);
  const span = Math.min(28, Math.max(7, Math.round((dateObj(today) - dateObj(first)) / 864e5) + 1));
  const recent = pagesInPeriod(st.id, addDays(today, -span + 1), today);
  const planned = dailyPagesOf(st) * programDays().length;
  const perWeek = recent ? (recent * 7) / span : planned;
  return { done, left, perWeek, basedOnPlan: !recent, date: addDays(today, Math.ceil((left / perWeek) * 7)) };
}

// الصفحات المقترحة للورد التالي حسب اتجاه الحفظ
function nextPages(st) {
  const n = dailyPagesOf(st);
  const before = Number(st.memorizedBefore) || 0;
  const last = studentDaily(st.id).find((r) => r.status === "done" && pagesOf(r));
  if (st.direction === "desc") {
    const to = Math.max(1, last ? Math.min(last.fromPage, last.toPage) - 1 : TOTAL_PAGES - before);
    return [Math.max(1, to - n + 1), to];
  }
  const from = Math.min(TOTAL_PAGES, last ? Math.max(last.fromPage, last.toPage) + 1 : before + 1);
  return [from, Math.min(TOTAL_PAGES, from + n - 1)];
}

function surahAtPage(p) {
  if (typeof QPC_PAGES === "undefined" || !(p >= 1 && p <= TOTAL_PAGES)) return 0;
  return fromGlobal(QPC_PAGES[p - 1])[0];
}

/* ---------- إحصاءات الشهر ---------- */
function joinDate(st) {
  const created = st.createdAt ? todayStr(new Date(st.createdAt)) : "0000-00-00";
  return db.daily.filter((r) => r.studentId === st.id).reduce((m, r) => (r.date < m ? r.date : m), created);
}
function monthStats(st, ym) {
  const today = todayStr(), { first, last } = monthRange(ym);
  const from = first > joinDate(st) ? first : joinDate(st);
  const days = programDays();
  const recs = db.daily.filter((r) => r.studentId === st.id && r.date >= first && r.date <= last);
  const regs = recs.filter((r) => r.kind !== "makeup");
  const out = { required: 0, done: 0, failed: 0, absent: 0, unrecorded: 0, madeUp: 0, owed: 0 };
  for (let d = from; d <= last && d <= today; d = addDays(d, 1)) {
    if (!days.includes(dowOf(d))) continue;
    const r = regs.find((x) => x.date === d);
    if (!r && d === today) continue; // اليوم لم يُسجَّل بعد
    out.required++;
    if (!r) { out.unrecorded++; continue; }
    out[r.status]++;
    if (r.madeUpBy) out.madeUp++;
    else if (isOwed(r)) out.owed++;
  }
  out.achieved = out.done + out.madeUp;
  out.rate = out.required ? out.achieved / out.required : null;
  out.pages = pagesInPeriod(st.id, first, last);
  out.mistakes = recs.reduce((a, r) => a + (r.mistakes || []).length, 0);
  const sard = db.sard.filter((r) => r.studentId === st.id && r.date >= first && r.date <= last);
  out.sardPages = sard.reduce((a, r) => a + sardPagesOf(r), 0);
  out.sardSittings = sard.length;
  out.attended = out.done + out.failed;
  out.memorized = memorizedSet(st, last).size;
  out.reached = reachedPage(st, last);
  out.exam = examFor(st.id, ym);
  out.khatm = khatmProjection(st);
  return out;
}
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/* ---------- الرسائل ---------- */
const teacherLine = (r, st) => {
  const t = getTeacher(r.teacherId) || teacherOf(st);
  return t ? `👤 المعلم: ${t.name}` : "";
};
function mistakesLines(ms) {
  return ms.map((m, i) => `${i + 1}. سورة ${surahName(m.surah)} آية ${m.ayah}${m.note ? ` — ${m.note}` : ""}`).join("\n");
}
function buildDailyMessage(r) {
  const st = getStudent(r.studentId);
  const ms = r.mistakes || [];
  const n = pagesOf(r);
  const lines = ["السلام عليكم ورحمة الله وبركاته",
    `📋 ${programName()} — ${r.kind === "makeup" ? "تعويض " : ""}${fmtDate(r.date)}`,
    `🎓 الطالب: ${st.name}`, teacherLine(r, st)];
  if (n) lines.push(`📖 التسميع: ${pageRangeText(r)} (${wajhAr(n)})`);
  if (r.kind === "makeup") {
    const days = (r.makeupFor || []).map((id) => db.daily.find((x) => x.id === id)).filter(Boolean)
      .map((x) => `${fmtDate(x.date)} (${x.status === "absent" ? "غياب" : "خطأ"})`);
    if (r.status === "done") lines.push(`✅ عوّض ورد ${days.join("، ") || "الأيام الفائتة"}، بارك الله فيه.`);
    else lines.push(`❌ لم يجتز التعويض${days.length ? ` عن ${days.join("، ")}` : ""}، وما زال التعويض مطلوباً منه.`);
  } else if (r.status === "done") {
    lines.push(ms.length ? `✅ أنجز ورد اليوم مع ${ms.length === 1 ? "خطأ واحد" : `${ms.length} أخطاء`}` : "✅ أنجز ورد اليوم بلا أخطاء، بارك الله فيه.");
  } else if (r.status === "failed") {
    lines.push("❌ لم يُنجز ورد اليوم بسبب الخطأ");
  } else {
    lines.push("🚫 غاب عن تسميع اليوم فلم يُنجز الورد");
  }
  if (ms.length) lines.push(`📌 الأخطاء:\n${mistakesLines(ms)}`);
  if (r.kind !== "makeup" && isOwed(r)) lines.push(`⚠️ يلزمه التعويض يوم ${fmtDate(makeupDateFor(r.date))}`);
  if (r.notes) lines.push(`📝 ملاحظة: ${r.notes}`);
  return lines.filter(Boolean).join("\n");
}

function buildDaySummary(date, tid = "") {
  const sts = db.students.filter((s) => !tid || s.teacherId === tid);
  const groups = { done: [], failed: [], absent: [], none: [], makeup: [] };
  for (const st of sts) {
    const recs = studentDaily(st.id).filter((r) => r.date === date);
    const reg = recs.find((r) => r.kind !== "makeup");
    for (const m of recs.filter((r) => r.kind === "makeup" && r.status === "done")) groups.makeup.push(st.name);
    if (reg) groups[reg.status].push(reg.status === "failed" ? `${st.name} (${reg.mistakes.length} خطأ)` : st.name);
    else if (programDays().includes(dowOf(date))) groups.none.push(st.name);
  }
  const owed = sts.map((st) => ({ st, o: owedRecords(st.id) })).filter((x) => x.o.length);
  const line = (icon, label, list) => (list.length ? `${icon} ${label} (${list.length}): ${list.join("، ")}` : "");
  const t = getTeacher(tid);
  return ["السلام عليكم ورحمة الله وبركاته",
    `📋 ملخص ${programName()} — ${fmtDate(date)}${t ? ` — حلقة ${t.name}` : ""}`,
    line("✅", "أنجزوا", groups.done), line("❌", "أخطؤوا", groups.failed), line("🚫", "غابوا", groups.absent),
    line("⏺️", "لم يُسجَّل لهم تسميع", groups.none), line("↩️", "عوّضوا", groups.makeup),
    owed.length ? `⚠️ مطلوب منهم التعويض يوم ${DAYS[makeupDay()]}:\n${owed.map(({ st, o }) =>
      `• ${st.name}: ${o.map((r) => `${DAYS[dowOf(r.date)]} (${r.status === "absent" ? "غياب" : "خطأ"})`).join("، ")}`).join("\n")}` : "✅ لا يوجد تعويض مستحق"
  ].filter(Boolean).join("\n");
}

function buildSardMessage(r) {
  const st = getStudent(r.studentId);
  const ym = monthOf(r.date);
  const m = monthStats(st, ym);
  return ["السلام عليكم ورحمة الله وبركاته",
    `📚 سرد ${programName()} — ${fmtDate(r.date)}`, `🎓 الطالب: ${st.name}`, teacherLine(r, st),
    pagesOf(r) ? `📖 قرأ ${pageRangeText(r)}` : "", `🔢 عدد الأوجه: ${wajhAr(sardPagesOf(r))}`,
    r.mistakes ? `📌 الأخطاء: ${r.mistakes}` : "✅ بلا أخطاء",
    `📊 مجموع سرد شهر ${fmtMonth(ym)}: ${wajhAr(m.sardPages)} من محفوظه (${wajhAr(m.memorized)})`,
    r.notes ? `📝 ملاحظة: ${r.notes}` : ""].filter(Boolean).join("\n");
}

function khatmText(k) {
  if (k.finished) return "🎉 أتمّ حفظ القرآن كاملاً";
  return `🏁 الختم المتوقع: ${fmtKhatm(k.date)} — بمعدل ${wajhAr(Math.round(k.perWeek * 10) / 10)} أسبوعياً${k.basedOnPlan ? " (حسب الخطة)" : ""}`;
}
function buildMonthlyReport(st, ym) {
  const m = monthStats(st, ym);
  const t = teacherOf(st);
  return ["السلام عليكم ورحمة الله وبركاته",
    `📊 التقرير الشهري — ${programName()}`, `🗓️ شهر ${fmtMonth(ym)}`, `🎓 الطالب: ${st.name}`, t ? `👤 المعلم: ${t.name}` : "",
    "",
    `📍 وصل في الحفظ إلى: ${reachedText(m.reached)}`,
    `📝 الاختبار الشهري: ${examText(m.exam)}`,
    "",
    `🙋 الحضور: حضر ${m.attended} من ${m.required} يوماً${m.absent ? `، وغاب ${m.absent}` : ""}`,
    `✅ أنجز: ${m.done} · ↩️ عوّض: ${m.madeUp}`,
    `❌ أخطأ: ${m.failed} · 🚫 غاب: ${m.absent}${m.unrecorded ? ` · ⏺️ لم يُسجَّل: ${m.unrecorded}` : ""}`,
    m.owed ? `⚠️ لم يعوّض بعد: ${m.owed}` : "",
    `🎯 نسبة الإنجاز: ${pct(m.rate)}`,
    `📌 مجموع الأخطاء: ${m.mistakes}`,
    "",
    `📖 حفظ هذا الشهر: ${wajhAr(m.pages)}`,
    `📚 السرد هذا الشهر: ${wajhAr(m.sardPages)} في ${m.sardSittings} ${m.sardSittings === 1 ? "مجلس" : "مجالس"}`,
    `📗 مجموع المحفوظ: ${wajhAr(m.memorized)} من ${TOTAL_PAGES} (${pct(m.memorized / TOTAL_PAGES)})`,
    khatmText(m.khatm)].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}
function buildMonthSummary(ym, tid = "") {
  const sts = db.students.filter((s) => !tid || s.teacherId === tid).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const t = getTeacher(tid);
  const rows = sts.map((st, i) => {
    const m = monthStats(st, ym);
    return [`${i + 1}. ${st.name}`,
      `   📍 وصل إلى: ${reachedText(m.reached)} — المحفوظ ${wajhAr(m.memorized)}`,
      `   📖 حفظ الشهر: ${wajhAr(m.pages)} · 📚 السرد: ${wajhAr(m.sardPages)}`,
      `   🙋 الحضور: ${m.attended}/${m.required}${m.absent ? ` (غاب ${m.absent})` : ""} · الإنجاز ${pct(m.rate)}${m.owed ? ` · ⚠️ لم يعوّض ${m.owed}` : ""}`,
      `   📝 الاختبار: ${examText(m.exam)}`].join("\n");
  });
  return ["السلام عليكم ورحمة الله وبركاته", `📊 التقرير الشهري — ${fmtMonth(ym)}`, `${programName()}${t ? ` — حلقة ${t.name}` : ""}`,
    `عدد الطلاب: ${sts.length}`, "", rows.join("\n\n")].join("\n");
}

/* ---------- نافذة الإرسال لأكثر من جهة ---------- */
function recipientsFor(st) {
  const t = teacherOf(st);
  const s = db.settings;
  return [
    st && st.phone && !isStudent() && { label: "الطالب", phone: st.phone },
    st && st.guardianPhone && { label: "ولي الأمر", phone: st.guardianPhone },
    t && t.phone && { label: `المعلم (${t.name})`, phone: t.phone },
    s.supervisorPhone && { label: `المشرف${s.supervisorName ? ` (${s.supervisorName})` : ""}`, phone: s.supervisorPhone }
  ].filter(Boolean);
}
function staffRecipients(tid) {
  const s = db.settings;
  return [
    s.supervisorPhone && { label: `المشرف${s.supervisorName ? ` (${s.supervisorName})` : ""}`, phone: s.supervisorPhone },
    ...teachers().filter((t) => t.phone && (!tid || t.id === tid)).map((t) => ({ label: `المعلم (${t.name})`, phone: t.phone }))
  ].filter(Boolean);
}
// واتساب لا يسمح بالإرسال الآلي لعدة أرقام دون خادم، فلكل جهة زر يفتح المحادثة والرسالة جاهزة
function multiSendDialog({ title, text, recipients, onSent }) {
  const form = openDialog(`
    <h2>${title}</h2>
    <label><span>نص الرسالة (يمكنك تعديله)</span><textarea name="text" rows="12" style="min-height:240px">${esc(text)}</textarea></label>
    <p class="small muted">اضغط على كل جهة لفتح واتساب والرسالة جاهزة، ثم اضغط «إرسال» في واتساب.</p>
    <div class="sendlist">
      ${recipients.map((r, i) => `<a class="btn whatsapp" data-wa="${i}" target="_blank" rel="noopener" href="#">واتساب: ${esc(r.label)}</a>`).join("")}
      <a class="btn" data-wa="group" target="_blank" rel="noopener" href="#">📲 اختيار جهة أو مجموعة في واتساب</a>
    </div>
    ${recipients.length ? "" : `<p class="badge warn">لا توجد أرقام محفوظة — أضف أرقام الطالب والمعلم والمشرف من البيانات والإعدادات</p>`}
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn" data-copy>نسخ</button><span class="grow"></span>
      <button type="button" class="btn" data-close>إغلاق</button>
    </div>`, () => false);
  const ta = $("[name=text]", form);
  const update = () => $$("[data-wa]", form).forEach((a) => {
    const r = recipients[a.dataset.wa];
    a.href = r ? waLink(r.phone, ta.value) : `https://wa.me/?text=${encodeURIComponent(ta.value)}`;
  });
  ta.addEventListener("input", update);
  update();
  form.onclick = async (e) => {
    const a = e.target.closest("[data-wa]");
    if (a) {
      a.classList.add("sent");
      if (!a.textContent.startsWith("✓")) a.textContent = "✓ " + a.textContent;
      if (onSent) { onSent(); save(); }
      return;
    }
    if (e.target.closest("[data-copy]")) {
      try { await navigator.clipboard.writeText(ta.value); toast("تم نسخ الرسالة"); }
      catch { ta.select(); document.execCommand("copy"); toast("تم النسخ"); }
    }
  };
  dlg.addEventListener("close", () => render(), { once: true });
}

function dailySendDialog(id) {
  const r = db.daily.find((x) => x.id === id);
  const st = r && getStudent(r.studentId);
  if (!st) return;
  multiSendDialog({ title: `إرسال تقرير اليوم — ${esc(st.name)}`, text: buildDailyMessage(r), recipients: recipientsFor(st), onSent: () => { r.sentAt = Date.now(); } });
}
function sardSendDialog(id) {
  const r = db.sard.find((x) => x.id === id);
  const st = r && getStudent(r.studentId);
  if (!st) return;
  multiSendDialog({ title: `إرسال السرد — ${esc(st.name)}`, text: buildSardMessage(r), recipients: recipientsFor(st), onSent: () => { r.sentAt = Date.now(); } });
}

/* ---------- نموذج التسميع اليومي ---------- */
function mistakeRow(m = {}) {
  return `<div class="mrow">
    <select name="mSurah" aria-label="السورة">${surahOptions(m.surah || 1)}</select>
    <input name="mAyah" type="number" min="1" inputmode="numeric" placeholder="الآية" aria-label="رقم الآية" value="${m.ayah || ""}">
    <input name="mNote" placeholder="الخطأ (اختياري)" aria-label="وصف الخطأ" value="${esc(m.note || "")}">
    <button type="button" class="btn sm danger" data-rm-m aria-label="حذف الخطأ">✕</button>
  </div>`;
}

function dailyForm(studentId, rec = null, preset = {}) {
  const st = getStudent(studentId);
  if (!st) return;
  loadQuran().catch(() => {}); // لمعرفة سورة الصفحة عند إضافة خطأ
  const date = rec ? rec.date : preset.date || todayStr();
  const linked = rec ? db.daily.filter((x) => x.madeUpBy === rec.id) : [];
  const owed = [...linked, ...owedRecords(studentId).filter((x) => !rec || x.id !== rec.id)].sort((a, b) => a.date.localeCompare(b.date));
  const kind = rec ? rec.kind || "regular" : preset.kind || (owed.length && dowOf(date) === makeupDay() ? "makeup" : "regular");
  const firstOwed = owed.find((x) => pagesOf(x));
  const [nf, nt] = kind === "makeup" && firstOwed && !rec ? [firstOwed.fromPage, firstOwed.toPage] : nextPages(st);
  const r = rec || { fromPage: nf, toPage: nt, status: "done", mistakes: [], teacherId: st.teacherId || "" };
  const checked = (x) => (rec ? (rec.makeupFor || []).includes(x.id) : x === owed[0]);

  const form = openDialog(`
    <h2>${rec ? "تعديل التسميع" : "تسجيل التسميع"} — ${esc(st.name)}</h2>
    <div class="grid2">
      <label><span>التاريخ</span><input name="date" type="date" required value="${esc(date)}"></label>
      <label ${isStudent() ? "hidden" : ""}><span>المعلم</span><select name="teacherId">${teacherOptions(r.teacherId)}</select></label>
    </div>
    <p class="field-label">نوع اليوم</p>
    ${chips("kind", [["regular", "ورد يومي"], ["makeup", `↩️ تعويض`]], kind)}
    <div class="makeup-box" ${kind === "makeup" ? "" : "hidden"}>
      <p class="field-label">يعوّض عن</p>
      ${owed.length ? owed.map((x) => `<label class="row" style="margin:0 0 6px"><input type="checkbox" name="makeupFor" value="${x.id}" ${checked(x) ? "checked" : ""} style="width:auto;min-height:0">
        ${fmtDate(x.date)} — ${x.status === "absent" ? "غياب" : "خطأ"}${pagesOf(x) ? ` (${pageRangeText(x)})` : ""}</label>`).join("")
        : `<p class="small muted">لا يوجد يوم مستحق للتعويض.</p>`}
    </div>
    <p class="field-label">النتيجة</p>
    ${chips("status", Object.entries(DAILY_STATUS).filter(([k]) => !isStudent() || k !== "absent").map(([k, v]) => [k, `${STATUS_ICON[k]} ${v}`]), r.status)}
    <div class="grid2 pages-box" style="margin-top:12px">
      <label><span>من صفحة</span><input name="fromPage" type="number" min="1" max="${TOTAL_PAGES}" inputmode="numeric" value="${r.fromPage || ""}"></label>
      <label><span>إلى صفحة</span><input name="toPage" type="number" min="1" max="${TOTAL_PAGES}" inputmode="numeric" value="${r.toPage || ""}"></label>
    </div>
    <div class="mistakes-box">
      <div class="row between"><p class="field-label" style="margin:0">الآيات التي وقع فيها الخطأ</p>
        <button type="button" class="btn sm" data-add-m>+ خطأ</button></div>
      <div class="mrows">${(r.mistakes || []).map(mistakeRow).join("")}</div>
      <p class="small muted" data-m-hint>${(r.mistakes || []).length ? "" : "لا أخطاء. اضغط «+ خطأ» لتسجيل الآية."}</p>
    </div>
    <label><span>ملاحظة (اختياري، تُرسل في التقرير)</span><input name="notes" value="${esc(r.notes || "")}"></label>
    <div class="dlg-actions">
      <button type="button" class="btn" data-close>إلغاء</button>
      <button class="btn primary">حفظ</button>
      <button class="btn whatsapp" data-send-after>حفظ وإرسال 📤</button>
    </div>`, (fd, f, submitter) => {
    const status = fd.get("status"), k = fd.get("kind");
    const fromPage = Number(fd.get("fromPage")) || 0, toPage = Number(fd.get("toPage")) || 0;
    const inRange = (p) => p >= 1 && p <= TOTAL_PAGES;
    if (status !== "absent" && (!inRange(fromPage) || !inRange(toPage))) { toast(`أدخل الصفحات من 1 إلى ${TOTAL_PAGES}`); return false; }
    const ms = [];
    const surahs = fd.getAll("mSurah"), ayahs = fd.getAll("mAyah"), notes = fd.getAll("mNote");
    for (let i = 0; i < surahs.length; i++) {
      const surah = Number(surahs[i]), ayah = Number(ayahs[i]);
      if (!ayah && !notes[i].trim()) continue;
      if (!(ayah >= 1 && ayah <= surahAyahs(surah))) { toast(`رقم الآية غير صحيح في سورة ${surahName(surah)} (1–${surahAyahs(surah)})`); return false; }
      ms.push({ surah, ayah, note: notes[i].trim() });
    }
    const data = {
      date: fd.get("date") || date, kind: k, status, teacherId: fd.get("teacherId"),
      fromPage: status === "absent" && !fromPage ? 0 : fromPage, toPage: status === "absent" && !toPage ? 0 : toPage,
      mistakes: status === "absent" ? [] : ms, notes: fd.get("notes").trim(), updatedAt: Date.now()
    };
    let target = rec;
    if (target) Object.assign(target, data);
    else { target = { id: uid(), studentId, createdAt: Date.now(), ...data }; db.daily.push(target); }
    markAuthor(target);
    // ربط التعويض بالأيام التي يعوّضها
    const chosen = k === "makeup" ? fd.getAll("makeupFor") : [];
    target.makeupFor = chosen;
    db.daily.forEach((x) => {
      if (x.madeUpBy === target.id && !(chosen.includes(x.id) && status === "done")) delete x.madeUpBy;
      if (chosen.includes(x.id) && status === "done") { x.madeUpBy = target.id; x.updatedAt = Date.now(); }
    });
    save();
    toast("تم الحفظ");
    render();
    // عند الخطأ أو الغياب تُجهَّز رسالة التعويض للطالب والمعلم والمشرف مباشرة
    const notify = (submitter && "sendAfter" in submitter.dataset) || (!rec && (status !== "done" || isStudent()));
    if (notify) setTimeout(() => dailySendDialog(target.id));
  }, (e) => {
    if (e.target.closest("[data-add-m]")) {
      const rows = $(".mrows", form);
      const prev = $$("[name=mSurah]", rows).pop();
      const surah = prev ? Number(prev.value) : surahAtPage(Number($("[name=fromPage]", form).value)) || 1;
      rows.insertAdjacentHTML("beforeend", mistakeRow({ surah }));
      $$("[name=mAyah]", rows).pop().focus();
      syncStatus();
    } else if (e.target.closest("[data-rm-m]")) {
      e.target.closest(".mrow").remove();
      syncStatus();
    }
  });

  // تجاوز عدد الأخطاء المسموح يجعل النتيجة «أخطأ» ما لم يغيّرها الشيخ بنفسه
  let statusTouched = !!rec;
  const syncStatus = () => {
    const n = $$(".mrow", form).length;
    $("[data-m-hint]", form).textContent = n ? "" : "لا أخطاء. اضغط «+ خطأ» لتسجيل الآية.";
    if (statusTouched) return;
    const val = n > (Number(db.settings.passMistakes) || 0) ? "failed" : "done";
    $(`[name=status][value=${val}]`, form).checked = true;
    syncBoxes();
  };
  const syncBoxes = () => {
    const status = $("[name=status]:checked", form).value;
    $(".mistakes-box", form).hidden = status === "absent";
    $(".makeup-box", form).hidden = $("[name=kind]:checked", form).value !== "makeup";
  };
  form.onchange = (e) => {
    if (e.target.name === "status") statusTouched = true;
    if (e.target.name === "kind" && e.target.value === "makeup" && !rec) {
      const o = owed.find((x) => pagesOf(x));
      if (o) { $("[name=fromPage]", form).value = o.fromPage; $("[name=toPage]", form).value = o.toPage; }
    }
    syncBoxes();
  };
  syncBoxes();
}

/* ---------- نموذج السرد ---------- */
function sardForm(studentId, rec = null) {
  const st = getStudent(studentId);
  if (!st) return;
  const r = rec || { date: todayStr(), teacherId: st.teacherId || "", mistakes: 0 };
  const form = openDialog(`
    <h2>${rec ? "تعديل السرد" : "تسجيل سرد"} — ${esc(st.name)}</h2>
    <p class="small muted">السرد الشهري: يقرأ الطالب محفوظه في مجلس أو أكثر. سجّل كل مجلس، ويُجمع عدد الأوجه للشهر تلقائياً.</p>
    <div class="grid2">
      <label><span>التاريخ</span><input name="date" type="date" required value="${esc(r.date)}"></label>
      <label ${isStudent() ? "hidden" : ""}><span>المعلم</span><select name="teacherId">${teacherOptions(r.teacherId)}</select></label>
      <label><span>من صفحة</span><input name="fromPage" type="number" min="1" max="${TOTAL_PAGES}" inputmode="numeric" value="${r.fromPage || ""}"></label>
      <label><span>إلى صفحة</span><input name="toPage" type="number" min="1" max="${TOTAL_PAGES}" inputmode="numeric" value="${r.toPage || ""}"></label>
      <label><span>عدد الأوجه</span><input name="pages" type="number" min="0" inputmode="numeric" value="${r.pages || pagesOf(r) || ""}"></label>
      <label><span>عدد الأخطاء</span><input name="mistakes" type="number" min="0" inputmode="numeric" value="${r.mistakes || 0}"></label>
    </div>
    <label><span>ملاحظة (اختياري)</span><input name="notes" value="${esc(r.notes || "")}"></label>
    <div class="dlg-actions">
      <button type="button" class="btn" data-close>إلغاء</button>
      <button class="btn primary">حفظ</button>
      <button class="btn whatsapp" data-send-after>حفظ وإرسال 📤</button>
    </div>`, (fd, f, submitter) => {
    const data = {
      date: fd.get("date"), teacherId: fd.get("teacherId"), fromPage: Number(fd.get("fromPage")) || 0, toPage: Number(fd.get("toPage")) || 0,
      pages: Number(fd.get("pages")) || 0, mistakes: Number(fd.get("mistakes")) || 0, notes: fd.get("notes").trim(), updatedAt: Date.now()
    };
    if (!data.pages) data.pages = pagesOf(data);
    if (!data.pages) { toast("أدخل الصفحات أو عدد الأوجه"); return false; }
    let target = rec;
    if (target) Object.assign(target, data);
    else { target = { id: uid(), studentId, createdAt: Date.now(), ...data }; db.sard.push(target); }
    markAuthor(target);
    save(); toast("تم حفظ السرد"); render();
    if (submitter && "sendAfter" in submitter.dataset) setTimeout(() => sardSendDialog(target.id));
  });
  // عدد الأوجه يُحسب من الصفحات ما لم يكتبه الشيخ بنفسه
  let pagesTouched = !!(rec && rec.pages && rec.pages !== pagesOf(rec));
  form.oninput = (e) => {
    if (e.target.name === "pages") pagesTouched = true;
    if ((e.target.name === "fromPage" || e.target.name === "toPage") && !pagesTouched) {
      const n = pagesOf({ fromPage: Number($("[name=fromPage]", form).value), toPage: Number($("[name=toPage]", form).value) });
      $("[name=pages]", form).value = n || "";
    }
  };
}

/* ---------- العرض ---------- */
function weekCell(st, date) {
  const today = todayStr();
  const dw = dowOf(date);
  const label = `${SHORT_DAYS[dw]} ${Number(date.slice(8))}`;
  if (dw === makeupDay()) {
    const mk = studentDaily(st.id).filter((r) => r.date === date && r.kind === "makeup");
    const owesThisWeek = owedRecords(st.id).some((r) => makeupDateFor(r.date) === date);
    const icon = mk.length ? mk.map((r) => (r.status === "done" ? "↩️" : "❌")).join("") : owesThisWeek ? (date < today ? "⚠️" : "⏳") : "·";
    const title = mk.length ? "تعويض" : owesThisWeek ? "عليه تعويض" : "لا تعويض";
    return `<button class="wc mk ${owesThisWeek && !mk.length ? "due" : ""}" title="${label}: ${title}" data-daily-new="${st.id}" data-date="${date}" data-kind="makeup"><b>${icon}</b></button>`;
  }
  const r = regularOn(st.id, date);
  if (r) {
    const cls = r.status === "done" || r.madeUpBy ? "ok" : "bad";
    return `<button class="wc ${cls}" title="${label}: ${DAILY_STATUS[r.status]}${r.madeUpBy ? " ثم عوّض" : ""}" data-daily-edit="${r.id}"><b>${STATUS_ICON[r.status]}${r.madeUpBy ? "↩️" : ""}</b></button>`;
  }
  const future = date > today;
  return `<button class="wc ${future ? "future" : date === today ? "today" : "missing"}" title="${label}: ${future ? "لم يأتِ بعد" : "لم يُسجَّل"}" ${future ? "disabled" : `data-daily-new="${st.id}" data-date="${date}"`}><b>${future ? "" : date === today ? "＋" : "—"}</b></button>`;
}
const weekDates = (ws) => [...programDays(), makeupDay()].sort((a, b) => a - b).map((d) => addDays(ws, d));
function weekBoard(students, ws) {
  const dates = weekDates(ws);
  const cols = `minmax(90px, 1.6fr) repeat(${dates.length}, minmax(34px, 1fr))`;
  return `<div class="board" style="grid-template-columns:${cols}">
    <span></span>${dates.map((d) => `<span class="bh ${d === todayStr() ? "now" : ""}">${SHORT_DAYS[dowOf(d)]}<br>${Number(d.slice(8))}</span>`).join("")}
    ${students.map((st) => `<a class="bn" href="#/student/${st.id}">${esc(st.name)}</a>${dates.map((d) => weekCell(st, d)).join("")}`).join("")}
  </div>
  <p class="small muted" style="margin:6px 0 0">✅ أنجز · ❌ أخطأ · 🚫 غاب · ↩️ عوّض · ⏳ عليه تعويض · — لم يُسجَّل. اضغط على أي خانة للتسجيل.</p>`;
}

const progressBar = (x, label) => `<div class="bar" role="img" aria-label="${label}"><i style="width:${Math.max(0, Math.min(100, x * 100)).toFixed(1)}%"></i></div>`;

const pendingApprovals = () => [
  ...db.daily.filter((r) => r.bySelf && !r.approved).map((r) => ({ c: "daily", r })),
  ...db.sard.filter((r) => r.bySelf && !r.approved).map((r) => ({ c: "sard", r }))
].filter((x) => getStudent(x.r.studentId)).sort((a, b) => b.r.date.localeCompare(a.r.date));
function approvalsHtml(tid) {
  const list = pendingApprovals().filter((x) => !tid || getStudent(x.r.studentId).teacherId === tid);
  if (!list.length) return "";
  return `<h2>سجّلها الطلاب — بانتظار اعتمادك (${list.length})</h2>
    <div class="card"><ul class="list">${list.slice(0, 15).map(({ c, r }) => `<li class="row between">
      <span class="grow"><b>${esc(getStudent(r.studentId).name)}</b><br><span class="small muted">${c === "sard" ? `📚 سرد ${wajhAr(sardPagesOf(r))}` :
        `${STATUS_ICON[r.status]} ${r.kind === "makeup" ? "تعويض" : DAILY_STATUS[r.status]}${pagesOf(r) ? ` · ${pageRangeText(r)}` : ""}${(r.mistakes || []).length ? ` · ${r.mistakes.length} خطأ` : ""}`} · ${fmtDate(r.date)}</span></span>
      ${c === "daily" ? `<button class="btn sm" data-daily-edit="${r.id}">مراجعة</button>` : `<button class="btn sm" data-sard-edit="${r.id}">مراجعة</button>`}
      <button class="btn sm primary" data-approve="${c}|${r.id}">✓ اعتماد</button></li>`).join("")}</ul>
      ${list.length > 1 ? `<button class="btn sm block" style="margin-top:8px" data-approve="all">✓ اعتماد الكل</button>` : ""}</div>`;
}

function programHomeSection() {
  if (!db.students.length) return "";
  const today = todayStr(), dw = dowOf(today);
  const tid = programHomeSection.tid || "";
  const sts = db.students.filter((s) => !tid || s.teacherId === tid).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const isDay = programDays().includes(dw), isMakeup = dw === makeupDay();
  const owed = sts.map((st) => ({ st, o: owedRecords(st.id) })).filter((x) => x.o.length);
  const pending = isDay ? sts.filter((st) => !regularOn(st.id, today)) : [];
  const cur = currentMonth(), left = Math.round((dateObj(monthRange(cur).last) - dateObj(today)) / 864e5);
  const prev = shiftMonth(cur, -1), sinceStart = Math.round((dateObj(today) - dateObj(monthRange(cur).first)) / 864e5);
  const reportKey = left <= 3 ? cur : sinceStart <= 4 ? prev : "";
  const missingExams = reportKey ? sts.filter((st) => !examFor(st.id, reportKey)).length : 0;
  return `
    ${reportKey ? `<div class="card notice">
      <b>🗓️ ${reportKey === cur ? `اقتربت نهاية شهر ${fmtMonth(cur)}${left ? ` (بقي ${left === 1 ? "يوم" : left === 2 ? "يومان" : `${left} أيام`})` : " — اليوم آخره"}` : `انتهى شهر ${fmtMonth(prev)}`}</b>
      <div class="small">${missingExams ? `لم تُرصد درجة الاختبار لـ ${missingExams} من ${sts.length} طالب. ` : "رُصدت درجات الاختبار. "}التقرير الشهري جاهز للإرسال.</div>
      <div class="row" style="margin-top:8px">
        ${missingExams ? `<button class="btn sm" data-exam="${reportKey}" data-ids="${sts.map((x) => x.id).join(",")}">📝 رصد الدرجات</button>` : ""}
        <a class="btn sm primary" href="#/stats/${reportKey}${tid ? "/" + tid : ""}">📊 التقرير الشهري</a>
      </div></div>` : ""}
    ${approvalsHtml(tid)}
    <h2>${esc(programName())}</h2>
    ${teachers().length > 1 ? `<div class="tabs" style="margin-top:0">${[["", "الكل"], ...teachers().map((t) => [t.id, t.name])].map(([id, n]) =>
      `<button data-home-teacher="${id}" class="${tid === id ? "active" : ""}">${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="card">
      <div class="row between"><b>هذا الأسبوع</b>
        <button class="btn sm whatsapp" data-day-summary="${today}" data-tid="${tid}">📤 ملخص اليوم للمشرف</button></div>
      <div style="margin-top:10px">${weekBoard(sts, weekStartOf(today))}</div>
    </div>
    ${isDay && pending.length ? `<h2>لم يُسجَّل تسميعهم اليوم (${pending.length})</h2>
      <div class="card"><ul class="list">${pending.map((st) => `<li class="row between">
        <a class="student-link grow" href="#/student/${st.id}"><span class="avatar">${initials(st.name)}</span><b>${esc(st.name)}</b></a>
        <span class="muted small">${pageRangeText({ fromPage: nextPages(st)[0], toPage: nextPages(st)[1] })}</span>
        <button class="btn sm primary" data-daily-new="${st.id}" data-date="${today}">📝 تسجيل</button></li>`).join("")}</ul></div>` : ""}
    ${owed.length ? `<h2>${isMakeup ? "تعويض اليوم" : `مطلوب تعويضهم يوم ${DAYS[makeupDay()]}`} (${owed.length})</h2>
      <div class="card"><ul class="list">${owed.map(({ st, o }) => `<li class="row between">
        <span class="grow"><b>${esc(st.name)}</b><br><span class="small muted">${o.map((r) => `${DAYS[dowOf(r.date)]} ${Number(r.date.slice(8))} (${r.status === "absent" ? "غياب" : "خطأ"})`).join("، ")}</span></span>
        <button class="btn sm primary" data-daily-new="${st.id}" data-date="${today}" data-kind="makeup">↩️ تسجيل التعويض</button></li>`).join("")}</ul></div>` : ""}
    <div class="row" style="margin-top:10px">
      <a class="btn" href="#/stats">📊 الإحصائيات والتقرير الشهري</a>
      <a class="btn" href="#/reminders">🔔 التذكير</a>
    </div>`;
}

function dailyCard(r) {
  const ms = r.mistakes || [];
  const n = pagesOf(r);
  const cls = r.status === "done" ? "ok" : r.madeUpBy ? "warn" : "danger";
  return `<div class="card">
    <div class="row between">
      <b>${r.kind === "makeup" ? "↩️ تعويض" : DAYS[dowOf(r.date)]}${n ? ` · ${pageRangeText(r)}` : ""}</b>
      <span class="badge ${cls}">${STATUS_ICON[r.status]} ${DAILY_STATUS[r.status]}${r.madeUpBy ? " · عوّض" : isOwed(r) ? " · يلزمه التعويض" : ""}</span>
    </div>
    <div class="muted small">${fmtDate(r.date)}${n ? ` · ${wajhAr(n)}` : ""}${getTeacher(r.teacherId) ? ` · ${esc(getTeacher(r.teacherId).name)}` : ""}${r.sentAt ? ` · <span class="badge ok">أُرسل ✓</span>` : ""}</div>
    ${r.bySelf ? `<div style="margin-top:4px">${selfBadge(r)}</div>` : ""}
    ${ms.length ? `<div class="small" style="margin-top:6px">📌 ${ms.map((m) => `<span class="badge warn">${surahName(m.surah)} ${m.ayah}${m.note ? `: ${esc(m.note)}` : ""}</span>`).join(" ")}</div>` : ""}
    ${r.notes ? `<div class="small" style="margin-top:4px">📝 ${esc(r.notes)}</div>` : ""}
    <div class="row" style="margin-top:8px">
      <button class="btn sm whatsapp" data-daily-send="${r.id}">📤 ${r.sentAt ? "إعادة إرسال" : "إرسال"}</button>
      ${isOwed(r) ? `<button class="btn sm primary" data-daily-new="${r.studentId}" data-date="${todayStr()}" data-kind="makeup">↩️ تعويض</button>` : ""}
      ${r.bySelf && !r.approved && !isStudent() ? `<button class="btn sm primary" data-approve="daily|${r.id}">✓ اعتماد</button>` : ""}
      ${canEditRec(r) ? `<button class="btn sm" data-daily-edit="${r.id}">تعديل</button>
      <button class="btn sm danger" data-daily-del="${r.id}">حذف</button>` : ""}
    </div>
  </div>`;
}

function studentProgramTab(st) {
  const ym = currentMonth();
  const m = monthStats(st, ym);
  const recs = studentDaily(st.id);
  const shown = recs.slice(0, studentProgramTab.more ? recs.length : 20);
  return `
    <div class="card">
      <div class="row between"><b>التقدم نحو الختم</b><span class="badge">${wajhAr(m.memorized)} من ${TOTAL_PAGES}</span></div>
      ${progressBar(m.memorized / TOTAL_PAGES, `محفوظ ${pct(m.memorized / TOTAL_PAGES)}`)}
      <div class="small" style="margin-top:6px">${khatmText(m.khatm)}</div>
      <div class="small">📍 وصل إلى: ${reachedText(m.reached)}</div>
      <div class="small muted">المقدار اليومي: ${wajhAr(dailyPagesOf(st))} · ${st.direction === "desc" ? "من آخر المصحف" : "من أول المصحف"}</div>
      <div class="stats two" style="margin:12px 0 0">
        <div class="stat"><b>${m.exam ? m.exam.score : "—"}</b><span>اختبار ${fmtMonth(ym).replace(/\s*[\d٠-٩]+.*$/, "")}</span></div>
        <div class="stat"><b>${pct(m.rate)}</b><span>إنجاز الشهر</span></div>
        <div class="stat"><b>${m.pages}</b><span>وجه حُفظ الشهر</span></div>
        <div class="stat"><b>${m.sardPages}</b><span>وجه سرد الشهر</span></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn sm whatsapp" data-month-report="${st.id}" data-ym="${ym}">📤 التقرير الشهري</button>
        ${isStudent() ? "" : `<button class="btn sm" data-exam="${ym}" data-ids="${st.id}">📝 درجة الاختبار</button>`}
      </div>
    </div>
    <div class="card"><b>هذا الأسبوع</b><div style="margin-top:8px">${weekBoard([st], weekStartOf(todayStr()))}</div></div>
    ${recs.length ? shown.map(dailyCard).join("") : `<div class="card empty">لا يوجد تسميع مسجّل في البرنامج بعد. اضغط «📝 تسجيل اليوم».</div>`}
    ${recs.length > shown.length ? `<button class="btn block" data-daily-more>عرض الكل (${recs.length})</button>` : ""}`;
}

function studentSardTab(st) {
  const recs = studentSard(st.id);
  const months = [...new Set(recs.map((r) => monthOf(r.date)))];
  const memorized = memorizedSet(st).size;
  return `
    <div class="row between" style="margin-bottom:10px">
      <span class="small muted">محفوظه الآن ${wajhAr(memorized)}</span>
      <button class="btn sm primary" data-sard-new="${st.id}">+ تسجيل سرد</button>
    </div>
    ${months.length ? months.map((ym) => {
      const list = recs.filter((r) => monthOf(r.date) === ym);
      const total = list.reduce((a, r) => a + sardPagesOf(r), 0);
      return `<div class="card">
        <div class="row between"><b>سرد ${fmtMonth(ym)}</b><span class="badge">المجموع: ${wajhAr(total)}</span></div>
        ${memorized ? progressBar(total / memorized, `سرد ${pct(total / memorized)} من المحفوظ`) + `<div class="small muted">${pct(total / memorized)} من المحفوظ</div>` : ""}
        <ul class="list">${list.map((r) => `<li>
          <div class="row between"><span>${fmtDate(r.date)}${pagesOf(r) ? ` · ${pageRangeText(r)}` : ""}</span><b>${wajhAr(sardPagesOf(r))}</b></div>
          <div class="small muted">${r.mistakes ? `${r.mistakes} خطأ` : "بلا أخطاء"}${r.notes ? ` · ${esc(r.notes)}` : ""}${r.sentAt ? " · أُرسل ✓" : ""}</div>
          ${selfBadge(r)}
          <div class="row" style="margin-top:6px">
            <button class="btn sm whatsapp" data-sard-send="${r.id}">📤 إرسال</button>
            ${r.bySelf && !r.approved && !isStudent() ? `<button class="btn sm primary" data-approve="sard|${r.id}">✓ اعتماد</button>` : ""}
            ${canEditRec(r) ? `<button class="btn sm" data-sard-edit="${r.id}">تعديل</button>
            <button class="btn sm danger" data-sard-del="${r.id}">حذف</button>` : ""}
          </div></li>`).join("")}</ul>
      </div>`;
    }).join("") : `<div class="card empty">لم يُسجَّل سرد بعد. في كل شهر يسرد الطالب محفوظه، فسجّل من أين قرأ وإلى أين، ويُجمع عدد الأوجه تلقائياً.</div>`}`;
}

/* ---------- صفحة الإحصائيات ---------- */
function pageStats(ymArg, tidArg) {
  const ym = /^\d{4}-\d{2}$/.test(ymArg || "") ? ymArg : currentMonth();
  const range = monthRange(ym);
  const tid = tidArg || "";
  const sts = db.students.filter((s) => !tid || s.teacherId === tid).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const rows = sts.map((st) => ({ st, m: monthStats(st, ym) }));
  const sum = (k) => rows.reduce((a, x) => a + x.m[k], 0);
  const required = sum("required"), achieved = sum("achieved");
  const link = (y, t) => `#/stats/${y}${t ? "/" + t : ""}`;

  // الأوجه المحفوظة أسبوعياً في آخر ثمانية أسابيع
  const ws0 = weekStartOf(todayStr());
  const weeks = [...Array(8)].map((_, i) => {
    const ws = addDays(ws0, -7 * (7 - i));
    return { ws, n: sts.reduce((a, st) => a + pagesInPeriod(st.id, ws, addDays(ws, 6)), 0) };
  });
  const maxW = Math.max(1, ...weeks.map((w) => w.n));

  const byTeacher = teachers().map((t) => {
    const rs = rows.filter((x) => x.st.teacherId === t.id);
    const req = rs.reduce((a, x) => a + x.m.required, 0), ach = rs.reduce((a, x) => a + x.m.achieved, 0);
    return { t, n: rs.length, rate: req ? ach / req : null, pages: rs.reduce((a, x) => a + x.m.pages, 0), sard: rs.reduce((a, x) => a + x.m.sardPages, 0) };
  }).filter((x) => x.n);

  return `
    <h1>الإحصائيات</h1>
    <div class="row between card monthnav">
      <a class="btn sm" href="${link(shiftMonth(ym, -1), tid)}" aria-label="الشهر السابق">→</a>
      <span style="text-align:center"><b>${fmtMonth(ym)}</b><br><span class="small muted">${fmtDate(range.first)} – ${fmtDate(range.last)}</span></span>
      <a class="btn sm" href="${link(shiftMonth(ym, 1), tid)}" aria-label="الشهر التالي">←</a>
    </div>
    ${teachers().length > 1 ? `<div class="tabs">${[["", "كل الحلقات"], ...teachers().map((t) => [t.id, t.name])].map(([id, n]) =>
      `<a class="tabbtn ${tid === id ? "active" : ""}" href="${link(ym, id)}">${esc(n)}</a>`).join("")}</div>` : ""}
    <div class="stats">
      <div class="stat"><b>${sts.length}</b><span>طالب</span></div>
      <div class="stat"><b>${pct(required ? achieved / required : null)}</b><span>نسبة الإنجاز</span></div>
      <div class="stat"><b>${sum("pages")}</b><span>وجه حُفظ</span></div>
      <div class="stat"><b>${sum("sardPages")}</b><span>وجه سُرد</span></div>
      <div class="stat"><b>${sum("absent")}</b><span>غياب</span></div>
      <div class="stat"><b>${sum("owed")}</b><span>تعويض لم يُؤدَّ</span></div>
    </div>
    <div class="card">
      <b>الأوجه المحفوظة أسبوعياً</b>
      <div class="vchart" role="img" aria-label="الأوجه المحفوظة في آخر ثمانية أسابيع">
        ${weeks.map((w) => `<div class="col" title="أسبوع ${fmtDate(w.ws)}: ${wajhAr(w.n)}">
          <span class="v">${w.n || ""}</span><i style="height:${(w.n / maxW) * 100}%"></i>
          <span class="x">${Number(w.ws.slice(8))}/${Number(w.ws.slice(5, 7))}</span></div>`).join("")}
      </div>
      <p class="small muted" style="margin:6px 0 0">كل عمود أسبوع يبدأ يوم الأحد بالتاريخ المكتوب تحته.</p>
    </div>
    ${byTeacher.length > 1 && !tid ? `<h2>مقارنة الحلقات</h2><div class="card"><ul class="list">${byTeacher.map((x) => `<li>
      <div class="row between"><b>${esc(x.t.name)}</b><span class="badge">${x.n} طالب</span></div>
      ${progressBar(x.rate || 0, `إنجاز ${pct(x.rate)}`)}
      <div class="small muted">إنجاز ${pct(x.rate)} · حفظ ${wajhAr(x.pages)} · سرد ${wajhAr(x.sard)}</div></li>`).join("")}</ul></div>` : ""}
    <div class="row between"><h2>التقرير الشهري</h2>
      <div class="row no-print">
        <button class="btn sm" data-exam="${ym}" data-ids="${sts.map((x) => x.id).join(",")}">📝 رصد درجات الاختبار</button>
        <button class="btn sm whatsapp" data-month-summary="${ym}" data-tid="${tid}">📤 إرسال التقرير</button>
        <button class="btn sm" data-print>🖨️ طباعة / PDF</button>
      </div></div>
    ${rows.length ? `<div class="card tablewrap"><table class="report">
      <thead><tr><th>الطالب</th><th>وصل إلى</th><th>حفظ · سرد</th><th>الحضور</th><th>الاختبار</th></tr></thead>
      <tbody>${rows.map(({ st, m }) => `<tr>
        <td><a href="#/student/${st.id}">${esc(st.name)}</a></td>
        <td>${m.reached ? `ص ${m.reached}<br><span class="small muted">${surahName(PAGE_SURAH[m.reached - 1])}</span>` : "—"}</td>
        <td>${m.pages} · ${m.sardPages}</td>
        <td>${m.attended}/${m.required}${m.absent ? `<br><span class="small" style="color:var(--danger)">غاب ${m.absent}</span>` : ""}</td>
        <td>${m.exam ? `<b>${m.exam.score}</b><br><span class="small muted">${examGrade(m.exam)}</span>` : `<span class="muted">—</span>`}</td>
      </tr>`).join("")}</tbody></table>
      <p class="small muted" style="margin:6px 0 0">«حفظ · سرد»: الأوجه المحفوظة هذا الشهر ثم أوجه السرد. الحضور: أيام الحضور من أيام التسميع${HIJRI ? "، والشهر هجري بتقويم أم القرى" : ""}.</p></div>` : ""}
    <h2>تفاصيل الطلاب</h2>
    ${rows.length ? rows.map(({ st, m }) => `<div class="card">
      <div class="row between"><a href="#/student/${st.id}"><b>${esc(st.name)}</b></a>
        <span class="badge ${m.rate == null ? "" : m.rate >= 0.9 ? "ok" : m.rate >= 0.7 ? "warn" : "danger"}">إنجاز ${pct(m.rate)}</span></div>
      <div class="small muted">أنجز ${m.done} · عوّض ${m.madeUp} · أخطأ ${m.failed} · غاب ${m.absent}${m.unrecorded ? ` · لم يُسجَّل ${m.unrecorded}` : ""} — من ${m.required} يوماً${m.owed ? ` · <span class="badge danger">لم يعوّض ${m.owed}</span>` : ""}</div>
      <div class="small">📍 وصل إلى: ${reachedText(m.reached)} · 📝 الاختبار: ${examText(m.exam)}</div>
      <div class="small">حفظ الشهر: <b>${wajhAr(m.pages)}</b> · السرد: <b>${wajhAr(m.sardPages)}</b> · الأخطاء: ${m.mistakes}</div>
      ${progressBar(m.memorized / TOTAL_PAGES, `محفوظ ${pct(m.memorized / TOTAL_PAGES)}`)}
      <div class="small muted">المحفوظ ${m.memorized}/${TOTAL_PAGES} (${pct(m.memorized / TOTAL_PAGES)}) · ${m.khatm.finished ? "🎉 خاتم" : `الختم المتوقع: ${fmtKhatm(m.khatm.date)}`}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn sm whatsapp" data-month-report="${st.id}" data-ym="${ym}">📤 التقرير الشهري</button>
        <button class="btn sm" data-sard-new="${st.id}">+ سرد</button>
      </div>
    </div>`).join("") : `<div class="card empty">لا يوجد طلاب</div>`}`;
}

/* ---------- الأحداث ---------- */
// يعيد true إذا عالج الضغطة
function programClick(t) {
  const d = t.dataset;
  if (d.dailyNew) { dailyForm(d.dailyNew, null, { date: d.date, kind: d.kind }); return true; }
  if (d.dailyEdit) {
    const r = db.daily.find((x) => x.id === d.dailyEdit);
    if (r && !canEditRec(r)) toast(r.bySelf ? "اعتمده الشيخ، فلا يمكن تعديله" : "سجّله الشيخ، فلا يمكن تعديله");
    else if (r) dailyForm(r.studentId, r);
    return true;
  }
  if (d.approve) {
    const ids = d.approve === "all" ? pendingApprovals().map((x) => `${x.c}|${x.r.id}`) : [d.approve];
    for (const k of ids) {
      const [c, id] = k.split("|");
      const r = db[c].find((x) => x.id === id);
      if (r) r.approved = true;
    }
    save(); render(); toast(ids.length > 1 ? `اعتُمد ${ids.length} سجلاً` : "تم الاعتماد");
    return true;
  }
  if (d.dailySend) { dailySendDialog(d.dailySend); return true; }
  if (d.dailyDel) {
    confirmDialog("حذف هذا التسميع؟", () => {
      db.daily.forEach((x) => { if (x.madeUpBy === d.dailyDel) delete x.madeUpBy; });
      db.daily = db.daily.filter((x) => x.id !== d.dailyDel);
      save(); render();
    });
    return true;
  }
  if ("dailyMore" in d) { studentProgramTab.more = true; render(); return true; }
  if (d.sardNew) { sardForm(d.sardNew); return true; }
  if (d.sardEdit) { const r = db.sard.find((x) => x.id === d.sardEdit); if (r) sardForm(r.studentId, r); return true; }
  if (d.sardSend) { sardSendDialog(d.sardSend); return true; }
  if (d.sardDel) {
    confirmDialog("حذف هذا السرد؟", () => { db.sard = db.sard.filter((x) => x.id !== d.sardDel); save(); render(); });
    return true;
  }
  if (d.monthReport) {
    const st = getStudent(d.monthReport);
    multiSendDialog({ title: `التقرير الشهري — ${esc(st.name)}`, text: buildMonthlyReport(st, d.ym), recipients: recipientsFor(st) });
    return true;
  }
  if (d.monthSummary) {
    multiSendDialog({ title: `ملخص شهر ${fmtMonth(d.monthSummary)}`, text: buildMonthSummary(d.monthSummary, d.tid), recipients: staffRecipients(d.tid) });
    return true;
  }
  if (d.daySummary) {
    multiSendDialog({ title: "ملخص اليوم", text: buildDaySummary(d.daySummary, d.tid), recipients: staffRecipients(d.tid) });
    return true;
  }
  if (d.exam) { examDialog(d.exam, d.ids ? d.ids.split(",").filter(Boolean) : []); return true; }
  if ("print" in d) { window.print(); return true; }
  if ("homeTeacher" in d) { programHomeSection.tid = d.homeTeacher; render(); return true; }
  return false;
}

/* ---------- الإعدادات ---------- */
function programSettingsHtml() {
  const s = db.settings;
  const list = [...teachers(), {}, {}];
  return `
    <h2 style="margin-top:0">${esc(programName())}</h2>
    <label><span>اسم البرنامج</span><input name="programName" value="${esc(programName())}"></label>
    <label><span>أيام التسميع</span>
      <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="programDays" value="${i}" ${programDays().includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div>
    </label>
    <div class="grid2">
      <label><span>يوم التعويض</span><select name="makeupDay">${DAYS.map((d, i) => `<option value="${i}" ${i === makeupDay() ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label><span>المقدار اليومي الافتراضي (أوجه)</span><input name="dailyPages" type="number" min="1" inputmode="numeric" value="${esc(s.dailyPages || 1)}"></label>
    </div>
    <label><span>عدد الأخطاء المسموح ليُعدّ الورد منجزاً</span><select name="passMistakes">${[0, 1, 2, 3].map((n) =>
      `<option value="${n}" ${n === (Number(s.passMistakes) || 0) ? "selected" : ""}>${n === 0 ? "لا شيء — أي خطأ يوجب التعويض" : n}</option>`).join("")}</select></label>
    <label><span>الدرجة الكاملة للاختبار الشهري</span><input name="examMax" type="number" min="1" inputmode="numeric" value="${examMax()}"></label>
    <p class="field-label">المعلمون (يُرسل لكل معلم تقرير طلابه)</p>
    ${list.map((t) => `<div class="grid2"><input type="hidden" name="tId" value="${esc(t.id || "")}">
      <input name="tName" placeholder="اسم المعلم" aria-label="اسم المعلم" value="${esc(t.name || "")}">
      <input name="tPhone" type="tel" inputmode="tel" placeholder="جوال المعلم" aria-label="جوال المعلم" value="${esc(t.phone || "")}">
      ${isAdmin() && t.code ? `<div style="grid-column:1/-1;margin-bottom:8px"><button type="button" class="btn sm whatsapp" data-send-teacher-code="${t.id}">📤 إرسال رابط الدخول لـ ${esc(t.name)}</button></div>` : ""}</div>`).join("")}
    ${isAdmin() ? `<p class="small muted">اكتب اسم المعلم وجواله ثم «حفظ الإعدادات»، فيظهر زر إرسال رابط دخوله.</p>` : ""}
    <p class="small muted">لإضافة معلم آخر احفظ ثم ستظهر خانة جديدة. ولحذف معلم امسح اسمه.</p>
    <div class="grid2">
      <label><span>اسم المشرف</span><input name="supervisorName" value="${esc(s.supervisorName || "")}"></label>
      <label><span>جوال المشرف</span><input name="supervisorPhone" type="tel" inputmode="tel" value="${esc(s.supervisorPhone || "")}"></label>
    </div>
    <hr class="sep">`;
}
function readProgramSettings(fd) {
  const ids = fd.getAll("tId"), names = fd.getAll("tName"), phones = fd.getAll("tPhone");
  // رمز دخول المعلم يُنشأ تلقائياً (المشرف وحده يملك رموز المعلمين)
  const list = names.map((n, i) => {
    const id = ids[i] || uid();
    const code = (getTeacher(id) || {}).code || (isAdmin() && n.trim() ? newCode() : "");
    return { id, name: n.trim(), phone: phones[i].trim(), code };
  }).filter((t) => t.name);
  const days = fd.getAll("programDays").map(Number);
  return {
    programName: fd.get("programName").trim() || "برنامج صناعة الحافظ",
    programDays: days.length ? days : [0, 1, 2, 3], makeupDay: Number(fd.get("makeupDay")),
    dailyPages: Math.max(1, Number(fd.get("dailyPages")) || 1), examMax: Math.max(1, Number(fd.get("examMax")) || 100), passMistakes: Number(fd.get("passMistakes")) || 0,
    teachers: list, supervisorName: fd.get("supervisorName").trim(), supervisorPhone: fd.get("supervisorPhone").trim()
  };
}

// حقول البرنامج في نموذج الطالب
function studentProgramFields(st) {
  return `
    <div class="grid2">
      <label><span>المعلم</span><select name="teacherId">${teacherOptions(st.teacherId)}</select></label>
      <label><span>المقدار اليومي (أوجه)</span><input name="dailyPages" type="number" min="1" inputmode="numeric" value="${esc(st.dailyPages || db.settings.dailyPages || 1)}"></label>
      <label style="grid-column:1/-1"><span>كم وجهاً كان يحفظ قبل البرنامج</span><input name="memorizedBefore" type="number" min="0" max="${TOTAL_PAGES}" inputmode="numeric" value="${esc(st.memorizedBefore || 0)}"></label>
    </div>`;
}
function studentDirectionField(st) {
  return `<label><span>اتجاه الحفظ</span><select name="direction">
    <option value="asc" ${st.direction !== "desc" ? "selected" : ""}>من الفاتحة إلى الناس</option>
    <option value="desc" ${st.direction === "desc" ? "selected" : ""}>من الناس إلى الفاتحة</option></select></label>`;
}
function readStudentProgramFields(fd) {
  return {
    teacherId: fd.get("teacherId"), dailyPages: Math.max(1, Number(fd.get("dailyPages")) || 1),
    memorizedBefore: Math.min(TOTAL_PAGES, Math.max(0, Number(fd.get("memorizedBefore")) || 0)), direction: fd.get("direction")
  };
}
