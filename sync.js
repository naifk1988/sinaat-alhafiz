"use strict";

/* ============ المزامنة والدخول برمز ============ */
// إذا رُبط المشروع بقاعدة بيانات على Vercel تُحفظ البيانات هناك، ويدخل المشرف والمعلمون والطلاب برموزهم.
// تبقى نسخة في المتصفح ليعمل التطبيق دون إنترنت، وتُرسل التعديلات عند عودة الاتصال.
// دون قاعدة بيانات يعمل التطبيق محلياً كما كان.

const AUTH_KEY = "halaqa-auth", SNAP_KEY = "halaqa-sync-snap", CLOUD_KEY = "halaqa-cloud";
const SYNC_COLLS = ["students", "sessions", "mistakes", "notes", "daily", "sard", "exams"];
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeJSON = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let auth = readJSON(AUTH_KEY);                 // { code, role, name, studentId?, teacherId? }
let cloud = readJSON(CLOUD_KEY) || { configured: false, hasAdmin: false };
let snap = readJSON(SNAP_KEY);                 // آخر حالة متزامنة: لمعرفة ما تغيّر محلياً
let syncState = "", lastSync = 0;

const isStudent = () => !!(auth && auth.role === "student");
const isAdmin = () => !!(auth && auth.role === "admin");
const loginRequired = () => cloud.configured && cloud.hasAdmin && !auth;

async function syncApi(body) {
  const r = await fetch("api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!j) throw Object.assign(new Error("noapi"), { noapi: true });
  if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
}

function snapshotOf(d) {
  const rec = {};
  for (const c of SYNC_COLLS) for (const x of d[c] || []) rec[`${c}|${x.id}`] = JSON.stringify(x);
  return { rec, settings: JSON.stringify(d.settings) };
}

// التعديلات منذ آخر مزامنة: السجلات الجديدة والمعدّلة والمحذوفة
function collectChanges() {
  const base = (snap && snap.rec) || {};
  const now = Date.now();
  const records = {}, sent = {};
  const seen = new Set();
  for (const c of SYNC_COLLS) {
    for (const x of db[c] || []) {
      const k = `${c}|${x.id}`;
      seen.add(k);
      if (base[k] === JSON.stringify(x)) continue;
      // أول دخول من جهاز: تُرسل سجلاته بتاريخها الأصلي فلا تغلب نسخة أحدث على الخادم
      if (snap) x.updatedAt = now;
      (records[c] = records[c] || []).push(x);
      sent[k] = JSON.stringify(x);
    }
  }
  for (const k of Object.keys(snap ? base : {})) {
    if (seen.has(k)) continue;
    const [c, id] = k.split("|");
    (records[c] = records[c] || []).push({ id, deleted: true, updatedAt: now });
  }
  const push = { records };
  // إعدادات جهاز يدخل أول مرة لا تُرسل، فإعدادات الخادم هي المعتمدة
  if (!isStudent() && snap && snap.settings !== JSON.stringify(db.settings)) {
    db.settings.updatedAt = now;
    push.settings = db.settings;
  }
  return { push, sent };
}

function setSyncState(s) {
  syncState = s;
  const el = document.getElementById("sync-state");
  if (!el) return;
  el.hidden = !auth;
  el.textContent = s === "syncing" ? "⏳" : s === "offline" ? "⚠️" : "☁️";
  el.title = s === "syncing" ? "جارٍ المزامنة" : s === "offline" ? "غير متصل — ستُرسل التعديلات عند عودة الاتصال" : "متزامن";
}

// تطبيق بيانات الخادم مع إبقاء ما عُدّل محلياً أثناء الطلب
function applyServer(res, sent) {
  const before = (snap && snap.rec) || {};
  const local = {};
  for (const c of SYNC_COLLS) for (const x of db[c] || []) {
    const k = `${c}|${x.id}`, j = JSON.stringify(x);
    if (j !== before[k] && j !== sent[k]) local[k] = x;
  }
  const base = emptyDb();
  const next = { ...base, settings: { ...base.settings, ...(res.settings || db.settings) } };
  for (const c of SYNC_COLLS) next[c] = (res.data && res.data[c]) || [];
  snap = snapshotOf(next);
  for (const [k, x] of Object.entries(local)) {
    const c = k.split("|")[0];
    next[c] = next[c].filter((y) => y.id !== x.id).concat(x);
  }
  const changed = JSON.stringify(next) !== JSON.stringify(db);
  db = next;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch {}
  writeJSON(SNAP_KEY, snap);
  if (res.me) { auth = { ...auth, ...res.me }; writeJSON(AUTH_KEY, auth); }
  return { changed, more: Object.keys(local).length > 0 };
}

// لا تُعاد رسم الصفحة والمعلم يكتب في نموذج أو نافذة
let renderPending = false;
function softRender() {
  const busy = dlg.open || parseRoute().page === "settings" || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
  if (busy) { renderPending = true; return; }
  renderPending = false;
  render();
}

let syncing = null, syncAgain = false;
function syncNow() {
  if (!auth || !cloud.configured) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    setSyncState("syncing");
    try {
      const { push, sent } = collectChanges();
      const res = await syncApi({ code: auth.code, push });
      const { changed, more } = applyServer(res, sent);
      lastSync = Date.now();
      setSyncState("ok");
      if (more) syncAgain = true;
      if (changed) softRender();
    } catch (e) {
      if (e.status === 401) { toast("انتهت صلاحية رمز الدخول"); logout(true); }
      else setSyncState("offline");
    } finally {
      syncing = null;
      if (syncAgain) { syncAgain = false; setTimeout(syncNow, 300); }
    }
  })();
  return syncing;
}
let syncTimer = null;
function syncSoon() {
  if (!auth) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1200);
}

async function checkCloud() {
  try {
    const res = await syncApi({});
    cloud = { configured: !!res.configured, hasAdmin: !!res.hasAdmin };
  } catch (e) {
    if (e.noapi) cloud = { configured: false, hasAdmin: false }; // استضافة دون خادم: وضع محلي
    else return; // دون اتصال: تبقى الحالة السابقة
  }
  writeJSON(CLOUD_KEY, cloud);
}

async function syncInit() {
  dlg.addEventListener("close", () => { if (renderPending) setTimeout(softRender, 50); });
  setSyncState("ok");
  const wasLogin = loginRequired();
  await checkCloud();
  if (loginRequired() !== wasLogin || (parseRoute().page === "settings" && !dlg.open)) render();
  if (auth) syncNow();
  // مزامنة دورية كل دقيقتين ما دامت الصفحة ظاهرة، وعند العودة إليها بعد دقيقة على الأقل،
  // لتبقى العمليات ضمن الخطة المجانية لقاعدة البيانات
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 120000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSync > 60000) syncNow();
  });
  window.addEventListener("online", () => syncNow());
}

async function login(code) {
  code = String(code || "").trim();
  if (!code) return toast("اكتب رمز الدخول");
  try {
    // البيانات المحلية من قبل الدخول تُرسل مرة واحدة لتُدمج (ما يجوز لصاحب الرمز إرساله)
    const hadData = db.students.length > 0;
    if (hadData) writeJSON("halaqa-local-backup", db);
    auth = { code };
    snap = null;
    const { push, sent } = collectChanges();
    const res = await syncApi({ code, push });
    auth = { code, ...res.me };
    writeJSON(AUTH_KEY, auth);
    applyServer(res, sent);
    lastSync = Date.now();
    setSyncState("ok");
    toast(`أهلاً ${auth.name || ""}`);
    location.hash = isStudent() ? `#/student/${auth.studentId}` : "#/";
    render();
  } catch (e) {
    auth = null;
    toast(e.status === 401 ? "الرمز غير صحيح" : e.status === 429 ? "محاولات كثيرة، حاول بعد ربع ساعة" : "تعذّر الاتصال، تأكد من الإنترنت");
  }
}

function logout(silent) {
  const done = () => {
    auth = null; snap = null;
    writeJSON(AUTH_KEY, null); writeJSON(SNAP_KEY, null);
    db = emptyDb();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch {}
    setSyncState("");
    location.hash = "#/";
    render();
  };
  if (silent) return done();
  confirmDialog("تسجيل الخروج من هذا الجهاز؟", () => syncNow().finally(done), "خروج");
}

// إنشاء رمز المشرف أول مرة، وترفع معه بيانات هذا الجهاز
function setupAdminDialog() {
  openDialog(`
    <h2>تفعيل المزامنة</h2>
    <p class="small muted">أنشئ رمز المشرف (6 أحرف أو أرقام على الأقل) واحفظه جيداً، فهو يفتح كل البيانات. وتُرفع بيانات هذا الجهاز الحالية.</p>
    <label><span>رمز المشرف</span><input name="code" required minlength="6" autocomplete="new-password"></label>
    <label><span>تأكيد الرمز</span><input name="code2" required minlength="6" autocomplete="new-password"></label>
    ${dlgActions("تفعيل")}`, (fd) => {
    const code = fd.get("code").trim();
    if (code.length < 6) { toast("الرمز قصير"); return false; }
    if (code !== fd.get("code2").trim()) { toast("الرمزان غير متطابقين"); return false; }
    (async () => {
      try {
        snap = null;
        const { push, sent } = collectChanges();
        db.settings.updatedAt = Date.now();
        push.settings = db.settings; // إعدادات المشرف هي الأساس
        const res = await syncApi({ setup: true, code, push });
        auth = { code, ...res.me };
        writeJSON(AUTH_KEY, auth);
        cloud = { configured: true, hasAdmin: true };
        writeJSON(CLOUD_KEY, cloud);
        applyServer(res, sent);
        setSyncState("ok");
        render();
        toast("تم تفعيل المزامنة");
      } catch (e) {
        toast(e.status === 409 ? "رمز المشرف مُنشأ من قبل، سجّل الدخول به" : "تعذّر التفعيل، تأكد من الإنترنت");
        await checkCloud(); render();
      }
    })();
  });
}

function pageLogin() {
  return `
    <div class="card login">
      <h1>${esc(programName())}</h1>
      <p class="muted">اكتب رمز الدخول الذي أعطاك إياه المشرف أو الشيخ.</p>
      <form id="login-form">
        <label><span>رمز الدخول</span><input name="code" inputmode="text" autocomplete="one-time-code" required style="text-align:center;font-size:1.3rem;letter-spacing:.2em"></label>
        <button class="btn primary block">دخول</button>
      </form>
    </div>`;
}

const newCode = () => {
  const used = new Set([...db.students.map((s) => s.loginCode), ...teachers().map((t) => t.code)].filter(Boolean));
  let c;
  do c = String(100000 + Math.floor(Math.random() * 900000)); while (used.has(c));
  return c;
};
function codeMessage(name, code) {
  return `السلام عليكم ورحمة الله وبركاته\n${name} حفظه الله\nللدخول إلى ${programName()} وتسجيل تسميعك اليومي:\n1️⃣ افتح الرابط: ${location.origin}${location.pathname}\n2️⃣ اكتب رمز الدخول: ${code}\nاحفظ الرمز ولا تعطه لأحد.`;
}

// قسم المزامنة في الإعدادات
function syncSettingsHtml() {
  if (!cloud.configured) {
    return `<h2>المزامنة بين الأجهزة</h2><div class="card">
      <p class="small">غير مفعّلة: البيانات في هذا الجهاز فقط. لتفعيلها اربط قاعدة بيانات مجانية بالمشروع من لوحة Vercel (Storage ← Upstash Redis)، ثم أعد النشر وافتح هذه الصفحة.</p>
      <button class="btn sm" data-action="cloud-check">إعادة الفحص</button></div>`;
  }
  if (!cloud.hasAdmin) {
    return `<h2>المزامنة بين الأجهزة</h2><div class="card">
      <p class="small">قاعدة البيانات جاهزة. أنشئ رمز المشرف لتفعيل المزامنة ورفع بيانات هذا الجهاز.</p>
      <button class="btn primary" data-action="cloud-setup">☁️ تفعيل المزامنة</button></div>`;
  }
  const roles = { admin: "المشرف", teacher: "معلم", student: "طالب" };
  const sts = [...db.students].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return `<h2>المزامنة والدخول</h2><div class="card">
      <p><b>الدخول:</b> ${roles[auth.role] || ""}${auth.name && auth.role !== "admin" ? ` — ${esc(auth.name)}` : ""}</p>
      <p class="small muted">آخر مزامنة: ${lastSync ? new Date(lastSync).toLocaleTimeString("ar") : "—"}</p>
      <div class="row"><button class="btn sm" data-action="sync-now">🔄 مزامنة الآن</button><button class="btn sm danger" data-action="logout">تسجيل الخروج</button></div>
    </div>
    <h2>رموز دخول الطلاب</h2><div class="card">
      <p class="small muted">يدخل كل طالب برمزه فيرى سجله وحده ويسجّل تسميعه اليومي. أنشئ الرمز ثم أرسله له.</p>
      ${sts.length ? `<ul class="list">${sts.map((st) => `<li class="row between">
        <span class="grow"><b>${esc(st.name)}</b><br><span class="small muted">${st.loginCode ? `الرمز: <b dir="ltr">${esc(st.loginCode)}</b>` : "لا يوجد رمز"}</span></span>
        ${st.loginCode ? `<button class="btn sm whatsapp" data-send-code="${st.id}">📤 إرسال</button>` : ""}
        <button class="btn sm" data-gen-code="${st.id}">${st.loginCode ? "تغيير" : "إنشاء رمز"}</button></li>`).join("")}</ul>` : `<p class="empty">أضف طلاباً أولاً</p>`}
    </div>`;
}

function syncClick(t) {
  const d = t.dataset;
  if (d.genCode) {
    const st = getStudent(d.genCode);
    const go = () => { st.loginCode = newCode(); save(); render(); toast("تم إنشاء الرمز"); };
    if (st.loginCode) confirmDialog(`تغيير رمز ${st.name}؟ الرمز القديم لن يعمل بعدها.`, go, "تغيير");
    else go();
    return true;
  }
  if (d.sendCode) {
    const st = getStudent(d.sendCode);
    multiSendDialog({ title: `رمز الدخول — ${esc(st.name)}`, text: codeMessage(st.name, st.loginCode),
      recipients: recipientsFor(st).filter((r) => r.phone === st.phone || r.phone === st.guardianPhone) });
    return true;
  }
  if (d.sendTeacherCode) {
    const tc = getTeacher(d.sendTeacherCode);
    multiSendDialog({ title: `رمز الدخول — ${esc(tc.name)}`, text: codeMessage(tc.name, tc.code).replace("وتسجيل تسميعك اليومي", "ومتابعة طلابك"),
      recipients: tc.phone ? [{ label: tc.name, phone: tc.phone }] : [] });
    return true;
  }
  switch (d.action) {
    case "cloud-setup": setupAdminDialog(); return true;
    case "cloud-check": checkCloud().then(render); return true;
    case "sync-now": syncNow().then(() => { toast(syncState === "ok" ? "تمت المزامنة" : "تعذّرت المزامنة"); render(); }); return true;
    case "logout": logout(); return true;
  }
  return false;
}
