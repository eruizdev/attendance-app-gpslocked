# Registro de asistencia

Node.js + PostgreSQL. Pensado para desplegarse en Render con la base de datos en Neon (ver `DESPLIEGUE.md`).
El archivo `.env` trae los valores de despliegue: se pegan en Render, no se usan en el computador.

## Desplegar

Siga `DESPLIEGUE.md`: subir a GitHub privado, crear la base en Neon, crear el servicio en Render con `render.yaml`.

## Probar en el computador (opcional)

### Con Docker

Requiere Docker Desktop. En `.env` ponga `NODE_ENV=` vacío, `TRUST_PROXY=0` y `DB_SSL=false`, y agregue `POSTGRES_PASSWORD=` con una clave.

```
docker compose up -d --build
```

- Firma: http://localhost:3000/
- Administración: http://localhost:3000/admin (usuario y contraseña en `.env`: `ADMIN_USUARIO`, `ADMIN_CLAVE`)

Comandos útiles:

```
docker compose logs -f app
docker compose down
docker compose exec app npm run descifrar
```

Los datos quedan en el volumen `datos_pg`. `docker compose down` no los borra; `down -v` sí.

HTTPS con dominio propio (el celular exige https para dar la ubicación): ponga `DOMINIO` y `TRUST_PROXY=1` en `.env` y ejecute:

```
docker compose --profile https up -d --build
```

### Sin Docker

Necesita Node.js LTS y PostgreSQL.

```
npm install
npm run crear-base
npm run db:init
npm start
```

`crear-base` pide la contraseña del usuario `postgres` y crea el usuario y la base de `DATABASE_URL`.

### Probar desde el celular

1. En `.env` ponga `TRUST_PROXY=1` y reinicie.
2. En otra terminal: `cloudflared tunnel --url http://localhost:3000`
3. Abra en el celular la dirección `https://...trycloudflare.com`.

Al terminar, vuelva a poner `TRUST_PROXY=0`.

### GPS en el computador

El límite de precisión del GPS es `GPS_PRECISION_MAX_METROS` (500 m). Un computador sin GPS puede tener más error: súbalo para probar y reinicie.

## Primer uso (también en Render)

1. Entre a `/admin`.
2. Revise la lista de colegios en "Instituciones educativas" (ya viene cargada) y ajústela si hace falta.
3. Cree el evento y use el enlace que muestra el panel para generar el QR.

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `node no se reconoce` | Instale Node.js y abra una terminal nueva |
| `Cannot find module` | `npm install` |
| `ECONNREFUSED ... 5432` | PostgreSQL está apagado (`services.msc`) |
| `password authentication failed` | `DATABASE_URL` mal, o ejecute `npm run crear-base` |
| Docker: `Defina POSTGRES_PASSWORD` | Falta esa línea en `.env` |

Despliegue gratuito en Render con Neon: `DESPLIEGUE.md`. Documentación: `GUIA-USO.md` (uso del panel y reglas) y `DATOS-CIFRADOS.md` (seguridad y descifrado).
