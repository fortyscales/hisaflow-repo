const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mig=read('electron/migrations.js'), svc=read('electron/syncService.js'), client=read('electron/cloudSyncClient.js'), preload=read('electron/preload.js'), renderer=read('src/services/SyncService.js'), server=read('server/src/sync/sync.service.ts');
assert.match(mig,/version:\s*18/); assert.match(mig,/CREATE TABLE IF NOT EXISTS sync_inbox/); assert.match(mig,/trg_outbox_stock_batches_insert/);
assert.match(svc,/stock_batch:\s*'stock_batches'/); assert.match(svc,/applyRemoteChanges/); assert.match(svc,/DELETE FROM sync_outbox WHERE id>\?/); assert.match(svc,/sync_pull_cursor/);
assert.match(client,/\/sync\/push/); assert.match(client,/\/sync\/pull\?/); assert.match(client,/acknowledgeEvents/); assert.match(client,/releaseLease/); assert.match(client,/source_device_id !== ident.deviceId/); assert.match(client,/\/auth\/refresh/);
assert.match(preload,/cloud:syncNow/); assert.match(renderer,/window\.hisaflow\.syncNow/); assert.match(server,/stock_batch/);
console.log('desktop sync transport contract: PASS');
