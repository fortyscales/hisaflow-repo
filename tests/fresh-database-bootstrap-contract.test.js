const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const mig=fs.readFileSync(path.join(root,'electron/migrations.js'),'utf8');
const pkg=require(path.join(root,'package.json'));
function ok(x,m){if(!x)throw new Error(m)}
const fn=mig.slice(mig.indexOf('function ensureCloudSyncSchema'), mig.indexOf('function normalizeCloudIdentity'));
ok(pkg.version==='2.2.25','package version must be 2.2.25');
ok(fn.includes('CREATE TABLE IF NOT EXISTS system_meta'),'cloud preflight must bootstrap system_meta before first INSERT');
ok(fn.indexOf('CREATE TABLE IF NOT EXISTS system_meta') < fn.indexOf("INSERT OR IGNORE INTO system_meta"),'system_meta must be created before it is written');
ok(mig.indexOf('ensureCloudSyncSchema(db)') < mig.indexOf('CREATE TABLE IF NOT EXISTS schema_migrations'),'preflight ordering assumption changed unexpectedly');
console.log('Fresh database bootstrap contract: PASS');
