require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

// ---------- CONFIGURACIÓN OBLIGATORIA ----------
// Si falta algo en el .env, el servidor avisa y no arranca

const VARIABLES_OBLIGATORIAS = [
    "DB_USER", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT",
    "JWT_SECRET", "JWT_EXPIRES"
];

const faltantes = VARIABLES_OBLIGATORIAS.filter(nombre => !process.env[nombre]);
if (faltantes.length > 0) {
    console.error("Faltan variables en el .env: " + faltantes.join(", "));
    process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET es muy corto: usa al menos 32 caracteres.");
    process.exit(1);
}

const app = express();
const TIEMPO_CACHE_RESUMEN_MS = 30000;
let cacheResumenDashboard = null;
let cacheHorasAhorradasAcumuladas = null;

app.use(cors());
app.use(express.json());

// Registro de cada petición en consola: "GET /variables -> 200 (0.02s)"
app.use((req, res, next) => {
    const inicio = Date.now();
    res.on("finish", () => {
        if (/\.(js|css|png|jpg|ico|svg|map)$/i.test(req.path)) return; // sin ruido de archivos
        const hora = new Date().toLocaleTimeString("es-CO");
        const segundos = ((Date.now() - inicio) / 1000).toFixed(2);
        console.log("[" + hora + "] " + req.method + " " + req.path + " -> " + res.statusCode + " (" + segundos + "s)");
    });

    next();
});

// ---------- AUDITORÍA ----------
// Tabla sin llaves foráneas: guarda el nombre tal cual estaba al momento de la acción
async function prepararAuditoria() {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS public.auditoria (
            id             SERIAL PRIMARY KEY,
            usuario_id     INTEGER,
            usuario_nombre VARCHAR(100),
            rol            VARCHAR(20),
            accion         VARCHAR(40) NOT NULL,
            entidad        VARCHAR(40),
            detalle        TEXT,
            ip             VARCHAR(60),
            creado_en      TIMESTAMP NOT NULL DEFAULT NOW()
        )`
    );
    await pool.query("CREATE INDEX IF NOT EXISTS auditoria_creado_idx ON public.auditoria (creado_en DESC)");
}

async function auditar(u, accion, entidad, detalle, ip) {
    try {
        const repetida = await pool.query(
            `SELECT EXISTS (
                SELECT 1 FROM public.auditoria
                WHERE usuario_id IS NOT DISTINCT FROM $1
                  AND accion = $2
                  AND entidad IS NOT DISTINCT FROM $3
                  AND detalle IS NOT DISTINCT FROM $4
                  AND ip IS NOT DISTINCT FROM $5
                  AND creado_en >= NOW() - INTERVAL '10 seconds'
            ) AS repetida`,
            [u ? u.id : null, accion, entidad || null, detalle || null, ip || null]
        );
        if (repetida.rows[0].repetida) return;

        await pool.query(
            `INSERT INTO public.auditoria (usuario_id, usuario_nombre, rol, accion, entidad, detalle, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [u ? u.id : null, u ? u.nombre : null, u ? u.rol : null, accion, entidad || null, detalle || null, ip || null]
        );
    } catch (error) {
        console.error("No se pudo registrar auditoría:", error.message); // nunca rompe la petición
    }
}

async function prepararLogsSistema() {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS public.logs_sistema (
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
        )`
    );
    await pool.query("CREATE INDEX IF NOT EXISTS logs_sistema_creado_idx ON public.logs_sistema (creado_en DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS logs_sistema_nivel_idx ON public.logs_sistema (nivel)");
}

async function registrarLogSistema({ nivel = "info", origen = null, accion = null, mensaje, detalle = null, usuario = null, ip = null }) {
    try {
        const repetido = await pool.query(
            `SELECT EXISTS (
                SELECT 1 FROM public.logs_sistema
                WHERE nivel = $1
                  AND origen IS NOT DISTINCT FROM $2
                  AND accion IS NOT DISTINCT FROM $3
                  AND mensaje = $4
                  AND usuario_id IS NOT DISTINCT FROM $5
                  AND ip IS NOT DISTINCT FROM $6
                  AND creado_en >= NOW() - INTERVAL '5 seconds'
            ) AS repetido`,
            [nivel, origen, accion, mensaje, usuario ? usuario.id : null, ip || null]
        );
        if (repetido.rows[0].repetido) return;

        await pool.query(
            `INSERT INTO public.logs_sistema (nivel, origen, accion, mensaje, detalle, usuario_id, usuario_nombre, rol, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                nivel,
                origen,
                accion,
                String(mensaje || "").slice(0, 500),
                detalle ? String(detalle).slice(0, 4000) : null,
                usuario ? usuario.id : null,
                usuario ? usuario.nombre : null,
                usuario ? usuario.rol : null,
                ip || null
            ]
        );
    } catch (error) {
        console.error("No se pudo registrar log del sistema:", error.message);
    }
}

// Toda acción que modifica datos (POST/PUT/PATCH/DELETE) y sale bien queda registrada
app.use((req, res, next) => {
    res.on("finish", () => {
        const ruta = req.path || "";
        const partes = ruta.split("/").filter(Boolean); // ["variables","5","desactivar"]
        const entidad = partes[0] || "sistema";
        const nombre = req.body && typeof req.body.nombre === "string" ? ' "' + req.body.nombre.slice(0, 80) + '"' : "";

        if (res.statusCode >= 400) {
            const nivel = res.statusCode >= 500 ? "error" : "warn";
            const accionLog = req.method + " " + ruta;
            const mensajeError = res.locals.mensajeLogSistema || (res.statusCode >= 500
                ? "Error del servidor en una solicitud"
                : "Solicitud rechazada o con error");
            registrarLogSistema({
                nivel,
                origen: entidad,
                accion: accionLog,
                mensaje: mensajeError,
                detalle: "Estado HTTP " + res.statusCode + nombre,
                usuario: req.user || null,
                ip: req.ip
            });
            return;
        }

        if (req.method === "GET" || !req.user) return;
        cacheResumenDashboard = null;
        cacheHorasAhorradasAcumuladas = null;
        let accion = { POST: "crear", PUT: "editar", DELETE: "eliminar" }[req.method] || "modificar";
        if (req.method === "PATCH" && partes[2]) accion = partes[2]; // activar / desactivar
        if (partes[0] === "calculos" && partes[2] === "enviar") accion = "enviar";
        if (partes[0] === "calculos" && partes[2] === "previsualizar") accion = "previsualizar";
        auditar(req.user, accion, entidad, req.method + " " + req.path + nombre, req.ip);
        if (["variables", "calculos", "usuarios", "perfil", "registro"].includes(entidad)) {
            const mensajesPorEntidad = {
                variables: {
                    crear: "Variable creada",
                    editar: "Variable actualizada",
                    eliminar: "Variable eliminada",
                    activar: "Variable activada",
                    desactivar: "Variable desactivada"
                },
                calculos: {
                    crear: "Consulta/métrica creada",
                    editar: "Consulta/métrica actualizada",
                    eliminar: "Borrador de métrica eliminado",
                    activar: "Métrica activada",
                    desactivar: "Métrica desactivada",
                    enviar: "Métrica enviada/activada",
                    previsualizar: "Consulta/métrica previsualizada"
                },
                usuarios: {
                    crear: "Usuario creado",
                    editar: "Usuario actualizado",
                    eliminar: "Usuario eliminado",
                    activar: "Usuario activado",
                    desactivar: "Usuario desactivado"
                },
                perfil: {
                    editar: "Perfil actualizado",
                    modificar: "Perfil actualizado"
                },
                registro: {
                    crear: "Solicitud de registro recibida"
                }
            };
            const mensajeEspecifico = (mensajesPorEntidad[entidad] && mensajesPorEntidad[entidad][accion])
                || "Acción realizada correctamente";
            const detalleLog = "Acción: " + accion + " | Entidad: " + entidad + (nombre ? " | Nombre:" + nombre : "") + " | Ruta: " + req.method + " " + ruta;
            registrarLogSistema({
                nivel: "info",
                origen: entidad,
                accion: req.method + " " + ruta,
                mensaje: mensajeEspecifico,
                detalle: detalleLog,
                usuario: req.user,
                ip: req.ip
            });
        }
    });
    next();
});

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Conexión a PRISMA (solo lectura). Si en el .env no hay PRISMA_DB_*, se usa la copia
// que está dentro de esta misma base (esquema "prisma"). Si hay, se lee la base real de PRISMA.
const prismaPool = new Pool({
    user: process.env.PRISMA_DB_USER || process.env.DB_USER,
    host: process.env.PRISMA_DB_HOST || process.env.DB_HOST,
    database: process.env.PRISMA_DB_NAME || process.env.DB_NAME,
    password: process.env.PRISMA_DB_PASSWORD || process.env.DB_PASSWORD,
    port: process.env.PRISMA_DB_PORT || process.env.DB_PORT,
    // Esquema donde están las tablas de PRISMA: "prisma" en la copia, "public" en la base real
    options: "-c search_path=" + (process.env.PRISMA_DB_SCHEMA || "prisma") + " -c default_transaction_read_only=on"
});
const PRISMA_REAL = Boolean(process.env.PRISMA_DB_NAME);

const FUENTES_VARIABLES_PRISMA = [
    {
        clave: "beneficios",
        nombre: "Beneficios",
        descripcion: "Valores agregados de la tabla BENEFICIOS asociados a la iniciativa del proyecto.",
        tablaCandidata: "beneficios",
        enlacesProyecto: ["iniciativa_id"],
        soportaPeriodo: true,
        variables: [
            { nombre: "costo_ahorrado_esperado", etiqueta: "Costo ahorrado esperado", agregacion: "SUM" },
            { nombre: "hh_esperado", etiqueta: "Horas hombre esperadas", agregacion: "SUM" },
            { nombre: "multa_esperada", etiqueta: "Multa esperada", agregacion: "SUM" },
            { nombre: "costo_ahorrado_obtenido", etiqueta: "Costo ahorrado obtenido", agregacion: "SUM" },
            { nombre: "hh_obtenido", etiqueta: "Horas hombre obtenidas", agregacion: "SUM" },
            { nombre: "multa_obtenida", etiqueta: "Multa obtenida", agregacion: "SUM" },
            { nombre: "pct_n1_obtenido", etiqueta: "Porcentaje N1 obtenido", agregacion: "AVG" },
            { nombre: "pct_n2_obtenido", etiqueta: "Porcentaje N2 obtenido", agregacion: "AVG" },
            { nombre: "pct_n3_obtenido", etiqueta: "Porcentaje N3 obtenido", agregacion: "AVG" }
        ]
    },
    {
        clave: "ejecuciones_automatizacion",
        nombre: "Ejecuciones de automatización",
        descripcion: "Indicadores agregados de las ejecuciones registradas para la iniciativa del proyecto.",
        tablasCandidatas: ["ejecuciones_automatizacion", "ejecucion_automatizacion", "ejecuciones_automatizaciones", "automatizacion_ejecuciones"],
        enlacesProyecto: ["iniciativa_id", "proyecto_id", "id_iniciativa", "iob_id", "id_proyecto"],
        soportaPeriodo: false,
        variables: [
            { nombre: "ejecuciones_total", etiqueta: "Total de ejecuciones", expresion: "COUNT(*)", requiereColumnas: [] },
            { nombre: "ejecuciones_con_id_externo", etiqueta: "Ejecuciones con ID externo", expresion: 'COUNT(*) FILTER (WHERE "external_execution_id" IS NOT NULL)', requiereColumnas: ["external_execution_id"] },
            { nombre: "ejecuciones_ids_externos_unicos", etiqueta: "IDs externos únicos", expresion: 'COUNT(DISTINCT "external_execution_id")', requiereColumnas: ["external_execution_id"] },
            { nombre: "ejecuciones_con_estado_recoleccion", etiqueta: "Ejecuciones con estado de recolección", expresion: 'COUNT(*) FILTER (WHERE "estado_recoleccion" IS NOT NULL)', requiereColumnas: ["estado_recoleccion"] },
            { nombre: "ejecuciones_estados_recoleccion_unicos", etiqueta: "Estados de recolección únicos", expresion: 'COUNT(DISTINCT "estado_recoleccion")', requiereColumnas: ["estado_recoleccion"] },
            { nombre: "ejecuciones_con_fecha_inicio", etiqueta: "Ejecuciones con fecha de inicio", expresion: 'COUNT(*) FILTER (WHERE "fecha_inicio" IS NOT NULL)', requiereColumnas: ["fecha_inicio"] },
            { nombre: "ejecuciones_finalizadas", etiqueta: "Ejecuciones finalizadas", expresion: 'COUNT(*) FILTER (WHERE "fecha_fin" IS NOT NULL)', requiereColumnas: ["fecha_fin"] },
            { nombre: "ejecuciones_duracion_total_seg", etiqueta: "Duración total (segundos)", agregacion: "SUM", columna: "duracion_segundos" },
            { nombre: "ejecuciones_duracion_promedio_seg", etiqueta: "Duración promedio (segundos)", agregacion: "AVG", columna: "duracion_segundos" },
            { nombre: "ejecuciones_duracion_max_seg", etiqueta: "Duración máxima (segundos)", agregacion: "MAX", columna: "duracion_segundos" },
            { nombre: "ejecuciones_con_usuario", etiqueta: "Ejecuciones con usuario", expresion: 'COUNT(*) FILTER (WHERE "usuario_ejecucion" IS NOT NULL)', requiereColumnas: ["usuario_ejecucion"] },
            { nombre: "ejecuciones_usuarios_unicos", etiqueta: "Usuarios de ejecución únicos", expresion: 'COUNT(DISTINCT "usuario_ejecucion")', requiereColumnas: ["usuario_ejecucion"] },
            { nombre: "ejecuciones_con_tipo_caso", etiqueta: "Ejecuciones con tipo de caso", expresion: 'COUNT(*) FILTER (WHERE "tipo_caso_id" IS NOT NULL)', requiereColumnas: ["tipo_caso_id"] },
            { nombre: "ejecuciones_tipos_caso_unicos", etiqueta: "Tipos de caso únicos", expresion: 'COUNT(DISTINCT "tipo_caso_id")', requiereColumnas: ["tipo_caso_id"] }
        ]
    }
];

const fuentesPrismaPromises = new Map();

function citarIdentificadorSql(nombre) {
    return `"${String(nombre).replace(/"/g, '""')}"`;
}

async function obtenerDefinicionFuentePrisma(fuente) {
    if (!fuentesPrismaPromises.has(fuente.clave)) {
        fuentesPrismaPromises.set(fuente.clave, (async () => {
            const tablasCandidatas = fuente.tablasCandidatas || [fuente.tablaCandidata];
            const parametros = tablasCandidatas.map((_, indice) => `$${indice + 1}`).join(", ");
            const resultado = await prismaPool.query(
                `SELECT table_name, column_name
                 FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND lower(table_name) = ANY(ARRAY[${parametros}]::text[])`,
                tablasCandidatas.map(nombre => String(nombre).toLowerCase())
            );

            const porTabla = new Map();
            resultado.rows.forEach(fila => {
                const tabla = String(fila.table_name).toLowerCase();
                if (!porTabla.has(tabla)) porTabla.set(tabla, new Map());
                porTabla.get(tabla).set(String(fila.column_name).toLowerCase(), fila.column_name);
            });

            let tabla = null;
            let columnas = null;
            for (const candidata of tablasCandidatas) {
                const encontrada = porTabla.get(String(candidata).toLowerCase());
                if (encontrada) {
                    tabla = [...porTabla.entries()].find(([nombre]) => nombre === String(candidata).toLowerCase());
                    tabla = resultado.rows.find(fila => String(fila.table_name).toLowerCase() === String(candidata).toLowerCase())?.table_name || candidata;
                    columnas = encontrada;
                    break;
                }
            }

            if (!tabla || !columnas) {
                return { disponible: false, motivo: `No se encontró la tabla ${fuente.nombre} en el esquema PRISMA seleccionado.` };
            }

            const enlaceProyecto = (fuente.enlacesProyecto || []).find(columna => columnas.has(columna));
            if (!enlaceProyecto) {
                return {
                    disponible: false,
                    tabla,
                    motivo: `La tabla ${tabla} no contiene una columna de vínculo con el proyecto.`
                };
            }

            return {
                disponible: true,
                tabla,
                columnas,
                enlaceProyecto: columnas.get(enlaceProyecto)
            };
        })().catch(error => {
            fuentesPrismaPromises.delete(fuente.clave);
            throw error;
        }));
    }

    return fuentesPrismaPromises.get(fuente.clave);
}

function definicionesVariablesFuente(fuente, definicionTabla) {
    if (!definicionTabla || !definicionTabla.disponible) {
        return fuente.variables.map(variable => ({
            ...variable,
            disponible: false,
            motivo: definicionTabla ? definicionTabla.motivo : "Fuente no disponible"
        }));
    }

    const columnas = definicionTabla.columnas;
    return fuente.variables.map(variable => {
        if (variable.expresion) {
            const requeridas = variable.requiereColumnas || [];
            const disponible = requeridas.every(columna => columnas.has(columna));
            return {
                ...variable,
                disponible,
                sql: disponible ? `${variable.expresion} AS ${citarIdentificadorSql(variable.nombre)}` : null,
                motivo: disponible ? null : "No hay columnas compatibles en la tabla."
            };
        }

        const columnaOrigen = columnas.get(String(variable.columna || variable.nombre).toLowerCase());
        const disponible = Boolean(columnaOrigen);
        return {
            ...variable,
            disponible,
            columnaOrigen,
            motivo: disponible ? null : "No hay columnas compatibles en la tabla."
        };
    });
}

function camposAgregadosBeneficiosCompatibles(columnasDisponibles, dividirAnuales = false) {
    const columnaPeriodicidad = columnasDisponibles.get("periodicidad");
    const ajustarPeriodicidad = columna => dividirAnuales && columnaPeriodicidad
        ? `CASE WHEN upper(${citarIdentificadorSql(columnaPeriodicidad)}) = 'ANUAL' THEN ${citarIdentificadorSql(columna)} / 12.0 ELSE ${citarIdentificadorSql(columna)} END`
        : citarIdentificadorSql(columna);
    const fuente = FUENTES_VARIABLES_PRISMA[0];
    const campos = fuente.variables
        .filter(variable => columnasDisponibles.has(variable.nombre))
        .map(variable => {
            const columna = ajustarPeriodicidad(columnasDisponibles.get(variable.nombre));
            return `${variable.agregacion}(${columna}) AS ${citarIdentificadorSql(variable.nombre)}`;
        });
    const columnasTipoCantidad = columnasDisponibles.has("tipo") && columnasDisponibles.has("cantidad");
    const cantidad = columnasTipoCantidad ? ajustarPeriodicidad(columnasDisponibles.get("cantidad")) : "";
    if (columnasTipoCantidad) {
        if (!columnasDisponibles.has("hh_obtenido")) {
            campos.push(`SUM(${cantidad}) FILTER (WHERE upper("tipo") = 'HH') AS "hh_obtenido"`);
        }
        if (!columnasDisponibles.has("multa_obtenida")) {
            campos.push(`SUM(${cantidad}) FILTER (WHERE upper("tipo") = 'MULTA') AS "multa_obtenida"`);
        }
    }
    return { campos, columnasTipoCantidad };
}

function construirVariablesFuente(fuente, definicionTabla, fila) {
    const definiciones = definicionesVariablesFuente(fuente, definicionTabla);
    const columnas = definicionTabla && definicionTabla.disponible ? definicionTabla.columnas : new Map();
    const columnasTipoCantidad = fuente.clave === "beneficios" && columnas.has("tipo") && columnas.has("cantidad");
    const registros = Number((fila && fila.registros) || 0);

    return definiciones.map(variable => {
        let disponible = variable.disponible;
        if (fuente.clave === "beneficios" && columnasTipoCantidad && ["hh_obtenido", "multa_obtenida"].includes(variable.nombre)) {
            disponible = true;
        }
        const valorBruto = fila ? fila[variable.nombre] : null;
        return {
            nombre: variable.nombre,
            etiqueta: variable.etiqueta || variable.nombre,
            fuente: fuente.clave,
            fuenteNombre: fuente.nombre,
            descripcion: variable.descripcion || null,
            disponible,
            motivo: disponible ? null : (variable.motivo || "No disponible"),
            valor: valorBruto === null || valorBruto === undefined ? null : Number(valorBruto),
            registros
        };
    });
}

function camposAgregadosFuente(fuente, definicionTabla, periodo = null) {
    if (!definicionTabla || !definicionTabla.disponible) return { campos: [], columnasTipoCantidad: false };
    if (fuente.clave === "beneficios") {
        return camposAgregadosBeneficiosCompatibles(definicionTabla.columnas, Boolean(periodo));
    }

    const campos = definicionesVariablesFuente(fuente, definicionTabla)
        .filter(variable => variable.disponible)
        .map(variable => {
            if (variable.sql) return variable.sql;
            return `${variable.agregacion}(${citarIdentificadorSql(variable.columnaOrigen)}) AS ${citarIdentificadorSql(variable.nombre)}`;
        });
    return { campos, columnasTipoCantidad: false };
}

async function consultarVariablesPrismaPorProyecto(proyectosIds, periodo = null) {
    const ids = [...new Set((proyectosIds || []).filter(Number.isInteger))];
    const porProyecto = new Map(ids.map(proyectoId => [proyectoId, {
        proyecto_id: proyectoId,
        fuentes: FUENTES_VARIABLES_PRISMA.map(fuente => ({
            clave: fuente.clave,
            nombre: fuente.nombre,
            descripcion: fuente.descripcion,
            disponible: false,
            variables: construirVariablesFuente(fuente, null, { registros: 0 })
        }))
    }]));
    if (!ids.length) return porProyecto;

    for (const fuente of FUENTES_VARIABLES_PRISMA) {
        let definicionTabla;
        try {
            definicionTabla = await obtenerDefinicionFuentePrisma(fuente);
        } catch (error) {
            definicionTabla = {
                disponible: false,
                motivo: fuente.clave === "beneficios"
                    ? error.message
                    : "No se pudo consultar esta fuente en PRISMA."
            };
            if (fuente.clave === "beneficios") throw error;
            console.error(`No se pudo cargar la fuente PRISMA ${fuente.clave}:`, error);
        }

        const filasPorProyecto = new Map();
        if (definicionTabla.disponible) {
            const { campos } = camposAgregadosFuente(fuente, definicionTabla, fuente.soportaPeriodo ? periodo : null);
            const condiciones = [`${citarIdentificadorSql(definicionTabla.enlaceProyecto)} = ANY($1::integer[])`];
            const parametros = [ids];

            if (fuente.clave === "beneficios" && periodo && fuente.soportaPeriodo) {
                const columnasDisponibles = definicionTabla.columnas;
                const desde = columnasDisponibles.get("vigente_desde");
                const hasta = columnasDisponibles.get("vigente_hasta");
                let paramInicio = null;
                let paramFin = null;
                if (hasta) {
                    parametros.push(periodo.inicio);
                    paramInicio = "$" + parametros.length + "::date";
                }
                if (desde) {
                    parametros.push(periodo.finExclusivo);
                    paramFin = "$" + parametros.length + "::date";
                }
                if (desde) {
                    const nombre = citarIdentificadorSql(desde);
                    condiciones.push(`(${nombre} IS NULL OR ${nombre} < ${paramFin})`);
                }
                if (hasta) {
                    const nombre = citarIdentificadorSql(hasta);
                    condiciones.push(`(${nombre} IS NULL OR ${nombre} >= ${paramInicio})`);
                }
            }

            if (campos.length || true) {
                const selectCampos = campos.length ? ", " + campos.join(", ") : "";
                const resultado = await prismaPool.query(
                    `SELECT ${citarIdentificadorSql(definicionTabla.enlaceProyecto)} AS proyecto_id, COUNT(*)::integer AS registros${selectCampos}
                     FROM ${citarIdentificadorSql(definicionTabla.tabla)}
                     WHERE ${condiciones.join(" AND ")}
                     GROUP BY ${citarIdentificadorSql(definicionTabla.enlaceProyecto)}`,
                    parametros
                );
                resultado.rows.forEach(fila => filasPorProyecto.set(Number(fila.proyecto_id), fila));
            }
        }

        ids.forEach(proyectoId => {
            const entrada = porProyecto.get(proyectoId);
            const indice = entrada.fuentes.findIndex(item => item.clave === fuente.clave);
            const fila = filasPorProyecto.get(proyectoId) || { registros: 0 };
            entrada.fuentes[indice] = {
                clave: fuente.clave,
                nombre: fuente.nombre,
                descripcion: fuente.descripcion,
                disponible: Boolean(definicionTabla && definicionTabla.disponible),
                tabla: definicionTabla ? definicionTabla.tabla : null,
                motivo: definicionTabla && !definicionTabla.disponible ? definicionTabla.motivo : null,
                variables: construirVariablesFuente(fuente, definicionTabla, fila)
            };
        });
    }

    return porProyecto;
}

function aplanarVariablesPrisma(catalogoProyecto) {
    if (!catalogoProyecto) return [];
    return (catalogoProyecto.fuentes || []).flatMap(fuente => fuente.variables || []);
}

async function consultarVariablesBeneficiosPorProyecto(proyectosIds, periodo = null) {
    const catalogos = await consultarVariablesPrismaPorProyecto(proyectosIds, periodo);
    return new Map([...catalogos.entries()].map(([proyectoId, catalogo]) => {
        const fuente = (catalogo.fuentes || []).find(item => item.clave === "beneficios");
        return [proyectoId, fuente ? fuente.variables : []];
    }));
}

async function consultarVariablesBeneficios(proyectoId) {
    const resultados = await consultarVariablesBeneficiosPorProyecto([proyectoId]);
    return resultados.get(proyectoId) || [];
}

async function consultarCatalogoVariablesPrisma(proyectoId) {
    const catalogos = await consultarVariablesPrismaPorProyecto([proyectoId]);
    return catalogos.get(proyectoId) || { proyecto_id: proyectoId, fuentes: [] };
}

// ---------- ESQUEMA (se actualiza solo al arrancar; seguro de repetir) ----------
// Regla de la base: SIN llaves foráneas. Solo se guardan datos, no relaciones.
async function prepararEsquema() {
    // 1. Quitar llaves foráneas heredadas solo de las tablas propias de MIDAS.
    await pool.query(`
        DO $$
        DECLARE r record;
        BEGIN
            FOR r IN
                SELECT c.conrelid::regclass AS t, c.conname
                FROM pg_constraint c
                JOIN pg_class tabla ON tabla.oid = c.conrelid
                JOIN pg_namespace esquema ON esquema.oid = tabla.relnamespace
                WHERE c.contype = 'f'
                  AND esquema.nspname = 'public'
                  AND tabla.relname IN ('variables', 'metrica', 'metrica_historica')
            LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
            END LOOP;
        END $$`);

    // 2. Variables: proyecto al que pertenecen (id y nombre de PRISMA, solo como dato)
    await pool.query(`ALTER TABLE public.variables
        ADD COLUMN IF NOT EXISTS proyecto_id INTEGER,
        ADD COLUMN IF NOT EXISTS proyecto_nombre VARCHAR(300)`);

    // 2b. El mismo nombre de variable puede repetirse entre proyectos y países;
    //     lo que no puede repetirse es nombre + proyecto + país
    await pool.query("DROP INDEX IF EXISTS public.uq_variables_nombre_pais");
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_variables_nombre_proyecto_pais
        ON public.variables (lower(nombre), COALESCE(pais_codigo, ''), COALESCE(proyecto_id, 0))`);

    // 3. Métricas: proyecto, tabla, formato y estado (borrador -> activa -> desactivada)
    await pool.query(`ALTER TABLE public.metrica
        ADD COLUMN IF NOT EXISTS proyecto_id INTEGER,
        ADD COLUMN IF NOT EXISTS proyecto_nombre VARCHAR(300),
        ADD COLUMN IF NOT EXISTS tipo_resultado VARCHAR(10),
        ADD COLUMN IF NOT EXISTS capa SMALLINT,
        ADD COLUMN IF NOT EXISTS grupo_global_id INTEGER,
        ADD COLUMN IF NOT EXISTS nombre_tabla VARCHAR(63),
        ADD COLUMN IF NOT EXISTS formato VARCHAR(10),
        ADD COLUMN IF NOT EXISTS estado VARCHAR(12) NOT NULL DEFAULT 'borrador',
        ADD COLUMN IF NOT EXISTS variables_usadas TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS metricas_usadas TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS enviada_en TIMESTAMP,
        ADD COLUMN IF NOT EXISTS desactivada_en TIMESTAMP,
        ADD COLUMN IF NOT EXISTS desactivada_por VARCHAR(100)`);

    await pool.query("UPDATE public.metrica SET capa = 3 WHERE capa IS NULL");
    await pool.query(`ALTER TABLE public.metrica
        ALTER COLUMN capa SET DEFAULT 1,
        ALTER COLUMN capa SET NOT NULL`);

    await pool.query(`UPDATE public.metrica m
        SET tipo_resultado = CASE WHEN EXISTS (
            SELECT 1
            FROM public.metrica otra
            WHERE lower(otra.nombre) = lower(m.nombre)
              AND COALESCE(otra.proyecto_id, 0) <> COALESCE(m.proyecto_id, 0)
        ) THEN 'global' ELSE 'unica' END
        WHERE m.tipo_resultado IS NULL`);
    await pool.query(`ALTER TABLE public.metrica
        ALTER COLUMN tipo_resultado SET DEFAULT 'unica',
        ALTER COLUMN tipo_resultado SET NOT NULL`);
    await pool.query("ALTER TABLE public.metrica DROP CONSTRAINT IF EXISTS metrica_tipo_resultado_check");
    await pool.query(`ALTER TABLE public.metrica
        ADD CONSTRAINT metrica_tipo_resultado_check
        CHECK (tipo_resultado IN ('global', 'unica'))`);
    await pool.query("ALTER TABLE public.metrica DROP CONSTRAINT IF EXISTS metrica_capa_check");
    await pool.query(`ALTER TABLE public.metrica
        ADD CONSTRAINT metrica_capa_check CHECK (capa BETWEEN 1 AND 3)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS public.grupo_metrica_global (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        descripcion VARCHAR(500),
        creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        editado_en TIMESTAMP
    )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grupo_metrica_global_nombre_uq
        ON public.grupo_metrica_global (lower(nombre))`);

    // Conserva la consolidación previa creando un grupo por cada nombre Global existente.
    await pool.query(`INSERT INTO public.grupo_metrica_global (nombre, descripcion)
        SELECT DISTINCT ON (lower(trim(nombre))) trim(nombre), NULLIF(trim(descripcion), '')
        FROM public.metrica
        WHERE tipo_resultado = 'global' AND trim(nombre) <> ''
        ORDER BY lower(trim(nombre)), id
        ON CONFLICT DO NOTHING`);
    await pool.query(`UPDATE public.metrica m
        SET grupo_global_id = g.id
        FROM public.grupo_metrica_global g
        WHERE m.tipo_resultado = 'global'
          AND m.grupo_global_id IS NULL
          AND lower(trim(m.nombre)) = lower(g.nombre)`);
    await pool.query(`UPDATE public.metrica SET grupo_global_id = NULL WHERE tipo_resultado = 'unica'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS metrica_grupo_global_idx
        ON public.metrica (grupo_global_id) WHERE tipo_resultado = 'global'`);

    // Métricas que ya existían (sin tabla): pasan a activas o desactivadas según estaban
    await pool.query(`UPDATE public.metrica
        SET estado = CASE WHEN habilitada THEN 'activa' ELSE 'desactivada' END,
            formato = 'texto', enviada_en = creado_en,
            desactivada_en = CASE WHEN habilitada THEN NULL ELSE COALESCE(habilitada_en, NOW()) END
        WHERE nombre_tabla IS NULL AND estado = 'borrador'`);

    // El nombre de una métrica puede repetirse entre proyectos; el de la tabla no
    await pool.query("ALTER TABLE public.metrica DROP CONSTRAINT IF EXISTS metrica_nombre_key");
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS metrica_nombre_proyecto_uq
        ON public.metrica (lower(nombre), COALESCE(proyecto_id, 0))`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS metrica_tabla_uq
        ON public.metrica (lower(nombre_tabla)) WHERE nombre_tabla IS NOT NULL`);
}

// ---------- ROLES ----------
// admin_super: edita, desactiva y elimina todo | admin: agrega data | usuario: solo consulta

const ROLES = ["admin_super", "admin", "usuario"];

// ---------- UTILIDADES DE VALIDACIÓN ----------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letras, números, espacios y los símbolos de una fórmula: + - * / ( ) . , % ^ = < >
const ECUACION_REGEX = /^[\p{L}\p{N}_\s+\-*/().,%^=<>]+$/u;

// Quita espacios y pasa a minúsculas, para que Admin@x.com y admin@x.com sean la misma cuenta
function normalizarEmail(valor) {
    return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

function textoLimpio(valor) {
    return typeof valor === "string" ? valor.trim() : "";
}

// Devuelve el id como número entero positivo, o null si no es válido
function idValido(valor) {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// Devuelve un mensaje de error, o null si todo está bien
function errorDatosUsuario(nombre, email) {
    if (nombre.length > 100) return "El nombre no puede superar 100 caracteres";
    if (email.length > 150) return "El correo no puede superar 150 caracteres";
    if (!EMAIL_REGEX.test(email)) return "El correo no es válido";
    if (!email.endsWith("@sonda.com")) return "El correo debe ser corporativo (@sonda.com)";
    return null;
}

function errorClave(password) {
    if (typeof password !== "string" || password.length < 8) {
        return "La contraseña debe tener al menos 8 caracteres";
    }
    if (password.length > 72) {
        return "La contraseña no puede superar 72 caracteres";
    }
    return null;
}

// Devuelve el número (puede ser negativo o decimal), o null si no es válido
function numeroDecimal(valor) {
    if (typeof valor !== "string" && typeof valor !== "number") return null;
    if (typeof valor === "string" && valor.trim() === "") return null;

    const n = Number(valor);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e13) return null; // cabe en NUMERIC(18,4)
    return n;
}

function datosVariable(body) {
    const nombre = textoLimpio(body.nombre);
    const valor = numeroDecimal(body.valor);
    const pais = textoLimpio(body.pais_codigo).toUpperCase();

    if (!nombre) return { error: "El nombre de la variable es obligatorio" };
    if (nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres" };
    if (valor === null) return { error: "El dato debe ser un número válido" };
    if (pais.length > 5) return { error: "El país no es válido" };

        return { nombre, valor, pais: pais || null };
    }

// true si el país está en la réplica de PRISMA y activo (o si no se indicó país)
async function paisValido(codigo) {
    if (!codigo) return true;
    const r = await prismaPool.query(
        "SELECT 1 FROM pais WHERE codigo = $1 AND activo = true",
        [codigo]
    );
    return r.rowCount > 0;
}

// Ejecuta varias consultas como una sola operación: o se guardan todas o ninguna
async function transaccion(trabajo) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const resultado = await trabajo(client);
        await client.query("COMMIT");
        return resultado;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ---------- LÍMITE DE INTENTOS (las rutas públicas) ----------
// Se guardan en memoria: al reiniciar el servidor los contadores vuelven a cero

const limitarLogin = rateLimit({
    windowMs: 15 * 60 * 1000,      // ventana de 15 minutos
    limit: 10,                     // 10 intentos fallidos por IP
    skipSuccessfulRequests: true,  // los logins correctos no cuentan
    standardHeaders: true,
    legacyHeaders: false,
    message: { mensaje: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }
});

const limitarRegistro = rateLimit({
    windowMs: 60 * 60 * 1000,      // ventana de 1 hora
    limit: 10,                     // 10 registros por IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { mensaje: "Demasiados registros desde este equipo. Inténtalo más tarde." }
});

// ---------- MIDDLEWARES ----------

async function verificarToken(req, res, next) {
    // El token llega así: "Authorization: Bearer eyJhbGci..."
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ mensaje: "Token requerido" });
    }

    // 1. Validar la firma y la fecha del token
    let datos;
    try {
        datos = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ mensaje: "Token inválido o expirado" });
    }

    // 2. Revisar en la base que la cuenta siga existiendo y activa
    //    (así, si un admin desactiva a alguien, su sesión abierta deja de servir)
    try {
        const result = await pool.query(
            "SELECT activo, rol FROM public.usuarios WHERE id = $1",
            [datos.id]
        );

        if (result.rows.length === 0 || !result.rows[0].activo) {
            return res.status(401).json({ mensaje: "Cuenta no disponible" });
        }

        // El rol se toma de la base y no del token, para que un cambio de rol
        // hecho por un admin aplique de inmediato aunque el token siga vivo
        req.user = { ...datos, rol: result.rows[0].rol };
        next(); // pasa a la ruta
    } catch (error) {
        // Un fallo de la base no debe cerrar la sesión del usuario
        console.error(error);
        return res.status(500).json({ mensaje: "Error del servidor" });
    }
}

// Deja pasar solo a los roles indicados. Siempre va DESPUÉS de verificarToken
function permitir(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.rol)) {
            return res.status(403).json({ mensaje: "No tienes permiso para esta acción" });
        }
        next();
    };
}

const soloSuper = permitir("admin_super");
const puedeAgregar = permitir("admin_super", "admin");

// ---------- DATOS DE LA SESIÓN ACTUAL ----------

// Rol y nombre actuales de quien tiene la sesión abierta (salen de la base, no del token)
app.get("/yo", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, nombre, email, rol FROM public.usuarios WHERE id = $1",
            [req.user.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- VARIABLES ----------

// Países disponibles (salen de la réplica de PRISMA)
app.get("/paises", verificarToken, async (req, res) => {
    try {
        const result = await prismaPool.query(
            "SELECT codigo, nombre FROM pais WHERE activo = true ORDER BY nombre"
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- PROYECTOS (salen de PRISMA, solo lectura) ----------
app.get("/proyectos", verificarToken, async (req, res) => {
    try {
        const result = await prismaPool.query(
            `SELECT i.id, i.nombre, p.nombre AS pais_nombre
             FROM iniciativas i
             LEFT JOIN pais p ON p.id = i.pais_id
             WHERE i.estado = 'Implementado' AND i.eliminado_en IS NULL
             ORDER BY i.nombre LIMIT 1000`
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Devuelve el nombre del proyecto si existe en PRISMA, o null
async function nombreProyecto(id) {
    const r = await prismaPool.query(
        "SELECT nombre FROM iniciativas WHERE id = $1 AND estado = 'Implementado' AND eliminado_en IS NULL",
        [id]
    );
    return r.rowCount ? r.rows[0].nombre : null;
}

// ---------- MOTOR DE ECUACIONES ----------
// Calcula con variables personalizadas, variables agregadas de PRISMA y métricas activas del proyecto.
// Sin eval: se lee a mano número por número.

class ErrorEcuacion extends Error {}

function construirContexto(proyectoId, variablesFilas, metricasFilas, variablesPrisma) {
    const variables = new Map();

    // Carga una lista de variables y devuelve qué nombres vio y cuáles vio repetidos.
    // Dentro del mismo proyecto, un nombre repetido solo puede ser de países distintos.
    function agregar(lista) {
        const vistos = new Set();
        const repetidas = new Set();
        lista.forEach(v => {
            const k = v.nombre.toLowerCase();
            if (vistos.has(k)) repetidas.add(k);
            vistos.add(k);
            variables.set(k, { nombre: v.nombre, valor: Number(v.valor) });
        });
        return { vistos, repetidas };
    }

    // Primero las generales; las del proyecto las reemplazan si se llaman igual
    const generales = agregar(variablesFilas.filter(v => v.proyecto_id === null));
    const delProyecto = agregar(variablesFilas.filter(v => v.proyecto_id === proyectoId));

    // Nombres ambiguos: repetidos (por país) y que nadie más resuelve.
    // Una general repetida no es problema si el proyecto tiene su propia variable con ese nombre.
    const ambiguas = new Set();
    generales.repetidas.forEach(k => { if (!delProyecto.vistos.has(k)) ambiguas.add(k); });
    delProyecto.repetidas.forEach(k => ambiguas.add(k));

    const metricas = new Map(metricasFilas.map(m => [m.nombre.toLowerCase(), m]));
    (variablesPrisma || []).forEach(variable => {
        const nombre = variable.nombre.toLowerCase();
        variables.delete(nombre);
        ambiguas.delete(nombre);
        if (variable.valor !== null && Number.isFinite(variable.valor)) {
            variables.set(nombre, {
                nombre: variable.nombre,
                valor: variable.valor
            });
        }
    });
    return { variables, metricas, ambiguas };
}

async function cargarContextos(proyectosIds, periodo = null) {
    const idsUnicos = [...new Set(proyectosIds)];
    if (!idsUnicos.length) return new Map();

    const idsNumericos = idsUnicos.filter(Number.isInteger);
    const [vars, mets, variablesPrisma] = await Promise.all([
        pool.query(
            `SELECT nombre, valor, proyecto_id FROM public.variables
             WHERE habilitada = true AND (proyecto_id = ANY($1::integer[]) OR proyecto_id IS NULL)`,
            [idsNumericos]
        ),
        pool.query(
            `SELECT nombre, ecuacion, proyecto_id FROM public.metrica
             WHERE estado = 'activa' AND proyecto_id = ANY($1::integer[])`,
            [idsNumericos]
        ),
        consultarVariablesPrismaPorProyecto(idsNumericos, periodo)
    ]);

    return new Map(idsUnicos.map(proyectoId => [
        proyectoId,
        construirContexto(
            proyectoId,
            vars.rows.filter(variable => variable.proyecto_id === null || variable.proyecto_id === proyectoId),
            mets.rows.filter(metrica => metrica.proyecto_id === proyectoId),
            aplanarVariablesPrisma(variablesPrisma.get(proyectoId))
        )
    ]));
}

async function cargarContexto(proyectoId) {
    const contextos = await cargarContextos([proyectoId]);
    return contextos.get(proyectoId);
}

const ES_PALABRA = /[\p{L}\p{N}_]/u;

function evaluar(texto, ctx, pila = []) {
    if (pila.length > 10) throw new ErrorEcuacion("Hay demasiadas métricas anidadas");

    const nombres = [...ctx.variables.keys(), ...ctx.metricas.keys()].sort((a, b) => b.length - a.length);
    const bajo = texto.toLowerCase();
    const usadas = [];
    const tokens = [];
    let i = 0;

    while (i < texto.length) {
        const c = texto[i];
        if (/\s/.test(c)) { i++; continue; }

        // 1. ¿Empieza aquí el nombre de una variable o de una métrica? (el más largo primero)
        const nombre = nombres.find(n =>
            bajo.startsWith(n, i) && !ES_PALABRA.test(texto[i + n.length] || ""));
        if (nombre) {
            if (ctx.variables.has(nombre)) {
                if (ctx.ambiguas.has(nombre)) {
                    throw new ErrorEcuacion('La variable "' + nombre + '" existe para varios países en este proyecto. Desactiva las que sobren o usa nombres distintos (ej. "' + nombre + ' CO")');
                }
                const v = ctx.variables.get(nombre);
                tokens.push({ t: "n", v: v.valor });
                usadas.push({ tipo: "variable", nombre: v.nombre, valor: v.valor });
            } else {
                if (pila.includes(nombre)) throw new ErrorEcuacion("Una métrica no puede llamarse a sí misma");
                const m = ctx.metricas.get(nombre);
                const interno = evaluar(m.ecuacion, ctx, [...pila, nombre]);
                tokens.push({ t: "n", v: interno.valor });
                usadas.push({ tipo: "metrica", nombre: m.nombre, valor: interno.valor });
            }
            i += nombre.length;
            continue;
        }

        // 2. Número (acepta 12,5 o 12.5)
        const num = /^\d+(?:[.,]\d+)?/.exec(texto.slice(i));
        if (num) {
            tokens.push({ t: "n", v: Number(num[0].replace(",", ".")) });
            i += num[0].length;
            continue;
        }

        // 3. Operadores
        if ("+-*/%^()".includes(c)) {
            tokens.push({ t: c });
            i++;
            continue;
        }

        // 4. Palabra desconocida u otro símbolo
        const palabra = /^[\p{L}\p{N}_]+/u.exec(texto.slice(i));
        if (palabra) {
            throw new ErrorEcuacion('"' + palabra[0] + '" no es una variable ni una métrica activa de este proyecto');
        }
        throw new ErrorEcuacion('Símbolo no permitido: "' + c + '" (usa + - * / % ^ y paréntesis)');
    }

    if (tokens.length === 0) throw new ErrorEcuacion("La ecuación está vacía");

    // Lector: suma/resta -> multiplicación/división/módulo -> potencia -> número o paréntesis
    let pos = 0;
    const mirar = () => tokens[pos] && tokens[pos].t;

    function suma() {
        let x = producto();
        while (mirar() === "+" || mirar() === "-") {
            const op = tokens[pos++].t;
            const y = producto();
            x = op === "+" ? x + y : x - y;
        }
        return x;
    }
    function producto() {
        let x = unario();
        while (mirar() === "*" || mirar() === "/" || mirar() === "%") {
            const op = tokens[pos++].t;
            const y = unario();
            if ((op === "/" || op === "%") && y === 0) {
                throw new ErrorEcuacion(op === "/" ? "División entre cero" : "No se puede calcular módulo entre cero");
            }
            x = op === "*" ? x * y : op === "/" ? x / y : x % y;
        }
        return x;
    }
    function unario() {
        if (mirar() === "-") { pos++; return -unario(); }
        if (mirar() === "+") { pos++; return unario(); }
        return potencia();
    }
    function potencia() {
        const base = primario();
        if (mirar() === "^") { pos++; return Math.pow(base, unario()); }
        return base;
    }
    function primario() {
        const tk = tokens[pos];
        if (!tk) throw new ErrorEcuacion("La ecuación está incompleta (falta un valor al final)");
        if (tk.t === "n") { pos++; return tk.v; }
        if (tk.t === "(") {
            pos++;
            const x = suma();
            if (mirar() !== ")") throw new ErrorEcuacion("Falta cerrar un paréntesis");
            pos++;
            return x;
        }
        throw new ErrorEcuacion('Operador "' + tk.t + '" en un lugar donde se esperaba un valor');
    }

    const valor = suma();
    if (pos < tokens.length) {
        throw new ErrorEcuacion(tokens[pos].t === ")" ? "Sobra un paréntesis" : "Falta un operador entre dos valores");
    }
    if (!Number.isFinite(valor)) throw new ErrorEcuacion("El resultado no es un número válido");

    // Detalle sin repetidos
    const vistos = new Set();
    const detalle = usadas.filter(u => { const k = u.tipo + u.nombre; if (vistos.has(k)) return false; vistos.add(k); return true; });
    return { valor: Math.round(valor * 1e6) / 1e6, detalle };
}

// Valida y calcula; devuelve {valor, detalle} o lanza ErrorEcuacion
async function calcular(ecuacion, proyectoId) {
    const ctx = await cargarContexto(proyectoId);
    return evaluar(ecuacion, ctx);
}

// ---------- VARIABLES ----------

// ¿Alguna métrica ya enviada usa esta variable? Entonces queda bloqueada
const SQL_EN_USO = `EXISTS (
    SELECT 1 FROM public.metrica m
    WHERE m.estado <> 'borrador'
      AND lower(v.nombre) = ANY (m.variables_usadas))`;

async function variableEnUso(id) {
    const r = await pool.query(`SELECT ${SQL_EN_USO} AS en_uso FROM public.variables v WHERE v.id = $1`, [id]);
    return r.rowCount > 0 && r.rows[0].en_uso;
}

const MSG_BLOQUEADA = "Esta variable ya se usa en una métrica enviada: ya no se puede modificar";
const MSG_VARIABLE_REPETIDA = "Ya existe una variable con ese nombre y país";

async function variableRepetida(nombre, pais, id = null) {
    const result = await pool.query(
        `SELECT EXISTS (
            SELECT 1 FROM public.variables
            WHERE lower(nombre) = lower($1)
              AND COALESCE(pais_codigo, '') = COALESCE($2, '')
              AND ($3::integer IS NULL OR id <> $3)
        ) AS repetida`,
        [nombre, pais, id]
    );
    return result.rows[0].repetida;
}

app.get("/variables", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.id, v.nombre, v.valor, v.pais_codigo,
                    v.proyecto_id, v.proyecto_nombre, ${SQL_EN_USO} AS en_uso,
                    v.habilitada, v.creado_en, v.editado_en, v.habilitada_en,
                    uc.nombre AS creado_por, um.nombre AS modificado_por
             FROM public.variables v
             LEFT JOIN public.usuarios uc ON uc.id = v.creado_por
             LEFT JOIN public.usuarios um ON um.id = v.modificado_por
             ORDER BY v.id`
        );

        // El nombre del país viene de PRISMA (otra conexión); si no responde, se muestra el código
        try {
            const paises = new Map((await prismaPool.query("SELECT codigo, nombre FROM pais")).rows.map(p => [p.codigo, p.nombre]));
            result.rows.forEach(r => { r.pais = paises.get(r.pais_codigo) || null; });
        } catch (e) {
            console.error("No se pudo leer PRISMA:", e.message);
        }
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

app.get("/variables/beneficios", verificarToken, async (req, res) => {
    const proyecto = idValido(req.query.proyecto_id);
    if (proyecto === null) return res.status(400).json({ mensaje: "Selecciona un proyecto válido" });
    try {
        const variables = await consultarVariablesBeneficios(proyecto);
        res.json(variables);
    } catch (error) {
        console.error("No se pudieron cargar las variables de BENEFICIOS:", error);
        if (error.code === "BENEFICIOS_SCHEMA_INVALID") {
            return res.status(422).json({ mensaje: error.message });
        }
        res.status(500).json({ mensaje: "No se pudo consultar BENEFICIOS en PRISMA. Revisa la conexión y el esquema configurado." });
    }
});

app.get("/variables/prisma", verificarToken, async (req, res) => {
    const proyecto = idValido(req.query.proyecto_id);
    if (proyecto === null) return res.status(400).json({ mensaje: "Selecciona un proyecto válido" });
    try {
        const catalogo = await consultarCatalogoVariablesPrisma(proyecto);
        res.json(catalogo);
    } catch (error) {
        console.error("No se pudo cargar el catálogo de variables de PRISMA:", error);
        if (error.code === "BENEFICIOS_SCHEMA_INVALID") {
            return res.status(422).json({ mensaje: error.message });
        }
        res.status(500).json({ mensaje: "No se pudo consultar las fuentes de variables en PRISMA. Revisa la conexión y el esquema configurado." });
    }
});

// Agregar: admin_super y admin
app.post("/variables", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const datos = datosVariable(req.body || {});
        if (datos.error) return res.status(400).json({ mensaje: datos.error });
        if (!(await paisValido(datos.pais))) {
            return res.status(400).json({ mensaje: "El país no existe en PRISMA" });
        }
        if (await variableRepetida(datos.nombre, datos.pais)) {
            return res.status(409).json({ mensaje: MSG_VARIABLE_REPETIDA });
        }
        const result = await pool.query(
            `INSERT INTO public.variables (nombre, valor, pais_codigo, proyecto_id, proyecto_nombre, creado_por)
             VALUES ($1, $2, $3, NULL, NULL, $4)
             RETURNING id`,
            [datos.nombre, datos.valor, datos.pais, req.user.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: MSG_VARIABLE_REPETIDA });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Editar: solo admin_super y solo antes de que una métrica enviada la use
app.put("/variables/:id", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const datos = datosVariable(req.body || {});
        if (datos.error) return res.status(400).json({ mensaje: datos.error });
        if (!(await paisValido(datos.pais))) {
            return res.status(400).json({ mensaje: "El país no existe en PRISMA" });
        }
        if (await variableEnUso(id)) return res.status(409).json({ mensaje: MSG_BLOQUEADA });
        if (await variableRepetida(datos.nombre, datos.pais, id)) {
            return res.status(409).json({ mensaje: MSG_VARIABLE_REPETIDA });
        }

        const result = await pool.query(
            `UPDATE public.variables
             SET nombre = $1, valor = $2, pais_codigo = $3, proyecto_id = NULL, proyecto_nombre = NULL,
                 editado_en = NOW(), modificado_por = $4
             WHERE id = $5
             RETURNING id`,
            [datos.nombre, datos.valor, datos.pais, req.user.id, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ mensaje: "Variable no encontrada" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: MSG_VARIABLE_REPETIDA });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Desactivar o reactivar: solo admin_super y solo si ninguna métrica enviada la usa
function cambiarEstadoVariable(habilitada) {
    return async (req, res) => {
        try {
            const id = idValido(req.params.id);
            if (id === null) return res.status(400).json({ mensaje: "Id inválido" });
            if (await variableEnUso(id)) return res.status(409).json({ mensaje: MSG_BLOQUEADA });

            const result = await pool.query(
                `UPDATE public.variables
                 SET habilitada = $1, habilitada_en = NOW(), modificado_por = $2
                 WHERE id = $3 AND habilitada <> $1
                 RETURNING id`,
                [habilitada, req.user.id, id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ mensaje: "Variable no encontrada o ya estaba en ese estado" });
            }
            res.json({ mensaje: "Estado actualizado" });
        } catch (error) {
            console.error(error);
            res.status(500).json({ mensaje: "Error del servidor" });
        }
    };
}

app.patch("/variables/:id/desactivar", verificarToken, soloSuper, cambiarEstadoVariable(false));
app.patch("/variables/:id/activar", verificarToken, soloSuper, cambiarEstadoVariable(true));

// Eliminar: solo admin_super y solo variables ya desactivadas
app.delete("/variables/:id", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });
        if (await variableEnUso(id)) return res.status(409).json({ mensaje: MSG_BLOQUEADA });

        const result = await pool.query(
            "DELETE FROM public.variables WHERE id = $1 AND habilitada = false",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(400).json({ mensaje: "Solo se pueden eliminar variables desactivadas" });
        }
        res.json({ mensaje: "Variable eliminada" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- GRUPOS DE MÉTRICAS GLOBALES ----------
function datosGrupoGlobal(body) {
    const nombre = textoLimpio(body.nombre);
    const descripcion = textoLimpio(body.descripcion);
    if (!nombre) return { error: "El nombre del grupo es obligatorio" };
    if (nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres" };
    if (descripcion.length > 500) return { error: "La descripción no puede superar 500 caracteres" };
    return { nombre, descripcion: descripcion || null };
}

app.get("/grupos-globales", verificarToken, async (req, res) => {
    try {
        const resultado = await pool.query(
            `SELECT g.id, g.nombre, g.descripcion, g.creado_en, g.editado_en,
                    COUNT(m.id)::integer AS metricas_asignadas
             FROM public.grupo_metrica_global g
             LEFT JOIN public.metrica m ON m.grupo_global_id = g.id
             GROUP BY g.id
             ORDER BY lower(g.nombre), g.id`
        );
        res.json(resultado.rows);
    } catch (error) {
        console.error("No se pudieron cargar los grupos Globales:", error);
        res.status(500).json({ mensaje: "No se pudieron cargar los grupos Globales" });
    }
});

app.post("/grupos-globales", verificarToken, puedeAgregar, async (req, res) => {
    const datos = datosGrupoGlobal(req.body || {});
    if (datos.error) return res.status(400).json({ mensaje: datos.error });
    try {
        const resultado = await pool.query(
            `INSERT INTO public.grupo_metrica_global (nombre, descripcion)
             VALUES ($1, $2)
             RETURNING id, nombre, descripcion`,
            [datos.nombre, datos.descripcion]
        );
        res.status(201).json(resultado.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe un grupo con ese nombre" });
        }
        console.error("No se pudo crear el grupo Global:", error);
        res.status(500).json({ mensaje: "No se pudo crear el grupo Global" });
    }
});

app.put("/grupos-globales/:id", verificarToken, soloSuper, async (req, res) => {
    const id = idValido(req.params.id);
    if (id === null) return res.status(400).json({ mensaje: "Id inválido" });
    const datos = datosGrupoGlobal(req.body || {});
    if (datos.error) return res.status(400).json({ mensaje: datos.error });
    try {
        const resultado = await pool.query(
            `UPDATE public.grupo_metrica_global
             SET nombre = $1, descripcion = $2, editado_en = NOW()
             WHERE id = $3
             RETURNING id, nombre, descripcion`,
            [datos.nombre, datos.descripcion, id]
        );
        if (!resultado.rowCount) return res.status(404).json({ mensaje: "Grupo Global no encontrado" });
        res.json(resultado.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe un grupo con ese nombre" });
        }
        console.error("No se pudo actualizar el grupo Global:", error);
        res.status(500).json({ mensaje: "No se pudo actualizar el grupo Global" });
    }
});

app.delete("/grupos-globales/:id", verificarToken, soloSuper, async (req, res) => {
    const id = idValido(req.params.id);
    if (id === null) return res.status(400).json({ mensaje: "Id inválido" });
    try {
        const resultado = await pool.query(
            `DELETE FROM public.grupo_metrica_global g
             WHERE g.id = $1
               AND NOT EXISTS (
                   SELECT 1 FROM public.metrica m WHERE m.grupo_global_id = g.id
               )
             RETURNING g.id`,
            [id]
        );
        if (resultado.rowCount) return res.json({ mensaje: "Grupo Global eliminado" });

        const existe = await pool.query("SELECT 1 FROM public.grupo_metrica_global WHERE id = $1", [id]);
        if (!existe.rowCount) return res.status(404).json({ mensaje: "Grupo Global no encontrado" });
        return res.status(409).json({
            mensaje: "No se puede eliminar un grupo que tiene métricas asignadas. Reasigna o elimina primero sus métricas."
        });
    } catch (error) {
        console.error("No se pudo eliminar el grupo Global:", error);
        res.status(500).json({ mensaje: "No se pudo eliminar el grupo Global" });
    }
});

// ---------- CÁLCULOS DE MÉTRICAS POR PROYECTO ----------
// Flujo: borrador (se edita) -> rectificar y enviar -> activa (bloqueada) -> desactivada (va al historial)

const TABLA_REGEX = /^[a-z][a-z0-9_]{2,62}$/;

// Valida los campos de una métrica en borrador
async function datosMetrica(body) {
    const nombre = textoLimpio(body.nombre);
    const tabla = textoLimpio(body.nombre_tabla).toLowerCase();
    const ecuacion = textoLimpio(body.ecuacion);
    const descripcion = textoLimpio(body.descripcion);
    const proyecto = idValido(body.proyecto_id);
    const tipoResultado = body.tipo_resultado;
    const capa = body.capa === undefined ? 1 : Number(body.capa);
    const grupoGlobal = tipoResultado === "global" ? idValido(body.grupo_global_id) : null;

    if (proyecto === null) return { error: "Elige un proyecto" };
    if (!nombre) return { error: "El nombre de la métrica es obligatorio" };
    if (nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres" };
    if (tipoResultado !== "global" && tipoResultado !== "unica") {
        return { error: "Elige si el resultado de la métrica será Global o Único" };
    }
    if (!Number.isInteger(capa) || capa < 1 || capa > 3) {
        return { error: "Elige una capa válida entre 1 y 3" };
    }
    if (tipoResultado === "global" && grupoGlobal === null) {
        return { error: "Asigna la métrica Global a un grupo" };
    }
    if (!TABLA_REGEX.test(tabla)) {
        return { error: "El nombre de la tabla debe empezar con letra y usar solo minúsculas, números y guion bajo (3 a 63 caracteres). Ej: ahorro_horas_proyecto" };
    }
    if (!ecuacion) return { error: "La ecuación es obligatoria" };
    if (ecuacion.length > 500) return { error: "La ecuación no puede superar 500 caracteres" };
    if (descripcion.length > 500) return { error: "La descripción no puede superar 500 caracteres" };

    const proyectoNom = await nombreProyecto(proyecto);
    if (!proyectoNom) return { error: "El proyecto no existe o no está implementado en PRISMA" };
    if (grupoGlobal !== null) {
        const grupo = await pool.query("SELECT 1 FROM public.grupo_metrica_global WHERE id = $1", [grupoGlobal]);
        if (!grupo.rowCount) return { error: "El grupo Global seleccionado no existe" };
    }

    try {
        await calcular(ecuacion, proyecto); // la ecuación debe poder calcularse
    } catch (e) {
        if (e instanceof ErrorEcuacion) return { error: "Ecuación: " + e.message };
        throw e;
    }
    return {
        nombre,
        tabla,
        ecuacion,
        descripcion: descripcion || null,
        proyecto,
        proyectoNom,
        tipoResultado,
        capa,
        grupoGlobal
    };
}

async function obtenerHorasAhorradasMensualesAcumuladas() {
    const fuenteBeneficios = FUENTES_VARIABLES_PRISMA.find(f => f.clave === "beneficios");
    let definicionBeneficios = null;
    try {
        definicionBeneficios = fuenteBeneficios ? await obtenerDefinicionFuentePrisma(fuenteBeneficios) : null;
    } catch (error) {
        console.error("No se pudo obtener la definición de BENEFICIOS para horas ahorradas mensuales:", error);
        return { disponible: false, motivo: "No se pudo consultar BENEFICIOS en PRISMA.", meses: [] };
    }

    if (!definicionBeneficios || !definicionBeneficios.disponible || !definicionBeneficios.tabla) {
        return {
            disponible: false,
            motivo: (definicionBeneficios && definicionBeneficios.motivo) || "La fuente BENEFICIOS no está disponible.",
            meses: []
        };
    }

    const columnas = definicionBeneficios.columnas;
    const tabla = citarIdentificadorSql(definicionBeneficios.tabla);
    const colPeriodicidad = columnas.get("periodicidad");
    const ajustarAnual = (expresion) => colPeriodicidad
        ? `CASE WHEN upper(${citarIdentificadorSql(colPeriodicidad)}) = 'ANUAL' THEN (${expresion}) / 12.0 ELSE (${expresion}) END`
        : `(${expresion})`;

    let expresionHoras = null;
    if (columnas.has("hh_obtenido")) {
        expresionHoras = ajustarAnual(citarIdentificadorSql(columnas.get("hh_obtenido")));
    } else if (columnas.has("tipo") && columnas.has("cantidad")) {
        const cantidad = ajustarAnual(citarIdentificadorSql(columnas.get("cantidad")));
        expresionHoras = `CASE WHEN upper(${citarIdentificadorSql(columnas.get("tipo"))}) = 'HH' THEN ${cantidad} ELSE 0 END`;
    } else {
        return {
            disponible: false,
            motivo: "No hay datos de horas ahorradas (hh_obtenido/tipo-cantidad) en BENEFICIOS.",
            meses: []
        };
    }

    const colDesde = columnas.get("vigente_desde") || null;
    const colHasta = columnas.get("vigente_hasta") || null;
    const tieneVigencia = Boolean(colDesde || colHasta);

    try {
        let inicioSerie = null;
        let finSerie = null;
        if (tieneVigencia) {
            const exprMin = colDesde ? citarIdentificadorSql(colDesde) : citarIdentificadorSql(colHasta);
            const exprMax = colHasta ? citarIdentificadorSql(colHasta) : citarIdentificadorSql(colDesde);
            const rango = await prismaPool.query(
                `SELECT
                    MIN(${exprMin})::timestamptz AS fecha_min,
                    MAX(COALESCE(${exprMax}, CURRENT_DATE))::timestamptz AS fecha_max
                 FROM ${tabla}`
            );
            const fechaMin = rango.rows[0] && rango.rows[0].fecha_min ? new Date(rango.rows[0].fecha_min) : null;
            const fechaMax = rango.rows[0] && rango.rows[0].fecha_max ? new Date(rango.rows[0].fecha_max) : null;
            if (fechaMin && fechaMax && !Number.isNaN(fechaMin.getTime()) && !Number.isNaN(fechaMax.getTime())) {
                inicioSerie = new Date(Date.UTC(fechaMin.getUTCFullYear(), fechaMin.getUTCMonth(), 1));
                const ahora = new Date();
                const finDatos = new Date(Date.UTC(fechaMax.getUTCFullYear(), fechaMax.getUTCMonth(), 1));
                const finActual = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
                finSerie = finDatos > finActual ? finDatos : finActual;
            }
        }

        if (!inicioSerie || !finSerie || inicioSerie > finSerie) {
            const ahora = new Date();
            finSerie = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
            inicioSerie = new Date(Date.UTC(finSerie.getUTCFullYear(), finSerie.getUTCMonth() - 11, 1));
        }

        const maxMeses = 36;
        const totalMeses = (finSerie.getUTCFullYear() - inicioSerie.getUTCFullYear()) * 12 +
            (finSerie.getUTCMonth() - inicioSerie.getUTCMonth()) + 1;
        if (totalMeses > maxMeses) {
            inicioSerie = new Date(Date.UTC(finSerie.getUTCFullYear(), finSerie.getUTCMonth() - (maxMeses - 1), 1));
        }

        const meses = [];
        let cursor = new Date(inicioSerie);
        while (cursor <= finSerie) {
            meses.push({
                anio: cursor.getUTCFullYear(),
                mes: cursor.getUTCMonth() + 1,
                inicio: new Date(cursor),
                finExclusivo: new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)),
                horas: 0,
                acumulado: 0
            });
            cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
        }

        if (!tieneVigencia) {
            const total = await prismaPool.query(
                `SELECT COALESCE(SUM(${expresionHoras}), 0)::numeric AS total FROM ${tabla}`
            );
            const valorTotal = Number(total.rows[0] && total.rows[0].total) || 0;
            if (meses.length) meses[meses.length - 1].horas = valorTotal;
        } else {
            const selectCols = [`(${expresionHoras})::numeric AS valor`];
            if (colDesde) selectCols.push(`${citarIdentificadorSql(colDesde)}::timestamptz AS desde`);
            if (colHasta) selectCols.push(`${citarIdentificadorSql(colHasta)}::timestamptz AS hasta`);
            const finSerieExclusivo = new Date(Date.UTC(finSerie.getUTCFullYear(), finSerie.getUTCMonth() + 1, 1));
            const condiciones = [];
            const params = [];
            if (colDesde) {
                params.push(finSerieExclusivo.toISOString());
                condiciones.push(`(${citarIdentificadorSql(colDesde)} IS NULL OR ${citarIdentificadorSql(colDesde)} < $${params.length}::timestamptz)`);
            }
            if (colHasta) {
                params.push(inicioSerie.toISOString());
                condiciones.push(`(${citarIdentificadorSql(colHasta)} IS NULL OR ${citarIdentificadorSql(colHasta)} >= $${params.length}::timestamptz)`);
            }
            const where = condiciones.length ? ` WHERE ${condiciones.join(" AND ")}` : "";
            const filas = await prismaPool.query(
                `SELECT ${selectCols.join(", ")} FROM ${tabla}${where}`,
                params
            );

            const aFecha = (valor) => {
                if (!valor) return null;
                const fecha = valor instanceof Date ? valor : new Date(valor);
                return Number.isNaN(fecha.getTime()) ? null : fecha;
            };

            for (const fila of filas.rows) {
                const valor = Number(fila.valor) || 0;
                if (!valor) continue;
                const desde = aFecha(fila.desde);
                const hasta = aFecha(fila.hasta);
                for (const bucket of meses) {
                    const iniciaAntesDeFinMes = !desde || desde < bucket.finExclusivo;
                    const terminaDespuesDeInicioMes = !hasta || hasta >= bucket.inicio;
                    if (iniciaAntesDeFinMes && terminaDespuesDeInicioMes) {
                        bucket.horas += valor;
                    }
                }
            }
        }

        let acumulado = 0;
        const resultadoMeses = meses.map(bucket => {
            const horas = Math.round((Number(bucket.horas) || 0) * 100) / 100;
            acumulado += horas;
            return {
                anio: bucket.anio,
                mes: bucket.mes,
                horas,
                acumulado: Math.round(acumulado * 100) / 100
            };
        });

        return {
            disponible: true,
            fuente_temporal: tieneVigencia ? "vigencias" : "sin_vigencias",
            meses: resultadoMeses,
            total_acumulado: Math.round(acumulado * 100) / 100
        };
    } catch (error) {
        console.error("No se pudo calcular las horas ahorradas mensuales acumuladas:", error);
        return { disponible: false, motivo: "No se pudo calcular la serie mensual de horas ahorradas.", meses: [] };
    }
}
async function obtenerResumenDashboard() {
    if (cacheResumenDashboard && Date.now() - cacheResumenDashboard.creadoEn < TIEMPO_CACHE_RESUMEN_MS) {
        return cacheResumenDashboard.datos;
    }

    const [metricas, proyectos] = await Promise.all([
        pool.query(
            `SELECT m.id, m.nombre, m.proyecto_id, m.proyecto_nombre, m.tipo_resultado, m.capa,
                    m.grupo_global_id, g.nombre AS grupo_global_nombre,
                    g.descripcion AS grupo_global_descripcion, m.ecuacion, m.descripcion
             FROM public.metrica m
             LEFT JOIN public.grupo_metrica_global g ON g.id = m.grupo_global_id
             WHERE m.estado = 'activa'
             ORDER BY m.enviada_en DESC NULLS LAST, m.id DESC`
        ),
        prismaPool.query(
            "SELECT COUNT(*)::integer AS total FROM iniciativas WHERE eliminado_en IS NULL"
        ).catch(error => {
            console.error("No se pudo contar los proyectos de PRISMA:", error.message);
            return null;
        })
    ]);

    const paisesPorProyecto = new Map();
    let contextos = new Map();
    if (metricas.rows.length) {
        const idsProyecto = metricas.rows.map(metrica => metrica.proyecto_id);
        const [datosPaises, contextosCargados] = await Promise.all([
            prismaPool.query(
                `SELECT i.id, p.nombre AS pais_nombre
                 FROM iniciativas i
                 LEFT JOIN pais p ON p.id = i.pais_id
                 WHERE i.id = ANY($1::integer[])`,
                [idsProyecto.filter(Number.isInteger)]
            ).catch(error => {
                console.error("No se pudieron cargar los países de los proyectos:", error.message);
                return { rows: [] };
            }),
            cargarContextos(idsProyecto)
        ]);
        datosPaises.rows.forEach(proyecto => paisesPorProyecto.set(proyecto.id, proyecto.pais_nombre));
        contextos = contextosCargados;
    }

    const resultados = metricas.rows.map(metrica => {
        try {
            const contexto = contextos.get(metrica.proyecto_id);
            if (!contexto) throw new Error("No se encontró el contexto del proyecto " + metrica.proyecto_id);
            const resultado = evaluar(metrica.ecuacion, contexto);
            return {
                id: metrica.id,
                nombre: metrica.nombre,
                proyecto_id: metrica.proyecto_id,
                proyecto_nombre: metrica.proyecto_nombre,
                pais_nombre: paisesPorProyecto.get(metrica.proyecto_id) || null,
                tipo_resultado: metrica.tipo_resultado,
                capa: metrica.capa,
                grupo_global_id: metrica.grupo_global_id,
                grupo_global_nombre: metrica.grupo_global_nombre,
                grupo_global_descripcion: metrica.grupo_global_descripcion,
                descripcion: metrica.descripcion,
                valor: resultado.valor,
                error: null
            };
        } catch (error) {
            if (!(error instanceof ErrorEcuacion)) throw error;
            return {
                id: metrica.id,
                nombre: metrica.nombre,
                proyecto_id: metrica.proyecto_id,
                proyecto_nombre: metrica.proyecto_nombre,
                pais_nombre: paisesPorProyecto.get(metrica.proyecto_id) || null,
                tipo_resultado: metrica.tipo_resultado,
                capa: metrica.capa,
                grupo_global_id: metrica.grupo_global_id,
                grupo_global_nombre: metrica.grupo_global_nombre,
                grupo_global_descripcion: metrica.grupo_global_descripcion,
                descripcion: metrica.descripcion,
                valor: null,
                error: "No se pudo calcular esta métrica con los datos actuales."
            };
        }
    });

    const resumen = {
        total_metricas: metricas.rows.length,
        total_proyectos: new Set(metricas.rows.map(metrica => metrica.proyecto_id).filter(id => id !== null)).size,
        proyectos_prisma: proyectos ? proyectos.rows[0].total : null,
        metricas: resultados
    };
    cacheResumenDashboard = { creadoEn: Date.now(), datos: resumen };
    return resumen;
}

app.get("/dashboard/resumen", verificarToken, async (req, res) => {
    try {
        const resumen = await obtenerResumenDashboard();
        res.set("Cache-Control", "private, max-age=0, must-revalidate");
        res.json(resumen);
    } catch (error) {
        console.error("No se pudo generar el resumen del dashboard:", error);
        res.status(500).json({ mensaje: "No se pudo cargar el resumen" });
    }
});

app.get("/dashboard/horas-ahorradas-acumuladas", verificarToken, async (req, res) => {
    try {
        if (cacheHorasAhorradasAcumuladas && Date.now() - cacheHorasAhorradasAcumuladas.creadoEn < TIEMPO_CACHE_RESUMEN_MS) {
            res.set("Cache-Control", "private, max-age=0, must-revalidate");
            return res.json(cacheHorasAhorradasAcumuladas.datos);
        }
        const datos = await Promise.race([
            obtenerHorasAhorradasMensualesAcumuladas().catch(error => {
                console.error("No se pudo obtener horas ahorradas acumuladas:", error);
                return { disponible: false, motivo: "No se pudo calcular la serie mensual.", meses: [] };
            }),
            new Promise(resolve => setTimeout(() => resolve({
                disponible: false,
                motivo: "Tiempo de espera agotado al calcular horas ahorradas.",
                meses: []
            }), 8000))
        ]);
        cacheHorasAhorradasAcumuladas = { creadoEn: Date.now(), datos };
        res.set("Cache-Control", "private, max-age=0, must-revalidate");
        res.json(datos);
    } catch (error) {
        console.error("No se pudo generar horas ahorradas acumuladas:", error);
        res.status(500).json({ disponible: false, motivo: "No se pudo cargar las horas ahorradas.", meses: [] });
    }
});

app.get("/dashboard/comparacion-mensual", verificarToken, async (req, res) => {
    const leerPeriodo = (prefijo) => {
        const mesTexto = String(req.query["mes_" + prefijo] ?? "");
        const anioTexto = String(req.query["anio_" + prefijo] ?? "");
        const mes = Number(mesTexto);
        const anio = Number(anioTexto);
        if (!/^\d{1,2}$/.test(mesTexto) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
        if (!/^\d{4}$/.test(anioTexto) || !Number.isInteger(anio) || anio < 1900 || anio > 2100) return null;
        return { mes, anio };
    };

    const periodoA = leerPeriodo("a");
    const periodoB = leerPeriodo("b");
    if (!periodoA || !periodoB) {
        res.locals.mensajeLogSistema = "Comparación mensual con periodos inválidos";
        return res.status(400).json({ mensaje: "Selecciona dos periodos válidos (mes y año) para comparar." });
    }
    if (periodoA.anio === periodoB.anio && periodoA.mes === periodoB.mes) {
        res.locals.mensajeLogSistema = "Comparación mensual con periodos iguales";
        return res.status(400).json({ mensaje: "Selecciona dos periodos diferentes para comparar." });
    }

    const periodos = [periodoA, periodoB];

    try {
        const fuenteBeneficios = FUENTES_VARIABLES_PRISMA.find(f => f.clave === "beneficios");
        let definicionBeneficios = null;
        try {
            definicionBeneficios = fuenteBeneficios ? await obtenerDefinicionFuentePrisma(fuenteBeneficios) : null;
        } catch (error) {
            console.error("No se pudo obtener la definición de BENEFICIOS para comparación mensual:", error);
            definicionBeneficios = null;
        }
        const columnasBeneficios = definicionBeneficios?.disponible ? definicionBeneficios.columnas : new Map();
        const colDesde = columnasBeneficios.get("vigente_desde") || null;
        const colHasta = columnasBeneficios.get("vigente_hasta") || null;
        const tieneVigenciaDesde = Boolean(colDesde);
        const tieneVigenciaHasta = Boolean(colHasta);

        const resultadoMetricas = await pool.query(
            `SELECT m.id, m.nombre, m.ecuacion, m.proyecto_id, m.grupo_global_id,
                    g.nombre AS grupo_global_nombre, g.descripcion AS grupo_global_descripcion
             FROM public.metrica m
             JOIN public.grupo_metrica_global g ON g.id = m.grupo_global_id
             WHERE m.estado = 'activa'
               AND m.tipo_resultado = 'global'
               AND m.grupo_global_id IS NOT NULL
             ORDER BY lower(g.nombre), g.id, lower(m.nombre), m.id`
        );
        const metricas = resultadoMetricas.rows;
        const grupos = [...new Map(metricas.map(metrica => [
            metrica.grupo_global_id,
            {
                id: metrica.grupo_global_id,
                nombre: metrica.grupo_global_nombre,
                descripcion: metrica.grupo_global_descripcion,
                metricas_asignadas: metricas.filter(item => item.grupo_global_id === metrica.grupo_global_id).length
            }
        ])).values()];
        const proyectosIds = [...new Set(metricas
            .map(metrica => metrica.proyecto_id)
            .filter(Number.isInteger))];

        const coberturaPorAnio = new Map();
        if (proyectosIds.length && definicionBeneficios?.disponible && definicionBeneficios.enlaceProyecto && definicionBeneficios.tabla) {
            const anios = [...new Set(periodos.map(p => p.anio))];
            for (const anio of anios) {
                const enlace = `"${String(definicionBeneficios.enlaceProyecto).replace(/"/g, '""')}"`;
                const tabla = `"${String(definicionBeneficios.tabla).replace(/"/g, '""')}"`;
                const condicionesPeriodo = [`${enlace} = ANY($1::integer[])`];
                const parametrosPeriodo = [proyectosIds];
                const inicioAnio = anio + "-01-01";
                const finAnio = (anio + 1) + "-01-01";
                const checksVigencia = [];

                if (colDesde) {
                    const desde = `"${String(colDesde).replace(/"/g, '""')}"`;
                    parametrosPeriodo.push(finAnio);
                    condicionesPeriodo.push(`(${desde} IS NULL OR ${desde} < $${parametrosPeriodo.length}::date)`);
                    checksVigencia.push(`${desde} IS NOT NULL`);
                }
                if (colHasta) {
                    const hasta = `"${String(colHasta).replace(/"/g, '""')}"`;
                    parametrosPeriodo.push(inicioAnio);
                    condicionesPeriodo.push(`(${hasta} IS NULL OR ${hasta} >= $${parametrosPeriodo.length}::date)`);
                    checksVigencia.push(`${hasta} IS NOT NULL`);
                }

                const temporal = await prismaPool.query(
                    `SELECT COUNT(*)::integer AS registros_en_anio,
                            COUNT(*) FILTER (WHERE ${checksVigencia.length ? "(" + checksVigencia.join(" OR ") + ")" : "false"})::integer AS registros_con_vigencia
                     FROM ${tabla}
                     WHERE ${condicionesPeriodo.join(" AND ")}`,
                    parametrosPeriodo
                );
                coberturaPorAnio.set(anio, temporal.rows[0] || { registros_en_anio: 0, registros_con_vigencia: 0 });
            }
        } else {
            // Sin fuente BENEFICIOS disponible: no podemos calcular cobertura temporal desde PRISMA.
            for (const anio of [...new Set(periodos.map(p => p.anio))]) {
                coberturaPorAnio.set(anio, { registros_en_anio: 0, registros_con_vigencia: 0 });
            }
        }

        const resultados = [];
        for (const periodo of periodos) {
            const inicioDate = new Date(Date.UTC(periodo.anio, periodo.mes - 1, 1));
            const finDate = new Date(Date.UTC(periodo.anio, periodo.mes, 1));
            const rango = {
                inicio: inicioDate.toISOString().slice(0, 10),
                finExclusivo: finDate.toISOString().slice(0, 10)
            };
            const contextos = await cargarContextos(proyectosIds, rango);
            const valoresPorGrupo = new Map(grupos.map(grupo => [
                grupo.id,
                { valor: 0, metricas: 0, errores: 0 }
            ]));

            metricas.forEach(metrica => {
                const acumulado = valoresPorGrupo.get(metrica.grupo_global_id);
                const contexto = contextos.get(metrica.proyecto_id);
                if (!acumulado || !contexto) {
                    if (acumulado) acumulado.errores++;
                    return;
                }
                try {
                    acumulado.valor += evaluar(metrica.ecuacion, contexto).valor;
                    acumulado.metricas++;
                } catch (error) {
                    if (!(error instanceof ErrorEcuacion)) throw error;
                    acumulado.errores++;
                }
            });

            resultados.push({
                mes: periodo.mes,
                anio: periodo.anio,
                cobertura_anio: coberturaPorAnio.get(periodo.anio) || { registros_en_anio: 0, registros_con_vigencia: 0 },
                valores: grupos.map(grupo => {
                    const acumulado = valoresPorGrupo.get(grupo.id);
                    return {
                        grupo_id: grupo.id,
                        valor: acumulado.metricas ? acumulado.valor : null,
                        metricas_calculadas: acumulado.metricas,
                        metricas_con_error: acumulado.errores
                    };
                })
            });
        }

        registrarLogSistema({
            nivel: "info",
            origen: "dashboard",
            accion: "GET /dashboard/comparacion-mensual",
            mensaje: "Comparación mensual consultada",
            detalle: "Periodos: " + periodoA.mes + "/" + periodoA.anio + " vs " + periodoB.mes + "/" + periodoB.anio,
            usuario: req.user,
            ip: req.ip
        });
        res.set("Cache-Control", "private, max-age=0, must-revalidate");
        res.json({
            periodicidad: "mensual",
            periodos: periodos.map(p => ({ mes: p.mes, anio: p.anio })),
            regla_anual: "cantidad anual dividida entre 12",
            fuente_temporal: tieneVigenciaDesde || tieneVigenciaHasta ? "vigencias" : "sin_vigencias",
            campos_vigencia: {
                desde: tieneVigenciaDesde,
                hasta: tieneVigenciaHasta
            },
            grupos,
            resultados
        });
    } catch (error) {
        console.error("No se pudo generar la comparación mensual:", error);
        const detalle = error && error.message ? String(error.message) : "error interno";
        res.status(500).json({ mensaje: "No se pudo cargar la comparación mensual: " + detalle });
    }
});

// Ver: cualquier usuario con sesión. Los borradores solo los ven admin_super y admin
// (el filtro se hace aquí, en el servidor; ocultarlos en pantalla no basta)
app.get("/calculos", verificarToken, async (req, res) => {
    try {
        const verBorradores = req.user.rol !== "usuario";
        const result = await pool.query(
            `SELECT m.id, m.nombre, m.nombre_tabla, m.proyecto_id, m.proyecto_nombre,
                    m.tipo_resultado, m.capa, m.grupo_global_id, g.nombre AS grupo_global_nombre,
                    g.descripcion AS grupo_global_descripcion, m.ecuacion, m.descripcion,
                    m.formato, m.estado, m.variables_usadas, m.creado_en, m.editado_en, m.enviada_en,
                    uc.nombre AS creado_por, um.nombre AS modificado_por
             FROM public.metrica m
             LEFT JOIN public.grupo_metrica_global g ON g.id = m.grupo_global_id
             LEFT JOIN public.usuarios uc ON uc.id = m.creado_por
             LEFT JOIN public.usuarios um ON um.id = m.modificado_por
             WHERE m.estado <> 'desactivada'
               AND ($1::boolean OR m.estado <> 'borrador')
             ORDER BY m.id`,
            [verBorradores]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Previsualizar: calcula sin guardar nada (para ver el resultado antes de guardar o enviar)
app.post("/calculos/previsualizar", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const proyecto = idValido((req.body || {}).proyecto_id);
        const ecuacion = textoLimpio((req.body || {}).ecuacion);
        if (proyecto === null) return res.status(400).json({ mensaje: "Elige un proyecto" });
        if (!ecuacion) return res.status(400).json({ mensaje: "Escribe la ecuación" });
        if (ecuacion.length > 500) return res.status(400).json({ mensaje: "La ecuación no puede superar 500 caracteres" });

        const r = await calcular(ecuacion, proyecto);
        res.json({ resultado: r.valor, detalle: r.detalle });
    } catch (error) {
        if (error instanceof ErrorEcuacion) return res.status(400).json({ mensaje: error.message });
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Crear borrador: admin_super y admin
app.post("/calculos", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const d = await datosMetrica(req.body || {});
        if (d.error) return res.status(400).json({ mensaje: d.error });

        const result = await pool.query(
            `INSERT INTO public.metrica (nombre, nombre_tabla, ecuacion, descripcion, proyecto_id, proyecto_nombre,
                                        tipo_resultado, capa, grupo_global_id, estado, habilitada, creado_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'borrador', false, $10)
             RETURNING id`,
            [d.nombre, d.tabla, d.ecuacion, d.descripcion, d.proyecto, d.proyectoNom,
               d.tipoResultado, d.capa, d.grupoGlobal, req.user.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe una métrica con ese nombre en el proyecto, o esa tabla ya está en uso" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Editar: SOLO borradores
app.put("/calculos/:id", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const actual = await pool.query("SELECT estado FROM public.metrica WHERE id = $1", [id]);
        if (actual.rowCount === 0) return res.status(404).json({ mensaje: "Métrica no encontrada" });
        if (actual.rows[0].estado !== "borrador") {
            return res.status(409).json({ mensaje: "Una métrica enviada ya no se puede modificar" });
        }

        const d = await datosMetrica(req.body || {});
        if (d.error) return res.status(400).json({ mensaje: d.error });

        await pool.query(
            `UPDATE public.metrica
             SET nombre = $1, nombre_tabla = $2, ecuacion = $3, descripcion = $4,
                 proyecto_id = $5, proyecto_nombre = $6, tipo_resultado = $7, capa = $8, grupo_global_id = $9,
                 editado_en = NOW(), modificado_por = $10
             WHERE id = $11 AND estado = 'borrador'`,
            [d.nombre, d.tabla, d.ecuacion, d.descripcion, d.proyecto, d.proyectoNom,
                d.tipoResultado, d.capa, d.grupoGlobal, req.user.id, id]
        );
        res.json({ mensaje: "Borrador actualizado" });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe una métrica con ese nombre en el proyecto, o esa tabla ya está en uso" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Enviar: el borrador pasa a activa y ya no se puede modificar. Aquí se elige texto plano o tabla
app.post("/calculos/:id/enviar", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const formato = (req.body || {}).formato;
        if (formato !== "texto" && formato !== "tabla") {
            return res.status(400).json({ mensaje: "Elige si se guarda como texto plano o como tabla" });
        }

        const m = await pool.query("SELECT * FROM public.metrica WHERE id = $1", [id]);
        if (m.rowCount === 0) return res.status(404).json({ mensaje: "Métrica no encontrada" });
        if (m.rows[0].estado !== "borrador") {
            return res.status(409).json({ mensaje: "Esta métrica ya fue enviada" });
        }

        let r;
        try {
            r = await calcular(m.rows[0].ecuacion, m.rows[0].proyecto_id);
        } catch (e) {
            if (e instanceof ErrorEcuacion) return res.status(400).json({ mensaje: "Ecuación: " + e.message });
            throw e;
        }
        const vars = r.detalle.filter(u => u.tipo === "variable").map(u => u.nombre.toLowerCase());
        const mets = r.detalle.filter(u => u.tipo === "metrica").map(u => u.nombre.toLowerCase());

        await pool.query(
            `UPDATE public.metrica
             SET estado = 'activa', habilitada = true, formato = $1, variables_usadas = $2, metricas_usadas = $3,
                 enviada_en = NOW(), habilitada_en = NOW(), modificado_por = $4
             WHERE id = $5 AND estado = 'borrador'`,
            [formato, vars, mets, req.user.id, id]
        );
        res.json({ mensaje: "Métrica enviada", resultado: r.valor });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Desactivar (pasa al historial) o activar de nuevo: solo admin_super. Nada más se puede cambiar
app.patch("/calculos/:id/desactivar", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const m = await pool.query("SELECT nombre, proyecto_id, estado FROM public.metrica WHERE id = $1", [id]);
        if (m.rowCount === 0) return res.status(404).json({ mensaje: "Métrica no encontrada" });
        if (m.rows[0].estado !== "activa") return res.status(409).json({ mensaje: "Solo se pueden desactivar métricas activas" });

        // Si otra métrica activa la usa, no se puede apagar
        const usa = await pool.query(
            `SELECT nombre FROM public.metrica
             WHERE estado = 'activa' AND proyecto_id = $1 AND id <> $2 AND $3 = ANY (metricas_usadas)`,
            [m.rows[0].proyecto_id, id, m.rows[0].nombre.toLowerCase()]
        );
        if (usa.rowCount > 0) {
            return res.status(409).json({ mensaje: "No se puede desactivar: la usa la métrica \"" + usa.rows[0].nombre + "\"" });
        }

        await pool.query(
            `UPDATE public.metrica
             SET estado = 'desactivada', habilitada = false, desactivada_en = NOW(), desactivada_por = $1,
                 habilitada_en = NOW(), modificado_por = $2
             WHERE id = $3`,
            [req.user.nombre, req.user.id, id]
        );
        res.json({ mensaje: "Estado actualizado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

app.patch("/calculos/:id/activar", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const m = await pool.query("SELECT ecuacion, proyecto_id, estado FROM public.metrica WHERE id = $1", [id]);
        if (m.rowCount === 0) return res.status(404).json({ mensaje: "Métrica no encontrada" });
        if (m.rows[0].estado !== "desactivada") return res.status(409).json({ mensaje: "Solo se pueden activar métricas desactivadas" });

        // Las métricas que llama deben seguir activas
        try {
            await calcular(m.rows[0].ecuacion, m.rows[0].proyecto_id);
        } catch (e) {
            if (e instanceof ErrorEcuacion) return res.status(409).json({ mensaje: "No se puede activar: " + e.message });
            throw e;
        }

        await pool.query(
            `UPDATE public.metrica
             SET estado = 'activa', habilitada = true, desactivada_en = NULL, desactivada_por = NULL,
                 habilitada_en = NOW(), modificado_por = $1
             WHERE id = $2`,
            [req.user.id, id]
        );
        res.json({ mensaje: "Estado actualizado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Eliminar: SOLO borradores
app.delete("/calculos/:id", verificarToken, puedeAgregar, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) return res.status(400).json({ mensaje: "Id inválido" });

        const result = await pool.query("DELETE FROM public.metrica WHERE id = $1 AND estado = 'borrador'", [id]);
        if (result.rowCount === 0) {
            return res.status(409).json({ mensaje: "Solo se pueden eliminar borradores" });
        }
        res.json({ mensaje: "Borrador eliminado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- HISTORIAL DE MÉTRICAS (solo las desactivadas) ----------

app.get("/historial", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.id, m.nombre, m.nombre_tabla, m.proyecto_nombre, m.tipo_resultado,
                    m.grupo_global_id, g.nombre AS grupo_global_nombre,
                    g.descripcion AS grupo_global_descripcion,
                    m.ecuacion, m.descripcion, m.formato, m.desactivada_en, m.desactivada_por
             FROM public.metrica m
             LEFT JOIN public.grupo_metrica_global g ON g.id = m.grupo_global_id
             WHERE m.estado = 'desactivada'
             ORDER BY m.desactivada_en DESC NULLS LAST, m.id DESC
             LIMIT 500`
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- LOGIN ----------

app.post("/login", limitarLogin, async (req, res) => {
    try {
        const body = req.body || {};

        // 1. Leer los datos que envía el cliente (el correo se normaliza)
        const email = normalizarEmail(body.email);
        const password = body.password;

        // 2. Validar que lleguen los dos
        if (!email || typeof password !== "string" || password === "") {
            return res.status(400).json({ mensaje: "Email y contraseña son obligatorios" });
        }

        // 3. Buscar el usuario por email (activo o no; el estado se revisa después)
        const result = await pool.query(
            "SELECT * FROM public.usuarios WHERE email = $1",
            [email]
        );

        // 4. Si no existe, mensaje genérico
        if (result.rows.length === 0) {
            res.locals.mensajeLogSistema = "Intento de inicio de sesión con correo no registrado";
            return res.status(401).json({ mensaje: "Credenciales inválidas" });
        }

        const usuario = result.rows[0];

        // 5. Comparar la clave escrita con el hash guardado
        const ok = await bcrypt.compare(password, usuario.password_hash);

        // 6. Si no coincide, el MISMO mensaje que arriba
        if (!ok) {
            res.locals.mensajeLogSistema = "Intento de inicio de sesión con contraseña incorrecta";
            return res.status(401).json({ mensaje: "Credenciales inválidas" });
        }

        // 7. Clave correcta pero cuenta desactivada o sin activar
        if (usuario.desactivado) {
            res.locals.mensajeLogSistema = "Intento de inicio de sesión con cuenta desactivada";
            return res.status(403).json({
                codigo: "DESACTIVADA",
                mensaje: "Warning: usuario con cuenta desactivada, debe comunicarse con el admin."
            });
        }
        if (!usuario.activo) {
            res.locals.mensajeLogSistema = "Intento de inicio de sesión con cuenta pendiente de activación";
            return res.status(403).json({ mensaje: "Tu cuenta está pendiente de activación por un administrador" });
        }

        // 8. Crear el token (sin contraseña ni hash adentro)
        const token = jwt.sign(
            { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES }
        );

        auditar(usuario, "iniciar sesión", "sesion", usuario.email, req.ip);
        registrarLogSistema({ nivel: "info", origen: "sesion", accion: "login", mensaje: "Inicio de sesión exitoso", detalle: usuario.email, usuario, ip: req.ip });

        // 9. Responder con el token y los datos básicos
        res.json({
            token,
            usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- REGISTRO PÚBLICO (la cuenta nace sin activar) ----------

app.post("/registro", limitarRegistro, async (req, res) => {
    try {
        const body = req.body || {};

        // Ojo: NO se lee "rol" del body. Quien se registra siempre es "usuario"
        const nombre = textoLimpio(body.nombre);
        const email = normalizarEmail(body.email);
        const password = body.password;

        // 1. Campos obligatorios
        if (!nombre || !email || typeof password !== "string" || password === "") {
            return res.status(400).json({ mensaje: "Nombre, email y contraseña son obligatorios" });
        }

        // 2. Nombre y correo
        const errorDatos = errorDatosUsuario(nombre, email);
        if (errorDatos) {
            return res.status(400).json({ mensaje: errorDatos });
        }

        // 3. Contraseña
        const errorPass = errorClave(password);
        if (errorPass) {
            return res.status(400).json({ mensaje: errorPass });
        }

        // 4. Hash de la contraseña
        const hash = await bcrypt.hash(password, 10);

        // 5. Insertar con activo = false y rol fijo "usuario"
        await pool.query(
            `INSERT INTO public.usuarios (nombre, email, password_hash, rol, activo)
             VALUES ($1, $2, $3, 'usuario', false)`,
            [nombre, email, hash]
        );

        registrarLogSistema({
            nivel: "info",
            origen: "registro",
            accion: "POST /registro",
            mensaje: "Nuevo usuario registrado",
            detalle: nombre + " (" + email + ")",
            ip: req.ip
        });
        res.status(201).json({ mensaje: "Registro recibido. Un administrador debe activar tu cuenta." });
    } catch (error) {
        // 23505 = email duplicado (columna UNIQUE)
        if (error.code === "23505") {
            res.locals.mensajeLogSistema = "Intento de registro con correo ya registrado";
            return res.status(409).json({ mensaje: "El email ya está registrado" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- USUARIOS (solo admin_super) ----------

// Listar usuarios (los no activos primero)
app.get("/usuarios", verificarToken, soloSuper, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, email, rol, activo, desactivado, creado_en
             FROM public.usuarios
             ORDER BY activo ASC, id`
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Crear usuario directamente (ya activo)
app.post("/usuarios", verificarToken, soloSuper, async (req, res) => {
    try {
        const body = req.body || {};

        const nombre = textoLimpio(body.nombre);
        const email = normalizarEmail(body.email);
        const password = body.password;

        // 1. Campos obligatorios
        if (!nombre || !email || typeof password !== "string" || password === "") {
            return res.status(400).json({ mensaje: "Nombre, email y contraseña son obligatorios" });
        }

        // 2. Nombre y correo
        const errorDatos = errorDatosUsuario(nombre, email);
        if (errorDatos) {
            return res.status(400).json({ mensaje: errorDatos });
        }

        // 3. Contraseña
        const errorPass = errorClave(password);
        if (errorPass) {
            return res.status(400).json({ mensaje: errorPass });
        }

        // 4. Rol permitido (si no viene, será "usuario")
        const rolFinal = body.rol || "usuario";
        if (!ROLES.includes(rolFinal)) {
            return res.status(400).json({ mensaje: "Rol inválido" });
        }

        // 5. Hash de la contraseña
        const hash = await bcrypt.hash(password, 10);

        // 6. Insertar ya activo (lo crea un admin) sin devolver nunca el hash
        const result = await pool.query(
            `INSERT INTO public.usuarios (nombre, email, password_hash, rol, activo)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, nombre, email, rol, activo`,
            [nombre, email, hash, rolFinal]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        // 23505 = email duplicado (columna UNIQUE)
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "El email ya existe" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Modificar un usuario: nombre, correo, rol y, si se envía, contraseña nueva
app.put("/usuarios/:id", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) {
            return res.status(400).json({ mensaje: "Id inválido" });
        }

        const body = req.body || {};

        const nombre = textoLimpio(body.nombre);
        const email = normalizarEmail(body.email);
        const rol = body.rol;
        const password = body.password;

        // 1. Campos obligatorios
        if (!nombre || !email || !rol) {
            return res.status(400).json({ mensaje: "Nombre, email y rol son obligatorios" });
        }

        // 2. Nombre y correo
        const errorDatos = errorDatosUsuario(nombre, email);
        if (errorDatos) {
            return res.status(400).json({ mensaje: errorDatos });
        }

        // 3. Rol permitido
        if (!ROLES.includes(rol)) {
            return res.status(400).json({ mensaje: "Rol inválido" });
        }

        // 4. Un admin super no puede quitarse a sí mismo el rol (siempre queda alguien con control total)
        if (id === req.user.id && rol !== "admin_super") {
            return res.status(400).json({ mensaje: "No puedes quitarte el rol de Admin Super a ti mismo" });
        }

        // 5. La contraseña es opcional; si viene, se valida
        const cambiaClave = password !== undefined && password !== null && password !== "";
        if (cambiaClave) {
            const errorPass = errorClave(password);
            if (errorPass) {
                return res.status(400).json({ mensaje: errorPass });
            }
        }

        let result;

        if (cambiaClave) {
            const hash = await bcrypt.hash(password, 10);
            result = await pool.query(
                `UPDATE public.usuarios
                 SET nombre = $1, email = $2, rol = $3, password_hash = $4
                 WHERE id = $5
                 RETURNING id, nombre, email, rol, activo, desactivado`,
                [nombre, email, rol, hash, id]
            );
        } else {
            result = await pool.query(
                `UPDATE public.usuarios
                 SET nombre = $1, email = $2, rol = $3
                 WHERE id = $4
                 RETURNING id, nombre, email, rol, activo, desactivado`,
                [nombre, email, rol, id]
            );
        }

        if (result.rowCount === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        // 23505 = email duplicado (columna UNIQUE)
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ese correo ya lo usa otra cuenta" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Activar un usuario pendiente o reactivar uno desactivado
app.patch("/usuarios/:id/activar", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) {
            return res.status(400).json({ mensaje: "Id inválido" });
        }

        const result = await pool.query(
            `UPDATE public.usuarios SET activo = true, desactivado = false
             WHERE id = $1
             RETURNING id, nombre, email, rol, activo, desactivado`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Desactivar un usuario activo (no se borra, solo no puede entrar)
app.patch("/usuarios/:id/desactivar", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) {
            return res.status(400).json({ mensaje: "Id inválido" });
        }

        // No puedes desactivar tu propia cuenta
        if (id === req.user.id) {
            return res.status(400).json({ mensaje: "No puedes desactivar tu propia cuenta" });
        }

        const result = await pool.query(
            `UPDATE public.usuarios SET activo = false, desactivado = true
             WHERE id = $1
             RETURNING id, nombre, email, rol, activo, desactivado`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// Rechazar (pendiente) o eliminar (activo o desactivado) un usuario: se borra de la base
app.delete("/usuarios/:id", verificarToken, soloSuper, async (req, res) => {
    try {
        const id = idValido(req.params.id);
        if (id === null) {
            return res.status(400).json({ mensaje: "Id inválido" });
        }

        // No puedes borrar tu propia cuenta
        if (id === req.user.id) {
            return res.status(400).json({ mensaje: "No puedes eliminar tu propia cuenta" });
        }

        const result = await pool.query(
            "DELETE FROM public.usuarios WHERE id = $1",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        res.json({ mensaje: "Usuario eliminado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- AUDITORÍA (solo admin_super) ----------

// ?q= texto (usuario, acción, detalle) · ?orden=asc|desc · ?desde= ?hasta= (YYYY-MM-DD)
app.get("/auditoria", verificarToken, soloSuper, async (req, res) => {
    try {
        const orden = req.query.orden === "asc" ? "ASC" : "DESC";
        const cond = [], vals = [];
        const paginaSolicitada = Number.parseInt(req.query.pagina, 10);
        const pagina = Number.isInteger(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;
        const porPagina = 10;

        if (typeof req.query.q === "string" && req.query.q.trim() !== "") {
            vals.push("%" + req.query.q.trim() + "%");
            cond.push(`(usuario_nombre ILIKE $${vals.length} OR accion ILIKE $${vals.length} OR entidad ILIKE $${vals.length} OR detalle ILIKE $${vals.length})`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "")) {
            vals.push(req.query.desde);
            cond.push(`creado_en >= $${vals.length}::date`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "")) {
            vals.push(req.query.hasta);
            cond.push(`creado_en < ($${vals.length}::date + 1)`);
        }

        const filtro = cond.length ? "WHERE " + cond.join(" AND ") : "";
        const totalResult = await pool.query(
            `SELECT COUNT(*)::integer AS total
             FROM public.auditoria
             ${filtro}`,
            vals
        );
        const total = totalResult.rows[0].total;
        const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
        const paginaActual = Math.min(pagina, totalPaginas);
        const result = await pool.query(
            `SELECT id, usuario_id, usuario_nombre, rol, accion, entidad, detalle, ip, creado_en
             FROM public.auditoria
             ${filtro}
             ORDER BY creado_en ${orden}, id ${orden}
             LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
            [...vals, porPagina, (paginaActual - 1) * porPagina]
        );
        res.json({
            registros: result.rows,
            total,
            pagina: paginaActual,
            por_pagina: porPagina,
            total_paginas: totalPaginas
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

app.get("/logs-sistema", verificarToken, soloSuper, async (req, res) => {
    try {
        const orden = req.query.orden === "asc" ? "ASC" : "DESC";
        const cond = [], vals = [];
        const paginaSolicitada = Number.parseInt(req.query.pagina, 10);
        const pagina = Number.isInteger(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;
        const porPagina = 15;

        if (typeof req.query.q === "string" && req.query.q.trim() !== "") {
            vals.push("%" + req.query.q.trim() + "%");
            cond.push(`(usuario_nombre ILIKE $${vals.length} OR accion ILIKE $${vals.length} OR origen ILIKE $${vals.length} OR mensaje ILIKE $${vals.length} OR detalle ILIKE $${vals.length})`);
        }
        if (typeof req.query.nivel === "string" && ["info", "warn", "error"].includes(req.query.nivel)) {
            vals.push(req.query.nivel);
            cond.push(`nivel = $${vals.length}`);
        }
        if (typeof req.query.origen === "string" && req.query.origen.trim() !== "") {
            vals.push(req.query.origen.trim());
            cond.push(`origen = $${vals.length}`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "")) {
            vals.push(req.query.desde);
            cond.push(`creado_en >= $${vals.length}::date`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "")) {
            vals.push(req.query.hasta);
            cond.push(`creado_en < ($${vals.length}::date + 1)`);
        }

        const filtro = cond.length ? "WHERE " + cond.join(" AND ") : "";
        const totalResult = await pool.query(
            `SELECT COUNT(*)::integer AS total
             FROM public.logs_sistema
             ${filtro}`,
            vals
        );
        const total = totalResult.rows[0].total;
        const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
        const paginaActual = Math.min(pagina, totalPaginas);
        const result = await pool.query(
            `SELECT id, nivel, origen, accion, mensaje, detalle, usuario_id, usuario_nombre, rol, ip, creado_en
             FROM public.logs_sistema
             ${filtro}
             ORDER BY creado_en ${orden}, id ${orden}
             LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
            [...vals, porPagina, (paginaActual - 1) * porPagina]
        );
        res.json({
            registros: result.rows,
            total,
            pagina: paginaActual,
            por_pagina: porPagina,
            total_paginas: totalPaginas
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- MI PERFIL (cualquier usuario con sesión) ----------

// Cambiar nombre, correo y, si se envía, contraseña (exige la actual)
app.put("/perfil", verificarToken, async (req, res) => {
    try {
        const body = req.body || {};
        const nombre = textoLimpio(body.nombre);
        const email = normalizarEmail(body.email);

        if (!nombre || !email) {
            return res.status(400).json({ mensaje: "Nombre y correo son obligatorios" });
        }
        const errorDatos = errorDatosUsuario(nombre, email);
        if (errorDatos) {
            return res.status(400).json({ mensaje: errorDatos });
        }

        const nueva = body.passwordNueva;
        const cambiaClave = typeof nueva === "string" && nueva !== "";

        if (cambiaClave) {
            const errorPass = errorClave(nueva);
            if (errorPass) {
                return res.status(400).json({ mensaje: errorPass });
            }
            const actual = await pool.query("SELECT password_hash FROM public.usuarios WHERE id = $1", [req.user.id]);
            const ok = typeof body.passwordActual === "string" &&
                await bcrypt.compare(body.passwordActual, actual.rows[0].password_hash);
            if (!ok) {
                return res.status(400).json({ mensaje: "La contraseña actual no es correcta" });
            }
        }

        const result = cambiaClave
            ? await pool.query(
                `UPDATE public.usuarios SET nombre = $1, email = $2, password_hash = $3 WHERE id = $4
                 RETURNING id, nombre, email, rol`,
                [nombre, email, await bcrypt.hash(nueva, 10), req.user.id])
            : await pool.query(
                `UPDATE public.usuarios SET nombre = $1, email = $2 WHERE id = $3
                 RETURNING id, nombre, email, rol`,
                [nombre, email, req.user.id]);

        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ mensaje: "Ese correo ya lo usa otra cuenta" });
        }
        console.error(error);
        res.status(500).json({ mensaje: "Error del servidor" });
    }
});

// ---------- ARRANQUE (siempre al final) ----------

const PUERTO = 3000;
const LINEA = "=".repeat(60);

app.listen(PUERTO, async () => {
    // Comprueba la conexión a la base antes de mostrar el resumen
    let estadoBd;
    try {
        await pool.query("SELECT 1");
        await prepararAuditoria();
    await prepararLogsSistema();
        await prepararEsquema();
        estadoBd = "conectada";
    } catch (error) {
        estadoBd = "SIN CONEXIÓN (" + (error.message || error.code || "error") + ")";
    }

    let estadoPrisma;
    try {
        const r = await prismaPool.query("SELECT COUNT(*)::int AS n FROM iniciativas");
        estadoPrisma = "conectada (" + r.rows[0].n + " proyectos)";
    } catch (error) {
        estadoPrisma = "SIN CONEXIÓN (" + (error.message || error.code || "error") + ")";
    }

    console.log(LINEA);
    console.log("🚀 MIDAS · PANEL DE ADMINISTRACIÓN - EXPRESS + POSTGRESQL");
    console.log(LINEA);
    console.log("ð Login: http://127.0.0.1:5500/auth/login.html");
    console.log("ðï¸  Base de datos: " + process.env.DB_NAME + " @ " + process.env.DB_HOST + ":" + process.env.DB_PORT + " â " + estadoBd);
    console.log("ð PRISMA: " + (PRISMA_REAL
        ? process.env.PRISMA_DB_NAME + " @ " + (process.env.PRISMA_DB_HOST || process.env.DB_HOST) + " (esquema " + (process.env.PRISMA_DB_SCHEMA || "prisma") + ")"
        : "copia en " + process.env.DB_NAME + " (esquema prisma)") + " â " + estadoPrisma);
    console.log("ð¤ Primer admin: node crearAdmin.js (ver README)");
    console.log("ð Ctrl + C para detener");
    console.log(LINEA);
});