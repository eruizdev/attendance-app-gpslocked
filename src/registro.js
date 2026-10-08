// Guarda una asistencia con su hash encadenado y su comprobante. Lo usan la firma web y el registro manual.
const { cifrar, sha256 } = require('./crypto');
const { formatear } = require('./comprobante');

// Debe llamarse dentro de una transacción con el bloqueo pg_advisory_xact_lock(1).
async function guardarFirma(client, ev, { cedulaH, ipH, dispH, equipoH = null, datos }) {
  const ult = await client.query(
    `SELECT hash_registro FROM asistencias WHERE evento_id=$1 ORDER BY id DESC LIMIT 1`, [ev.id]);
  const hashAnterior = ult.rows[0]?.hash_registro || sha256(`genesis:${ev.id}`);
  const datosCifrados = cifrar(datos);
  const hashRegistro = sha256([hashAnterior, ev.id, cedulaH, ipH, dispH, datosCifrados].join('|'));

  const sig = await client.query('SELECT coalesce(max(comprobante_num), -1) + 1 AS n FROM asistencias');
  const comprobanteNum = Number(sig.rows[0].n);
  const comprobante = formatear(comprobanteNum);

  const ins = await client.query(
    `INSERT INTO asistencias (evento_id, cedula_hmac, ip_hmac, dispositivo_hmac, datos_cifrados,
                              hash_anterior, hash_registro, comprobante_num, comprobante, equipo_hmac)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING firmado_en`,
    [ev.id, cedulaH, ipH, dispH, datosCifrados, hashAnterior, hashRegistro, comprobanteNum, comprobante, equipoH]);
  return { firmado_en: ins.rows[0].firmado_en, comprobante };
}

module.exports = { guardarFirma };
