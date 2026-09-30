import React, { useState, useEffect } from "react";
import { dataService } from "../services/DataService";
import { ownerIdentity } from "../services/staffService";
import { useLanguage } from "../context/LanguageContext.jsx";

// First-run business creation and returning-owner cloud shop selection.
const OnboardingWizard = ({ onComplete }) => {
  const { t, setLanguage } = useLanguage();
  const [step, setStep] = useState("choice"); // choice | businessInfo | pin | cloudLogin | shopSelect
  const [businessName, setBusinessName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("sw");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");
  const [useCustomQuestion, setUseCustomQuestion] = useState(false);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cloudBaseUrl = "http://127.0.0.1:4100";
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudShops, setCloudShops] = useState([]);

  const PRESET_QUESTIONS = [
    t("securityQ1"),
    t("securityQ2"),
    t("securityQ3"),
    t("securityQ4"),
  ];

  useEffect(() => {
    if (!selectedQuestion) setSelectedQuestion(PRESET_QUESTIONS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCloudLogin = async () => {
    setError("");
    if (!cloudEmail.trim() || !cloudPassword) { setError(t("cloudLoginRequired")); return; }
    setBusy(true);
    try {
      const result = await window.hisaflow.cloudLogin({ email: cloudEmail.trim(), password: cloudPassword });
      const shops = result?.shops || [];
      if (!shops.length) { setError(t("cloudNoBusinesses")); return; }
      const ident = await window.hisaflow.getSyncIdentity();
      if (result?.binding || shops.some(x => x.id === ident.shopId)) {
        const selected = shops.find(x => x.id === ident.shopId) || shops[0];
        setBusinessName(selected.name);
        setStep("pin");
      } else {
        setCloudShops(shops);
        setStep("shopSelect");
      }
    } catch (err) { setError(err?.message || t("unexpectedErrorTryAgain")); }
    finally { setBusy(false); }
  };

  const handleJoinCloudShop = async (shop) => {
    setError(""); setBusy(true);
    try {
      await window.hisaflow.joinCloudShop(shop.id);
      setBusinessName(shop.name);
      setStep("pin");
    } catch (err) { setError(err?.message || t("unexpectedErrorTryAgain")); }
    finally { setBusy(false); }
  };

  const handleBusinessInfoNext = () => {
    setError("");
    if (!businessName.trim()) {
      setError(t("enterBusinessNameError"));
      return;
    }
    setStep("pin");
  };

  const handleFinishSetup = async () => {
    setError("");
    if (pin.length < 4) {
      setError(t("pinTooShort"));
      return;
    }
    if (pin !== confirmPin) {
      setError(t("pinMismatch"));
      return;
    }
    const question = useCustomQuestion
      ? customQuestion.trim()
      : selectedQuestion;
    if (!question) {
      setError(t("chooseOrWriteQuestion"));
      return;
    }
    if (!securityAnswer.trim()) {
      setError(t("enterSecurityAnswer"));
      return;
    }
    const newSettings = {
      businessName: businessName.trim(),
      ownerPhone: ownerPhone.trim(),
      ownerPin: pin,
      language: selectedLanguage,
      securityQuestion: {
        question,
        answer: securityAnswer.trim().toLowerCase(),
      },
    };
    setBusy(true);
    try {
      await dataService.saveSettings(newSettings);
      setLanguage(selectedLanguage, newSettings);
      onComplete(newSettings, ownerIdentity());
    } catch (err) {
      console.error("Onboarding save error:", err);
      setError(t("unexpectedErrorTryAgain"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>HisaFlow</h1>

        {step === "choice" && (
          <>
            <p style={styles.subtitle}>{t("onboardingWelcomeSubtitle")}</p>
            <div style={{fontSize:13,color:"#667085",marginBottom:14}}>{selectedLanguage === "sw" ? "Chagua: tengeneza duka jipya kwenye kifaa hiki, au ingia kwenye akaunti yako ili kuunganisha duka ulilonalo." : "Choose: create a new shop on this device, or sign in to connect a shop you already own."}</div>
            <button style={styles.primaryButton} onClick={() => setStep("businessInfo")}>
              {selectedLanguage === "sw" ? "Anzisha Duka Jipya" : "Start a New Shop"}
            </button>
            <button style={styles.secondaryButton} onClick={() => { setError(""); setStep("cloudLogin"); }}>
              {selectedLanguage === "sw" ? "Nina Akaunti Tayari" : "I Already Have an Account"}
            </button>

          </>
        )}

        {step === "cloudLogin" && (
          <>
            <p style={styles.subtitle}>{t("cloudLoginSubtitle")}</p>
            {error && <div style={styles.error}>{error}</div>}
            <input style={styles.input} value={cloudEmail} onChange={(e)=>setCloudEmail(e.target.value)} placeholder={t("emailLabel")} autoFocus />
            <input type="password" style={styles.input} value={cloudPassword} onChange={(e)=>setCloudPassword(e.target.value)} placeholder={t("passwordLabel")} onKeyUp={(e)=>e.key === "Enter" && handleCloudLogin()} />
            <button style={styles.primaryButton} disabled={busy} onClick={handleCloudLogin}>{busy ? t("completing") : t("signInButton")}</button>
            <button style={styles.linkButton} onClick={()=>{setError("");setStep("choice");}}>{t("backButton")}</button>
          </>
        )}

        {step === "shopSelect" && (
          <>
            <p style={styles.subtitle}>{t("chooseBusinessSubtitle")}</p>
            {error && <div style={styles.error}>{error}</div>}
            <div style={{display:"grid",gap:10,marginBottom:16}}>
              {cloudShops.map(shop => (
                <button key={shop.id} style={styles.shopButton} disabled={busy} onClick={()=>handleJoinCloudShop(shop)}>
                  <strong>{shop.name}</strong><span style={{fontSize:11,opacity:.7,overflowWrap:"anywhere"}}>{selectedLanguage === "sw" ? "Kitambulisho cha duka" : "Shop ID"}: {shop.id}</span><span style={{fontSize:11,opacity:.7}}>{shop.role}</span>
                </button>
              ))}
            </div>
            <button style={styles.linkButton} onClick={()=>{setError("");setStep("cloudLogin");}}>{t("backButton")}</button>
          </>
        )}

        {step === "businessInfo" && (
          <>
            <p style={styles.subtitle}>{t("businessInfoStepSubtitle")}</p>
            {error && <div style={styles.error}>{error}</div>}

            <input
              style={styles.input}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={t("businessNameSettingsLabel")}
              autoFocus
            />
            <input
              style={styles.input}
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder={t("ownerPhoneLabel")}
            />
            <div style={styles.hint}>{t("ownerPhoneHint")}</div>

            <div style={styles.langRow}>
              <button
                style={{
                  ...styles.langOption,
                  ...(selectedLanguage === "sw" ? styles.langOptionActive : {}),
                }}
                onClick={() => setSelectedLanguage("sw")}
              >
                Kiswahili
              </button>
              <button
                style={{
                  ...styles.langOption,
                  ...(selectedLanguage === "en" ? styles.langOptionActive : {}),
                }}
                onClick={() => setSelectedLanguage("en")}
              >
                English
              </button>
            </div>

            <button
              style={styles.primaryButton}
              onClick={handleBusinessInfoNext}
            >
              {t("continueButton")}
            </button>
            <button
              style={styles.linkButton}
              onClick={() => {
                setStep("choice");
                setError("");
              }}
            >
              {t("backButton")}
            </button>
          </>
        )}

        {step === "pin" && (
          <>
            <p style={styles.subtitle}>{t("setupPinTitle")}</p>
            {error && <div style={styles.error}>{error}</div>}

            <input
              type="password"
              inputMode="numeric"
              placeholder={t("newPinPlaceholder")}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              style={styles.input}
              autoFocus
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder={t("confirmPinPlaceholder")}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              style={styles.input}
            />

            <div style={styles.hint}>{t("securityQuestionSetupHint")}</div>

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

            <input
              style={styles.input}
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              placeholder={t("yourAnswerPlaceholder")}
              onKeyUp={(e) => e.key === "Enter" && handleFinishSetup()}
            />

            <button
              style={styles.primaryButton}
              disabled={busy}
              onClick={handleFinishSetup}
            >
              {busy ? t("completing") : t("startButton")}
            </button>
            <button
              style={styles.linkButton}
              onClick={() => {
                setStep("businessInfo");
                setError("");
              }}
            >
              {t("backButton")}
            </button>
          </>
        )}


      </div>
    </div>
  );
};

const styles = {
  wrap: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
  },
  card: {
    width: 380,
    background: "var(--surface)",
    borderRadius: 24,
    padding: "40px 32px",
    borderWidth: "1px", borderStyle: "solid", borderColor: "var(--border-muted)",
    boxShadow: "0 1px 3px rgba(41, 37, 34, 0.08)",
  },
  title: {
    fontSize: 24,
    fontWeight: 800,
    textAlign: "center",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    textAlign: "center",
    margin: "8px 0 24px",
    lineHeight: 1.5,
  },
  error: {
    background: "var(--danger-light)",
    color: "var(--danger)",
    fontSize: 13,
    fontWeight: 600,
    padding: "10px 14px",
    borderRadius: 12,
    marginBottom: 16,
    textAlign: "center",
  },
  input: {
    width: "100%",
    padding: "13px 14px",
    borderWidth: "2px", borderStyle: "solid", borderColor: "var(--border)",
    borderRadius: 14,
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 12,
    background: "var(--bg)",
    color: "var(--text-primary)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 16,
    marginTop: -6,
  },
  langRow: { display: "flex", gap: 8, marginBottom: 18 },
  langOption: {
    flex: 1,
    padding: "10px 0",
    borderRadius: 12,
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontWeight: 700,
    fontSize: 13,
  },
  langOptionActive: {
    background: "var(--primary-light)",
    borderColor: "var(--primary)",
    color: "var(--primary-dark)",
  },
  questionGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 },
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
  secondaryButton: { width:"100%", padding:14, marginTop:10, borderRadius:14, borderWidth:"1.5px", borderStyle:"solid", borderColor:"var(--primary)", background:"var(--surface)", color:"var(--primary)", fontSize:14, fontWeight:800 },
  shopButton: { width:"100%", padding:"13px 14px", borderRadius:14, borderWidth:"1px", borderStyle:"solid", borderColor:"var(--border)", background:"var(--surface)", color:"var(--text-primary)", display:"flex", justifyContent:"space-between", alignItems:"center", textAlign:"left" },
  primaryButton: {
    width: "100%",
    padding: 15,
    borderWidth: 0,
    borderRadius: 14,
    background: "var(--primary)",
    color: "white",
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 10,
  },
  secondaryButton: {
    width: "100%",
    padding: 15,
    borderRadius: 14,
    borderWidth: "1.5px", borderStyle: "solid", borderColor: "var(--border)",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontSize: 14,
    fontWeight: 700,
  },
  linkButton: {
    width: "100%",
    padding: 8,
    borderWidth: 0,
    background: "none",
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center",
  },
};

export default OnboardingWizard;


