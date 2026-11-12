import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts students' provider API keys at rest with AES-256-GCM (authenticated: a tampered
 * value fails to decrypt). The 32-byte key comes from LLM_CREDENTIALS_KEY and never touches
 * the database, so a database leak alone does not expose anyone's API key.
 *
 * Stored format: v1.<iv base64url>.<auth tag base64url>.<ciphertext base64url>
 */
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('LLM_CREDENTIALS_KEY must be 32 bytes, base64-encoded');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext] = stored.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unrecognised credential format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Shown in the UI instead of the key: enough to recognise it, useless to anyone else. */
export function keyHint(apiKey: string): string {
  return apiKey.length > 8 ? `…${apiKey.slice(-4)}` : '…';
}
