const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { DATA_DIR } = require('./db');

const SESSION_PATH = path.join(process.env.HISAFLOW_WORKSPACE_ROOT || DATA_DIR, 'cloud-session.json');
function readRaw() { try { return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')); } catch { return {}; } }
function writeRaw(value) { require('./workspaceRegistry').atomicJson(SESSION_PATH, value); }
function protect(value) {
  if (!value) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS_SECURE_STORAGE_UNAVAILABLE');
  return safeStorage.encryptString(String(value)).toString('base64');
}
function reveal(value) {
  if (!value) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS_SECURE_STORAGE_UNAVAILABLE');
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}
function saveSession({ baseUrl, accessToken, refreshToken, user, memberships }) {
  const prior = readRaw();
  writeRaw({
    baseUrl: String(baseUrl || prior.baseUrl || '').replace(/\/$/, ''),
    accessToken: accessToken ? protect(accessToken) : prior.accessToken,
    refreshToken: refreshToken ? protect(refreshToken) : prior.refreshToken,
    user: user || prior.user || null,
    memberships: memberships || prior.memberships || [],
    updatedAt: new Date().toISOString(),
  });
}
function getSession() {
  const raw = readRaw();
  return { ...raw, accessToken: reveal(raw.accessToken), refreshToken: reveal(raw.refreshToken) };
}
function publicSession() {
  const raw = readRaw();
  return { configured: Boolean(raw.baseUrl && raw.refreshToken), baseUrl: raw.baseUrl || '', user: raw.user || null, memberships: raw.memberships || [], updatedAt: raw.updatedAt || null };
}
function clearSession() { try { fs.unlinkSync(SESSION_PATH); } catch {} }
module.exports = { saveSession, getSession, publicSession, clearSession };
