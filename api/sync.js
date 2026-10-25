"use strict";
// مزامنة بيانات الحلقة بين المشرف والمعلمين والطلاب.
// طلب واحد يرسل التعديلات المحلية ويعيد البيانات المسموح بها لصاحب الرمز.
const crypto = require("crypto");
const { configured, pipeline } = require("./_store");

const COLLECTIONS = ["students", "sessions", "mistakes", "notes", "daily", "sard", "exams"];
const STUDENT_WRITABLE = ["daily", "sard"];
const MAX_FAILS = 20; // محاولات رمز خاطئة لكل عنوان خلال ربع ساعة

const hash = (s) => crypto.createHash("sha256").update("halaqa:" + s).digest("hex");
const stamp = (x) => x.updatedAt || x.createdAt || 0;
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 64;
function toObj(flat) {
  const o = {};
  for (let i = 0; i < (flat || []).length; i += 2) {
    try { o[flat[i]] = JSON.parse(flat[i + 1]); } catch {}
  }
  return o;
}

async function readAll() {
  const res = await pipeline([["GET", "admin"], ["GET", "settings"], ...COLLECTIONS.map((c) => ["HGETALL", "h:" + c])]);
  const data = {};
  COLLECTIONS.forEach((c, i) => (data[c] = toObj(res[i + 2])));
  return { admin: res[0], settings: res[1] ? JSON.parse(res[1]) : null, data };
}

function identify(code, st) {
  code = String(code || "").trim();
  if (!code) return null;
  if (st.admin && hash(code) === st.admin) return { role: "admin", name: "المشرف" };
  const t = ((st.settings || {}).teachers || []).find((x) => x.code && x.code === code);
  if (t) return { role: "teacher", teacherId: t.id, name: t.name };
  const s = Object.values(st.data.students).find((x) => x.loginCode && x.loginCode === code);
  if (s) return { role: "student", studentId: s.id, name: s.name };
  return null;
}

// الطالب يضيف سجلات تسميعه وسرده فقط، ويعدّلها ما لم يعتمدها الشيخ
function canStudentWrite(me, c, rec, cur) {
  if (!STUDENT_WRITABLE.includes(c)) return false;
  if (cur) return cur.studentId === me.studentId && cur.bySelf && !cur.approved;
  return !rec.deleted && rec.studentId === me.studentId;
}

function applyPush(me, st, push) {
  const cmds = [];
  const records = (push && push.records) || {};
  for (const c of COLLECTIONS) {
    for (const rec of Array.isArray(records[c]) ? records[c] : []) {
      if (!rec || !validId(rec.id)) continue;
      const cur = st.data[c][rec.id];
      if (me.role === "student") {
        if (!canStudentWrite(me, c, rec, cur)) continue;
        if (!rec.deleted) Object.assign(rec, { studentId: me.studentId, bySelf: true, approved: false });
      }
      if (cur && stamp(cur) > stamp(rec)) continue;
      if (rec.deleted) {
        if (cur) { delete st.data[c][rec.id]; cmds.push(["HDEL", "h:" + c, rec.id]); }
        continue;
      }
      st.data[c][rec.id] = rec;
      cmds.push(["HSET", "h:" + c, rec.id, JSON.stringify(rec)]);
    }
  }
  const s = push && push.settings;
  if (s && typeof s === "object" && me.role !== "student" && (!st.settings || stamp(s) >= stamp(st.settings))) {
    // رموز المعلمين يحددها المشرف وحده
    if (me.role === "teacher") {
      const old = ((st.settings || {}).teachers || []);
      s.teachers = (s.teachers || []).map((t) => ({ ...t, code: (old.find((o) => o.id === t.id) || {}).code || "" }));
    }
    st.settings = s;
    cmds.push(["SET", "settings", JSON.stringify(s)]);
  }
  return cmds;
}

function viewFor(me, st) {
  const settings = st.settings ? { ...st.settings } : null;
  const data = {};
  if (me.role !== "student") {
    for (const c of COLLECTIONS) data[c] = Object.values(st.data[c]);
    if (settings && me.role === "teacher") {
      settings.teachers = (settings.teachers || []).map((t) => ({ ...t, code: t.id === me.teacherId ? t.code : "" }));
    }
    return { settings, data };
  }
  for (const c of COLLECTIONS) {
    data[c] = Object.values(st.data[c]).filter((x) => (c === "students" ? x.id === me.studentId : x.studentId === me.studentId));
  }
  // ما يخص الشيخ وحده لا يصل إلى الطالب
  data.notes = data.notes.filter((n) => !n.private);
  data.sessions = data.sessions.map(({ privateNote, ...rest }) => rest);
  if (settings) settings.teachers = (settings.teachers || []).map(({ code, ...t }) => t);
  return { settings, data };
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  if (!configured()) return send(res, 200, { configured: false });
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: "bad json" }); }
  try {
    const st = await readAll();
    // إنشاء رمز المشرف أول مرة ورفع بياناته الحالية
    if (body.setup) {
      if (st.admin) return send(res, 409, { error: "admin exists" });
      const code = String(body.code || "").trim();
      if (code.length < 6) return send(res, 400, { error: "short code" });
      st.admin = hash(code);
      const me = { role: "admin", name: "المشرف" };
      await pipeline([["SET", "admin", st.admin], ...applyPush(me, st, body.push)]);
      return send(res, 200, { configured: true, hasAdmin: true, me, ...viewFor(me, st), serverTime: Date.now() });
    }
    if (!body.code) return send(res, 200, { configured: true, hasAdmin: !!st.admin });

    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const rlKey = "rl:" + ip;
    const me = identify(body.code, st);
    if (!me) {
      const [n] = await pipeline([["INCR", rlKey], ["EXPIRE", rlKey, 900]]);
      return send(res, n > MAX_FAILS ? 429 : 401, { error: "bad code" });
    }
    const [fails] = await pipeline([["GET", rlKey]]);
    if (Number(fails) > MAX_FAILS) return send(res, 429, { error: "too many attempts" });

    const cmds = applyPush(me, st, body.push);
    if (cmds.length) await pipeline(cmds);
    return send(res, 200, { configured: true, hasAdmin: true, me, ...viewFor(me, st), serverTime: Date.now() });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "server" });
  }
};
