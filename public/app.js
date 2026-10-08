(() => {
  const $ = (id) => document.getElementById(id);
  let codigo = new URLSearchParams(location.search).get('e') || '';
  const mostrar = (id) => ['pasoEvento', 'pasoUbicacion', 'pasoCedula', 'pasoListo', 'pasoNoDisponible']
    .forEach((p) => { $(p).hidden = p !== id; });

  // Identificador del teléfono, para detectar varias cédulas desde un mismo móvil.
  function idDispositivo() {
    try {
      let id = localStorage.getItem('asis_disp');
      if (!id) { id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('asis_disp', id); }
      return id;
    } catch { return 'sin-storage-' + Math.random().toString(36).slice(2) + Date.now(); }
  }

  // Modelo del teléfono (Client Hints en Chrome/Edge Android; Safari no lo da).
  async function infoCliente() {
    const info = { pantalla: `${screen.width}x${screen.height}@${devicePixelRatio}`,
                   zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone };
    try {
      if (navigator.userAgentData?.getHighEntropyValues) {
        const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        if (h.model) info.modelo = h.model;
        if (h.platformVersion) info.versionSO = h.platformVersion;
      }
    } catch {}
    return info;
  }

  function obtenerUbicacion() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject({ code: 'NO_SOPORTA' });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude,
                         precision: p.coords.accuracy, timestamp: p.timestamp }),
        reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  function ayudaPermiso(err) {
    const caja = $('ayudaUbicacion');
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (err.code === 1) {
      const pasos = ios
        ? `<li>Abra Ajustes, Privacidad y seguridad, Localización.</li>
           <li>Active Localización y, en la lista, entre a Sitios web de Safari.</li>
           <li>Elija "Mientras se usa la app" y active Ubicación exacta.</li>
           <li>Vuelva a esta página, cierre y abra de nuevo el navegador.</li>`
        : `<li>Active la ubicación del teléfono (Ajustes, Ubicación).</li>
           <li>Toque el candado junto a la dirección de la página.</li>
           <li>En Permisos, opción Ubicación, elija "Permitir".</li>
           <li>Recargue esta página.</li>`;
      caja.innerHTML = `<strong>No se pudo acceder a la ubicación.</strong> Sin ella no es posible registrar la asistencia.
        <ol>${pasos}</ol>
        <p>Si abrió el enlace desde WhatsApp u otra aplicación, ábralo directamente en ${ios ? 'Safari' : 'Chrome'}.</p>`;
    } else if (err.code === 2 || err.code === 3) {
      caja.textContent = 'No se pudo obtener su ubicación. Active el GPS del teléfono, ubíquese en un lugar despejado e intente de nuevo.';
    } else if (!window.isSecureContext) {
      caja.textContent = 'La página debe abrirse con https:// para poder leer la ubicación.';
    } else {
      caja.textContent = 'Este navegador no permite leer la ubicación. Use Chrome o Safari actualizados.';
    }
    if (err.message) {
      const t = document.createElement('p');
      t.className = 'detalle-tecnico';
      t.textContent = `Detalle técnico: ${err.message}`;
      caja.appendChild(t);
    }
    caja.hidden = false;
  }

  async function activarUbicacion() {
    $('btnUbicacion').disabled = true; $('estadoGps').hidden = false; $('ayudaUbicacion').hidden = true;
    try {
      const u = await obtenerUbicacion();
      $('ubicacionOk').textContent = `Ubicación activa (precisión de ${Math.round(u.precision)} m)`;
      mostrar('pasoCedula');
    } catch (e) { ayudaPermiso(e); }
    finally { $('btnUbicacion').disabled = false; $('estadoGps').hidden = true; }
  }

  // Sobre cifrado: ECDH P-256 + AES-256-GCM, clave nueva en cada envío.
  const aB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const deB64 = (txt) => Uint8Array.from(atob(txt), (c) => c.charCodeAt(0));
  let servidor = null;

  async function claveServidor() {
    if (servidor) return servidor;
    const r = await fetch('/api/sello', { cache: 'no-store' })
      .catch(() => { throw new Error('No hay conexión con el servidor. Verifique su internet e intente de nuevo.'); });
    const { clave } = await r.json();
    const raw = deB64(clave);
    servidor = { raw, key: await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []) };
    return servidor;
  }

  async function sellar(objeto) {
    if (!window.crypto?.subtle) throw new Error('Este navegador no permite el envío seguro. Use Chrome o Safari actualizados con https://.');
    const srv = await claveServidor();
    const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const epk = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: srv.key }, par.privateKey, 256);
    const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const aes = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: srv.raw, info: new TextEncoder().encode('asistencia-sobre-v1') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: epk }, aes,
      new TextEncoder().encode(JSON.stringify(objeto)));
    return { epk: aB64(epk), iv: aB64(iv), ct: aB64(ct) };
  }

  let formConf = null;
  const RADIOS = [['poblacion', 'opPoblacion'], ['rangoEdad', 'opRangoEdad'], ['vinculacion', 'opVinculacion'], ['escolaridad', 'opEscolaridad']];

  // Carga opciones, instituciones y versión del texto legal desde el servidor.
  async function cargarFormulario() {
    formConf = await pedirJSON('/api/formulario');
    $('contactoDatos').textContent = formConf.contacto;
    for (const [campo, cont] of RADIOS) {
      $(cont).innerHTML = '';
      formConf.opciones[campo].forEach((txt, i) => {
        const l = document.createElement('label');
        const r = document.createElement('input');
        r.type = 'radio'; r.name = campo; r.value = txt; r.id = `${campo}${i}`;
        l.append(r, document.createTextNode(' ' + txt));
        $(cont).appendChild(l);
      });
    }
    const sel = $('institucion');
    sel.innerHTML = '';
    const lista = formConf.instituciones;
    sel.hidden = !lista.length; $('institucionTexto').hidden = !!lista.length;
    if (lista.length) {
      sel.add(new Option('Selecciona la respuesta', ''));
      lista.forEach((n) => sel.add(new Option(n, n)));
    }
  }

  const marcado = (campo) => document.querySelector(`input[name="${campo}"]:checked`)?.value || '';

  // Devuelve { formulario } o { error, campo }.
  function leerFormulario() {
    const cedula = $('cedula').value.trim();
    if (!/^\d{6,13}$/.test(cedula)) return { error: 'Escriba su documento de identidad completo, solo números, sin puntos ni espacios.', campo: 'cedula' };
    const nombres = $('nombres').value.replace(/\s+/g, ' ').trim();
    if (nombres.length < 3) return { error: 'Escriba sus nombres y apellidos completos.', campo: 'nombres' };
    const institucion = (formConf.instituciones.length ? $('institucion').value : $('institucionTexto').value).trim();
    if (institucion.length < 3) return { error: 'Seleccione su institución educativa.', campo: formConf.instituciones.length ? 'institucion' : 'institucionTexto' };
    const f = { nombres, institucion };
    const faltan = { poblacion: ['su población', 'opPoblacion'], rangoEdad: ['su rango de edad', 'opRangoEdad'],
      vinculacion: ['su tipo de vinculación', 'opVinculacion'], escolaridad: ['su nivel de escolaridad', 'opEscolaridad'] };
    for (const k of Object.keys(faltan)) {
      f[k] = marcado(k);
      if (!f[k]) return { error: `Seleccione ${faltan[k][0]}.`, campo: faltan[k][1] };
    }
    f.celular = $('celular').value.trim();
    if (!/^\d{10}$/.test(f.celular)) return { error: 'Escriba su número de celular de 10 dígitos, solo números.', campo: 'celular' };
    f.correo = $('correo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.correo)) return { error: 'Escriba un correo electrónico válido.', campo: 'correo' };
    return { cedula, formulario: f };
  }

  async function enviar(ev) {
    ev.preventDefault();
    const err = $('error'); err.hidden = true;
    const r0 = leerFormulario();
    if (r0.error) {
      err.textContent = r0.error; err.hidden = false;
      $(r0.campo)?.scrollIntoView({ block: 'center' });
      return;
    }
    const { cedula, formulario } = r0;

    const btn = $('btnEnviar'); btn.disabled = true; btn.textContent = 'Verificando ubicación…';
    try {
      const ubicacion = await obtenerUbicacion();
      btn.textContent = 'Registrando…';
      const n = aB64(crypto.getRandomValues(new Uint8Array(18)));
      const sobre = await sellar({ evento: codigo, cedula, formulario, autorizacion: formConf.autorizacion, ubicacion, dispositivoId: idDispositivo(),
                                   cliente: await infoCliente(), t: Date.now(), n });
      const r = await fetch('/api/asistencia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', body: JSON.stringify(sobre),
      }).catch(() => { throw new Error('No hay conexión con el servidor. Verifique su internet e intente de nuevo.'); });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'No se pudo registrar la asistencia.');
      $('detalleListo').textContent = `${data.evento}. Fecha y hora: ${new Date(data.hora).toLocaleString('es')}.`;
      $('coordenadas').textContent = `${ubicacion.lat.toFixed(6)}, ${ubicacion.lng.toFixed(6)} (precisión de ${Math.round(ubicacion.precision)} m)`;
      $('form').reset();
      $('comprobante').textContent = data.comprobante;
      mostrar('pasoListo');
    } catch (e) {
      if (typeof e.code === 'number') { mostrar('pasoUbicacion'); ayudaPermiso(e); return; }
      err.textContent = e.message; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Enviar'; }
  }

  function noDisponible(titulo, mensaje) {
    $('eventoNombre').textContent = titulo;
    $('eventoEstado').textContent = '';
    $('mensajeNoDisponible').textContent = mensaje;
    mostrar('pasoNoDisponible');
  }

  async function pedirJSON(url) {
    const r = await fetch(url)
      .catch(() => { throw new Error('No hay conexión con el servidor. Verifique su internet e intente de nuevo.'); });
    const data = await r.json().catch(() => ({ error: 'El servicio no está disponible en este momento.' }));
    if (!r.ok) throw new Error(data.error);
    return data;
  }

  async function abrirEvento(nombre) {
    $('eventoEtiqueta').hidden = false;
    $('eventoNombre').textContent = nombre;
    $('eventoEstado').textContent = 'Registro abierto';
    $('eventoEstado').className = 'evento-estado abierto';
    mostrar('pasoUbicacion');
    try { await cargarFormulario(); } catch (e) { return noDisponible('Registro no disponible', e.message); }
    // Pide la ubicación al abrir; si está bloqueada, muestra instrucciones.
    const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
    if (perm?.state === 'denied') ayudaPermiso({ code: 1 });
    else activarUbicacion();
  }

  async function iniciar() {
    mostrar(null);
    try {
      if (codigo) {
        const ev = await pedirJSON('/api/evento/' + encodeURIComponent(codigo));
        return abrirEvento(ev.nombre);
      }
      // Sin código en el enlace: usa el evento activo o pide elegir.
      const eventos = await pedirJSON('/api/eventos');
      if (!eventos.length) return noDisponible('Sin eventos activos', 'En este momento no hay eventos con registro de asistencia abierto.');
      if (eventos.length === 1) { codigo = eventos[0].codigo; return abrirEvento(eventos[0].nombre); }
      $('eventoNombre').textContent = 'Registro de asistencia';
      $('selectEvento').innerHTML = '';
      eventos.forEach((e) => $('selectEvento').add(new Option(e.nombre, e.codigo)));
      mostrar('pasoEvento');
      $('btnEvento').onclick = () => {
        const sel = $('selectEvento');
        codigo = sel.value;
        abrirEvento(sel.options[sel.selectedIndex].text);
      };
    } catch (e) {
      noDisponible('Evento no disponible', e.message || 'No se pudo cargar el evento.');
    }
  }

  // Solo números en documento y celular.
  ['cedula', 'celular'].forEach((id) => $(id).addEventListener('input', () => { $(id).value = $(id).value.replace(/\D/g, ''); }));
  $('btnUbicacion').addEventListener('click', activarUbicacion);
  $('form').addEventListener('submit', enviar);
  iniciar();
})();
