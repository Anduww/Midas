-- Estructura de la base dashboard_db
-- Ejecutar sobre dashboard_db (pgAdmin Query Tool o psql -f). Se puede repetir sin daño.
-- Antes cargar la réplica de PRISMA en el esquema "prisma" (ver export_bd_prisma_postgres.sql).

CREATE TABLE IF NOT EXISTS public.usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL DEFAULT 'usuario',
    activo BOOLEAN DEFAULT TRUE,
    desactivado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS desactivado BOOLEAN NOT NULL DEFAULT FALSE;

-- Roles: admin_super (todo), admin (agrega), usuario (solo consulta)
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('admin_super', 'admin', 'usuario'));

-- Variables (con país opcional; sale de prisma.pais)
CREATE TABLE IF NOT EXISTS public.variables (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    valor NUMERIC(18,4) NOT NULL,
    pais_codigo VARCHAR(5),
    habilitada BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    editado_en TIMESTAMP,
    habilitada_en TIMESTAMP,
    creado_por INTEGER,
    modificado_por INTEGER
);
-- Mismo nombre solo una vez por país (y una vez en "Global")
CREATE UNIQUE INDEX IF NOT EXISTS uq_variables_nombre_pais
    ON public.variables (lower(nombre), COALESCE(pais_codigo, ''));

-- Métricas (ecuaciones)
CREATE TABLE IF NOT EXISTS public.grupo_metrica_global (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(500),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    editado_en TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS grupo_metrica_global_nombre_uq
    ON public.grupo_metrica_global (lower(nombre));

CREATE TABLE IF NOT EXISTS public.metrica (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    ecuacion VARCHAR(500) NOT NULL,
    descripcion VARCHAR(500),
    tipo_resultado VARCHAR(10) NOT NULL DEFAULT 'unica'
        CHECK (tipo_resultado IN ('global', 'unica')),
    capa SMALLINT NOT NULL DEFAULT 1 CHECK (capa BETWEEN 1 AND 3),
    grupo_global_id INTEGER,
    habilitada BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    editado_en TIMESTAMP,
    habilitada_en TIMESTAMP,
    creado_por INTEGER,
    modificado_por INTEGER
);
ALTER TABLE public.metrica
    ADD COLUMN IF NOT EXISTS proyecto_id INTEGER,
    ADD COLUMN IF NOT EXISTS tipo_resultado VARCHAR(10),
    ADD COLUMN IF NOT EXISTS capa SMALLINT,
    ADD COLUMN IF NOT EXISTS grupo_global_id INTEGER;
UPDATE public.metrica SET capa = 3 WHERE capa IS NULL;
ALTER TABLE public.metrica
    ALTER COLUMN capa SET DEFAULT 1,
    ALTER COLUMN capa SET NOT NULL;
UPDATE public.metrica m
SET tipo_resultado = CASE WHEN EXISTS (
    SELECT 1
    FROM public.metrica otra
    WHERE lower(otra.nombre) = lower(m.nombre)
      AND COALESCE(otra.proyecto_id, 0) <> COALESCE(m.proyecto_id, 0)
) THEN 'global' ELSE 'unica' END
WHERE m.tipo_resultado IS NULL;
ALTER TABLE public.metrica
    ALTER COLUMN tipo_resultado SET DEFAULT 'unica',
    ALTER COLUMN tipo_resultado SET NOT NULL;
ALTER TABLE public.metrica DROP CONSTRAINT IF EXISTS metrica_tipo_resultado_check;
ALTER TABLE public.metrica
    ADD CONSTRAINT metrica_tipo_resultado_check
    CHECK (tipo_resultado IN ('global', 'unica'));
ALTER TABLE public.metrica DROP CONSTRAINT IF EXISTS metrica_capa_check;
ALTER TABLE public.metrica
    ADD CONSTRAINT metrica_capa_check CHECK (capa BETWEEN 1 AND 3);
INSERT INTO public.grupo_metrica_global (nombre, descripcion)
    SELECT DISTINCT ON (lower(trim(nombre))) trim(nombre), NULLIF(trim(descripcion), '')
    FROM public.metrica
    WHERE tipo_resultado = 'global' AND trim(nombre) <> ''
    ORDER BY lower(trim(nombre)), id
    ON CONFLICT DO NOTHING;
UPDATE public.metrica m
SET grupo_global_id = g.id
FROM public.grupo_metrica_global g
WHERE m.tipo_resultado = 'global'
  AND m.grupo_global_id IS NULL
  AND lower(trim(m.nombre)) = lower(g.nombre);
UPDATE public.metrica SET grupo_global_id = NULL WHERE tipo_resultado = 'unica';
CREATE INDEX IF NOT EXISTS metrica_grupo_global_idx
    ON public.metrica (grupo_global_id) WHERE tipo_resultado = 'global';

-- Historial de cambios de métricas (sin FK a metrica: debe sobrevivir al borrado)
CREATE TABLE IF NOT EXISTS public.metrica_historica (
    id SERIAL PRIMARY KEY,
    metrica_id INTEGER NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    ecuacion VARCHAR(500) NOT NULL,
    descripcion VARCHAR(500),
    habilitada BOOLEAN NOT NULL,
    accion VARCHAR(20) NOT NULL,
    cambiado_por INTEGER,
    cambiado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ===== Auditoría (sin llaves foráneas; el backend también la crea sola al arrancar) =====
CREATE TABLE IF NOT EXISTS public.auditoria (
    id             SERIAL PRIMARY KEY,
    usuario_id     INTEGER,
    usuario_nombre VARCHAR(100),
    rol            VARCHAR(20),
    accion         VARCHAR(40) NOT NULL,
    entidad        VARCHAR(40),
    detalle        TEXT,
    ip             VARCHAR(60),
    creado_en      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditoria_creado_idx ON public.auditoria (creado_en DESC);

CREATE TABLE IF NOT EXISTS public.logs_sistema (
    id             SERIAL PRIMARY KEY,
    nivel          VARCHAR(10) NOT NULL DEFAULT 'info',
    origen         VARCHAR(60),
    accion         VARCHAR(80),
    mensaje        TEXT NOT NULL,
    detalle        TEXT,
    usuario_id     INTEGER,
    usuario_nombre VARCHAR(100),
    rol            VARCHAR(20),
    ip             VARCHAR(60),
    creado_en      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS logs_sistema_creado_idx ON public.logs_sistema (creado_en DESC);
CREATE INDEX IF NOT EXISTS logs_sistema_nivel_idx ON public.logs_sistema (nivel);