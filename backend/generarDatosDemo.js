const fs = require("node:fs");
const path = require("node:path");
const { fakerES: faker } = require("@faker-js/faker");

faker.seed(Date.now());
const anioComparacion = new Date().getFullYear();

const operaciones = [
    "conciliación de facturas",
    "gestión de solicitudes internas",
    "validación de documentos",
    "generación de reportes operativos",
    "clasificación de casos de soporte",
    "actualización de registros",
    "seguimiento de aprobaciones",
    "integración de datos",
    "control de órdenes de compra",
    "gestión de novedades",
    "verificación de información",
    "notificaciones de procesos"
];

function literal(valor) {
    return "'" + String(valor).replace(/'/g, "''") + "'";
}

function decimal(valor) {
    if (!Number.isFinite(valor)) {
        throw new Error("Se intentó generar un valor numérico inválido");
    }
    return Number(valor.toFixed(2)).toString();
}

function crearProyecto(indice) {
    const hhEsperado = faker.number.int({ min: 80, max: 420 });
    const hhObtenido = faker.number.int({ min: 60, max: hhEsperado });
    const valorHora = faker.number.int({ min: 35000, max: 80000 });
    const multaEsperada = faker.number.int({ min: 0, max: 25 }) * 1000000;
    const multaObtenida = Math.min(
        multaEsperada,
        faker.number.int({ min: 0, max: 12 }) * 1000000
    );
    return {
        id: 10001 + indice,
        beneficioId: 20001 + indice,
        nombre: "[DEMO] Automatización de " + operaciones[indice],
        descripcion: "Datos sintéticos para probar cálculos de ahorro y horas en MIDAS. " +
            "No corresponde a un proyecto real.",
        fechaInicio: faker.date
            .past({ years: 2, refDate: new Date(Date.UTC(anioComparacion, 0, 1)) })
            .toISOString()
            .slice(0, 10),
        hhEsperado,
        hhObtenido,
        costoEsperado: hhEsperado * valorHora,
        costoObtenido: hhObtenido * valorHora,
        multaEsperada,
        multaObtenida,
        pctN1: faker.number.int({ min: 70, max: 100 }),
        pctN2: faker.number.int({ min: 60, max: 98 }),
        pctN3: faker.number.int({ min: 50, max: 95 })
    };
}

const proyectos = operaciones.map((_, indice) => crearProyecto(indice));
const beneficiosMensuales = proyectos.flatMap((proyecto, indiceProyecto) =>
    Array.from({ length: 12 }, (_, indiceMes) => {
        const mes = indiceMes + 1;
        const inicio = new Date(Date.UTC(anioComparacion, indiceMes, 1));
        const fin = new Date(Date.UTC(anioComparacion, indiceMes + 1, 0));
        const factor = faker.number.float({ min: 0.65, max: 1.35, fractionDigits: 2 });
        const hhEsperado = Math.max(1, Math.round(proyecto.hhEsperado * factor));
        const hhObtenido = Math.min(hhEsperado, Math.max(1, Math.round(proyecto.hhObtenido * factor)));
        const valorHora = proyecto.hhEsperado ? proyecto.costoEsperado / proyecto.hhEsperado : 0;
        const costoEsperado = Math.round(hhEsperado * valorHora);
        const costoObtenido = Math.round(hhObtenido * valorHora);
        const multaEsperada = Math.round(proyecto.multaEsperada * factor);
        const multaObtenida = Math.min(multaEsperada, Math.round(proyecto.multaObtenida * factor));
        return {
            id: mes === 1
                ? proyecto.beneficioId
                : 30001 + indiceProyecto * 11 + indiceMes - 1,
            iniciativaId: proyecto.id,
            inicio: inicio.toISOString().slice(0, 10),
            fin: fin.toISOString().slice(0, 10),
            hhEsperado,
            hhObtenido,
            costoEsperado,
            costoObtenido,
            multaEsperada,
            multaObtenida,
            pctN1: faker.number.int({ min: 70, max: 100 }),
            pctN2: faker.number.int({ min: 60, max: 98 }),
            pctN3: faker.number.int({ min: 50, max: 95 })
        };
    })
);

const instrucciones = [
    "-- Datos sintéticos de demostración generados con @faker-js/faker.",
    "-- No son datos reales ni deben cargarse en producción.",
    "-- Esquema aislado: prisma_demo. No modifica public ni el esquema prisma existente.",
    "",
    "CREATE SCHEMA IF NOT EXISTS prisma_demo;",
    "",
    `CREATE TABLE IF NOT EXISTS prisma_demo.pais (
    id INTEGER PRIMARY KEY,
    codigo VARCHAR(5) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);`,
    "",
    `CREATE TABLE IF NOT EXISTS prisma_demo.iniciativas (
    id INTEGER PRIMARY KEY,
    pais_id INTEGER,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    estado VARCHAR(50) NOT NULL DEFAULT 'Inicial',
    avance INTEGER NOT NULL DEFAULT 0,
    fecha_inicio DATE,
    eliminado_en TIMESTAMP
);`,
    "",
    `CREATE TABLE IF NOT EXISTS prisma_demo.beneficios (
    id INTEGER PRIMARY KEY,
    iniciativa_id INTEGER NOT NULL,
    tipo VARCHAR(10) NOT NULL DEFAULT 'HH',
    subtipo VARCHAR(40) NOT NULL DEFAULT 'N/A',
    periodicidad VARCHAR(10) NOT NULL DEFAULT 'MENSUAL',
    cantidad NUMERIC(18, 4) NOT NULL,
    unidad_medida VARCHAR(10) NOT NULL DEFAULT 'HH',
    metodo_calculo VARCHAR(30) NOT NULL DEFAULT 'ESFUERZO_DECLARADO',
    costo_ahorrado_esperado NUMERIC(18, 4),
    hh_esperado NUMERIC(18, 4),
    multa_esperada NUMERIC(18, 4),
    costo_ahorrado_obtenido NUMERIC(18, 4),
    hh_obtenido NUMERIC(18, 4),
    multa_obtenida NUMERIC(18, 4),
    pct_n1_obtenido NUMERIC(18, 4),
    pct_n2_obtenido NUMERIC(18, 4),
    pct_n3_obtenido NUMERIC(18, 4)
);`,
    "",
    "ALTER TABLE prisma_demo.beneficios",
    "    ADD COLUMN IF NOT EXISTS vigente_desde DATE,",
    "    ADD COLUMN IF NOT EXISTS vigente_hasta DATE;",
    "",
    `INSERT INTO prisma_demo.pais (id, codigo, nombre, activo)
VALUES (1, 'CO', 'Colombia (DEMO)', TRUE)
ON CONFLICT (id) DO UPDATE SET
    codigo = EXCLUDED.codigo,
    nombre = EXCLUDED.nombre,
    activo = EXCLUDED.activo;`,
    "",
    "INSERT INTO prisma_demo.iniciativas " +
        "(id, pais_id, nombre, descripcion, estado, avance, fecha_inicio, eliminado_en)",
    "VALUES",
    proyectos.map(proyecto =>
        `(${proyecto.id}, 1, ${literal(proyecto.nombre)}, ${literal(proyecto.descripcion)}, ` +
        `'Implementado', 100, ${literal(proyecto.fechaInicio)}, NULL)`
    ).join(",\n"),
    "ON CONFLICT (id) DO UPDATE SET",
    "    pais_id = EXCLUDED.pais_id,",
    "    nombre = EXCLUDED.nombre,",
    "    descripcion = EXCLUDED.descripcion,",
    "    estado = EXCLUDED.estado,",
    "    avance = EXCLUDED.avance,",
    "    fecha_inicio = EXCLUDED.fecha_inicio,",
    "    eliminado_en = EXCLUDED.eliminado_en;",
    "",
    "INSERT INTO prisma_demo.beneficios " +
        "(id, iniciativa_id, tipo, subtipo, periodicidad, vigente_desde, vigente_hasta, cantidad, unidad_medida, metodo_calculo, " +
        "costo_ahorrado_esperado, hh_esperado, multa_esperada, costo_ahorrado_obtenido, " +
        "hh_obtenido, multa_obtenida, pct_n1_obtenido, pct_n2_obtenido, pct_n3_obtenido)",
    "VALUES",
    beneficiosMensuales.map(beneficio =>
        `(${beneficio.id}, ${beneficio.iniciativaId}, 'HH', 'N/A', 'MENSUAL', ` +
        `${literal(beneficio.inicio)}, ${literal(beneficio.fin)}, ` +
        `${decimal(beneficio.hhObtenido)}, 'HH', 'ESFUERZO_DECLARADO', ` +
        `${decimal(beneficio.costoEsperado)}, ${decimal(beneficio.hhEsperado)}, ` +
        `${decimal(beneficio.multaEsperada)}, ${decimal(beneficio.costoObtenido)}, ` +
        `${decimal(beneficio.hhObtenido)}, ${decimal(beneficio.multaObtenida)}, ` +
        `${decimal(beneficio.pctN1)}, ${decimal(beneficio.pctN2)}, ${decimal(beneficio.pctN3)})`
    ).join(",\n"),
    "ON CONFLICT (id) DO UPDATE SET",
    "    iniciativa_id = EXCLUDED.iniciativa_id,",
    "    tipo = EXCLUDED.tipo,",
    "    subtipo = EXCLUDED.subtipo,",
    "    periodicidad = EXCLUDED.periodicidad,",
    "    vigente_desde = EXCLUDED.vigente_desde,",
    "    vigente_hasta = EXCLUDED.vigente_hasta,",
    "    cantidad = EXCLUDED.cantidad,",
    "    unidad_medida = EXCLUDED.unidad_medida,",
    "    metodo_calculo = EXCLUDED.metodo_calculo,",
    "    costo_ahorrado_esperado = EXCLUDED.costo_ahorrado_esperado,",
    "    hh_esperado = EXCLUDED.hh_esperado,",
    "    multa_esperada = EXCLUDED.multa_esperada,",
    "    costo_ahorrado_obtenido = EXCLUDED.costo_ahorrado_obtenido,",
    "    hh_obtenido = EXCLUDED.hh_obtenido,",
    "    multa_obtenida = EXCLUDED.multa_obtenida,",
    "    pct_n1_obtenido = EXCLUDED.pct_n1_obtenido,",
    "    pct_n2_obtenido = EXCLUDED.pct_n2_obtenido,",
    "    pct_n3_obtenido = EXCLUDED.pct_n3_obtenido;",
    ""
].join("\n");

const destino = path.join(__dirname, "..", "database", "prisma_demo_seed.sql");
fs.writeFileSync(destino, instrucciones, "utf8");
console.log(`Se generó ${destino} con ${proyectos.length} proyectos y ${beneficiosMensuales.length} beneficios sintéticos mensuales para ${anioComparacion}.`);
