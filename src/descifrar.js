// Descifra datos_cifrados con la CLAVE_CIFRADO del .env, o calcula la huella de una cédula o IP.
//   npm run descifrar                       pide el valor
//   npm run descifrar -- "VALOR"            descifra ese valor
//   npm run descifrar -- --hash 1012345678  huella para buscar en las columnas *_hmac
require('dotenv').config();
const readline = require('readline');
const { descifrar, hmac } = require('./crypto');

const falla = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };
const preguntar = (texto) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(texto, (v) => { rl.close(); resolve(v); });
});

(async () => {
  const [a, b] = process.argv.slice(2);

  if (a === '--hash') {
    if (!b) falla('Escriba el dato. Ejemplo:  npm run descifrar -- --hash 1012345678');
    console.log(hmac(b.trim()));
    return;
  }

  const valor = (a || await preguntar('Pegue el valor de datos_cifrados y pulse Enter: ')).trim().replace(/^["']|["']$/g, '');
  if (!valor) falla('No escribió ningún valor.');
  try {
    console.log(JSON.stringify(descifrar(valor), null, 2));
  } catch {
    falla('No se pudo descifrar. El valor está incompleto, no es de datos_cifrados, o se guardó con otra CLAVE_CIFRADO.');
  }
})();
