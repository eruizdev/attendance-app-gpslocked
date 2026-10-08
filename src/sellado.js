// El navegador cifra el cuerpo antes de enviar, además de HTTPS: ECDH P-256 + HKDF + AES-256-GCM.
const crypto = require('crypto');
const { derivar } = require('./crypto');

const INFO = Buffer.from('asistencia-sobre-v1');
const VIGENCIA_MS = 2 * 60 * 1000;

const ecdh = crypto.createECDH('prime256v1');
ecdh.setPrivateKey(derivar('sellado-ecdh-p256-v1', 32));
const PUBLICA = ecdh.getPublicKey();

// Números únicos ya usados, para impedir repetir un envío.
const usados = new Map();
function noRepetido(n) {
  const ahora = Date.now();
  if (usados.size > 20000) for (const [k, v] of usados) if (v < ahora) usados.delete(k);
  if (usados.has(n)) return false;
  usados.set(n, ahora + 2 * VIGENCIA_MS);
  return true;
}

const clavePublica = () => PUBLICA.toString('base64');

// Descifra y valida el sobre; lanza error si está alterado, vencido o repetido.
function abrirSobre(sobre) {
  if (!sobre || typeof sobre.epk !== 'string' || typeof sobre.iv !== 'string' || typeof sobre.ct !== 'string')
    throw new Error('sobre inválido');
  const epk = Buffer.from(sobre.epk, 'base64');
  const iv = Buffer.from(sobre.iv, 'base64');
  const ct = Buffer.from(sobre.ct, 'base64');
  if (epk.length !== 65 || iv.length !== 12 || ct.length < 17 || ct.length > 8192) throw new Error('sobre inválido');

  const secreto = ecdh.computeSecret(epk);
  const clave = Buffer.from(crypto.hkdfSync('sha256', secreto, PUBLICA, INFO, 32));
  const d = crypto.createDecipheriv('aes-256-gcm', clave, iv);
  d.setAAD(epk);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plano = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8');

  const cuerpo = JSON.parse(plano);
  if (typeof cuerpo.n !== 'string' || cuerpo.n.length < 16 || cuerpo.n.length > 64) throw new Error('sin número único');
  if (typeof cuerpo.t !== 'number' || Math.abs(Date.now() - cuerpo.t) > VIGENCIA_MS) throw new Error('vencido');
  if (!noRepetido(cuerpo.n)) throw new Error('repetido');
  return cuerpo;
}

module.exports = { abrirSobre, clavePublica };
