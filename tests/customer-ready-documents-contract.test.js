const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function ok(x,m){if(!x)throw new Error(m)}
const sidebar=read('src/components/SideBar.jsx');
const settings=read('src/screens/SettingsScreen.jsx');
const docs=read('src/screens/DocumentsScreen.jsx');
const branding=read('src/utils/documentBranding.js');
const theme=read('src/styles/theme.css');
const dash=read('src/screens/DashboardScreen.jsx');
const onboarding=read('src/components/OnboardingWizard.jsx');
ok(!sidebar.includes('{ key: "cloud",'), 'cloud navigation must remain hidden for customer release');
ok(!sidebar.includes('{ key: "reconciliation",'), 'reconciliation navigation must remain hidden for customer release');
ok(!onboarding.includes('onClick={() => setStep("restore")}'), 'cloud restore entry point must remain hidden during onboarding');
ok(settings.includes('{false && (<>') && settings.includes('cloudBackupSectionTitle'), 'cloud backup implementation should be retained but hidden');
ok(settings.includes('documentBrandColor') && settings.includes('type="color"'), 'brand color customization missing');
ok(branding.includes('normalizeBrandColor') && branding.includes('--brand'), 'safe brand color document theme missing');
ok(docs.includes('docQuery') && docs.includes('invoiceQuery'), 'B2B/invoice search missing');
ok(docs.includes('invoiceStatus') && docs.includes('docType'), 'document filters missing');
ok(docs.includes('Prepared for') && docs.includes('<table>'), 'professional quotation structure missing');
ok(theme.includes('width: 72mm') && theme.includes('position: fixed'), 'compact receipt print regression fix missing');
ok(dash.includes('products.length === 0 && transactionCount === 0'), 'fresh-install dashboard guard regressed');
ok(!dash.includes('products.length === 0 && sales.length === 0'), 'old fresh-install crash returned');
console.log('customer-ready documents contract: PASS');
