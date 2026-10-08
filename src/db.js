const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Verifique que exista el archivo .env (es un archivo oculto) con la línea ' +
    'DATABASE_URL=postgres://usuario:contraseña@localhost:5432/asistencia');
  process.exit(1);
}

// DB_SSL=true cifra la conexión cuando Postgres está en otro servidor.
const ssl = String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: true } : undefined;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });

// Una conexión inactiva que la base cierra (por ejemplo Neon al suspenderse) no debe tumbar el servidor.
pool.on('error', (e) => console.warn('Conexión inactiva cerrada por la base de datos:', e.code || e.message));

module.exports = pool;
