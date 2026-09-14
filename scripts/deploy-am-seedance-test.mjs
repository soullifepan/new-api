// Explicit test-server-only plugin/config deployment. Never reads channel credentials.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { seedanceBilling } from "./am-seedance-pricing.mjs";

if (process.argv[2] !== "--apply-test") throw new Error("Requires --apply-test");
const source = readFileSync(new URL("../plugins/local/apimart-video/plugin.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(source).digest("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const models = Object.keys(seedanceBilling);
const mapping = Object.fromEntries(models.map(model => [model, model.slice(0, -3)]));
const modes = Object.fromEntries(models.map(model => [model, "tiered_expr"]));
const overrides = Object.fromEntries(Object.entries(seedanceBilling).map(([model, expr]) => ["am-video::" + model, expr]));
const options = {
  "billing_setting.billing_mode": modes,
  "billing_setting.billing_expr": seedanceBilling,
  "billing_setting.plugin_billing_expr": overrides,
};
const sql = `
BEGIN;
LOCK TABLE task_plugins, channels, abilities, options IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF (SELECT count(*) FROM task_plugins WHERE key='am-video' AND active AND version='0.2.0') <> 1 THEN
    RAISE EXCEPTION 'Expected active am-video 0.2.0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM channels WHERE id=11 AND status=1 AND setting::jsonb->>'task_plugin_key'='am-video') THEN
    RAISE EXCEPTION 'Expected enabled test channel 11';
  END IF;
END $$;
-- Restricted rollback snapshot: no credentials, users, request data or unrelated options.
CREATE TABLE am_seedance_release_030_backup AS
SELECT 'channel'::text AS kind, jsonb_build_object('id',id,'models',models,'model_mapping',model_mapping) AS value
FROM channels WHERE id=11
UNION ALL SELECT 'option',jsonb_build_object('key',key,'value',value) FROM options
WHERE key IN ('billing_setting.billing_mode','billing_setting.billing_expr','billing_setting.plugin_billing_expr');
INSERT INTO task_plugins (key,api_version,version,source,source_hash,icon,enabled,active,created_at,remark)
SELECT 'am-video',1,'0.3.0',${quote(source)},${quote(hash)},icon,true,false,extract(epoch from now())::bigint,'Seedance estimates and validated upstream cost settlement'
FROM task_plugins WHERE key='am-video' AND active;
UPDATE channels SET models=models||','||${quote(models.join(","))},
model_mapping=(COALESCE(NULLIF(model_mapping,''),'{}')::jsonb||${quote(JSON.stringify(mapping))}::jsonb)::text WHERE id=11;
INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight,tag)
SELECT a."group",m.model,11,a.enabled,a.priority,a.weight,a.tag
FROM (SELECT DISTINCT "group",enabled,priority,weight,tag FROM abilities WHERE channel_id=11) a
CROSS JOIN (VALUES ${models.map(model => "(" + quote(model) + ")").join(",")}) m(model)
WHERE NOT EXISTS (SELECT 1 FROM abilities old WHERE old.channel_id=11 AND old."group"=a."group" AND old.model=m.model);
${Object.entries(options).map(([key, value]) => `INSERT INTO options (key,value) VALUES (${quote(key)},${quote(JSON.stringify(value))})
ON CONFLICT (key) DO UPDATE SET value=(COALESCE(NULLIF(options.value,''),'{}')::jsonb||EXCLUDED.value::jsonb)::text;`).join("\n")}
UPDATE task_plugins SET active=false WHERE key='am-video' AND active;
UPDATE task_plugins SET active=true WHERE key='am-video' AND version='0.3.0';
COMMIT;
SELECT key,version,active,source_hash FROM task_plugins WHERE key='am-video' ORDER BY version;
`;
console.log(execFileSync("ssh", ["-o", "BatchMode=yes", "root@47.99.98.76",
  "docker exec -i tapcomfy-newapi-postgres psql -v ON_ERROR_STOP=1 -U newapi -d newapi -At"],
{ input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 }));
