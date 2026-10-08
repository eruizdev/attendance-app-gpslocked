// Cifrado AES-256-GCM, huellas HMAC-SHA256 y hash de contraseñas (scrypt).
const crypto = require('crypto');

// Las claves se derivan de CLAVE_CIFRADO (scrypt) o se leen de ENC_KEY y HASH_PEPPER (64 caracteres hex).
let KEY, PEPPER;
if (process.env.CLAVE_CIFRADO) {
  if (process.env.CLAVE_CIFRADO.length < 32) {
    const aviso = 'CLAVE_CIFRADO es demasiado corta (mínimo 32 caracteres aleatorios). Genere una con: npm run genkeys';
    if (process.env.NODE_ENV === 'production') { console.error(`No se puede iniciar: ${aviso}`); process.exit(1); }
    console.warn(`ADVERTENCIA: ${aviso}`);
  }
  // Sal fija: la misma clave siempre produce las mismas claves derivadas.
  const derivada = crypto.scryptSync(process.env.CLAVE_CIFRADO, 'asistencia-secretaria-educacion/v1', 64,
    { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  KEY = derivada.subarray(0, 32);
  PEPPER = derivada.subarray(32, 64);
} else {
  KEY = Buffer.from(process.env.ENC_KEY || '', 'hex');
  PEPPER = Buffer.from(process.env.HASH_PEPPER || '', 'hex');
}
if (KEY.length !== 32 || PEPPER.length < 32) {
  throw new Error('Falta la clave de cifrado. Defina CLAVE_CIFRADO en .env (o ENC_KEY y HASH_PEPPER).');
}

// Huella de un solo sentido con clave secreta.
const hmac = (valor) => crypto.createHmac('sha256', PEPPER).update(String(valor)).digest('hex');

// Devuelve "iv.etiqueta.cifrado" en base64.
function cifrar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function descifrar(texto) {
  const [iv, tag, enc] = texto.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

// Clave derivada de la clave maestra, según la etiqueta.
const derivar = (etiqueta, bytes = 32) =>
  Buffer.from(crypto.hkdfSync('sha256', KEY, 'asistencia/derivada', etiqueta, bytes));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Contraseña de administrador: scrypt con sal aleatoria.
function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(clave, sal, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}
function verificarClave(clave, guardado) {
  const [tipo, sal, h] = String(guardado).split('$');
  if (tipo !== 'scrypt') return false;
  const esperado = Buffer.from(h, 'base64');
  const calc = crypto.scryptSync(clave, Buffer.from(sal, 'base64'), esperado.length, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(esperado, calc);
}

module.exports = { hmac, cifrar, descifrar, derivar, sha256, hashClave, verificarClave };
