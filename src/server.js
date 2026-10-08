// Servidor: página de asistencia, API pública y panel de administración.
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const UAParser = require('ua-parser-js');
const pool = require('./db');
const { hmac, cifrar } = require('./crypto');
const { guardarFirma } = require('./registro');
const { revisarConexion } = require('./vpn');
const { abrirSobre, clavePublica } = require('./sellado');
const { VERSION_AUTORIZACION, CONTACTO, OPCIONES, RE_CEDULA, validar } = require('./formulario');

const app = express();
// Express 4 no captura errores async: este envoltorio los pasa al manejador de errores.
const seguro = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// TRUST_PROXY=0 sin proxy; 1 con Nginx, Caddy o Cloudflare delante.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
app.use(helmet({
  contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"] } },
  hsts: { maxAge: 63072000, includeSubDomains: true },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  next();
});

// Con SOLO_HTTPS=true se rechaza o redirige lo que llegue sin https (excepto localhost).
const SOLO_HTTPS = String(process.env.SOLO_HTTPS ||
  ((process.env.SSL_CERT || process.env.NODE_ENV === 'production') ? 'true' : 'false')).toLowerCase() === 'true';
app.use((req, res, next) => {
  if (!SOLO_HTTPS || req.secure || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(req.hostname)) return next();
  const host = req.headers.host || '';
  if ((req.method === 'GET' || req.method === 'HEAD') && /^[a-z0-9.-]+(:\d+)?$/i.test(host))
    return res.redirect(308, `https://${host}${req.originalUrl}`);
  return res.status(403).json({ error: 'Esta página solo funciona con conexión segura (https).' });
});

app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  res.setHeader('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const MAX_POR_DISPOSITIVO = Number(process.env.MAX_CEDULAS_POR_DISPOSITIVO || 1);
// Minutos que debe esperar un teléfono para registrar otra cédula.
const REINICIO_DISPOSITIVO_MIN = Number(process.env.DISPOSITIVO_REINICIO_MINUTOS || 60);
// Si es true, también se compara la huella del equipo (sin navegador) para detectar otro navegador en el mismo teléfono.
const HUELLA_CRUZADA = String(process.env.HUELLA_CRUZADA ?? 'true').toLowerCase() !== 'false';
const GPS_MAX_ANTIGUEDAD_MS = 2 * 60 * 1000;
const GPS_PRECISION_MAX = Number(process.env.GPS_PRECISION_MAX_METROS || 500);

const ipCliente = (req) => (req.ip || '').replace(/^::ffff:/, '');

const limpio = (v, max = 60) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

function datosDispositivo(req, cliente = {}) {
  const ua = limpio(req.get('user-agent') || '', 400);
  const p = new UAParser(ua).getResult();
  const modeloHint = limpio((req.get('sec-ch-ua-model') || '').replace(/"/g, ''), 60);
  const pantalla = limpio(cliente.pantalla, 20);
  return {
    modelo: limpio(cliente.modelo) || modeloHint || p.device.model || 'desconocido',
    marca: p.device.vendor || null,
    sistema: [p.os.name, limpio(cliente.versionSO, 20) || p.os.version].filter(Boolean).join(' '),
    navegador: [p.browser.name, p.browser.version].filter(Boolean).join(' '),
    pantalla: /^\d{2,5}x\d{2,5}@[\d.]{1,5}$/.test(pantalla) ? pantalla : null,
    zonaHoraria: limpio(cliente.zonaHoraria, 60) || null,
    userAgent: ua,
  };
}

// Huella del equipo que no cambia con el navegador: IP, sistema operativo, tamaño de pantalla y zona horaria.
function huellaEquipo(disp, ip) {
  const m = /^(\d+)x(\d+)@/.exec(disp.pantalla || '');
  const pantalla = m ? [Number(m[1]), Number(m[2])].sort((a, b) => a - b).join('x') : '';
  const so = (disp.sistema || '').split(' ')[0];
  return hmac(['equipo', ip, so, pantalla, disp.zonaHoraria || ''].join('|'));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const listaInstituciones = async (db = pool) =>
  (await db.query('SELECT nombre FROM instituciones ORDER BY orden, nombre')).rows.map((r) => r.nombre);

app.get('/api/evento/:codigo', seguro(async (req, res) => {
  const { rows } = await pool.query(`SELECT nombre, activo FROM eventos WHERE codigo = $1`, [req.params.codigo]);
  if (!rows[0]) return res.status(404).json({ error: 'Este evento no existe. Verifique el enlace.' });
  if (!rows[0].activo) return res.status(403).json({ error: 'El registro de asistencia de este evento está cerrado.' });
  res.json({ nombre: rows[0].nombre });
}));

app.get('/api/eventos', seguro(async (req, res) => {
  const { rows } = await pool.query(`SELECT codigo, nombre FROM eventos WHERE activo ORDER BY creado_en DESC`);
  res.json(rows);
}));

app.get('/api/formulario', seguro(async (req, res) => {
  res.json({ opciones: OPCIONES, instituciones: await listaInstituciones(),
             autorizacion: VERSION_AUTORIZACION, contacto: CONTACTO });
}));

app.get('/api/sello', (req, res) => res.json({ clave: clavePublica() }));

const limitador = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.LIMITE_POR_MINUTO || 60),
  standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Espere un minuto.' } });
const limiteFallos = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.LIMITE_FALLOS || 40),
  skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espere unos minutos e intente de nuevo.' } });

app.post('/api/asistencia', limitador, limiteFallos, seguro(async (req, res) => {
  let cuerpo;
  try { cuerpo = abrirSobre(req.body); }
  catch { return res.status(400).json({ error: 'Solicitud no válida. Recargue la página e intente de nuevo.' }); }
  const { evento, cedula, formulario, autorizacion, ubicacion, dispositivoId, cliente } = cuerpo;
  const ip = ipCliente(req);

  const ced = String(cedula ?? '').trim();
  if (!RE_CEDULA.test(ced)) return res.status(400).json({ error: 'Escriba un documento de identidad válido (solo números).' });
  if (autorizacion !== VERSION_AUTORIZACION)
    return res.status(400).json({ error: 'El texto de autorización cambió. Recargue la página e intente de nuevo.' });
  const val = validar(formulario, await listaInstituciones());
  if (val.error) return res.status(400).json({ error: val.error });
  if (typeof dispositivoId !== 'string' || dispositivoId.length < 16 || dispositivoId.length > 64)
    return res.status(400).json({ error: 'No se pudo identificar el dispositivo. Recargue la página.' });
  const lat = num(ubicacion?.lat), lng = num(ubicacion?.lng), precision = num(ubicacion?.precision), ts = num(ubicacion?.timestamp);
  if (lat === null || lng === null || precision === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Falta la ubicación. Active el GPS y permita el acceso a la ubicación.' });

  const { rows: evs } = await pool.query(`SELECT * FROM eventos WHERE codigo = $1`, [String(evento || '')]);
  const ev = evs[0];
  if (!ev) return res.status(404).json({ error: 'Este evento no existe. Verifique el enlace.' });
  if (!ev.activo) return res.status(403).json({ error: 'El registro de asistencia de este evento está cerrado.' });

  const disp = datosDispositivo(req, cliente || {});
  const cedulaH = hmac(ced), ipH = hmac(ip), dispH = hmac(dispositivoId);
  const equipoH = HUELLA_CRUZADA ? huellaEquipo(disp, ip) : null;
  const ahora = new Date().toISOString();
  const datos = { cedula: ced, formulario: val.datos, autorizacion: { version: VERSION_AUTORIZACION, aceptadaEn: ahora },
                  ip, lat, lng, precision, gpsTimestamp: ts, dispositivo: disp, servidorTimestamp: ahora };

  const rechazar = async (motivo, mensaje, status = 403) => {
    await pool.query(
      `INSERT INTO intentos_rechazados (evento_id, cedula_hmac, ip_hmac, dispositivo_hmac, datos_cifrados, motivo)
       VALUES ($1,$2,$3,$4,$5,$6)`, [ev.id, cedulaH, ipH, dispH, cifrar(datos), motivo]);
    return res.status(status).json({ error: mensaje });
  };

  if (!ts || Math.abs(Date.now() - ts) > GPS_MAX_ANTIGUEDAD_MS)
    return rechazar('gps_antiguo', 'La ubicación no es reciente. Intente de nuevo con el GPS activo.', 400);
  if (precision > GPS_PRECISION_MAX)
    return rechazar('gps_impreciso', `Su GPS tiene una precisión de ${Math.round(precision)} m. Active la ubicación precisa e intente de nuevo.`, 400);

  const conexion = await revisarConexion(req, ip);
  datos.vpn = conexion.info;
  if (conexion.bloquear) return rechazar(conexion.motivo, conexion.mensaje);

  // Mensaje único para cédula repetida: no revela a quién ya asistió a un evento.
  const MENSAJE_CEDULA = 'No fue posible registrar la asistencia con este documento. Verifique el número. ' +
    'Si ya había firmado en este evento no necesita hacerlo otra vez. Si el problema continúa, comuníquese con la Secretaría de Educación.';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa la cadena de hashes y la numeración de comprobantes.
    await client.query('SELECT pg_advisory_xact_lock(1)');

    const dup = await client.query(`SELECT 1 FROM asistencias WHERE evento_id=$1 AND cedula_hmac=$2`, [ev.id, cedulaH]);
    if (dup.rowCount) {
      await client.query('ROLLBACK');
      return rechazar('cedula_repetida', MENSAJE_CEDULA, 403);
    }

    const porDisp = await client.query(
      `SELECT count(*)::int AS n FROM asistencias
        WHERE evento_id=$1 AND dispositivo_hmac=$2 AND firmado_en > now() - make_interval(mins => $3)`,
      [ev.id, dispH, REINICIO_DISPOSITIVO_MIN]);
    let repetido = porDisp.rows[0].n >= MAX_POR_DISPOSITIVO;
    if (!repetido && equipoH) {
      const porEquipo = await client.query(
        `SELECT count(*)::int AS n FROM asistencias
          WHERE evento_id=$1 AND equipo_hmac=$2 AND firmado_en > now() - make_interval(mins => $3)`,
        [ev.id, equipoH, REINICIO_DISPOSITIVO_MIN]);
      repetido = porEquipo.rows[0].n >= MAX_POR_DISPOSITIVO;
    }
    if (repetido) {
      await client.query('ROLLBACK');
      return rechazar('dispositivo_repetido', 'Este dispositivo ya registró una asistencia. Cada persona debe registrarse desde su propio teléfono.');
    }

    const { firmado_en, comprobante } = await guardarFirma(client, ev, { cedulaH, ipH, dispH, equipoH, datos });
    await client.query('COMMIT');
    // Respuesta mínima: no devuelve datos personales.
    res.json({ ok: true, evento: ev.nombre, hora: firmado_en, comprobante });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(403).json({ error: MENSAJE_CEDULA });
    console.error('Error al guardar la firma:', e.code || '', e.message);
    res.status(500).json({ error: 'No se pudo guardar. Intente de nuevo.' });
  } finally {
    client.release();
  }
}));

const { router: adminRouter, crearAdminInicial } = require('./admin');
app.use('/api/admin', adminRouter);
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/manual', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'manual.html')));

app.use((err, req, res, next) => {
  // Solo se registra el tipo de error, nunca datos de la petición.
  console.error('Error:', err.type || err.code || '', err.message);
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
    return res.status(400).json({ error: 'Solicitud no válida.' });
  res.status(500).json({ error: 'El servicio no está disponible en este momento. Intente de nuevo en unos minutos.' });
});

const PORT = Number(process.env.PORT || 3000);

(async () => {
  await crearAdminInicial();
  if (process.env.SSL_CERT && process.env.SSL_KEY) {
    const fs = require('fs');
    require('https').createServer({ cert: fs.readFileSync(process.env.SSL_CERT), key: fs.readFileSync(process.env.SSL_KEY) }, app)
      .listen(PORT, () => console.log(`Asistencia (HTTPS) escuchando en el puerto ${PORT}`));
    if (process.env.HTTP_REDIRECT_PORT) {
      require('http').createServer((req, res) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '');
        res.writeHead(301, { Location: `https://${host}${PORT === 443 ? '' : ':' + PORT}${req.url}` }).end();
      }).listen(Number(process.env.HTTP_REDIRECT_PORT));
    }
  } else {
    app.listen(PORT, () => console.log(`Asistencia escuchando en http://localhost:${PORT}`));
  }
})().catch((e) => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
