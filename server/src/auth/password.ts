import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
const scrypt = promisify(scryptCb);
export async function hashPassword(password: string) {
  if (password.length < 8) throw new Error('PASSWORD_TOO_SHORT');
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
