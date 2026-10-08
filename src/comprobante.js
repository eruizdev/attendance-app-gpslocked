// Comprobantes secuenciales: AA00, AA01 ... ZZ99 (67.600 en total).
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAXIMO = 26 * 26 * 100;

function formatear(n) {
  if (!Number.isInteger(n) || n < 0 || n >= MAXIMO) throw new Error('Se agotaron los comprobantes (máximo ZZ99).');
  const bloque = Math.floor(n / 100);
  return LETRAS[Math.floor(bloque / 26)] + LETRAS[bloque % 26] + String(n % 100).padStart(2, '0');
}

module.exports = { formatear, MAXIMO };
