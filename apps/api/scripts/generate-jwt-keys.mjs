// Generates an ES256 key pair for signing access tokens.
// The API gets the private key; the Next.js server gets ONLY the public key.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
console.log('# apps/api/.env');
console.log(`JWT_PRIVATE_KEY_B64=${b64(privateKey)}`);
console.log(`JWT_PUBLIC_KEY_B64=${b64(publicKey)}`);
console.log('\n# apps/web/.env.local');
console.log(`JWT_PUBLIC_KEY_B64=${b64(publicKey)}`);
