export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function normalizeBrandColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#263f32";
}

export function businessIdentity(settings = {}) {
  return {
    name: settings.businessName || "HisaFlow",
    logo: settings.businessLogo || "",
    tagline: settings.businessTagline || "",
    address: settings.businessAddress || settings.address || "",
    phone: settings.businessPhone || settings.ownerPhone || settings.phone || "",
    email: settings.businessEmail || "",
    tin: settings.tin || "",
    vrn: settings.vrn || "",
    registrationNo: settings.businessRegistrationNo || "",
    footer: settings.documentFooter || "",
    color: normalizeBrandColor(settings.documentBrandColor),
  };
}

export function brandedDocumentHeader(settings = {}, { title = "", meta = "" } = {}) {
  const b = businessIdentity(settings);
  const logo = b.logo ? `<img class="hf-brand-logo" src="${escapeHtml(b.logo)}" alt="" />` : "";
  const details = [b.address, b.phone, b.email].filter(Boolean).map(escapeHtml).join(" · ");
  const legal = [b.tin && `TIN: ${escapeHtml(b.tin)}`, b.vrn && `VRN: ${escapeHtml(b.vrn)}`, b.registrationNo && `Reg: ${escapeHtml(b.registrationNo)}`].filter(Boolean).join(" · ");
  return `<header class="hf-brand-header" style="--brand:${b.color}"><div class="hf-brand-left">${logo}<div><div class="hf-brand-name">${escapeHtml(b.name)}</div>${b.tagline ? `<div class="hf-brand-tagline">${escapeHtml(b.tagline)}</div>` : ""}${details ? `<div class="hf-brand-details">${details}</div>` : ""}${legal ? `<div class="hf-brand-details">${legal}</div>` : ""}</div></div><div class="hf-document-meta">${title ? `<div class="hf-document-title">${escapeHtml(title)}</div>` : ""}${meta ? `<div>${meta}</div>` : ""}</div></header>`;
}

export const brandedDocumentCss = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#17202a;-webkit-print-color-adjust:exact;print-color-adjust:exact}.hf-document{--brand:#263f32;font-family:Inter,Arial,sans-serif;max-width:900px;margin:0 auto}.hf-brand-header{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;padding-bottom:18px;border-bottom:3px solid var(--brand,#263f32)}.hf-brand-left{display:flex;align-items:flex-start;gap:14px;min-width:0}.hf-brand-logo{width:72px;height:72px;object-fit:contain;display:block}.hf-brand-name{font-size:22px;font-weight:800;line-height:1.15;color:#111827}.hf-brand-tagline{font-size:11px;color:#667085;margin-top:4px}.hf-brand-details{font-size:10px;color:#667085;margin-top:4px;max-width:520px;line-height:1.45}.hf-document-meta{text-align:right;font-size:11px;color:#667085;line-height:1.5}.hf-document-title{font-size:21px;font-weight:850;color:var(--brand,#263f32);letter-spacing:.7px;margin-bottom:5px}.hf-brand-footer{margin-top:30px;padding-top:12px;border-top:1px solid #d0d5dd;text-align:center;font-size:9px;color:#667085;white-space:pre-wrap;line-height:1.5}.hf-accent{color:var(--brand,#263f32)}.hf-accent-bg{background:var(--brand,#263f32);color:#fff}@page{size:A4;margin:13mm}`;

export function brandedFooter(settings = {}) {
  const b = businessIdentity(settings);
  const identity = [b.phone, b.email].filter(Boolean).map(escapeHtml).join(" · ");
  const footer = b.footer ? escapeHtml(b.footer).replace(/\n/g,"<br>") : identity;
  return footer ? `<footer class="hf-brand-footer">${footer}</footer>` : "";
}
