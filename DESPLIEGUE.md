# Despliegue gratuito: Render + Neon

Render ejecuta la aplicación y Neon guarda la base de datos. Los dos tienen plan gratuito.
La base de Render no sirve: el plan gratuito la borra a los 30 días.

## Lo que hay que saber antes

- Render gratis **se duerme tras 15 minutos sin visitas** y tarda cerca de un minuto en despertar. Render no ofrece forma oficial de evitarlo.
  Se reduce con un monitor externo que lo visite cada 5 a 10 minutos (paso 6).
- Render gratis da 750 horas al mes: alcanza para un solo servicio encendido todo el mes.
- Neon gratis: 0,5 GB, sin tarjeta, sin vencimiento. La base se suspende cuando no se usa; la primera consulta tarda un instante más.
- Sin copia de seguridad automática. Haga copias (paso 7). Guarde la `CLAVE_CIFRADO` fuera de Render: sin ella los datos no se pueden leer.
- Las condiciones gratuitas cambian. Revise las páginas de precios de Render y Neon antes del evento.

## 1. Subir el proyecto a GitHub (repositorio privado)

Cree un repositorio **privado** vacío en github.com. El `.env` no se sube (lo excluye `.gitignore`). En PowerShell, dentro de la carpeta del proyecto:

```
git init
git add .
git commit -m "Registro de asistencia"
git branch -M main
git remote add origin https://github.com/SU-USUARIO/asistencia.git
git push -u origin main
```

## 2. Crear la base en Neon

1. Entre a neon.com, cree una cuenta y un proyecto (región cercana, por ejemplo São Paulo o US East).
2. En "Connection details" copie la cadena de conexión (`postgresql://...neon.tech/...?sslmode=require`).
3. Guárdela: es el valor de `DATABASE_URL`.

## 3. Crear el servicio en Render

1. Entre a render.com y conecte su cuenta de GitHub.
2. New, Blueprint, elija el repositorio. Render lee `render.yaml` y crea el servicio `asistencia` con plan Free.
3. Cuando lo pida, escriba los valores secretos:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena de Neon |
| `CLAVE_CIFRADO` | La misma del archivo `.env` (o una nueva de `npm run genkeys`) |
| `ADMIN_CLAVE` | La contraseña del panel |
| `VPN_API_KEY` | La clave de proxycheck.io (puede quedar vacía) |

   Las demás variables (`NODE_ENV=production`, `TRUST_PROXY=1`, `DB_SSL=true`, GPS, correo de contacto) ya vienen en `render.yaml`.
   El `.env` del proyecto tiene esos mismos valores como referencia.
4. Espere a que termine el despliegue. Render muestra la dirección `https://asistencia-xxxx.onrender.com`.

Al arrancar, la aplicación crea las tablas y carga la lista de colegios sola.

## 4. Revisar que funciona

1. Abra `https://asistencia-xxxx.onrender.com/admin` e inicie sesión.
2. Cree el evento y copie el enlace desde ahí (ya sale con la dirección de Render). Haga el QR con ese enlace.
3. Haga un registro de prueba desde el celular y mire en el panel la IP: debe ser la del celular. Si sale una IP de Render o de Cloudflare,
   cambie `TRUST_PROXY` a `2` en las variables de Render y vuelva a probar.
4. Borre los datos de prueba con una consulta en el editor SQL de Neon antes del evento real:
   `TRUNCATE asistencias, intentos_rechazados RESTART IDENTITY;`

## 5. Dirección propia (opcional)

En Render, Settings, Custom Domains, agregue su dominio. Después abra el panel por esa dirección antes de hacer el QR.

## 6. Mantenerlo despierto

Cree un monitor en un servicio gratuito como UptimeRobot que visite cada 5 minutos:

```
https://asistencia-xxxx.onrender.com/api/sello
```

Es una práctica común, no una función oficial de Render. Si Render cambia sus reglas puede dejar de funcionar.
Antes del evento, abra la página unos minutos antes para comprobar que responde de inmediato.

## 7. Copias de seguridad

Con Docker Desktop, en PowerShell (cambie la dirección por la de Neon):

```
docker run --rm postgres:17-alpine pg_dump "postgresql://usuario:clave@host.neon.tech/neondb?sslmode=require" > copia.sql
```

Hágala al terminar el evento y guárdela fuera del equipo. El archivo está cifrado dentro, pero igual es información sensible.

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| La primera visita tarda un minuto | Render estaba dormido (paso 6) |
| `Falta DATABASE_URL` en los registros | Falta la variable en Render |
| `password authentication failed` | La cadena de Neon está mal copiada |
| Redirecciona en bucle | `TRUST_PROXY` debe ser `1` y `NODE_ENV` `production` |
| Registros ilegibles en el panel | Se cambió `CLAVE_CIFRADO` después de guardar datos |
