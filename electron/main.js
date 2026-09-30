const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  nativeImage,
  dialog,
} = require("electron");
const path = require("path");
// Resolve and lock a workspace BEFORE any module opens SQLite.
const fs = require("fs");
const Database = require("better-sqlite3");
const { createRegistry, acquireLock, samePath } = require("./workspaceRegistry");
const rootDir = path.resolve(process.env.HISAFLOW_WORKSPACE_ROOT || process.env.HISAFLOW_DATA_DIR || path.join(app.getPath("userData"), "hisaflow-data"));
fs.mkdirSync(rootDir, {recursive:true});
let workspaceState, workspaceRegistry, releaseRoot, releaseActive;
try {
  releaseRoot = acquireLock(rootDir);
  workspaceRegistry = createRegistry(rootDir);
  workspaceState = workspaceRegistry.resolve(Database);
  if (!samePath(rootDir, workspaceState.dir)) releaseActive = acquireLock(workspaceState.dir);
} catch (error) {
  if(releaseRoot) releaseRoot();
  dialog.showErrorBox("HisaFlow workspace", String(error.message));
  app.exit(1);
  process.exit(1);
}
process.env.HISAFLOW_WORKSPACE_ROOT = rootDir;
process.env.HISAFLOW_DATA_DIR = workspaceState.dir;
process.on("exit", () => { if(releaseActive) releaseActive(); if(releaseRoot) releaseRoot(); });

require('./workspaceGate').installWorkspaceGate(ipcMain);
const queries = require("./queries");
const license = require("./license");
const { getDatabaseHealth, repairCachedProductSummaries, getInventoryReconciliationReport } = require("./integrity");
const { createDatabaseSnapshot, inspectSnapshot } = require("./databaseSnapshot");
const { validateRestoreCandidate, restoreDatabaseSnapshot } = require("./databaseRecovery");
const sync = require("./syncService");
const cloud = require("./cloudSyncClient");
const { createApplication } = require("./application");
const application = createApplication({ queries });
const { invokeSafely } = require("./errorContract");
const diagnostics = require("./diagnostics");
const { db, DB_PATH, DATA_DIR } = require("./db");

const isDev = process.env.NODE_ENV === "development";

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#FAF9F7", // matches the app's warm background, avoids a white flash on load
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      partition: `persist:shop-${require("crypto").createHash("sha256").update(DATA_DIR).digest("hex").slice(0,24)}`,
      contextIsolation: true, // renderer never gets direct Node access
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function restartWorkspace() {
  if(isDev && process.env.HISAFLOW_DEV_RUNNER === '1') {
    app.exit(75); // the dev runner retains Vite and launches a fresh Electron process
  } else {
    app.relaunch();
    app.exit(0);
  }
}
const workspaceManager = require('./workspaceManager').createWorkspaceManager({
  root:rootDir,dir:DATA_DIR,Database,db,sync,cloud,queries,dialog,
  license:() => { license.getLicenseStatus(); return db.prepare('SELECT * FROM license WHERE id=1').get(); },
  getWindow:() => mainWindow,restart:restartWorkspace
});
ipcMain.handle('workspace:list', () => workspaceManager.list());
ipcMain.handle('workspace:open', (event, payload) => workspaceManager.open(payload || {}));

app.whenReady().then(async () => {
  if(!await require('./workspaceDownload').completeWorkspaceDownload({state:workspaceState,cloud,registry:workspaceRegistry,dialog,restart:restartWorkspace})) return;
  console.log("HisaFlow data directory:", DATA_DIR);
  console.log("HisaFlow database path:", DB_PATH);
  let health;
  try { health = getDatabaseHealth(); } catch (error) { health = { ok:false, integrity:"health-check-failed", error:String(error.message||error) }; }
  global.__HISAFLOW_STARTUP_HEALTH__ = health;
  if (!health.ok) console.error("HisaFlow database health warning:", health);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Every data operation the renderer needs goes through these explicit,
// narrow IPC handlers — the renderer process never touches the database
// directly (contextIsolation + no nodeIntegration above enforces this).
// The interface here is unchanged from the old JSON-file version — every
// service in the renderer calls these exact same functions. What's
// different is what happens behind them: saves now run inside a real
// SQLite transaction, closing the race-condition gap structurally.
ipcMain.handle("app:commandSafe", (event, name, payload) => invokeSafely(() => {
  const handler = application.commands[name];
  if (!handler) { const e=new Error("UNKNOWN_APPLICATION_COMMAND"); e.code="UNKNOWN_APPLICATION_COMMAND"; throw e; }
  return handler(payload);
}, { kind:"command", name }));
ipcMain.handle("app:querySafe", (event, name, payload) => invokeSafely(() => {
  const handler = application.queries[name];
  if (!handler) { const e=new Error("UNKNOWN_APPLICATION_QUERY"); e.code="UNKNOWN_APPLICATION_QUERY"; throw e; }
  return handler(payload);
}, { kind:"query", name }));

ipcMain.handle("data:getProducts", () => queries.getProducts());
ipcMain.handle("backup:getProducts", () => queries.getProductsForBackup());
ipcMain.handle("backup:restoreAll", (event, data) => queries.restoreBackupData(data));
ipcMain.handle("backup:createSnapshot", (event, destinationPath) => createDatabaseSnapshot(destinationPath));
ipcMain.handle("backup:validateSnapshot", (event, snapshotPath) => validateRestoreCandidate(snapshotPath));
ipcMain.handle("backup:restoreSnapshot", (event, snapshotPath) => restoreDatabaseSnapshot(snapshotPath));

ipcMain.handle("analytics:dashboard", (event, args) => application.queries.dashboard(args));
ipcMain.handle("analytics:inventorySummary", () => queries.getInventorySummary());
ipcMain.handle("analytics:receivablesSummary", () => queries.getReceivablesSummary());
ipcMain.handle("analytics:staffSales", () => queries.getStaffSalesSummary());
ipcMain.handle("analytics:overdueReceivables", (event, args) => queries.getOverdueReceivablesSummary(args));
ipcMain.handle("inventory:adjust", (event, args) => application.commands.adjustInventory(args));
ipcMain.handle("inventory:movements", (event, productId, options) => queries.getStockMovements(productId, options));

ipcMain.handle("data:getSales", () => queries.getSales());
ipcMain.handle("sales:getPage", (event, args) => application.queries.salesPage(args));

ipcMain.handle("data:getCreditSales", () => queries.getCreditSales());

ipcMain.handle("data:getExpenditures", () => queries.getExpenditures());
ipcMain.handle("reports:getData", (event, args) => queries.getReportData(args || {}));
ipcMain.handle("invoices:getByCreditSaleId", (event, id) => queries.getInvoiceByCreditSaleId(id));
ipcMain.handle("invoices:create", (event, id, details) => queries.createInvoice(id, details || {}));
ipcMain.handle("invoices:getBySaleId", (event, id) => queries.getInvoiceBySaleId(id));
ipcMain.handle("invoices:createForSale", (event, id, details) => queries.createSaleInvoice(id, details || {}));
ipcMain.handle("invoices:list", (event, args) => queries.listInvoices(args || {}));
ipcMain.handle("tax:summary", (event, args) => queries.getTaxSummary(args || {}));
ipcMain.handle("commercialDocuments:list", (event, args) => queries.listCommercialDocuments(args || {}));
ipcMain.handle("commercialDocuments:get", (event, id) => queries.getCommercialDocument(id));
ipcMain.handle("commercialDocuments:create", (event, args) => queries.createCommercialDocument(args || {}));
ipcMain.handle("commercialDocuments:update", (event, id, args) => queries.updateCommercialDocument(id, args || {}));
ipcMain.handle("commercialDocuments:delete", (event, id) => queries.deleteCommercialDocument(id));
ipcMain.handle("commercialDocuments:convertToProforma", (event, id) => queries.convertQuotationToProforma(id));
ipcMain.handle("commercialDocuments:setStatus", (event, id, status) => queries.updateCommercialDocumentStatus(id, status));
ipcMain.handle("commercialDocuments:convertToCreditSale", (event, id, options) => queries.convertProformaToCreditSale(id, options || {}));
ipcMain.handle("commercialDocuments:convertToSale", (event, id, options) => queries.convertProformaToSale(id, options || {}));
ipcMain.handle("documents:exportPdf", async (event, { html, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Export PDF",
    defaultPath: defaultPath || "HisaFlow-report.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    require("fs").writeFileSync(filePath, pdf);
    return { canceled: false, filePath };
  } finally { win.destroy(); }
});

ipcMain.handle("expenses:add", (event, expenditure) => application.commands.addExpense(expenditure));
ipcMain.handle("expenses:delete", (event, id) => application.commands.deleteExpense(typeof id === "object" ? id : { id }));

ipcMain.handle("data:getSuppliers", () => queries.getSuppliers());

ipcMain.handle("data:getStaff", () => queries.getStaff());
ipcMain.handle("staff:identifyByPin", (event, pin) => queries.identifyStaffByPin(pin));

ipcMain.handle("data:getActivityLog", () => queries.getActivityLog());

ipcMain.handle("data:getCrashLog", () => queries.getCrashLog());
ipcMain.handle("orders:getOrders", () => queries.getOrders());

ipcMain.handle("sales:completeSale", (event, args) =>
  application.commands.completeSale(args),
);
ipcMain.handle("sales:completeCartSale", (event, cartItems, meta) =>
  application.commands.completeCartSale({ items: cartItems, meta }),
);
ipcMain.handle("credit:completeCreditSale", (event, args) =>
  application.commands.completeCreditSale(args),
);


ipcMain.handle("restock:addStock", (event, args) => application.commands.addStock(args));
ipcMain.handle("restock:completeRestockCart", (event, cartItems, meta) =>
  application.commands.completeRestockCart({ items: cartItems, meta }),
);


ipcMain.handle(
  "credit:recordPayment",
  (event, creditSaleId, amount, paymentMethod) =>
    application.commands.recordCreditPayment({ creditSaleId, amount, paymentMethod }),
);
ipcMain.handle("credit:deleteCreditSale", (event, creditSaleId) =>
  application.commands.deleteCreditSale({ creditSaleId }),
);


ipcMain.handle("license:getStatus", () => license.getLicenseStatus());
ipcMain.handle("license:activate", (event, key) =>
  license.activateLicense(key),
);

// Opens a URL in the user's actual default browser (or, for wa.me links,
// straight into WhatsApp Desktop if it's installed and registered as the
// handler) — this is real, warranted use of Electron's native shell
// module. A sandboxed renderer navigating itself to an external site
// isn't the right approach and often won't behave the way a real browser
// tab would.
ipcMain.handle("shell:openExternal", (event, url) => shell.openExternal(url));

// Writes a PNG (as a data URL) straight to the OS clipboard — real,
// native Electron capability, not something achievable from a sandboxed
// web page. This is what makes "paste this poster into WhatsApp/Facebook"
// a single click instead of download-then-manually-attach.
ipcMain.handle("clipboard:writeImage", (event, dataUrl) => {
  const image = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(image);
});

ipcMain.handle("system:databaseHealth", () => getDatabaseHealth());
ipcMain.handle("system:startupHealth", () => global.__HISAFLOW_STARTUP_HEALTH__ || getDatabaseHealth());
ipcMain.handle("system:diagnostics", () => diagnostics.buildDiagnostics());
ipcMain.handle("system:exportDiagnostics", (event, destinationPath) => diagnostics.exportDiagnostics(destinationPath));
ipcMain.handle("system:repairProductSummaries", () => repairCachedProductSummaries());
ipcMain.handle("system:inventoryReconciliation", (event, limit) => getInventoryReconciliationReport(limit));
ipcMain.handle("sync:identity", () => sync.identity());
ipcMain.handle("sync:status", () => sync.getSyncStatus());
ipcMain.handle("sync:firstSyncSafety", () => sync.getFirstSyncSafety());
ipcMain.handle("sync:lease", (event, options) => sync.leasePendingEvents(options));
ipcMain.handle("sync:ack", (event, leaseToken, eventIds) => sync.acknowledgeEvents(leaseToken, eventIds));
ipcMain.handle("sync:fail", (event, leaseToken, failures) => sync.failEvents(leaseToken, failures));
ipcMain.handle("sync:release", (event, leaseToken) => sync.releaseLease(leaseToken));
ipcMain.handle("sync:trigger", () => cloud.triggerSync());
ipcMain.handle("sync:conflicts", (event, limit) => sync.getConflicts(limit));
ipcMain.handle('storefront:request', (event, action, payload = {}) => {
  if (['save','publish','unpublish'].includes(action)) {
    const settings=queries.getSettings();
    if(!settings.ownerPin||String(payload.pin)!==String(settings.ownerPin))throw new Error('OWNER_PIN_REQUIRED');
  }
  return cloud.storefront(action,payload);
});
ipcMain.handle("cloud:session", () => cloud.publicSession());
ipcMain.handle("cloud:login", (event, payload) => cloud.login(payload));
ipcMain.handle("cloud:register", (event, payload) => cloud.register(payload));
ipcMain.handle("cloud:logout", () => cloud.clearSession());
ipcMain.handle("cloud:shops", () => cloud.listShops());
ipcMain.handle("cloud:ownerOverview", () => cloud.getOwnerOverview());
ipcMain.handle("cloud:createShop", (event, name) => cloud.createShop(name));
ipcMain.handle("cloud:renameShop", (event, shopId, name) => cloud.renameShop(shopId, name));
ipcMain.handle("cloud:joinShop", (event, shopId) => cloud.joinShop(shopId));
ipcMain.handle("cloud:history", (event, limit) => cloud.getSyncHistory(limit));
ipcMain.handle("cloud:devices", () => cloud.listDevices());
ipcMain.handle("cloud:renameDevice", (event, deviceId, name) => cloud.renameDevice(deviceId, name));
ipcMain.handle("cloud:revokeDevice", (event, deviceId) => cloud.revokeDevice(deviceId));
ipcMain.handle("reconciliation:issues", () => cloud.getReconciliationIssues());
ipcMain.handle("reconciliation:details", (event, issueId) => cloud.getReconciliationDetails(issueId));
ipcMain.handle("reconciliation:acknowledge", (event, issueId, note) => cloud.acknowledgeReconciliation(issueId, note));
ipcMain.handle("reconciliation:resolve", (event, issueId, physicalQuantity, note) => cloud.resolveReconciliation(issueId, physicalQuantity, note));
ipcMain.handle("reconciliation:cached", () => sync.getCachedReconciliationIssues());

ipcMain.handle("data:getSettings", () => queries.getSettings());
ipcMain.handle("accounts:summary", () => queries.getAccountSummary());
ipcMain.handle("accounts:statement", (event, args) => queries.getAccountStatement(args));
ipcMain.handle("data:saveSettings", (event, settings) =>
  queries.saveSettings(settings),
);
ipcMain.handle("data:resetOwnerPin", (event, newPin) =>
  queries.resetOwnerPin(newPin),
);


