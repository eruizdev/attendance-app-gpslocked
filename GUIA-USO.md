# Guía de uso

Registro de asistencia a eventos, Secretaría de Educación.

## Para el personal que administra

### Entrar al panel

1. Abra `https://su-dominio/admin`.
2. Usuario y contraseña: `ADMIN_USUARIO` y `ADMIN_CLAVE` del archivo `.env`.
3. La sesión dura 8 horas.

### Crear un evento y sacar el QR

1. En "Crear evento" escriba el nombre y un código corto (letras, números o guiones, por ejemplo `TIC-OCT-2026`).
2. Pulse "Crear evento". El panel muestra el enlace: `https://su-dominio/?e=TIC-OCT-2026`.
3. Genere el QR con ese enlace en cualquier generador externo e imprímalo.

Si hay un solo evento abierto, el enlace sin código (`https://su-dominio/`) también funciona.

### Lista de colegios

En el resumen, "Instituciones educativas" tiene la lista que ven las personas en el desplegable.
Una por línea. Al pulsar "Guardar lista" reemplaza la anterior. Los registros ya hechos no cambian.

### Durante el evento

Abra el evento desde la tabla. Verá:

- Firmas, registros manuales, rechazos y firmas desde una misma IP (filas resaltadas).
- Gráficas de población, edad, vinculación, escolaridad y colegios.
- La tabla de asistentes con documento, nombre, colegio, ubicación (enlace al mapa), IP y dispositivo.
- Los intentos rechazados con su motivo.
- Un aviso en verde si los registros están íntegros, o en rojo si alguien los alteró en la base.

Use "Cerrar registro" al terminar. Cerrado, nadie más puede firmar y los datos se conservan.

### Registro manual

Para quien no pudo registrarse desde su teléfono.

1. En el evento, pulse el botón rojo "CLIC AQUI REGISTRO MANUAL".
2. Llene el formulario completo por la persona y escriba el motivo.
3. Pulse "Registrar asistencia". Se muestra el comprobante.

Queda guardado con ubicación, IP y dispositivo "ADMIN", precisión 0 m, el usuario que lo hizo y el motivo.
Una cédula ya registrada en el evento no se puede repetir.

### Descargar a Excel

En el evento: "Descargar asistencias (Excel)" y "Descargar rechazos (Excel)". Traen todos los campos, ya descifrados.

## Reglas que aplica la página

| Regla | Qué pasa |
|---|---|
| Ubicación obligatoria | Sin GPS no hay registro |
| Ubicación con más de 2 minutos o precisión peor que `GPS_PRECISION_MAX_METROS` | Se rechaza |
| VPN o proxy | Se rechaza |
| Misma cédula en el mismo evento | Se rechaza, siempre |
| Mismo teléfono con otra cédula antes de 60 minutos (`DISPOSITIVO_REINICIO_MINUTOS`) | Se rechaza. El mensaje no dice el tiempo |
| Otro navegador en el mismo teléfono (`HUELLA_CRUZADA`) | Se detecta por IP, sistema, pantalla y zona horaria |
| Más de 40 intentos fallidos en 15 minutos desde una conexión | Se bloquea unos minutos |

Si dos personas con teléfonos iguales comparten WiFi, la segunda puede ser rechazada. Se le registra en manual.

## Para quien se registra

1. Abre el enlace o escanea el QR y permite la ubicación.
2. Lee la autorización de datos (Ley 1581 de 2012) y llena el formulario.
3. Pulsa "Enviar". Al hacerlo acepta el tratamiento de sus datos.
4. Recibe un comprobante (por ejemplo AB07). Puede tomar captura de pantalla.

Si no le deja usar la ubicación: debe abrir el enlace en Chrome (Android) o Safari (iPhone), activar la ubicación del
teléfono y permitirla para el navegador. La página muestra los pasos.

## Cambios de configuración

Todo está en `.env`. Después de editarlo:

- Con Docker: `docker compose up -d`
- Sin Docker: detenga con Ctrl + C y ejecute `npm start`

Las claves y el modo de ejecución están en `README.md`.
