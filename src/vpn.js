// Detección de VPN y proxy: cabeceras de proxy y reputación de la IP (proxycheck.io v3, con caché).
// Variables: VPN_BLOQUEAR (true|false), VPN_API_KEY, VPN_SI_FALLA (permitir|bloquear), VPN_API_URL (pruebas).

const BLOQUEAR = String(process.env.VPN_BLOQUEAR ?? 'true').toLowerCase() !== 'false';
const API_KEY = process.env.VPN_API_KEY || '';
const SI_FALLA = String(process.env.VPN_SI_FALLA || 'permitir').toLowerCase();
const API_URL = (process.env.VPN_API_URL || 'https://proxycheck.io/v3').replace(/\/$/, '');
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 0);

const TTL_MS = 60 * 60 * 1000;
const MAX_CACHE = 5000;
const cache = new Map();

// IP local o privada: no se consulta.
function esIpLocal(ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  return v === '::1' || v === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(v);
}

// Cabeceras de proxy. Solo se revisan si la app no está detrás de un proxy propio (TRUST_PROXY=0).
function cabecerasDeProxy(req) {
  if (TRUST_PROXY > 0) return null;
  const sospechosas = ['via', 'forwarded', 'x-forwarded-for', 'x-real-ip', 'client-ip', 'proxy-connection', 'x-proxy-id'];
  const halladas = sospechosas.filter((h) => req.headers[h] !== undefined);
  return halladas.length ? halladas : null;
}

async function consultarReputacion(ip) {
  const url = `${API_URL}/${encodeURIComponent(ip)}${API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : ''}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status === 'denied' || data.status === 'error' || !data[ip]) {
    throw new Error(data.message || `Respuesta ${r.status} del servicio de reputación`);
  }
  const d = data[ip].detections || {};
  const anonimo = d.anonymous === true || d.proxy === true || d.vpn === true || d.tor === true;
  const tipos = ['proxy', 'vpn', 'tor'].filter((k) => d[k] === true);
  return { anonimo, tipos, pais: data[ip].location?.country_code ?? null, red: data[ip].network?.provider ?? null };
}

// Devuelve { bloquear, motivo, mensaje, info }; info se guarda cifrada con la firma.
async function revisarConexion(req, ip) {
  if (!BLOQUEAR) return { bloquear: false, info: { verificacion: 'desactivada' } };

  const mensaje = 'Se detectó una conexión mediante VPN o proxy. Desactívela e intente de nuevo.';

  const cab = cabecerasDeProxy(req);
  if (cab) return { bloquear: true, motivo: 'vpn_proxy', mensaje, info: { verificacion: 'cabeceras', cabeceras: cab } };

  if (esIpLocal(ip)) return { bloquear: false, info: { verificacion: 'ip_local' } };

  const hit = cache.get(ip);
  let rep = hit && hit.vence > Date.now() ? hit.rep : null;

  if (!rep) {
    try {
      rep = await consultarReputacion(ip);
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(ip, { rep, vence: Date.now() + TTL_MS });
    } catch (e) {
      console.warn(`Verificación VPN no disponible (${e.message}).`);
      const info = { verificacion: 'no_disponible' };
      return SI_FALLA === 'bloquear'
        ? { bloquear: true, motivo: 'vpn_no_verificable', mensaje: 'No fue posible verificar su conexión. Intente de nuevo en unos minutos.', info }
        : { bloquear: false, info };
    }
  }

  if (rep.anonimo) {
    return { bloquear: true, motivo: 'vpn_proxy', mensaje, info: { verificacion: 'reputacion', tipos: rep.tipos, red: rep.red } };
  }
  return { bloquear: false, info: { verificacion: 'limpia', red: rep.red } };
}

module.exports = { revisarConexion };
