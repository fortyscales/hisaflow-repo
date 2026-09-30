import React, { useState, useEffect, useRef } from "react";
import { dataService } from "../services/DataService";
import { backupService } from "../services/backupService";
import CrashLogModal from "../components/CrashLogModal.jsx";
import PaymentAccountsSection from "../components/PaymentAccountsSection.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { blockInvalidNumberKeys } from "../utils/numberInput";
import LoadingState from "../components/LoadingState.jsx";

const SettingsScreen = () => {
  const { t, language } = useLanguage();
  const [settings, setSettings] = useState({});
  const [businessName, setBusinessName] = useState("");
  const [businessLogo, setBusinessLogo] = useState(null);
  const [businessTagline, setBusinessTagline] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessRegistrationNo, setBusinessRegistrationNo] = useState("");
  const [documentFooter, setDocumentFooter] = useState("");
  const [documentBrandColor, setDocumentBrandColor] = useState("#263f32");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);
  const [busy, setBusy] = useState(null); // which backup action is in flight
  const [showCrashLog, setShowCrashLog] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const PRESET_QUESTIONS = [
    t("securityQ1"),
    t("securityQ2"),
    t("securityQ3"),
    t("securityQ4"),
  ];
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");
  const [useCustomQuestion, setUseCustomQuestion] = useState(false);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionSaved, setQuestionSaved] = useState(false);

  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState("18");
  const [tin, setTin] = useState("");
  const [vrn, setVrn] = useState("");
  const [savingTax, setSavingTax] = useState(false);
  const [taxSaved, setTaxSaved] = useState(false);

  const loadSettings = () =>
    dataService.getSettings().then((s) => {
      setSettings(s);
      setBusinessName(s.businessName || "");
      setBusinessLogo(s.businessLogo || null);
      setBusinessTagline(s.businessTagline || "");
      setBusinessAddress(s.businessAddress || "");
      setBusinessPhone(s.businessPhone || "");
      setBusinessEmail(s.businessEmail || "");
      setBusinessRegistrationNo(s.businessRegistrationNo || "");
      setDocumentFooter(s.documentFooter || "");
      setDocumentBrandColor(/^#[0-9a-fA-F]{6}$/.test(s.documentBrandColor || "") ? s.documentBrandColor : "#263f32");
      setOwnerPhone(s.ownerPhone || "");
      if (s.securityQuestion?.question) {
        const isPreset = PRESET_QUESTIONS.includes(s.securityQuestion.question);
        setUseCustomQuestion(!isPreset);
        setSelectedQuestion(isPreset ? s.securityQuestion.question : "");
        setCustomQuestion(isPreset ? "" : s.securityQuestion.question);
      } else {
        setSelectedQuestion(PRESET_QUESTIONS[0]);
      }
      setVatEnabled(!!s.vatEnabled);
      setVatRate(s.vatRate != null ? String(s.vatRate) : "18");
      setTin(s.tin || "");
      setVrn(s.vrn || "");
      setLoading(false);
    });

  useEffect(() => {
    loadSettings();
  }, []);

  if (loading) return <LoadingState />;

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    try {
      const updated = {
        ...settings,
        businessName: businessName.trim(),
        businessLogo,
        businessTagline: businessTagline.trim(),
        businessAddress: businessAddress.trim(),
        businessPhone: businessPhone.trim(),
        businessEmail: businessEmail.trim(),
        businessRegistrationNo: businessRegistrationNo.trim(),
        documentFooter: documentFooter.trim(),
        documentBrandColor,
        ownerPhone: ownerPhone.trim(),
      };
      await dataService.saveSettings(updated);
      setSettings(updated);
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2000);
    } catch (err) {
      console.error("Save business info error:", err);
      setMessage({ type: "error", text: t("unexpectedErrorTryAgain") });
    } finally {
      setSavingInfo(false);
    }
  };

  const handlePickLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setMessage({ type: "error", text: "Please choose an image file for the business logo." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: "error", text: "Logo must be 2 MB or smaller." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBusinessLogo(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveSecurityQuestion = async () => {
    const question = useCustomQuestion
      ? customQuestion.trim()
      : selectedQuestion;
    if (!question) {
      setMessage({ type: "error", text: t("chooseOrWriteQuestion") });
      return;
    }
    if (!securityAnswer.trim()) {
      setMessage({ type: "error", text: t("enterSecurityAnswer") });
      return;
    }
    setSavingQuestion(true);
    try {
      const updated = {
        ...settings,
        securityQuestion: {
          question,
          answer: securityAnswer.trim().toLowerCase(),
        },
      };
      await dataService.saveSettings(updated);
      setSettings(updated);
      setSecurityAnswer("");
      setQuestionSaved(true);
      setTimeout(() => setQuestionSaved(false), 2000);
    } catch (err) {
      console.error("Save security question error:", err);
      setMessage({ type: "error", text: t("unexpectedErrorTryAgain") });
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleSaveTaxSettings = async () => {
    setSavingTax(true);
    try {
      const updated = {
        ...settings,
        vatEnabled,
        vatRate: parseFloat(vatRate) || 0,
        tin: tin.trim(),
        vrn: vrn.trim(),
      };
      await dataService.saveSettings(updated);
      setSettings(updated);
      setTaxSaved(true);
      setTimeout(() => setTaxSaved(false), 2000);
    } catch (err) {
      console.error("Save tax settings error:", err);
      setMessage({ type: "error", text: t("unexpectedErrorTryAgain") });
    } finally {
      setSavingTax(false);
    }
  };

  const handleExportFile = async () => {
    setBusy("exportFile");
    try {
      await backupService.exportToFile();
      setMessage({ type: "success", text: t("backupFileSavedMessage") });
    } catch (err) {
      console.error("Export backup error:", err);
      setMessage({ type: "error", text: t("unexpectedErrorTryAgain") });
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("importFile");
    try {
      const result = await backupService.importFromFile(file);
      setMessage(
        result.success
          ? { type: "success", text: t("restoreSuccessMessage") }
          : { type: "error", text: result.error },
      );
      if (result.success) await loadSettings();
    } catch (err) {
      console.error("Import backup error:", err);
      setMessage({ type: "error", text: t("unexpectedErrorTryAgain") });
    } finally {
      setBusy(null);
      e.target.value = "";
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.stickyHeader}><h1 style={styles.title}>{t("navSettings")}</h1></div>

      {message && (
        <div
          style={{
            ...styles.message,
            ...(message.type === "error"
              ? styles.messageError
              : styles.messageSuccess),
          }}
        >
          {message.text}
        </div>
      )}

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("businessInfoSectionTitle")}</h2>

        <label style={styles.label}>{t("businessNameSettingsLabel")}</label>
        <input
          style={styles.input}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />

        <label style={styles.label}>{t("businessLogoLabel")}</label>
        <div style={styles.logoRow}>
          <div
            style={styles.logoPreview}
            onClick={() => logoInputRef.current.click()}
          >
            {businessLogo && (
              <img src={businessLogo} alt="" style={styles.logoImg} />
            )}
          </div>
          <div>
            <button
              style={styles.logoBtn}
              onClick={() => logoInputRef.current.click()}
            >
              {businessLogo ? t("changePhoto") : t("addPhoto")}
            </button>
            {businessLogo && (
              <button
                style={styles.removeLogoBtn}
                onClick={() => setBusinessLogo(null)}
              >
                {t("removePhoto")}
              </button>
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickLogo}
            style={{ display: "none" }}
          />
        </div>
        <div style={styles.hint}>Used automatically on quotations, invoices, receipts, reports, statements and other printable documents. PNG/JPG/WebP, max 2 MB.</div>

        <label style={styles.label}>Business tagline</label>
        <input style={styles.input} value={businessTagline} onChange={(e) => setBusinessTagline(e.target.value)} placeholder="Optional tagline" />
        <label style={styles.label}>Business address</label>
        <input style={styles.input} value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="Street, city / region" />
        <label style={styles.label}>Business phone</label>
        <input style={styles.input} value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} placeholder="+255 ..." />
        <label style={styles.label}>Business email</label>
        <input style={styles.input} type="email" value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} placeholder="sales@example.com" />
        <label style={styles.label}>Registration number</label>
        <input style={styles.input} value={businessRegistrationNo} onChange={(e) => setBusinessRegistrationNo(e.target.value)} placeholder="Optional company registration number" />
        <label style={styles.label}>Document brand color</label>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <input aria-label="Document brand color" type="color" value={documentBrandColor} onChange={(e)=>setDocumentBrandColor(e.target.value)} style={{width:54,height:40,borderWidth: "1px", borderStyle: "solid", borderColor: "var(--border)",borderRadius:8,padding:3,background:"var(--surface)"}} />
          <input style={{...styles.input,flex:1}} value={documentBrandColor} onChange={(e)=>{const v=e.target.value; if(/^#[0-9a-fA-F]{0,6}$/.test(v)) setDocumentBrandColor(v)}} placeholder="#263f32" />
        </div>
        <div style={styles.hint}>Used for headings, table headers and accents on quotations, proformas and invoices.</div>

        <label style={styles.label}>Document footer / payment instructions</label>
        <textarea style={{...styles.input, minHeight: 72, resize: "vertical"}} value={documentFooter} onChange={(e) => setDocumentFooter(e.target.value)} placeholder="Thank you, bank details, payment instructions, terms, etc." />

        <label style={styles.label}>{t("ownerPhoneLabel")}</label>
        <input
          style={styles.input}
          value={ownerPhone}
          onChange={(e) => setOwnerPhone(e.target.value)}
          placeholder="07XX XXX XXX"
        />
        <div style={styles.hint}>{t("ownerPhoneHint")}</div>

        <button
          style={styles.saveBtn}
          disabled={savingInfo}
          onClick={handleSaveInfo}
        >
          {infoSaved
            ? t("savedLabel")
            : savingInfo
              ? t("completing")
              : t("saveButton")}
        </button>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("paymentAccountsSectionTitle")}</h2>
        <p style={styles.sectionHint}>{t("paymentAccountsHint")}</p>
        <PaymentAccountsSection
          settings={settings}
          onSettingsChange={setSettings}
        />
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("securityQuestionSectionTitle")}</h2>
        <p style={styles.sectionHint}>
          {settings.securityQuestion?.question
            ? t("securityQuestionSetHint")
            : t("securityQuestionNotSetHint")}
        </p>

        <div style={styles.questionGrid}>
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              style={{
                ...styles.questionOption,
                ...(!useCustomQuestion && selectedQuestion === q
                  ? styles.questionOptionActive
                  : {}),
              }}
              onClick={() => {
                setSelectedQuestion(q);
                setUseCustomQuestion(false);
              }}
            >
              {q}
            </button>
          ))}
          <button
            style={{
              ...styles.questionOption,
              ...(useCustomQuestion ? styles.questionOptionActive : {}),
            }}
            onClick={() => setUseCustomQuestion(true)}
          >
            {t("otherQuestion")}
          </button>
        </div>

        {useCustomQuestion && (
          <input
            style={styles.input}
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder={t("writeYourQuestion")}
          />
        )}

        <label style={styles.label}>{t("yourAnswerPlaceholder")}</label>
        <input
          style={styles.input}
          value={securityAnswer}
          onChange={(e) => setSecurityAnswer(e.target.value)}
          placeholder={t("yourAnswerPlaceholder")}
        />

        <button
          style={styles.saveBtn}
          disabled={savingQuestion}
          onClick={handleSaveSecurityQuestion}
        >
          {questionSaved
            ? t("savedLabel")
            : savingQuestion
              ? t("completing")
              : t("saveButton")}
        </button>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("taxSectionTitle")}</h2>
        <p style={styles.sectionHint}>{t("taxSectionHint")}</p>

        <div
          style={styles.toggleRow}
          onClick={() => setVatEnabled(!vatEnabled)}
        >
          <span style={styles.toggleLabel}>{t("enableVatLabel")}</span>
          <div
            style={{ ...styles.toggle, ...(vatEnabled ? styles.toggleOn : {}) }}
          >
            <div
              style={{
                ...styles.toggleKnob,
                ...(vatEnabled ? styles.toggleKnobOn : {}),
              }}
            />
          </div>
        </div>

        {vatEnabled && (
          <>
            <label style={styles.label}>{t("vatRateLabel")}</label>
            <input
              style={styles.input}
              type="number"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              onKeyDown={blockInvalidNumberKeys}
              placeholder="18"
            />
          </>
        )}

        <label style={styles.label}>{t("tinLabel")}</label>
        <input
          style={styles.input}
          value={tin}
          onChange={(e) => setTin(e.target.value)}
          placeholder="000-000-000"
        />

        <label style={styles.label}>{t("vrnLabel")}</label>
        <input
          style={styles.input}
          value={vrn}
          onChange={(e) => setVrn(e.target.value)}
          placeholder="00-000000-A"
        />

        <button
          style={styles.saveBtn}
          disabled={savingTax}
          onClick={handleSaveTaxSettings}
        >
          {taxSaved
            ? t("savedLabel")
            : savingTax
              ? t("completing")
              : t("saveButton")}
        </button>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("localBackupSectionTitle")}</h2>
        <p style={styles.sectionHint}>{t("localBackupHint")}</p>

        <div style={styles.row}>
          <button
            style={styles.actionBtn}
            disabled={!!busy}
            onClick={handleExportFile}
          >
            {busy === "exportFile" ? t("completing") : t("backupToFileButton")}
          </button>
          <button
            style={styles.actionBtn}
            disabled={!!busy}
            onClick={() => fileInputRef.current.click()}
          >
            {busy === "importFile"
              ? t("completing")
              : t("restoreFromFileButton")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{language === "en" ? "Backup and cloud sync" : "Nakala na usawazishaji wa cloud"}</h2>
        <p style={styles.sectionHint}>{language === "en"
          ? "The legacy Google backup service is retired; automatic Google uploads are off. Local file export and import remain available above. Use My Shops / Cloud & Services for PostgreSQL sync. Sync is not a replacement for an independent backup."
          : "Huduma ya zamani ya nakala za Google imeondolewa; utumaji wa nakala kiotomatiki Google umezimwa. Kuhifadhi na kurejesha faili bado kunapatikana hapo juu. Tumia Maduka Yangu / Cloud na Huduma kusawazisha PostgreSQL. Usawazishaji si mbadala wa nakala ya ziada."}</p>
      </div>
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t("errorReportsTitle")}</h2>
        <p style={styles.sectionHint}>{t("errorReportsHint")}</p>
        <button style={styles.actionBtn} onClick={() => setShowCrashLog(true)}>
          {t("viewErrorReportsButton")}
        </button>
      </div>

      <CrashLogModal
        visible={showCrashLog}
        onClose={() => setShowCrashLog(false)}
      />
    </div>
  );
};

const styles = {
  stickyHeader: { position: "sticky", top: -28, zIndex: 20, marginTop: -28, marginLeft: -28, marginRight: -28, padding: "28px 28px 14px", marginBottom: 18, background: "var(--bg)", borderBottom: "1px solid var(--border-muted)" },
  wrap: {
    flex: 1,
    overflow: "auto",
    padding: 28,
    maxWidth: 640,
    margin: "0 auto",
    width: "100%",
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    marginBottom: 20,
  },
  message: {
    padding: "12px 16px",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 18,
  },
  messageSuccess: {
    background: "var(--success-light)",
    color: "var(--success)",
  },
  messageError: { background: "var(--danger-light)", color: "var(--danger)" },
  section: {
    background: "var(--surface)",
    borderWidth: "1px", borderStyle: "solid", borderColor: "var(--border-muted)",
    borderRadius: 18,
    padding: 22,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: 800, marginBottom: 4 },
  sectionHint: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 16,
    marginTop: 4,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
    color: "var(--text-primary)",
    marginTop: 14,
  },
  input: {
    width: "100%",
    padding: "11px 13px",
    borderWidth: "1.5px", borderStyle: "solid", borderColor: "var(--border)",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    background: "var(--bg)",
    color: "var(--text-primary)",
  },
  hint: { fontSize: 11, color: "var(--text-muted)", marginTop: 6 },
  logoRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 4 },
  logoPreview: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: "var(--bg)",
    borderWidth: "1.5px", borderStyle: "dashed", borderColor: "var(--border)",
    cursor: "pointer",
    overflow: "hidden",
    flexShrink: 0,
  },
  logoImg: { width: "100%", height: "100%", objectFit: "cover" },
  logoBtn: {
    display: "block",
    padding: "7px 12px",
    borderRadius: 10,
    borderWidth: "1.5px", borderStyle: "solid", borderColor: "var(--border)",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontWeight: 700,
    fontSize: 12,
    marginBottom: 4,
  },
  removeLogoBtn: {
    display: "block",
    padding: "4px 12px",
    borderWidth: 0,
    background: "none",
    color: "var(--danger)",
    fontWeight: 700,
    fontSize: 11,
  },
  questionGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 14,
    marginBottom: 12,
  },
  questionOption: {
    padding: "7px 12px",
    borderRadius: 999,
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontWeight: 600,
    fontSize: 11,
  },
  questionOptionActive: {
    background: "var(--primary-light)",
    borderColor: "var(--primary)",
    color: "var(--primary-dark)",
  },
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    cursor: "pointer",
    marginBottom: 6,
  },
  toggleLabel: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" },
  toggle: {
    width: 38,
    height: 22,
    borderRadius: 999,
    background: "var(--border)",
    padding: 2,
    flexShrink: 0,
  },
  toggleOn: { background: "var(--primary)" },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "white",
    transition: "transform 0.15s ease",
  },
  toggleKnobOn: { transform: "translateX(16px)" },
  saveBtn: {
    marginTop: 18,
    padding: "11px 20px",
    borderRadius: 12,
    borderWidth: 0,
    background: "var(--primary)",
    color: "white",
    fontWeight: 800,
    fontSize: 13,
  },
  row: { display: "flex", gap: 10 },
  actionBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: "1.5px", borderStyle: "solid", borderColor: "var(--border)",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontWeight: 700,
    fontSize: 13,
  },
  cloudStatus: {
    padding: "11px 14px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 14,
  },
  cloudStatusOk: {
    background: "var(--success-light)",
    color: "var(--success)",
  },
  cloudStatusWarn: {
    background: "var(--warning-light)",
    color: "var(--warning)",
  },
  warnNote: { fontSize: 12, color: "var(--text-muted)", marginBottom: 14 },
};

export default SettingsScreen;


