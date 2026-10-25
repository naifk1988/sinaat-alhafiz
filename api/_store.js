"use strict";
// قاعدة البيانات: Upstash Redis المجانية من لوحة Vercel (Storage)، عبر واجهتها REST فلا يحتاج المشروع مكتبات.
// Vercel يضيف هذه المتغيرات تلقائياً عند ربط قاعدة البيانات بالمشروع.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const configured = () => !!(URL_ && TOKEN);

async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(`${URL_.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error(`store ${r.status}`);
  return (await r.json()).map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

module.exports = { configured, pipeline };
