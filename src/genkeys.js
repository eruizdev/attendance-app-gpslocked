// Genera claves aleatorias que empiezan con "Secretaria". Uso: npm run genkeys
const { randomBytes, randomInt } = require('crypto');

// Alfabeto sin caracteres confusos ni símbolos que rompan .env o la dirección de Postgres.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const azar = (n) => Array.from({ length: n }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
const grupos = (n, k) => Array.from({ length: n }, () => azar(k)).join('-');

console.log('CLAVE_CIFRADO=Secretaria-' + randomBytes(48).toString('base64url'));
console.log('ADMIN_CLAVE=Secretaria-' + grupos(4, 4));
console.log('POSTGRES_PASSWORD=Secretaria' + azar(24));
