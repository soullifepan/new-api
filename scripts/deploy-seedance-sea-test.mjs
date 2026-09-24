// One-time test-server registration. Does not read existing channel credentials.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv[2] !== "--apply-test") throw new Error("Requires --apply-test");
const source = readFileSync(new URL("../plugins/local/seedance-sea/plugin.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(source).digest("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const remote = ["-o", "BatchMode=yes", "root@47.99.98.76"];
const psql = "docker exec -i tapcomfy-newapi-postgres psql -X -v ON_ERROR_STOP=1 -U newapi -d newapi -At";
const identity = execFileSync("ssh", [...remote, "docker inspect tapcomfy-newapi-test --format '{{.Name}} {{.Config.Image}} {{.Config.WorkingDir}}'"], { encoding: "utf8" }).trim();
if (identity !== "/tapcomfy-newapi-test tapcomfy/newapi:test /data") throw new Error("Unexpected test environment");
const snapshot = execFileSync("ssh", [...remote, psql], {
  input: `SELECT json_build_object('plugins', (SELECT json_agg(p) FROM (SELECT key,version,active,enabled,source_hash FROM task_plugins WHERE key IN ('seedance-hub','seedance-sea')) p), 'options', (SELECT json_agg(o) FROM (SELECT key,value FROM options WHERE key IN ('billing_setting.billing_mode','billing_setting.billing_expr','billing_setting.plugin_billing_expr')) o));`,
  encoding: "utf8",
});
const backup = join(mkdtempSync(join(tmpdir(), "seedance-sea-deploy-")), "pricing-before.json");
writeFileSync(backup, snapshot, { mode: 0o600 });
console.log("Non-secret pricing backup:", backup);
const sql = `
BEGIN;
LOCK TABLE task_plugins, channels, models, abilities, options IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF (SELECT count(*) FROM task_plugins WHERE key='seedance-hub' AND active AND version='2.0.5') <> 1 THEN RAISE EXCEPTION 'Expected active seedance-hub 2.0.5'; END IF;
  IF EXISTS (SELECT 1 FROM task_plugins WHERE key='seedance-sea') OR EXISTS (SELECT 1 FROM channels WHERE name='seedance-sea') OR EXISTS (SELECT 1 FROM models WHERE model_name LIKE '%-sea') THEN RAISE EXCEPTION 'SEA already exists; inspect before retrying'; END IF;
  IF (SELECT count(*) FROM jsonb_each_text((SELECT value::jsonb FROM options WHERE key='billing_setting.plugin_billing_expr')) WHERE key LIKE 'seedance-hub::%') <> 4 THEN RAISE EXCEPTION 'Expected four Hub provider prices'; END IF;
END $$;
INSERT INTO task_plugins (key,api_version,version,source,source_hash,enabled,active,created_at,remark)
VALUES ('seedance-sea',1,'1.0.1',${quote(source)},${quote(hash)},true,true,extract(epoch from now())::bigint,'Token0A video and OSS URL asset registration');
INSERT INTO channels (type,key,status,name,weight,created_time,base_url,models,"group",model_mapping,priority,auto_ban,setting,channel_info)
VALUES (61,'1',2,'seedance-sea',0,extract(epoch from now())::bigint,'https://seedance.0a.com',
'doubao-seedance-2-0-sea,doubao-seedance-2-0-fast-sea,doubao-seedance-2-0-mini-sea,doubao-seedance-2-5-sea',
'default','{}',0,1,'{"task_plugin_key":"seedance-sea"}','{}');
INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight)
SELECT 'default',unnest(string_to_array(models,',')),id,false,0,0 FROM channels WHERE name='seedance-sea';
INSERT INTO models (model_name,description,icon,tags,vendor_id,endpoints,status,sync_official,created_time,updated_time,name_rule)
SELECT replace(model_name,'-hub','-sea'),
 CASE model_name
 WHEN 'doubao-seedance-2-0-hub' THEN 'Seedance 2.0 Token0A 视频生成，支持 480p、720p、1080p、4K'
 WHEN 'doubao-seedance-2-0-fast-hub' THEN 'Seedance 2.0 Fast Token0A 视频生成，支持 480p、720p、1080p'
 WHEN 'doubao-seedance-2-0-mini-hub' THEN 'Seedance 2.0 Mini Token0A 视频生成，支持 480p、720p'
 ELSE 'Seedance 2.5 Token0A 视频生成，支持 480p、720p' END,
 icon,'video,seedance,doubao,sea',vendor_id,'',status,0,extract(epoch from now())::bigint,extract(epoch from now())::bigint,name_rule
FROM models WHERE model_name IN ('doubao-seedance-2-0-hub','doubao-seedance-2-0-fast-hub','doubao-seedance-2-0-mini-hub','doubao-seedance-2-5-hub') AND deleted_at IS NULL;
CREATE TEMP TABLE sea_prices ON COMMIT DROP AS
SELECT replace(key,'seedance-hub::','seedance-sea::') AS provider_key,replace(split_part(key,'::',2),'-hub','-sea') AS model, value AS expr
FROM jsonb_each_text((SELECT value::jsonb FROM options WHERE key='billing_setting.plugin_billing_expr')) WHERE key LIKE 'seedance-hub::%';
UPDATE sea_prices SET provider_key=replace(provider_key,'-hub','-sea');
UPDATE options SET value=(value::jsonb || (SELECT jsonb_object_agg(provider_key,expr) FROM sea_prices))::text WHERE key='billing_setting.plugin_billing_expr';
UPDATE options SET value=(value::jsonb || (SELECT jsonb_object_agg(model,expr) FROM sea_prices))::text WHERE key='billing_setting.billing_expr';
UPDATE options SET value=(value::jsonb || (SELECT jsonb_object_agg(model,'tiered_expr'::text) FROM sea_prices))::text WHERE key='billing_setting.billing_mode';
DO $$ BEGIN
 IF (SELECT count(*) FROM models WHERE model_name LIKE '%-sea' AND deleted_at IS NULL) <> 4 THEN RAISE EXCEPTION 'Expected four SEA model entries'; END IF;
END $$;
COMMIT;
SELECT key,version,enabled,active,source_hash FROM task_plugins WHERE key='seedance-sea';
SELECT id,name,status,base_url,models,"group" FROM channels WHERE name='seedance-sea';
`;
console.log(execFileSync("ssh", [...remote, psql], { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 }));
