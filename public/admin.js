(() => {
  const $ = (id) => document.getElementById(id);
  const VISTAS = ['vistaLogin', 'vistaResumen', 'vistaEvento'];
  const mostrar = (id) => VISTAS.forEach((v) => { $(v).hidden = v !== id; });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = (f) => (f ? new Date(f).toLocaleString('es-CO', { hour12: false, timeZone: 'America/Bogota' }) : 'Sin firmas');
  let eventoActual = null;
  let asistenciasActuales = [];

  async function api(url, opciones = {}) {
    const r = await fetch('/api/admin' + url, {
      ...opciones, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    }).catch(() => { throw new Error('No hay conexión con el servidor.'); });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/login') { irLogin(); throw new Error(data.error || 'Inicie sesión.'); }
    if (!r.ok) throw new Error(data.error || 'Ocurrió un error.');
    return data;
  }

  function aviso(id, texto, exito = false) {
    const el = $(id); el.textContent = texto; el.hidden = !texto;
    el.classList.toggle('exito-msg', exito);
  }

  function irLogin() { $('menu').hidden = true; mostrar('vistaLogin'); $('usuario').focus(); }

  const cifra = (valor, texto, alerta = false) =>
    `<div class="cifra${alerta ? ' alerta-cifra' : ''}"><strong>${esc(valor)}</strong><span>${esc(texto)}</span></div>`;

  function barras(items, etiqueta, valor) {
    if (!items.length) return '<p class="sin-datos">Sin datos todavía.</p>';
    const max = Math.max(...items.map(valor), 1);
    return '<div class="barras">' + items.map((i) =>
      `<div class="barra-fila"><span>${esc(etiqueta(i))}</span>
         <div class="pista"><div class="relleno" style="width:${(valor(i) / max) * 100}%"></div></div>
         <span class="valor">${valor(i)}</span></div>`).join('') + '</div>';
  }

  async function cargarResumen() {
    const r = await api('/resumen');
    mostrar('vistaResumen');
    $('cifras').innerHTML =
      cifra(r.firmas, 'Firmas registradas') +
      cifra(r.firmas_hoy, 'Firmas hoy') +
      cifra(r.personas_distintas, 'Personas que han firmado') +
      cifra(r.eventos_activos, 'Eventos activos') +
      cifra(r.rechazos, 'Intentos rechazados', r.rechazos > 0);

    $('tablaEventos').innerHTML = '<thead><tr><th>Evento</th><th>Código</th><th>Estado</th><th>Firmas</th><th>Rechazos</th><th>Última firma</th></tr></thead><tbody>' +
      (r.eventos.length ? r.eventos.map((e) => `<tr>
        <td><button class="enlace" data-evento="${esc(e.codigo)}">${esc(e.nombre)}</button></td>
        <td>${esc(e.codigo)}</td>
        <td><span class="etiqueta ${e.activo ? 'activo' : 'inactivo'}">${e.activo ? 'Activo' : 'Cerrado'}</span></td>
        <td>${e.firmas}</td><td>${e.rechazos}</td><td>${esc(fecha(e.ultima_firma))}</td></tr>`).join('')
        : '<tr><td colspan="6" class="vacio">No hay eventos. Cree el primero con el formulario.</td></tr>') + '</tbody>';
    $('tablaEventos').querySelectorAll('[data-evento]').forEach((b) => { b.onclick = () => cargarEvento(b.dataset.evento).catch((err) => alert(err.message)); });

    $('motivos').innerHTML = barras(r.rechazos_por_motivo, (m) => m.motivo, (m) => m.n);

    const inst = await api('/instituciones');
    $('instLista').value = inst.lista.join('\n');
    $('instTotal').textContent = `${inst.lista.length} institución(es) en la lista.`;
  }

  async function cargarEvento(codigo) {
    const d = await api('/eventos/' + encodeURIComponent(codigo));
    eventoActual = d.evento;
    asistenciasActuales = d.asistencias;
    mostrar('vistaEvento');
    window.scrollTo(0, 0);
    $('detNombre').textContent = d.evento.nombre;
    $('detMeta').textContent = `Código ${d.evento.codigo}. Enlace: ${location.origin}/?e=${d.evento.codigo}. ` +
      (d.evento.activo ? 'Registro abierto.' : 'Registro cerrado.');
    $('csvAsistencias').href = `/api/admin/eventos/${encodeURIComponent(codigo)}/asistencias.csv`;
    $('btnManual').href = '/manual?e=' + encodeURIComponent(codigo);
    $('csvRechazos').href = `/api/admin/eventos/${encodeURIComponent(codigo)}/rechazos.csv`;
    $('btnEstado').textContent = d.evento.activo ? 'Cerrar registro' : 'Abrir registro';

    $('detCifras').innerHTML =
      cifra(d.asistencias.length, 'Firmas') +
      cifra(d.asistencias.filter((a) => a.origen === 'manual').length, 'Registros manuales') +
      cifra(d.rechazos.length, 'Intentos rechazados', d.rechazos.length > 0) +
      cifra(d.ips_compartidas, 'Firmas desde IP compartida', d.ips_compartidas > 0);

    $('detIntegridad').innerHTML = d.integridad.integro
      ? `<div class="ok-caja">Registros íntegros: ninguna de las ${d.integridad.registros} firmas fue modificada en la base de datos.</div>`
      : `<div class="alerta">Alerta: los registros fueron modificados o borrados directamente en la base de datos, a partir del registro número ${esc(d.integridad.primer_registro_alterado)}.</div>`;

    $('detIlegibles').innerHTML = d.ilegibles
      ? `<div class="alerta">${esc(d.ilegibles)} registro(s) de este evento no se pueden leer porque se guardaron con otra clave de cifrado.
          Si son firmas de prueba, bórrelas con: npm run crear-base -- --vaciar-datos</div>`
      : '';
    $('detHoras').innerHTML = barras(d.firmas_por_hora, (h) => h.hora, (h) => h.n);
    $('detDispositivos').innerHTML = barras(d.dispositivos, (x) => x.nombre, (x) => x.n);
    const nom = (x) => x.nombre, cnt = (x) => x.n;
    $('perPoblacion').innerHTML = barras(d.perfil.poblacion, nom, cnt);
    $('perEdad').innerHTML = barras(d.perfil.rango_edad, nom, cnt);
    $('perVinculacion').innerHTML = barras(d.perfil.vinculacion, nom, cnt);
    $('perEscolaridad').innerHTML = barras(d.perfil.escolaridad, nom, cnt);
    $('perInstituciones').innerHTML = barras(d.perfil.instituciones, nom, cnt);
    $('filtro').value = '';
    pintarAsistencias();

    $('tablaRechazos').innerHTML = '<thead><tr><th>Fecha y hora</th><th>Motivo</th><th>Documento</th><th>Nombres</th><th>Ubicación</th><th>Precisión</th><th>IP</th><th>Modelo</th></tr></thead><tbody>' +
      (d.rechazos.length ? d.rechazos.map((r) => `<tr>
        <td>${esc(fecha(r.fecha))}</td><td>${esc(r.motivo)}</td><td>${r.ilegible ? '<span class="etiqueta fallo">No legible</span>' : esc(r.cedula)}</td><td>${esc(r.nombres)}</td>
        <td>${r.mapa ? `<a href="${esc(r.mapa)}" target="_blank" rel="noopener">${esc(r.latitud?.toFixed(6))}, ${esc(r.longitud?.toFixed(6))}</a>` : ''}</td>
        <td>${r.precision_metros != null ? esc(r.precision_metros) + ' m' : ''}</td><td>${esc(r.ip)}</td><td>${esc(r.modelo)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="vacio">No hay intentos rechazados.</td></tr>') + '</tbody>';
  }

  // Minúsculas y sin tildes, para buscar sin importar el acento.
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function pintarAsistencias() {
    const q = norm($('filtro').value.trim());
    const filas = asistenciasActuales.filter((a) =>
      !q || [a.cedula, a.comprobante, a.nombres, a.institucion].some((v) => norm(v).includes(q)));
    $('tablaAsistencias').innerHTML = '<thead><tr><th>Comprobante</th><th>Fecha y hora</th><th>Documento</th><th>Nombres</th><th>Institución</th><th>Ubicación (ver mapa)</th><th>Precisión</th><th>IP</th><th>Dispositivo</th></tr></thead><tbody>' +
      (filas.length ? filas.map((a) => a.origen === 'ilegible'
        ? `<tr><td><strong>${esc(a.comprobante)}</strong></td><td>${esc(fecha(a.firmado_en))}</td>
             <td colspan="7"><span class="etiqueta fallo">No legible</span> <span class="motivo" style="display:inline">${esc(a.motivo)}</span></td></tr>`
        : `<tr${a.cedulas_misma_ip > 1 ? ' class="sospechoso" title="Varias cédulas firmaron desde esta IP"' : ''}>
        <td><strong>${esc(a.comprobante)}</strong></td><td>${esc(fecha(a.firmado_en))}</td><td>${esc(a.cedula)}</td>
        <td class="largo">${esc(a.nombres)}</td><td class="largo">${esc(a.institucion)}</td>
        ${a.origen === 'manual'
          ? `<td>ADMIN</td><td>0 m</td><td>ADMIN</td><td>ADMIN <span class="etiqueta manual" title="${esc(a.motivo)}">Manual por ${esc(a.registrado_por)}</span></td>`
          : `<td><a href="${esc(a.mapa)}" target="_blank" rel="noopener">${esc(a.latitud.toFixed(6))}, ${esc(a.longitud.toFixed(6))}</a></td>
        <td>${esc(a.precision_metros)} m</td>
        <td>${esc(a.ip)}${a.cedulas_misma_ip > 1 ? ` (${a.cedulas_misma_ip} cédulas)` : ''}</td>
        <td>${esc([a.modelo, a.sistema, a.navegador].filter(Boolean).join(' | '))}</td>`}</tr>`).join('')
        : `<tr><td colspan="9" class="vacio">${q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay firmas en este evento.'}</td></tr>`) + '</tbody>';
  }

  $('formLogin').onsubmit = async (e) => {
    e.preventDefault(); aviso('errorLogin', '');
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ usuario: $('usuario').value.trim(), clave: $('clave').value }) });
      $('clave').value = '';
      iniciar();
    } catch (err) { aviso('errorLogin', err.message); }
  };

  $('btnSalir').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); irLogin(); };
  $('btnVolver').onclick = () => cargarResumen().catch((e) => alert(e.message));
  $('filtro').oninput = pintarAsistencias;

  $('btnEstado').onclick = async () => {
    const abrir = !eventoActual.activo;
    if (!abrir && !confirm('Al cerrar el registro, nadie más podrá firmar en este evento. ¿Continuar?')) return;
    await api('/eventos/' + encodeURIComponent(eventoActual.codigo), { method: 'PATCH', body: JSON.stringify({ activo: abrir }) });
    cargarEvento(eventoActual.codigo);
  };

  $('nuevoCodigo').oninput = () => {
    const c = $('nuevoCodigo').value.toUpperCase().replace(/\s+/g, '-');
    $('nuevoCodigo').value = c;
    $('vistaEnlace').textContent = `${location.origin}/?e=${c || 'CODIGO'}`;
  };

  $('formInstituciones').onsubmit = async (e) => {
    e.preventDefault(); aviso('msgInst', '');
    try {
      const r = await api('/instituciones', { method: 'PUT', body: JSON.stringify({ lista: $('instLista').value }) });
      const inst = await api('/instituciones');
      $('instLista').value = inst.lista.join('\n');
      $('instTotal').textContent = `${r.total} institución(es) en la lista.`;
      aviso('msgInst', 'Lista guardada.', true);
    } catch (err) { aviso('msgInst', err.message); }
  };

  $('formEvento').onsubmit = async (e) => {
    e.preventDefault(); aviso('msgEvento', '');
    try {
      const r = await api('/eventos', { method: 'POST', body: JSON.stringify({ nombre: $('nuevoNombre').value, codigo: $('nuevoCodigo').value }) });
      $('formEvento').reset(); $('vistaEnlace').textContent = '/?e=CODIGO';
      await cargarResumen();
      aviso('msgEvento', `Evento creado. Enlace: ${location.origin}/?e=${r.codigo}`, true);
    } catch (err) { aviso('msgEvento', err.message); }
  };

  async function iniciar() {
    try {
      const yo = await api('/yo');
      $('usuarioActual').textContent = yo.usuario;
      $('menu').hidden = false;
      await cargarResumen();
    } catch { /* api() ya muestra el inicio de sesión */ }
  }
  iniciar();
})();
