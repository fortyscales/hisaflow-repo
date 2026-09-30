import { dataService } from "./DataService";

// Local file backups remain available. The retired Google phone/PIN
// transport must never gather data, send credentials or claim backup success.
const legacyDisabled = () => ({
  success: false,
  code: "LEGACY_CLOUD_BACKUP_RETIRED",
  error: "Legacy Google backup is unavailable. Use local file backups; use My Shops for cloud sync. / Nakala za zamani za Google hazipatikani. Tumia nakala za faili; tumia Maduka Yangu kusawazisha cloud.",
});

const gatherAllData = async () => {
  const [products, sales, creditSales, expenditures, suppliers, settings] =
    await Promise.all([
      dataService.getProductsForBackup(),
      dataService.getSales(),
      dataService.getCreditSales(),
      dataService.getExpenditures(),
      dataService.getSuppliers(),
      dataService.getSettings(),
    ]);
  return { products, sales, creditSales, expenditures, suppliers, settings };
};

const applyAllData = async (data) => {
  const result = await dataService.restoreBackupData(data);
  if (!result?.success) throw new Error(result?.error || "Backup restore failed");
};

export const backupService = {
  // ---- Local file backup — works immediately, no internet required ----

  async exportToFile() {
    const data = await gatherAllData();
    const settings = data.settings || {};
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const businessName = (settings.businessName || "HisaFlow").replace(
      /[^a-zA-Z0-9]/g,
      "_",
    );
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${businessName}_backup_${dateStr}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, fileName };
  },

  async importFromFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.products && !data.sales) {
        return {
          success: false,
          error: "Faili hii si nakala sahihi ya HisaFlow",
        };
      }
      await applyAllData(data);
      return { success: true };
    } catch (error) {
      console.error("Import from file error:", error);
      return { success: false, error: "Imeshindikana kusoma faili hii" };
    }
  },

  // Compatibility guards for older callers. No network or database access.
  async pushToCloud() { return legacyDisabled(); },
  async fetchFromCloud() { return legacyDisabled(); },
};
