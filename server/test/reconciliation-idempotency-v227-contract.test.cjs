const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');
const svc=fs.readFileSync(path.join(root,'src/inventory/inventory-reconciliation.service.ts'),'utf8');
assert(svc.includes("issue.status==='RESOLVED'"));
assert(svc.includes('idempotentReplay:true'));
assert(svc.includes("throw new ConflictException('RECONCILIATION_ALREADY_RESOLVED_DIFFERENT_PHYSICAL_COUNT')"));
assert(svc.indexOf('idempotentReplay:true') < svc.indexOf("const q=await c.query(`SELECT COALESCE(SUM"), 'idempotent replay must return before creating/recomputing adjustment');
console.log('PASS v2.2.27 reconciliation idempotency contract');
