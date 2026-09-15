// One-time, user-approved test-server migration from am-image 0.9.0 to 0.10.0.
// Historical release script: later plugin sources intentionally fail the guard.
// Does not read credentials or modify old model prices. Keeps a rollback snapshot.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gpt25Billing } from "./am-gpt25-pricing.mjs";

if (process.argv[2] !== "--apply-test") throw new Error("Requires --apply-test");
const source = readFileSync(new URL("../plugins/local/apimart/plugin.js", import.meta.url), "utf8");
if (!source.includes('version: "0.10.0"')) throw new Error("Unexpected plugin version");
const hash = createHash("sha256").update(source).digest("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const models = Object.keys(gpt25Billing);
const mapping = Object.fromEntries(models.map(model => [model, model.slice(0, -3)]));
const options = {
  "billing_setting.billing_mode": Object.fromEntries(models.map(model => [model, "tiered_expr"])),
  "billing_setting.billing_expr": gpt25Billing,
  "billing_setting.plugin_billing_expr": Object.fromEntries(Object.entries(gpt25Billing).map(([model, expr]) => ["am-image::" + model, expr])),
};
const tokenDescription = "Token 参考单价（USD/百万）：文本输入 4；缓存文本输入 1；图片输入 6.4；缓存图片输入 1.6；图片输出 24。提交按尺寸、质量、张数及输入预估预扣；auto 按 max 预留。实际以 AM 返回的已校验任务费用结算，不重复打折或按张叠加。";
const sql = `BEGIN;
LOCK TABLE task_plugins,channels,abilities,options,models IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM task_plugins WHERE key='am-image' AND active AND version='0.9.0') <> 1 THEN RAISE EXCEPTION 'Expected active am-image 0.9.0'; END IF;
 IF NOT EXISTS (SELECT 1 FROM channels WHERE id=7 AND status=1 AND setting::jsonb->>'task_plugin_key'='am-image') THEN RAISE EXCEPTION 'Expected enabled AM image test channel 7'; END IF;
 IF EXISTS (SELECT 1 FROM models WHERE model_name IN (${models.map(quote).join(",")})) THEN RAISE EXCEPTION 'New model already exists; review before overwriting'; END IF;
END $$;
CREATE TABLE am_gpt25_release_0100_backup AS
SELECT 'channel'::text AS kind,jsonb_build_object('id',id,'models',models,'model_mapping',model_mapping) AS value FROM channels WHERE id=7
UNION ALL SELECT 'option',jsonb_build_object('key',key,'value',value) FROM options WHERE key IN (${Object.keys(options).map(quote).join(",")});
INSERT INTO task_plugins(key,api_version,version,source,source_hash,icon,enabled,active,created_at,remark)
SELECT 'am-image',1,'0.10.0',${quote(source)},${quote(hash)},icon,true,false,extract(epoch from now())::bigint,'GPT Image 2.5 Ext and validated actual-cost settlement' FROM task_plugins WHERE key='am-image' AND active;
UPDATE channels SET models=models||','||${quote(models.join(","))},model_mapping=(COALESCE(NULLIF(model_mapping,''),'{}')::jsonb||${quote(JSON.stringify(mapping))}::jsonb)::text WHERE id=7;
INSERT INTO abilities("group",model,channel_id,enabled,priority,weight,tag)
SELECT a."group",m.model,7,a.enabled,a.priority,a.weight,a.tag FROM (SELECT DISTINCT "group",enabled,priority,weight,tag FROM abilities WHERE channel_id=7) a
CROSS JOIN (VALUES ${models.map(model => "("+quote(model)+")").join(",")}) m(model)
WHERE NOT EXISTS(SELECT 1 FROM abilities old WHERE old.channel_id=7 AND old."group"=a."group" AND old.model=m.model);
${Object.entries(options).map(([key,value]) => `INSERT INTO options(key,value) VALUES(${quote(key)},${quote(JSON.stringify(value))}) ON CONFLICT(key) DO UPDATE SET value=(COALESCE(NULLIF(options.value,''),'{}')::jsonb||EXCLUDED.value::jsonb)::text;`).join("\n")}
${models.map(model => `INSERT INTO models(model_name,description,icon,tags,vendor_id,endpoints,status,sync_official,created_time,updated_time,name_rule) VALUES (${quote(model)},${quote(model.includes("-ext-") ? "Flare / Sunburst；1K $0.0085、2K $0.014、4K $0.021/张。按实际交付张数结算，参考图不额外收费。" : tokenDescription)},'OpenAI','image',3,'{}',1,0,extract(epoch from now())::bigint,extract(epoch from now())::bigint,0);`).join("\n")}
UPDATE task_plugins SET active=false WHERE key='am-image' AND active;
UPDATE task_plugins SET active=true WHERE key='am-image' AND version='0.10.0';
COMMIT;
SELECT key,version,enabled,active,source_hash FROM task_plugins WHERE key='am-image' ORDER BY version;`;
console.log(execFileSync("ssh", ["-o", "BatchMode=yes", "root@47.99.98.76", "docker exec -i tapcomfy-newapi-postgres psql -v ON_ERROR_STOP=1 -U newapi -d newapi -At"], { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 }));
