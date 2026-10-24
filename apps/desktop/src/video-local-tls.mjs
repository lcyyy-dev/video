/** Ephemeral loopback TLS, trusted only by the isolated child. No OS certificate installation. */
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';

const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
const der = (tag, content) => {
  const body = bytes(content);
  let n = body.length, length;
  if (n < 128) length = Buffer.from([n]);
  else { const list = []; while (n) { list.unshift(n & 255); n >>>= 8; } length = Buffer.from([128 | list.length, ...list]); }
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const sequence = (...parts) => der(0x30, Buffer.concat(parts));
const oid = values => {
  const result = [values[0] * 40 + values[1]];
  for (let n of values.slice(2)) { const part = [n & 127]; while ((n = Math.floor(n / 128))) part.unshift((n & 127) | 128); result.push(...part); }
  return der(6, Buffer.from(result));
};
const pem = (name, body) => `-----BEGIN ${name}-----\n${body.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${name}-----\n`;
const date = value => der(0x17, Buffer.from(value.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));

export function createVideoLocalTls() {
  const authority = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algorithm = sequence(oid([1, 2, 840, 113549, 1, 1, 11]), der(5, Buffer.alloc(0)));
  const name = text => sequence(der(0x31, sequence(oid([2, 5, 4, 3]), der(0x0c, Buffer.from(text)))));
  const authorityName = name('OpenFilm Ephemeral Video Authority');
  const serverName = name('OpenFilm Loopback Video Planner');
  const certificate = (subject, publicKey, issuer, signingKey, extensions) => {
    const serial = randomBytes(16); serial[0] &= 0x7f;
    const tbs = sequence(der(0xa0, der(2, Buffer.from([2]))), der(2, serial), algorithm, issuer,
      sequence(date(new Date(Date.now() - 300_000)), date(new Date(Date.now() + 7 * 86_400_000))), subject,
      publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, sequence(...extensions)));
    return pem('CERTIFICATE', sequence(tbs, algorithm, der(3, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, signingKey)]))));
  };
  const authorityCert = certificate(authorityName, authority.publicKey, authorityName, authority.privateKey, [
    sequence(oid([2, 5, 29, 19]), der(1, Buffer.from([255])), der(4, sequence(der(1, Buffer.from([255]))))),
    sequence(oid([2, 5, 29, 15]), der(1, Buffer.from([255])), der(4, der(3, Buffer.from([1, 6])))),
  ]);
  const serverCert = certificate(serverName, server.publicKey, authorityName, authority.privateKey, [
    sequence(oid([2, 5, 29, 19]), der(1, Buffer.from([255])), der(4, sequence())),
    sequence(oid([2, 5, 29, 15]), der(1, Buffer.from([255])), der(4, der(3, Buffer.from([5, 0xa0])))),
    sequence(oid([2, 5, 29, 17]), der(4, sequence(der(0x87, Buffer.from([127, 0, 0, 1])), der(0x82, Buffer.from('localhost'))))),
    sequence(oid([2, 5, 29, 37]), der(4, sequence(oid([1, 3, 6, 1, 5, 5, 7, 3, 1])))),
  ]);
  const parsed = new X509Certificate(serverCert);
  if (!parsed.verify(authority.publicKey) || parsed.ca || !parsed.checkIP('127.0.0.1') || !Number.isFinite(Date.parse(parsed.validTo))) throw new Error('Could not create private planner TLS');
  return { cert: serverCert + authorityCert, ca: authorityCert, key: server.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
