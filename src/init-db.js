// Crea las tablas, carga la lista inicial de instituciones y asigna comprobante a firmas antiguas sin él.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { formatear } = require('./comprobante');

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

  // Carga la lista inicial de instituciones solo si la tabla está vacía.
  if (!(await pool.query('SELECT 1 FROM instituciones LIMIT 1')).rowCount) {
    const lista = fs.readFileSync(path.join(__dirname, '..', 'db', 'instituciones.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lista.length; i++)
      await pool.query('INSERT INTO instituciones (nombre, orden) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lista[i], i]);
    console.log(`Instituciones cargadas: ${lista.length}.`);
  }

  const { rows: maxRow } = await pool.query('SELECT coalesce(max(comprobante_num), -1) AS m FROM asistencias');
  let siguiente = Number(maxRow[0].m) + 1;
  const { rows } = await pool.query('SELECT id FROM asistencias WHERE comprobante_num IS NULL ORDER BY firmado_en, id');
  for (const r of rows) {
    await pool.query('UPDATE asistencias SET comprobante_num = $1, comprobante = $2 WHERE id = $3', [siguiente, formatear(siguiente), r.id]);
    siguiente++;
  }
  if (rows.length) console.log(`Comprobantes asignados a ${rows.length} firma(s) anteriores.`);

  console.log('Base de datos lista.');
  await pool.end();
})().catch((e) => { console.error('Error al preparar la base de datos:', e.code || '', e.message); process.exit(1); });
