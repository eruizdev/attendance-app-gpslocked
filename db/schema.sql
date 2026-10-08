CREATE TABLE IF NOT EXISTS eventos (
  id         SERIAL PRIMARY KEY,
  codigo     TEXT UNIQUE NOT NULL,
  nombre     TEXT NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una fila por asistencia aceptada. Los datos personales van en datos_cifrados (AES-256-GCM).
CREATE TABLE IF NOT EXISTS asistencias (
  id                BIGSERIAL PRIMARY KEY,
  evento_id         INTEGER NOT NULL REFERENCES eventos(id),
  cedula_hmac       TEXT NOT NULL,
  ip_hmac           TEXT NOT NULL,
  dispositivo_hmac  TEXT NOT NULL,
  datos_cifrados    TEXT NOT NULL,
  hash_anterior     TEXT NOT NULL,
  hash_registro     TEXT NOT NULL,
  firmado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evento_id, cedula_hmac)
);

CREATE TABLE IF NOT EXISTS intentos_rechazados (
  id                BIGSERIAL PRIMARY KEY,
  evento_id         INTEGER REFERENCES eventos(id),
  cedula_hmac       TEXT,
  ip_hmac           TEXT,
  dispositivo_hmac  TEXT,
  datos_cifrados    TEXT,
  motivo            TEXT NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asis_evento_disp ON asistencias(evento_id, dispositivo_hmac);
CREATE INDEX IF NOT EXISTS idx_asis_evento_ip   ON asistencias(evento_id, ip_hmac);
CREATE INDEX IF NOT EXISTS idx_rech_evento      ON intentos_rechazados(evento_id);

CREATE TABLE IF NOT EXISTS administradores (
  id          SERIAL PRIMARY KEY,
  usuario     TEXT UNIQUE NOT NULL,
  clave_hash  TEXT NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  TEXT PRIMARY KEY,
  admin_id    INTEGER NOT NULL REFERENCES administradores(id) ON DELETE CASCADE,
  expira      TIMESTAMPTZ NOT NULL
);

-- Comprobantes AA00 a ZZ99, solo para asistencias aceptadas.
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS comprobante_num INTEGER UNIQUE;
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS comprobante TEXT UNIQUE;

-- Huella del equipo sin el navegador (IP, sistema, pantalla, zona horaria), para detectar otro navegador en el mismo teléfono.
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS equipo_hmac TEXT;
CREATE INDEX IF NOT EXISTS idx_asis_evento_equipo ON asistencias(evento_id, equipo_hmac);

-- Lista de instituciones educativas que se ofrece en el formulario.
CREATE TABLE IF NOT EXISTS instituciones (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT UNIQUE NOT NULL,
  orden   INTEGER NOT NULL DEFAULT 0
);
