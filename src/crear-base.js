// Crea o repara el usuario y la base de datos de DATABASE_URL (.env).
//   npm run crear-base                   crea o repara usuario y base
//   npm run crear-base -- --vaciar-datos además vacía firmas y rechazos (solo para pruebas)
//   npm run crear-base -- --visible      muestra lo que se escribe
// Contraseña de postgres sin que la pida (PowerShell):  $env:POSTGRES_CLAVE='la_clave'; npm run crear-base
require('dotenv').config();
const readline = require('readline');
const { Client } = require('pg');

const falla = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };

function leerOculto(pregunta) {
  if (process.env.POSTGRES_CLAVE !== undefined) return Promise.resolve(process.env.POSTGRES_CLAVE);

  // Modo visible, para terminales que no permiten pegar en modo oculto.
  if (process.argv.includes('--visible')) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(pregunta, (v) => { rl.close(); resolve(v); });
    });
  }

  return new Promise((resolve) => {
    process.stdout.write(pregunta);
    if (!process.stdin.isTTY) {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { buf += d; });
      process.stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
      return;
    }
    let clave = '';
    const alRecibir = (texto) => {
      // Descarta códigos especiales de flechas o pegado.
      for (const ch of texto.replace(/\u001b\[[0-9;]*[A-Za-z~]/g, '')) {
        if (ch === '\r' || ch === '\n') { fin(); return resolve(clave); }
        if (ch === '\u0003') { fin(); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') {
          if (clave.length) { clave = clave.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue;
        clave += ch; process.stdout.write('*');
      }
    };
    const fin = () => {
      process.stdin.setRawMode(false); process.stdin.pause();
      process.stdin.removeListener('data', alRecibir); process.stdout.write('\n');
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    process.stdin.on('data', alRecibir);
  });
}

(async () => {
  if (!process.env.DATABASE_URL) {
    falla('Falta DATABASE_URL. Verifique que exista el archivo .env en esta carpeta (es un archivo oculto).');
  }
  let url;
  try { url = new URL(process.env.DATABASE_URL); } catch { falla('DATABASE_URL en el archivo .env no tiene un formato válido.'); }
  const rol = decodeURIComponent(url.username);
  const claveRol = decodeURIComponent(url.password);
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!rol || !claveRol || !base) falla('DATABASE_URL debe tener la forma postgres://usuario:contraseña@localhost:5432/nombre_base');

  const superusuario = process.env.POSTGRES_USUARIO || 'postgres';
  const claveSuper = await leerOculto(`Contraseña del usuario "${superusuario}" de PostgreSQL: `);
  const ssl = String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: true } : undefined;
  const conectar = async (database) => {
    const c = new Client({ host: url.hostname, port: Number(url.port || 5432), user: superusuario, password: claveSuper, database, ssl });
    await c.connect();
    return c;
  };

  let c;
  try {
    try { c = await conectar('postgres'); }
    catch (e) { if (e.code === '3D000') c = await conectar('template1'); else throw e; }
  } catch (e) {
    if (e.code === '28P01') falla(`La contraseña del usuario "${superusuario}" no es correcta.`);
    if (e.code === 'ECONNREFUSED') falla('PostgreSQL no está encendido. Inícielo desde "Servicios" de Windows (services.msc) y vuelva a intentar.');
    falla(`No se pudo conectar a PostgreSQL: ${e.code || ''} ${e.message}`);
  }

  try {
    const q = (s) => c.escapeIdentifier(s);
    const l = (s) => c.escapeLiteral(s);

    const rolExiste = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [rol])).rowCount > 0;
    await c.query(`${rolExiste ? 'ALTER' : 'CREATE'} ROLE ${q(rol)} WITH LOGIN PASSWORD ${l(claveRol)}`);
    console.log(`Usuario "${rol}": ${rolExiste ? 'contraseña actualizada' : 'creado'}.`);

    const actual = (await c.query('SELECT pg_get_userbyid(datdba) AS dueno FROM pg_database WHERE datname = $1', [base])).rows[0];
    let creada = false;
    if (!actual) {
      await c.query(`CREATE DATABASE ${q(base)} OWNER ${q(rol)}`);
      creada = true;
      console.log(`Base "${base}": creada.`);
    } else {
      if (actual.dueno !== rol) await c.query(`ALTER DATABASE ${q(base)} OWNER TO ${q(rol)}`);
      console.log(`Base "${base}": ya existía.`);
    }

    if (process.argv.includes('--vaciar-datos')) {
      if (creada) console.log('Datos: la base es nueva, no hay nada que vaciar.');
      else {
        const d = await conectar(base);
        const existentes = [];
        for (const t of ['asistencias', 'intentos_rechazados']) {
          if ((await d.query('SELECT to_regclass($1) AS r', [`public.${t}`])).rows[0].r) existentes.push(t);
        }
        if (existentes.length) await d.query(`TRUNCATE ${existentes.join(', ')} RESTART IDENTITY`);
        await d.end();
        console.log(`Datos: se vaciaron ${existentes.length ? existentes.join(', ') : 'ninguna tabla (aún no existen)'}.`);
      }
    }

    console.log('\nListo. Siguiente paso:  npm run db:init');
  } catch (e) {
    falla(`No se pudo completar: ${e.code || ''} ${e.message}`);
  } finally {
    await c.end().catch(() => {});
  }
})();
