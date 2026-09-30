// Run using Electron's Node mode, with the same better-sqlite3 ABI as the app.
const fs=require('node:fs'), path=require('node:path');
const Database=require('better-sqlite3');
const {SHOP,DEVICE,products,buildPlan,sql}=require('./plan.cjs');
(async()=>{
  if(!process.env.HISAFLOW_DATA_DIR) throw new Error('HISAFLOW_DATA_DIR_REQUIRED');
  const dbPath=path.join(path.resolve(process.env.HISAFLOW_DATA_DIR),'hisaflow.db');
  const db=new Database(dbPath,{readonly:true,fileMustExist:true});
  try {
    if (process.argv.includes('--backup-only')) {
      const out=path.resolve('repair-output','backups',path.basename(path.dirname(dbPath))+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
      fs.mkdirSync(out,{recursive:true});
      await db.backup(path.join(out,'hisaflow.sqlite'));
      console.log('Backup saved:',out); return;
    }
    db.exec('BEGIN');
    const meta=k=>db.prepare('SELECT value FROM system_meta WHERE key=?').get(k)?.value;
    const ids=products.map(p=>p.id), placeholders=ids.map(()=>'?').join(',');
    const data={shopId:meta('shop_id'),deviceId:meta('device_id'),
      pending:db.prepare('SELECT count(*) n FROM sync_outbox WHERE synced_at IS NULL').get().n,
      products:db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...ids),
      batches:db.prepare(`SELECT * FROM stock_batches WHERE product_id IN (${placeholders})`).all(...ids),
      movements:db.prepare(`SELECT * FROM stock_movements WHERE product_id IN (${placeholders})`).all(...ids),
      sales:db.prepare(`SELECT * FROM sales WHERE product_id IN (${placeholders})`).all(...ids)};
    const plan=buildPlan(data);
    const out=path.resolve('repair-output',new Date().toISOString().replace(/[:.]/g,'-'));
    fs.mkdirSync(out,{recursive:true});
    await db.backup(path.join(out,'Device-A-before-repair.sqlite'));
    fs.writeFileSync(path.join(out,'local-evidence.json'),JSON.stringify(data,null,2));
    fs.writeFileSync(path.join(out,'preview.sql'),sql(data,false));
    fs.writeFileSync(path.join(out,'apply.sql'),sql(data,true));
    fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan.map(p=>({product:p.name,target:p.target,serverLedgerBefore:p.serverLedger,localLedgerBefore:p.localLedger,importHistoricalMovement:p.extra.id,correction:p.correction})),null,2));
    db.exec('ROLLBACK');
    console.log('PREPARED ONLY. Local database unchanged.');
    console.log('Output folder:',out);
    console.log(fs.readFileSync(path.join(out,'plan.json'),'utf8'));
  }finally{db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
