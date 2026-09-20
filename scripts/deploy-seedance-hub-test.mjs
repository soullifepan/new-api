// Explicit test-server-only Seedance Hub plugin deployment. Never reads channel credentials.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

if (process.argv[2] !== "--apply-test") throw new Error("Requires --apply-test");
const source = readFileSync(new URL("../plugins/local/seedance-hub/plugin.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(source).digest("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = `
BEGIN;
LOCK TABLE task_plugins, channels IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF (SELECT count(*) FROM task_plugins WHERE key='seedance-hub' AND active AND version='2.0.4') <> 1 THEN
    RAISE EXCEPTION 'Expected active seedance-hub 2.0.4';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM channels WHERE status=1 AND setting::jsonb->>'task_plugin_key'='seedance-hub') THEN
    RAISE EXCEPTION 'Expected an enabled Seedance Hub test channel';
  END IF;
END $$;
INSERT INTO task_plugins (key,api_version,version,source,source_hash,icon,enabled,active,created_at,remark)
SELECT 'seedance-hub',1,'2.0.5',${quote(source)},${quote(hash)},icon,true,false,extract(epoch from now())::bigint,'Expose generated video and last-frame artifacts'
FROM task_plugins WHERE key='seedance-hub' AND active;
UPDATE task_plugins SET active=false WHERE key='seedance-hub' AND active;
UPDATE task_plugins SET active=true WHERE key='seedance-hub' AND version='2.0.5';
COMMIT;
SELECT key,version,active,source_hash FROM task_plugins WHERE key='seedance-hub' ORDER BY version;
`;
console.log(execFileSync("ssh", ["-o", "BatchMode=yes", "root@47.99.98.76",
  "docker exec -i tapcomfy-newapi-postgres psql -v ON_ERROR_STOP=1 -U newapi -d newapi -At"],
{ input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 }));
