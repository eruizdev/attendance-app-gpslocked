// Panel de administración: sesión, estadísticas, eventos, instituciones, registro manual y exportación.
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const { hmac, descifrar, sha256, hashClave, verificarClave } = require('./crypto');
const { guardarFirma } = require('./registro');
const { RE_CEDULA, validar } = require('./formulario');

const router = express.Router();
const seguro = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ZONA = process.env.ZONA_HORARIA || 'America/Bogota';
const DURACION_SESION_H = 8;
const COOKIE = 'sesion_admin';
const mapa = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

const MOTIVOS = {
  gps_antiguo: 'Ubicación no reciente',
  gps_impreciso: 'GPS impreciso',
  dispositivo_repetido: 'Teléfono ya usado por otra cédula',
  cedula_repetida: 'Documento que ya había firmado en el evento',
  vpn_proxy: 'Conexión por VPN o proxy',
  vpn_no_verificable: 'Conexión no verificable (VPN)',
};

// Usuario y contraseña salen de .env y se sincronizan en cada arranque. Solo se guarda el hash.
async function crearAdminInicial() {
  const usuario = process.env.ADMIN_USUARIO;
  const clave = process.env.ADMIN_CLAVE || process.env.ADMIN_CLAVE_INICIAL;
  if (!usuario || !clave) {
    console.warn('Falta el administrador. Defina ADMIN_USUARIO y ADMIN_CLAVE en .env y reinicie.');
    return;
  }
  const { rows } = await pool.query('SELECT id, clave_hash FROM administradores WHERE usuario = $1', [usuario]);
  if (!rows[0]) {
    await pool.query('INSERT INTO administradores (usuario, clave_hash) VALUES ($1, $2)', [usuario, hashClave(clave)]);
  } else if (!verificarClave(clave, rows[0].clave_hash)) {
    await pool.query('UPDATE administradores SET clave_hash = $1 WHERE id = $2', [hashClave(clave), rows[0].id]);
    await pool.query('DELETE FROM sesiones WHERE admin_id = $1', [rows[0].id]);
  }
  await pool.query('DELETE FROM administradores WHERE usuario <> $1', [usuario]);
  console.log(`Administrador: ${usuario}`);
}

function leerCookie(req, nombre) {
  const c = (req.get('cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nombre + '='));
  return c ? decodeURIComponent(c.slice(nombre.length + 1)) : null;
}

const requiereSesion = seguro(async (req, res, next) => {
  const token = leerCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'Inicie sesión.' });
  const { rows } = await pool.query(
    `SELECT a.id, a.usuario FROM sesiones s JOIN administradores a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expira > now()`, [sha256(token)]);
  if (!rows[0]) return res.status(401).json({ error: 'La sesión expiró. Inicie sesión de nuevo.' });
  req.admin = rows[0];
  next();
});

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espere 15 minutos.' } });

router.post('/login', limiteLogin, seguro(async (req, res) => {
  const { usuario, clave } = req.body || {};
  const { rows } = await pool.query('SELECT id, clave_hash FROM administradores WHERE usuario = $1', [String(usuario || '')]);
  if (!rows[0] || !verificarClave(String(clave || ''), rows[0].clave_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`DELETE FROM sesiones WHERE expira < now()`);
  await pool.query(`INSERT INTO sesiones (token_hash, admin_id, expira) VALUES ($1, $2, now() + interval '${DURACION_SESION_H} hours')`,
    [sha256(token), rows[0].id]);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_SESION_H * 3600}${req.secure || process.env.SOLO_HTTPS === 'true' || process.env.SSL_CERT ? '; Secure' : ''}`);
  res.json({ ok: true });
}));

router.post('/logout', seguro(async (req, res) => {
  const token = leerCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM sesiones WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));

router.use(requiereSesion);

router.get('/yo', (req, res) => res.json({ usuario: req.admin.usuario }));

router.get('/resumen', seguro(async (req, res) => {
  const [tot, eventos, motivos] = await Promise.all([
    pool.query(`
      SELECT (SELECT count(*) FROM asistencias)::int AS firmas,
             (SELECT count(*) FROM asistencias WHERE (firmado_en AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date)::int AS firmas_hoy,
             (SELECT count(DISTINCT cedula_hmac) FROM asistencias)::int AS personas_distintas,
             (SELECT count(*) FROM intentos_rechazados)::int AS rechazos,
             (SELECT count(*) FROM eventos WHERE activo)::int AS eventos_activos`, [ZONA]),
    pool.query(`
      SELECT e.codigo, e.nombre, e.activo, e.creado_en,
             (SELECT count(*) FROM asistencias a WHERE a.evento_id = e.id)::int AS firmas,
             (SELECT count(*) FROM intentos_rechazados r WHERE r.evento_id = e.id)::int AS rechazos,
             (SELECT max(firmado_en) FROM asistencias a WHERE a.evento_id = e.id) AS ultima_firma
        FROM eventos e ORDER BY e.activo DESC, e.creado_en DESC`),
    pool.query(`SELECT motivo, count(*)::int AS n FROM intentos_rechazados GROUP BY motivo ORDER BY n DESC`),
  ]);
  res.json({
    ...tot.rows[0],
    eventos: eventos.rows,
    rechazos_por_motivo: motivos.rows.map((m) => ({ ...m, motivo: MOTIVOS[m.motivo] || m.motivo })),
  });
}));

const MAX_INSTITUCIONES = 3000;

router.get('/instituciones', seguro(async (req, res) => {
  const { rows } = await pool.query('SELECT nombre FROM instituciones ORDER BY orden, nombre');
  res.json({ lista: rows.map((r) => r.nombre) });
}));

router.put('/instituciones', seguro(async (req, res) => {
  const crudo = typeof req.body?.lista === 'string' ? req.body.lista : '';
  const vistos = new Set();
  const lista = [];
  for (const linea of crudo.split(/\r?\n/)) {
    const nombre = linea.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!nombre) continue;
    if (nombre.length < 3 || nombre.length > 150)
      return res.status(400).json({ error: `Cada institución debe tener entre 3 y 150 caracteres: "${nombre.slice(0, 40)}"` });
    const clave = nombre.toLowerCase();
    if (!vistos.has(clave)) { vistos.add(clave); lista.push(nombre); }
  }
  if (lista.length > MAX_INSTITUCIONES) return res.status(400).json({ error: `Máximo ${MAX_INSTITUCIONES} instituciones.` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM instituciones');
    for (let i = 0; i < lista.length; i++)
      await client.query('INSERT INTO instituciones (nombre, orden) VALUES ($1, $2)', [lista[i], i]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  res.json({ ok: true, total: lista.length });
}));

router.post('/eventos', seguro(async (req, res) => {
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  const nombre = String(req.body?.nombre || '').trim();
  if (!/^[A-Z0-9-]{3,40}$/.test(codigo))
    return res.status(400).json({ error: 'El código debe tener de 3 a 40 caracteres: letras, números o guiones, sin espacios.' });
  if (nombre.length < 3 || nombre.length > 150) return res.status(400).json({ error: 'Escriba el nombre del evento.' });
  try {
    await pool.query('INSERT INTO eventos (codigo, nombre) VALUES ($1, $2)', [codigo, nombre]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un evento con ese código.' });
    throw e;
  }
  res.json({ ok: true, codigo });
}));

router.patch('/eventos/:codigo', seguro(async (req, res) => {
  const { rowCount } = await pool.query('UPDATE eventos SET activo = $1 WHERE codigo = $2', [!!req.body?.activo, req.params.codigo]);
  if (!rowCount) return res.status(404).json({ error: 'Evento no encontrado.' });
  res.json({ ok: true });
}));

function leer(texto) {
  try { return descifrar(texto); } catch { return null; }
}

async function asistenciasDe(codigo) {
  const { rows } = await pool.query(
    `SELECT a.*, count(*) OVER (PARTITION BY a.ip_hmac) AS cedulas_misma_ip
       FROM asistencias a JOIN eventos e ON e.id = a.evento_id
      WHERE e.codigo = $1 ORDER BY a.comprobante_num`, [codigo]);
  return rows.map((r) => {
    const d = leer(r.datos_cifrados);
    if (!d) {
      return { origen: 'ilegible', firmado_en: r.firmado_en, comprobante: r.comprobante, cedula: null, latitud: null, longitud: null,
               precision_metros: null, mapa: null, ip: null, cedulas_misma_ip: 1, vpn: '',
               motivo: 'No se pudo leer: se guardó con otra clave de cifrado' };
    }
    const manual = d.origen === 'manual';
    const f = d.formulario || {};
    return {
      origen: manual ? 'manual' : 'web', registrado_por: d.registradoPor ?? null, motivo: d.motivo ?? null,
      firmado_en: r.firmado_en, cedula: d.cedula,
      nombres: f.nombres ?? null, institucion: f.institucion ?? null, poblacion: f.poblacion ?? null,
      rango_edad: f.rangoEdad ?? null, vinculacion: f.vinculacion ?? null, celular: f.celular ?? null,
      correo: f.correo ?? null, escolaridad: f.escolaridad ?? null, autorizacion: d.autorizacion?.version ?? null,
      latitud: manual ? 'ADMIN' : d.lat ?? null, longitud: manual ? 'ADMIN' : d.lng ?? null,
      precision_metros: d.precision != null ? Math.round(d.precision) : null,
      mapa: manual ? 'ADMIN' : d.lat != null ? mapa(d.lat, d.lng) : null, ip: d.ip ?? null,
      cedulas_misma_ip: Number(r.cedulas_misma_ip),
      modelo: d.dispositivo?.modelo, marca: d.dispositivo?.marca, sistema: d.dispositivo?.sistema,
      navegador: d.dispositivo?.navegador, comprobante: r.comprobante,
      vpn: manual ? 'ADMIN'
        : { limpia: 'Sin VPN ni proxy', no_disponible: 'No verificada', ip_local: 'Red local', desactivada: 'Desactivada' }[d.vpn?.verificacion] || '',
    };
  });
}

async function rechazosDe(codigo) {
  const { rows } = await pool.query(
    `SELECT r.* FROM intentos_rechazados r JOIN eventos e ON e.id = r.evento_id
      WHERE e.codigo = $1 ORDER BY r.creado_en`, [codigo]);
  return rows.map((r) => {
    const d = (r.datos_cifrados ? leer(r.datos_cifrados) : {}) || {};
    return {
      ilegible: r.datos_cifrados && !Object.keys(d).length,
      fecha: r.creado_en, motivo: MOTIVOS[r.motivo] || r.motivo, cedula: d.cedula, nombres: d.formulario?.nombres,
      latitud: d.lat, longitud: d.lng,
      precision_metros: d.precision != null ? Math.round(d.precision) : null,
      mapa: d.lat != null ? mapa(d.lat, d.lng) : null, ip: d.ip, modelo: d.dispositivo?.modelo,
    };
  });
}

// Recorre la cadena de hashes del evento y detecta registros alterados.
async function verificarCadena(codigo) {
  const { rows } = await pool.query(
    `SELECT a.* FROM asistencias a JOIN eventos e ON e.id = a.evento_id WHERE e.codigo = $1 ORDER BY a.id`, [codigo]);
  if (!rows.length) return { integro: true, registros: 0 };
  let previo = sha256(`genesis:${rows[0].evento_id}`);
  for (const r of rows) {
    const esperado = sha256([previo, r.evento_id, r.cedula_hmac, r.ip_hmac, r.dispositivo_hmac, r.datos_cifrados].join('|'));
    if (r.hash_anterior !== previo || r.hash_registro !== esperado)
      return { integro: false, registros: rows.length, primer_registro_alterado: r.id };
    previo = r.hash_registro;
  }
  return { integro: true, registros: rows.length };
}

function contar(asistencias, campo, max = 12) {
  const c = {};
  asistencias.filter((a) => a.origen !== 'ilegible' && a[campo]).forEach((a) => { c[a[campo]] = (c[a[campo]] || 0) + 1; });
  return Object.entries(c).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n).slice(0, max);
}

router.get('/eventos/:codigo', seguro(async (req, res) => {
  const { rows } = await pool.query('SELECT codigo, nombre, activo, creado_en FROM eventos WHERE codigo = $1', [req.params.codigo]);
  if (!rows[0]) return res.status(404).json({ error: 'Evento no encontrado.' });
  const [asistencias, rechazos, integridad, porHora] = await Promise.all([
    asistenciasDe(req.params.codigo), rechazosDe(req.params.codigo), verificarCadena(req.params.codigo),
    pool.query(`SELECT to_char(date_trunc('hour', a.firmado_en AT TIME ZONE $2), 'YYYY-MM-DD HH24:00') AS hora, count(*)::int AS n
                  FROM asistencias a JOIN eventos e ON e.id = a.evento_id
                 WHERE e.codigo = $1 GROUP BY 1 ORDER BY 1`, [req.params.codigo, ZONA]),
  ]);
  const modelos = {};
  asistencias.filter((a) => a.origen === 'web').forEach((a) => {
    const m = a.modelo && a.modelo !== 'desconocido' ? a.modelo : (a.sistema?.split(' ')[0] || 'Desconocido');
    modelos[m] = (modelos[m] || 0) + 1;
  });
  res.json({
    evento: rows[0], asistencias, rechazos, integridad, firmas_por_hora: porHora.rows,
    dispositivos: Object.entries(modelos).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
    perfil: {
      poblacion: contar(asistencias, 'poblacion'), rango_edad: contar(asistencias, 'rango_edad'),
      vinculacion: contar(asistencias, 'vinculacion'), escolaridad: contar(asistencias, 'escolaridad'),
      instituciones: contar(asistencias, 'institucion', 10),
    },
    ips_compartidas: asistencias.filter((a) => a.cedulas_misma_ip > 1).length,
    ilegibles: asistencias.filter((a) => a.origen === 'ilegible').length + rechazos.filter((r) => r.ilegible).length,
  });
}));

const limpio = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// Registra a una persona con el formulario completo diligenciado por el administrador.
// Ubicación, IP y dispositivo quedan como ADMIN. Mismo hash encadenado y comprobante que la firma web.
router.post('/eventos/:codigo/manual', seguro(async (req, res) => {
  const { rows: evs } = await pool.query('SELECT id, codigo, nombre FROM eventos WHERE codigo = $1', [req.params.codigo]);
  const ev = evs[0];
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  const motivo = limpio(req.body?.motivo, 200);
  if (motivo.length < 3) return res.status(400).json({ error: 'Escriba el motivo del registro manual.' });
  const ced = String(req.body?.cedula ?? '').trim();
  if (!RE_CEDULA.test(ced)) return res.status(400).json({ error: 'Escriba un documento válido (solo números, de 6 a 13 dígitos).' });
  const instituciones = (await pool.query('SELECT nombre FROM instituciones')).rows.map((r) => r.nombre);
  const val = validar(req.body?.formulario, instituciones);
  if (val.error) return res.status(400).json({ error: val.error });

  const cedulaH = hmac(ced);
  const datos = {
    cedula: ced, origen: 'manual', registradoPor: req.admin.usuario, motivo, formulario: val.datos,
    ip: 'ADMIN', precision: 0, ubicacion: 'ADMIN',
    dispositivo: { modelo: 'ADMIN', marca: 'ADMIN', sistema: 'ADMIN', navegador: 'ADMIN' },
    servidorTimestamp: new Date().toISOString(),
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1)');
    const dup = await client.query('SELECT comprobante FROM asistencias WHERE evento_id = $1 AND cedula_hmac = $2', [ev.id, cedulaH]);
    if (dup.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Este documento ya está registrado en el evento (comprobante ${dup.rows[0].comprobante}).` });
    }
    // Valores únicos para no chocar con la regla de un teléfono por cédula.
    const r = await guardarFirma(client, ev, { cedulaH, ipH: hmac('manual:' + crypto.randomUUID()),
                                               dispH: hmac('manual:' + crypto.randomUUID()), datos });
    await client.query('COMMIT');
    res.json({ ok: true, comprobante: r.comprobante, evento: ev.nombre });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}));

const fechaLocal = (f) => new Date(f).toLocaleString('es-CO', { timeZone: ZONA, hour12: false });
function csv(filas, columnas) {
  const celda = (v) => {
    let s = v == null ? '' : String(v);
    // Evita que Excel interprete el texto como fórmula.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columnas.map((c) => c[0]).join(';'), ...filas.map((f) => columnas.map((c) => celda(c[1](f))).join(';'))].join('\r\n');
}
function enviarCsv(res, nombre, contenido) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(contenido);
}

router.get('/eventos/:codigo/asistencias.csv', seguro(async (req, res) => {
  const filas = await asistenciasDe(req.params.codigo);
  enviarCsv(res, `asistencias-${req.params.codigo}.csv`, csv(filas, [
    ['Comprobante', (f) => f.comprobante], ['Fecha y hora', (f) => fechaLocal(f.firmado_en)], ['Documento', (f) => f.cedula],
    ['Nombres y apellidos', (f) => f.nombres], ['Institución educativa', (f) => f.institucion], ['Población', (f) => f.poblacion],
    ['Rango de edad', (f) => f.rango_edad], ['Tipo de vinculación', (f) => f.vinculacion], ['Celular', (f) => f.celular],
    ['Correo electrónico', (f) => f.correo], ['Nivel de escolaridad', (f) => f.escolaridad],
    ['Latitud', (f) => f.latitud], ['Longitud', (f) => f.longitud], ['Precisión (m)', (f) => f.precision_metros],
    ['Mapa', (f) => f.mapa], ['IP', (f) => f.ip], ['Cédulas con la misma IP', (f) => f.cedulas_misma_ip],
    ['Modelo', (f) => f.modelo], ['Sistema', (f) => f.sistema], ['Navegador', (f) => f.navegador], ['Verificación VPN', (f) => f.vpn],
    ['Origen', (f) => (f.origen === 'ilegible' ? 'No legible' : f.origen === 'manual' ? 'Manual' : 'Teléfono')],
    ['Registrado por', (f) => f.registrado_por], ['Motivo (manual)', (f) => f.motivo], ['Versión de autorización', (f) => f.autorizacion],
  ]));
}));

router.get('/eventos/:codigo/rechazos.csv', seguro(async (req, res) => {
  const filas = await rechazosDe(req.params.codigo);
  enviarCsv(res, `rechazos-${req.params.codigo}.csv`, csv(filas, [
    ['Fecha y hora', (f) => fechaLocal(f.fecha)], ['Motivo', (f) => f.motivo], ['Documento', (f) => f.cedula],
    ['Nombres y apellidos', (f) => f.nombres],
    ['Latitud', (f) => f.latitud], ['Longitud', (f) => f.longitud], ['Precisión (m)', (f) => f.precision_metros],
    ['Mapa', (f) => f.mapa], ['IP', (f) => f.ip], ['Modelo', (f) => f.modelo],
  ]));
}));

module.exports = { router, crearAdminInicial };
