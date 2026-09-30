const fs=require('fs'),assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const shops=read('server/src/shops/shops.controller.ts'), cloud=read('electron/cloudSyncClient.js'), preload=read('electron/preload.js'), app=read('src/App.jsx'), screen=read('src/screens/BusinessNetworkScreen.jsx');
assert(shops.includes("@Get('overview')")); assert(shops.includes("@Patch(':shopId')")); assert(shops.includes('shop_memberships'));
assert(shops.includes("entity_type='product'")); assert(shops.includes("entity_type='sale'")); assert(shops.includes('inventory_reconciliation_issues'));
assert(cloud.includes('getOwnerOverview')); assert(cloud.includes('createShop')); assert(cloud.includes('renameShop'));
assert(preload.includes('getOwnerOverview')); assert(preload.includes('createCloudShop')); assert(app.includes('BusinessNetworkScreen'));
assert(screen.includes('shop_id')); assert(screen.includes('lifetime_revenue')); console.log('multi-shop owner foundation v2.3.0 contract PASS');
