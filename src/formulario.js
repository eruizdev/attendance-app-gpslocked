// Campos del formulario de asistencia y su validación.

// Cambie la versión cuando cambie el texto legal de public/index.html.
const VERSION_AUTORIZACION = 'TD-2026-10-v1';
const CONTACTO = process.env.CONTACTO_DATOS || 'dmarinsem@tic.edu.co';

const OPCIONES = {
  poblacion: ['Indígenas', 'NARP (Negro, Afrocolombiano, Raizal y Palenquero)', 'Rom', 'Víctimas del conflicto armado',
    'OSIGD / LGBTIQ+', 'Con Discapacidad', 'Migrante', 'Otros'],
  rangoEdad: ['0-5 años', '6-12 años', '13-17 años', '18-28 años', '29-59 años', '60 años y más'],
  vinculacion: ['Planta', 'Provisional', 'Contrato'],
  escolaridad: ['Bachiller', 'Técnico', 'Tecnólogo', 'Profesional', 'Especialista', 'Magister', 'Doctorado'],
};

const RE_CEDULA = /^\d{6,13}$/;
const RE_CELULAR = /^\d{10}$/;
const RE_NOMBRES = /^\p{L}[\p{L}\s'.-]{2,119}$/u;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const texto = (v, max) =>
  (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Devuelve { datos } si es válido o { error } con el mensaje para la persona.
// instituciones: lista oficial; si está vacía, se acepta texto libre.
function validar(f, instituciones) {
  f = f || {};
  const nombres = texto(f.nombres, 120);
  if (!RE_NOMBRES.test(nombres)) return { error: 'Escriba sus nombres y apellidos completos, solo con letras.' };

  const institucion = texto(f.institucion, 150);
  if (instituciones.length ? !instituciones.includes(institucion) : institucion.length < 3)
    return { error: 'Seleccione su institución educativa.' };

  const datos = { nombres, institucion };
  const etiquetas = { poblacion: 'su población', rangoEdad: 'su rango de edad', vinculacion: 'su tipo de vinculación',
    escolaridad: 'su nivel de escolaridad' };
  for (const k of Object.keys(OPCIONES)) {
    if (!OPCIONES[k].includes(f[k])) return { error: `Seleccione ${etiquetas[k]}.` };
    datos[k] = f[k];
  }

  const celular = typeof f.celular === 'string' ? f.celular.trim() : '';
  if (!RE_CELULAR.test(celular)) return { error: 'Escriba su número de celular de 10 dígitos, solo números.' };
  datos.celular = celular;

  const correo = texto(f.correo, 254).toLowerCase();
  if (!RE_CORREO.test(correo)) return { error: 'Escriba un correo electrónico válido.' };
  datos.correo = correo;

  return { datos };
}

module.exports = { VERSION_AUTORIZACION, CONTACTO, OPCIONES, RE_CEDULA, validar };
