import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

let cachedKey: Buffer | undefined;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is not set');
  cachedKey = scryptSync(secret, 'support-tickets-ai-keys', 32);
  return cachedKey;
}

/** AES-256-GCM. Output: base64 `iv.tag.ciphertext`. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

/** Throws when APP_SECRET changed since the value was stored. */
export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
