(() => {
  const $ = (id) => document.getElementById(id);
  const RADIOS = [['poblacion', 'opPoblacion', 'su población'], ['rangoEdad', 'opRangoEdad', 'su rango de edad'],
    ['vinculacion', 'opVinculacion', 'su tipo de vinculación'], ['escolaridad', 'opEscolaridad', 'su nivel de escolaridad']];
  let conf = null;

  async function api(url, opciones = {}) {
    const r = await fetch(url, { ...opciones, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' } }).catch(() => { throw new Error('No hay conexión con el servidor.'); });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error('Inicie sesión.'); e.sinSesion = true; throw e; }
    if (!r.ok) throw new Error(data.error || 'Ocurrió un error.');
    return data;
  }

  const marcado = (campo) => document.querySelector(`input[name="${campo}"]:checked`)?.value || '';
  const mostrarError = (txt, campo) => { $('error').textContent = txt; $('error').hidden = !txt; if (campo) $(campo)?.scrollIntoView({ block: 'center' }); };

  // Arma opciones, instituciones y eventos.
  async function iniciar() {
    try {
      await api('/api/admin/yo');
      const [resumen, form] = await Promise.all([api('/api/admin/resumen'), api('/api/formulario')]);
      conf = form;
      const sel = new URLSearchParams(location.search).get('e') || '';
      resumen.eventos.forEach((e) => $('evento').add(new Option(`${e.nombre} (${e.codigo})${e.activo ? '' : ' - cerrado'}`, e.codigo)));
      if (sel) $('evento').value = sel;
      $('volver').href = '/admin';
      for (const [campo, cont] of RADIOS) {
        form.opciones[campo].forEach((txt, i) => {
          const l = document.createElement('label'), r = document.createElement('input');
          r.type = 'radio'; r.name = campo; r.value = txt; r.id = `${campo}${i}`;
          l.append(r, document.createTextNode(' ' + txt));
          $(cont).appendChild(l);
        });
      }
      const lista = form.instituciones;
      $('institucion').hidden = !lista.length; $('institucionTexto').hidden = !!lista.length;
      if (lista.length) { $('institucion').add(new Option('Selecciona la respuesta', '')); lista.forEach((n) => $('institucion').add(new Option(n, n))); }
      $('vistaManual').hidden = false;
    } catch (e) {
      if (e.sinSesion) $('sinSesion').hidden = false;
      else { $('vistaManual').hidden = false; mostrarError(e.message); }
    }
  }

  function leer() {
    const cedula = $('cedula').value.trim();
    if (!/^\d{6,13}$/.test(cedula)) return { error: 'Escriba el documento completo, solo números.', campo: 'cedula' };
    const nombres = $('nombres').value.replace(/\s+/g, ' ').trim();
    if (nombres.length < 3) return { error: 'Escriba los nombres y apellidos completos.', campo: 'nombres' };
    const institucion = (conf.instituciones.length ? $('institucion').value : $('institucionTexto').value).trim();
    if (institucion.length < 3) return { error: 'Seleccione la institución educativa.', campo: 'institucion' };
    const f = { nombres, institucion };
    for (const [campo, cont, texto] of RADIOS) {
      f[campo] = marcado(campo);
      if (!f[campo]) return { error: `Seleccione ${texto}.`, campo: cont };
    }
    f.celular = $('celular').value.trim();
    if (!/^\d{10}$/.test(f.celular)) return { error: 'El celular debe tener 10 dígitos, solo números.', campo: 'celular' };
    f.correo = $('correo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.correo)) return { error: 'Escriba un correo electrónico válido.', campo: 'correo' };
    const motivo = $('motivo').value.trim();
    if (motivo.length < 3) return { error: 'Escriba el motivo del registro manual.', campo: 'motivo' };
    return { cedula, formulario: f, motivo };
  }

  ['cedula', 'celular'].forEach((id) => $(id).addEventListener('input', () => { $(id).value = $(id).value.replace(/\D/g, ''); }));

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); mostrarError(''); $('listo').hidden = true;
    const v = leer();
    if (v.error) return mostrarError(v.error, v.campo);
    const evento = $('evento').value;
    if (!confirm(`Se registrará la asistencia de ${v.formulario.nombres} (${v.cedula}) en "${$('evento').selectedOptions[0].text}". ¿Continuar?`)) return;
    const btn = $('btnEnviar'); btn.disabled = true; btn.textContent = 'Registrando…';
    try {
      const r = await api(`/api/admin/eventos/${encodeURIComponent(evento)}/manual`,
        { method: 'POST', body: JSON.stringify({ cedula: v.cedula, formulario: v.formulario, motivo: v.motivo }) });
      $('listo').innerHTML = `Asistencia registrada. Comprobante: <strong></strong>`;
      $('listo').querySelector('strong').textContent = r.comprobante;
      $('listo').hidden = false;
      const motivo = $('motivo').value;
      $('form').reset(); $('evento').value = evento; $('motivo').value = motivo;
      $('listo').scrollIntoView({ block: 'center' });
    } catch (e) {
      if (e.sinSesion) { $('vistaManual').hidden = true; $('sinSesion').hidden = false; }
      else mostrarError(e.message);
    } finally { btn.disabled = false; btn.textContent = 'Registrar asistencia'; }
  });

  iniciar();
})();
