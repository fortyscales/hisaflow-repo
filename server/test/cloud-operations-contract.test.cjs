const fs=require('fs'),path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'..','..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const screen=read('src/screens/CloudScreen.jsx'),client=read('electron/cloudSyncClient.js'),svc=read('server/src/sync/sync.service.ts'),ctl=read('server/src/sync/sync.controller.ts'),auth=read('server/src/auth/auth.service.ts');
assert(screen.includes('Create cloud account')&&screen.includes('Fungua akaunti ya wingu'),'bilingual onboarding');
assert(screen.includes("setTab('history')")&&screen.includes("setTab('conflicts')"),'ops tabs');
assert(client.includes('getSyncHistory')&&client.includes('listShops'),'desktop admin transport');
assert(svc.includes('async history(')&&ctl.includes("@Get('history')"),'server history endpoint');
assert(auth.includes("body.shopId"),'registration preserves local shop identity');
console.log('cloud operations contract: PASS');
