const API_INICIO = "http://localhost:3000";
const INTERVALO_ACTUALIZACION_RESUMEN = 15 * 60 * 1000;
const tokenInicio = sessionStorage.getItem("token");
const usuarioInicio = JSON.parse(sessionStorage.getItem("usuario") || "{}");
const claveCacheResumen = "midas.resumen." + (usuarioInicio.id || usuarioInicio.email || "usuario");
let resumenCargando = false;
let mesSeleccionadoHorasAcumuladas = "";
const etiquetasRolInicio = { admin_super: "Admin Super", admin: "Admin", usuario: "Usuario" };
const categoriasResumen = [
    { clave: "horas", patrones: /\bhoras?\b|\btiempo ahorrado\b/ },
    { clave: "playbooks", patrones: /\bplaybooks?\b/ },
    { clave: "ejecuciones", patrones: /\bejecuciones?\b|\bruns?\b/ },
    { clave: "ahorro", patrones: /\bahorro\b|\bsavings?\b/ }
];
const transicionInicio = document.documentElement.classList.contains("transicion-entrada");
const duracionTransicionInicioMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 650;
let salidaEnCurso = false;

if (!tokenInicio) window.location.replace("../auth/login.html");

document.getElementById("nombreUsuario").textContent = usuarioInicio.nombre || "";
document.getElementById("rolUsuario").textContent =
    etiquetasRolInicio[usuarioInicio.rol] || usuarioInicio.rol || "";
const btnPanelAdministracion = document.getElementById("btnPanelAdministracion");
if (usuarioInicio.rol === "usuario") {
    btnPanelAdministracion.hidden = true;
} else {
    btnPanelAdministracion.addEventListener("click", () => {
        sessionStorage.setItem("midas.transicionAdmin", "1");
    });
}
document.getElementById("btnSalir").addEventListener("click", () => {
    if (salidaEnCurso) return;
    salidaEnCurso = true;
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("usuario");
    document.getElementById("transicionInicioTitulo").textContent = "Cerrando sesión";
    document.getElementById("transicionInicioMensaje").textContent = "Hasta pronto";
    document.documentElement.classList.add("transicion-entrada");
    window.setTimeout(() => {
        window.location.replace("../auth/login.html");
    }, duracionTransicionInicioMs);
});

document.querySelectorAll(".resumen-capa-toggle[aria-controls]").forEach(boton => {
    const panel = document.getElementById(boton.getAttribute("aria-controls"));
    boton.addEventListener("click", () => {
        const desplegar = boton.getAttribute("aria-expanded") !== "true";
        boton.setAttribute("aria-expanded", String(desplegar));
        panel.hidden = !desplegar;
    });
});

function mostrarErrorInicio(mensaje) {
    const aviso = document.getElementById("avisoError");
    aviso.textContent = mensaje;
    aviso.hidden = false;
}

function actualizarEstadoResumen(mensaje) {
    document.getElementById("estadoResumen").textContent = mensaje;
}

function formatoNumero(valor) {
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return "—";
    return Number(valor).toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

function datosProyecto(nombre, pais) {
    if (!nombre) return { numero: "", nombre: "Sin proyecto asociado", pais: pais || "" };
    const partes = nombre.split("|").map(parte => parte.trim()).filter(Boolean);
    const numero = partes[0].match(/^\d+/);
    return {
        numero: numero ? numero[0] : "",
        nombre: partes.length < 2 ? nombre.trim() : partes[1],
        pais: pais || ""
    };
}

function claveDeProyecto(metrica) {
    const nombre = datosProyecto(metrica.proyecto_nombre).nombre
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("es");
    if (nombre && nombre !== "sin proyecto asociado") return "nombre:" + nombre;
    return "id:" + String(metrica.proyecto_id || "sin-proyecto");
}

function categoriaDeMetrica(metrica) {
    const texto = [
        metrica.nombre,
        metrica.descripcion,
        metrica.grupo_global_nombre,
        metrica.grupo_global_descripcion
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return categoriasResumen.find(categoria => categoria.patrones.test(texto));
}

function mostrarEjemplos() {
    document.getElementById("avisoEjemplo").hidden = false;
    document.getElementById("kpiAhorro").textContent = "US$ " + formatoNumero(163792);
    document.getElementById("kpiHoras").textContent = formatoNumero(5803);
    document.getElementById("kpiEjecuciones").textContent = formatoNumero(4187);
    document.getElementById("kpiPlaybooks").textContent = formatoNumero(252);
    ["notaAhorro", "notaHoras", "notaEjecuciones", "notaPlaybooks"].forEach(id => {
        document.getElementById(id).textContent = "Dato de ejemplo";
    });
}

function agruparMetricasGlobales(metricas) {
    const grupos = new Map();
    metricas.filter(metrica => metrica.tipo_resultado === "global").forEach(metrica => {
        const nombre = metrica.grupo_global_nombre || metrica.nombre;
        const clave = metrica.grupo_global_id
            ? "grupo:" + metrica.grupo_global_id
            : "nombre:" + String(nombre || "").trim().toLocaleLowerCase();
        if (!grupos.has(clave)) {
            grupos.set(clave, {
                nombre,
                descripcion: metrica.grupo_global_descripcion || "",
                metricas: []
            });
        }
        const grupo = grupos.get(clave);
        grupo.metricas.push(metrica);
    });

    return [...grupos.values()].map(grupo => {
        const valores = grupo.metricas.map(metrica =>
            metrica.error || metrica.valor === null || metrica.valor === undefined
                ? null
                : Number(metrica.valor));
        const completo = valores.every(valor => valor !== null && Number.isFinite(valor));
        return {
            nombre: grupo.nombre,
            descripcion: grupo.descripcion || grupo.metricas.map(metrica => metrica.descripcion).filter(Boolean).join(" "),
            valor: completo ? valores.reduce((total, valor) => total + valor, 0) : null,
            error: completo ? null : "No se pudieron calcular todas las métricas de este grupo."
        };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function pintarTotalesGlobales(globales) {
    const totales = document.getElementById("resultadosGlobalesTotales");
    totales.replaceChildren();

    if (!globales.length) {
        totales.textContent = "No hay resultados Globales para mostrar.";
        return;
    }

    globales.forEach(resultado => {
        const tarjeta = document.createElement("article");
        tarjeta.className = "card resultado-global-card";
        const cuerpo = document.createElement("div");
        cuerpo.className = "card-body py-3";
        const nombre = document.createElement("div");
        nombre.className = "small text-body-secondary mb-1";
        nombre.textContent = resultado.nombre;
        const valor = document.createElement("div");
        valor.className = "resultado-global-valor fs-4 fw-bold";
        valor.textContent = resultado.error ? "No disponible" : formatoNumero(resultado.valor);
        cuerpo.append(nombre, valor);
        if (resultado.descripcion) {
            const descripcion = document.createElement("p");
            descripcion.className = "resultado-global-descripcion small text-body-secondary mt-2 mb-0";
            descripcion.textContent = resultado.descripcion;
            cuerpo.append(descripcion);
        }
        if (resultado.error) {
            const error = document.createElement("div");
            error.className = "small text-warning mt-1";
            error.textContent = resultado.error;
            cuerpo.append(error);
        }
        tarjeta.append(cuerpo);
        totales.append(tarjeta);
    });
}

function agruparMetricasPorProyecto(metricas) {
    const proyectos = new Map();
    metricas.forEach(metrica => {
        const clave = claveDeProyecto(metrica);
        if (!proyectos.has(clave)) {
            proyectos.set(clave, {
                nombre: metrica.proyecto_nombre,
                pais: metrica.pais_nombre,
                metricas: []
            });
        }
        proyectos.get(clave).metricas.push(metrica);
    });
    return [...proyectos.values()].sort((a, b) =>
        (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

function pintarResultadosPorProyecto(metricas, idContenedor = "resultadosPorProyecto") {
    const contenedor = document.getElementById(idContenedor);
    contenedor.replaceChildren();
    if (!metricas.length) {
        contenedor.textContent = "No hay métricas activas para mostrar por proyecto.";
        return;
    }
    agruparMetricasPorProyecto(metricas).forEach(proyecto => {
        const datos = datosProyecto(proyecto.nombre, proyecto.pais);
        const tarjeta = document.createElement("article");
        tarjeta.className = "card resumen-proyecto-card resumen-resultados-proyecto";
        const cuerpo = document.createElement("div");
        cuerpo.className = "card-body p-2";
        const titulo = document.createElement("h3");
        titulo.className = "h6 fw-semibold mb-1";
        titulo.textContent = datos.nombre;
        const meta = document.createElement("p");
        meta.className = "small text-body-secondary mb-2";
        meta.textContent = [datos.numero ? "Proyecto " + datos.numero : "", datos.pais]
            .filter(Boolean).join(" · ") || "País no disponible";
        const metricasEjecucion = proyecto.metricas.filter(metrica =>
            categoriaDeMetrica(metrica)?.clave === "ejecuciones");
        const valoresEjecucion = metricasEjecucion.map(metrica =>
            metrica.error || metrica.valor === null || metrica.valor === undefined
                ? null
                : Number(metrica.valor));
        const ejecuciones = document.createElement("div");
        ejecuciones.className = "resumen-ejecuciones-proyecto";
        const etiquetaEjecuciones = document.createElement("span");
        etiquetaEjecuciones.textContent = "Ejecuciones totales";
        const valorEjecuciones = document.createElement("strong");
        valorEjecuciones.textContent = !metricasEjecucion.length
            ? "—"
            : valoresEjecucion.every(valor => valor !== null && Number.isFinite(valor))
                ? formatoNumero(valoresEjecucion.reduce((total, valor) => total + valor, 0))
                : "No disponible";
        ejecuciones.append(etiquetaEjecuciones, valorEjecuciones);
        const lista = document.createElement("div");
        lista.className = "resumen-resultados-lista";
        const globales = new Map();
        proyecto.metricas.forEach(metrica => {
            if (categoriaDeMetrica(metrica)?.clave === "ejecuciones") return;
            if (metrica.tipo_resultado !== "global") {
                agregarResultadoProyecto(lista, metrica.nombre, "Ãšnica", metrica);
                return;
            }
            const nombre = metrica.grupo_global_nombre || metrica.nombre;
            const clave = metrica.grupo_global_id
                ? "grupo:" + metrica.grupo_global_id
                : "nombre:" + String(nombre || "").trim().toLocaleLowerCase();
            if (!globales.has(clave)) globales.set(clave, { nombre, metricas: [] });
            globales.get(clave).metricas.push(metrica);
        });
        [...globales.values()]
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
            .forEach(grupo => {
                const valores = grupo.metricas.map(metrica =>
                    metrica.error || metrica.valor === null || metrica.valor === undefined
                        ? null
                        : Number(metrica.valor));
                const completo = valores.every(valor => valor !== null && Number.isFinite(valor));
                agregarResultadoProyecto(lista, grupo.nombre, "Global · suma del grupo", {
                    valor: completo ? valores.reduce((total, valor) => total + valor, 0) : null,
                    error: completo ? null : "No se pudieron calcular todas las métricas de este grupo."
                });
            });
        cuerpo.append(titulo, meta, ejecuciones, lista);
        tarjeta.append(cuerpo);
        contenedor.append(tarjeta);
    });
}

function agregarResultadoProyecto(contenedor, nombre, tipo, metrica) {
    const fila = document.createElement("div");
    fila.className = "resumen-resultado-fila";
    const texto = document.createElement("div");
    texto.className = "resumen-resultado-identidad";
    const titulo = document.createElement("div");
    titulo.className = "resumen-resultado-nombre";
    titulo.textContent = nombre || "Métrica sin nombre";
    const subtitulo = document.createElement("div");
    subtitulo.className = "resumen-resultado-tipo";
    subtitulo.textContent = tipo;
    texto.append(titulo, subtitulo);
    const valor = document.createElement("strong");
    valor.className = "text-info text-end";
    valor.textContent = metrica.error || metrica.valor === null || metrica.valor === undefined
        ? "No disponible"
        : formatoNumero(metrica.valor);
    fila.append(texto, valor);
    if (metrica.error) {
        const error = document.createElement("p");
        error.className = "small text-warning mb-0 mt-1";
        error.textContent = metrica.error;
        fila.append(error);
    }
    contenedor.append(fila);
}

function pintarGraficaGlobales(metricas) {
    const contenedor = document.getElementById("graficaMetricasGlobales");
    contenedor.replaceChildren();
    const svgNamespace = "http://www.w3.org/2000/svg";
    const crearSvg = (nombre, atributos, texto) => {
        const elemento = document.createElementNS(svgNamespace, nombre);
        Object.entries(atributos || {}).forEach(([clave, valor]) => elemento.setAttribute(clave, String(valor)));
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    };
    const grupos = new Map();

    metricas.filter(metrica => metrica.tipo_resultado === "global").forEach(metrica => {
        const nombre = metrica.grupo_global_nombre || metrica.nombre || "Grupo Global";
        const claveGrupo = metrica.grupo_global_id
            ? "grupo:" + metrica.grupo_global_id
            : "nombre:" + String(nombre).trim().toLocaleLowerCase();
        const claveProyecto = claveDeProyecto(metrica);
        if (!grupos.has(claveGrupo)) {
            grupos.set(claveGrupo, {
                nombre,
                descripcion: metrica.grupo_global_descripcion || "",
                proyectos: new Map()
            });
        }
        const proyectos = grupos.get(claveGrupo).proyectos;
        if (!proyectos.has(claveProyecto)) {
            proyectos.set(claveProyecto, {
                nombre: datosProyecto(metrica.proyecto_nombre).nombre,
                metricas: []
            });
        }
        proyectos.get(claveProyecto).metricas.push(metrica);
    });

    const disponibles = [...grupos.values()].map(grupo => ({
        ...grupo,
        proyectos: [...grupo.proyectos.values()]
            .map(proyecto => {
                const valores = proyecto.metricas.map(metrica =>
                    metrica.error || metrica.valor === null || metrica.valor === undefined
                        ? null
                        : Number(metrica.valor));
                const valido = valores.every(valor => valor !== null && Number.isFinite(valor));
                return {
                    nombre: proyecto.nombre,
                    valor: valido ? valores.reduce((total, valor) => total + valor, 0) : null
                };
            })
            .filter(proyecto => proyecto.valor !== null)
            .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
    })).filter(grupo => grupo.proyectos.length)
        .sort((a, b) =>
            b.proyectos.reduce((total, proyecto) => total + Math.abs(proyecto.valor), 0) -
            a.proyectos.reduce((total, proyecto) => total + Math.abs(proyecto.valor), 0))
        .slice(0, 3);

    if (!disponibles.length) {
        const vacio = document.createElement("p");
        vacio.className = "grafica-globales-vacia mb-0";
        vacio.textContent = "No hay métricas Globales disponibles para graficar.";
        contenedor.append(vacio);
        return;
    }

    const tarjetas = document.createDocumentFragment();
    disponibles.forEach((grupo, indiceGrupo) => {
        const proyectosDestacados = grupo.proyectos.slice(0, 3);
        const tarjeta = document.createElement("article");
        tarjeta.className = "grafica-globales-tarjeta";
        const encabezado = document.createElement("header");
        encabezado.className = "grafica-globales-encabezado";
        const titulo = document.createElement("h4");
        titulo.textContent = grupo.nombre;
        titulo.title = grupo.nombre;
        const resumen = document.createElement("span");
        resumen.className = "grafica-globales-resumen";
        resumen.textContent = (grupo.descripcion ? grupo.descripcion + " · " : "") +
            Math.min(3, grupo.proyectos.length) + " destacados de " + grupo.proyectos.length;
        resumen.title = resumen.textContent;
        encabezado.append(titulo, resumen);

        const svg = crearSvg("svg", {
            class: "grafica-globales-svg",
            viewBox: "0 0 360 120",
            role: "img",
            "aria-label": "Gráfica del grupo " + grupo.nombre + " para los proyectos destacados"
        });
        svg.append(crearSvg("title", {}, grupo.nombre + " · proyectos destacados"));

        const margen = { arriba: 8, derecha: 34, abajo: 24, izquierda: 24 };
        const anchoGrafica = 360 - margen.izquierda - margen.derecha;
        const altoGrafica = 120 - margen.arriba - margen.abajo;
        const minimoDatos = Math.min(0, ...proyectosDestacados.map(proyecto => proyecto.valor));
        const maximoDatos = Math.max(0, ...proyectosDestacados.map(proyecto => proyecto.valor));
        const rangoDatos = maximoDatos - minimoDatos || 1;
        const espacioEscala = rangoDatos * .2;
        const minimo = minimoDatos < 0 ? minimoDatos - espacioEscala : 0;
        let maximo = 0;
        if (maximoDatos > 0) maximo = maximoDatos + espacioEscala;
        else if (minimoDatos === 0) maximo = 1;
        const rango = maximo - minimo;
        const coordenadaX = valor =>
            margen.izquierda + ((valor - minimo) / rango) * anchoGrafica;
        const baseX = coordenadaX(0);

        [0, .5, 1].forEach(fraccion => {
            const valor = minimo + rango * fraccion;
            const x = margen.izquierda + anchoGrafica * fraccion;
            svg.append(
                crearSvg("line", {
                    x1: x,
                    x2: x,
                    y1: margen.arriba,
                    y2: margen.arriba + altoGrafica,
                    stroke: Math.abs(x - baseX) < anchoGrafica * .000001 ? "#456174" : "#20394a",
                    "stroke-width": Math.abs(x - baseX) < anchoGrafica * .000001 ? 1.2 : 1
                }),
                crearSvg("text", {
                    x,
                    y: 120 - margen.abajo + 16,
                    fill: "#8fa6b6",
                    "font-size": 9,
                    "text-anchor": "middle"
                }, new Intl.NumberFormat("es-CO", {
                    notation: "compact",
                    maximumFractionDigits: 1
                }).format(valor))
            );
        });

        const altoGrupo = altoGrafica / proyectosDestacados.length;
        const altoBarra = Math.min(9, altoGrupo * .34);
        const coloresProyecto = ["#35c3d2", "#5dc78a", "#a883dc"];
        proyectosDestacados.forEach((proyecto, indice) => {
            const centroY = margen.arriba + altoGrupo * (indice + .5);
            const valorX = coordenadaX(proyecto.valor);
            const barra = crearSvg("rect", {
                x: Math.min(baseX, valorX),
                y: centroY - altoBarra / 2,
                width: Math.max(1, Math.abs(baseX - valorX)),
                height: altoBarra,
                rx: 3,
                fill: coloresProyecto[indice % coloresProyecto.length]
            });
            barra.append(crearSvg("title", {},
                proyecto.nombre + ": " + formatoNumero(proyecto.valor)));
            svg.append(barra);
        });

        const leyenda = document.createElement("ol");
        leyenda.className = "grafica-globales-leyenda";
        proyectosDestacados.forEach((proyecto, indice) => {
            const elemento = document.createElement("li");
            const muestra = document.createElement("span");
            muestra.className = "grafica-globales-muestra";
            muestra.style.backgroundColor = coloresProyecto[indice % coloresProyecto.length];
            muestra.setAttribute("aria-hidden", "true");
            const nombre = document.createElement("span");
            nombre.className = "grafica-globales-proyecto";
            nombre.textContent = proyecto.nombre;
            nombre.title = proyecto.nombre;
            const valor = document.createElement("strong");
            valor.textContent = new Intl.NumberFormat("es-CO", {
                notation: "compact",
                maximumFractionDigits: 1
            }).format(proyecto.valor);
            valor.title = formatoNumero(proyecto.valor);
            elemento.append(muestra, nombre, valor);
            leyenda.append(elemento);
        });

        tarjeta.append(encabezado, svg, leyenda);
        tarjetas.append(tarjeta);
    });
    contenedor.append(tarjetas);
}

function pintarHorasAhorradasAcumuladas(datos) {
    const contenedor = document.getElementById("graficaHorasAhorradasAcumuladas");
    const controlContenedor = document.getElementById("controlHorasAcumuladasMes");
    const nota = document.getElementById("notaHorasAhorradasAcumuladas");
    if (!contenedor) return;
    contenedor.innerHTML = "";
    if (controlContenedor) controlContenedor.innerHTML = "";

    const crearEstadoCard = (mensaje) => {
        const grid = document.createElement("div");
        grid.className = "row g-3 justify-content-center";
        const col = document.createElement("div");
        col.className = "col-12 col-md-8 col-xl-5";
        const card = document.createElement("article");
        card.className = "card kpi-card kpi-card-destacado h-100";
        const body = document.createElement("div");
        body.className = "card-body d-flex flex-column align-items-center justify-content-center text-center gap-1";
        const icono = document.createElement("i");
        icono.className = "bi bi-clock-history kpi-icon mb-1";
        icono.setAttribute("aria-hidden", "true");
        const tituloEl = document.createElement("div");
        tituloEl.className = "small text-body-secondary mb-1";
        tituloEl.textContent = "Acumulado del mes seleccionado";
        const valor = document.createElement("div");
        valor.className = "kpi-valor-destacado";
        valor.textContent = "?";
        const nota = document.createElement("div");
        nota.className = "small text-body-secondary mt-2";
        nota.textContent = mensaje;
        body.append(icono, tituloEl, valor, nota);
        card.append(body);
        col.append(card);
        grid.append(col);
        contenedor.append(grid);
    };

    if (!datos || !datos.disponible) {
        if (nota) nota.textContent = datos?.motivo || "No hay datos disponibles.";
        crearEstadoCard(datos?.motivo || "Sin datos disponibles.");
        return;
    }

    const meses = Array.isArray(datos.meses) ? datos.meses : [];
    if (!meses.length) {
        if (nota) nota.textContent = "Sin datos de vigencias.";
        crearEstadoCard("Sin datos de vigencias.");
        return;
    }

    const claves = meses.map(m => claveMes(m));
    let seleccion = mesSeleccionadoHorasAcumuladas;
    if (!claves.includes(seleccion)) {
        const claveActual = claveMes(new Date());
        seleccion = claves.includes(claveActual) ? claveActual : claves[claves.length - 1];
        mesSeleccionadoHorasAcumuladas = seleccion;
    }

    if (controlContenedor) {
        const grupo = document.createElement("div");
        grupo.className = "d-flex flex-column align-items-start align-items-sm-end";
        const etiquetaControl = document.createElement("label");
        etiquetaControl.className = "form-label small text-body-secondary mb-1";
        etiquetaControl.setAttribute("for", "selMesHorasAcumuladas");
        etiquetaControl.textContent = "Mes a consultar";
        const select = document.createElement("select");
        select.id = "selMesHorasAcumuladas";
        select.className = "form-select form-select-sm";
        select.style.maxWidth = "220px";
        for (let i = meses.length - 1; i >= 0; i--) {
            const m = meses[i];
            const opt = document.createElement("option");
            opt.value = claveMes(m);
            opt.textContent = etiquetaMes(m);
            if (opt.value === seleccion) opt.selected = true;
            select.append(opt);
        }
        select.addEventListener("change", () => {
            mesSeleccionadoHorasAcumuladas = select.value;
            pintarHorasAhorradasAcumuladas(datos);
        });
        grupo.append(etiquetaControl, select);
        controlContenedor.append(grupo);
    }

    const item = meses.find(m => claveMes(m) === seleccion) || meses[meses.length - 1];

    const grid = document.createElement("div");
    grid.className = "row g-3 justify-content-center";
    const col = document.createElement("div");
    col.className = "col-12 col-md-8 col-xl-5";

    const card = document.createElement("article");
    card.className = "card kpi-card kpi-card-destacado h-100";

    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column align-items-center justify-content-center text-center gap-1";

    const icono = document.createElement("i");
    icono.className = "bi bi-clock-history kpi-icon mb-1";
    icono.setAttribute("aria-hidden", "true");

    const titulo = document.createElement("div");
    titulo.className = "small text-body-secondary mb-1 text-capitalize";
    titulo.textContent = etiquetaMes(item);

    const valor = document.createElement("div");
    valor.className = "kpi-valor-destacado";
    valor.textContent = formatoNumero(Number(item.acumulado) || 0) + " h";

    const nota = document.createElement("div");
    nota.className = "small text-body-secondary mt-2";
    nota.textContent = "Horas del mes: " + formatoNumero(Number(item.horas) || 0) + " h";

    body.append(icono, titulo, valor, nota);

    if (datos.fuente_temporal === "sin_vigencias") {
        const aviso = document.createElement("div");
        aviso.className = "small text-warning mt-2";
        aviso.textContent = "Sin vigencias: distribuci?n estimada.";
        body.append(aviso);
    }

    card.append(body);
    col.append(card);
    grid.append(col);
    contenedor.append(grid);
}

function actualizarIndicadores(metricas, proyectosPrisma, horasAcumuladas) {
    document.getElementById("avisoEjemplo").hidden = true;
    const totales = { ahorro: 0, horas: 0, ejecuciones: 0, playbooks: 0 };
    const encontrados = { ahorro: 0, horas: 0, ejecuciones: 0, playbooks: 0 };
    const metricasCapaUno = metricas.filter(metrica => Number(metrica.capa || 1) >= 1);
    const metricasCapaDos = metricas.filter(metrica => Number(metrica.capa || 1) >= 2);
    const metricasCapaTres = metricas.filter(metrica => Number(metrica.capa || 1) >= 3);
    const globales = agruparMetricasGlobales(metricasCapaTres);

    metricasCapaTres.filter(metrica => metrica.tipo_resultado === "global").forEach(metrica => {
        if (metrica.valor === null || metrica.valor === undefined) return;
        const valor = Number(metrica.valor);
        if (!Number.isFinite(valor)) return;
        const categoria = categoriaDeMetrica(metrica);
        if (!categoria) return;
        totales[categoria.clave] += valor;
        encontrados[categoria.clave]++;
    });

    const mostrarTotal = (id, notaId, clave, formato) => {
        document.getElementById(id).textContent = encontrados[clave] ? formato(totales[clave]) : "—";
        document.getElementById(notaId).textContent = encontrados[clave]
            ? encontrados[clave] + (encontrados[clave] === 1 ? " resultado Global consolidado" : " resultados Globales consolidados")
            : "Sin resultado Global";
    };

    mostrarTotal("kpiAhorro", "notaAhorro", "ahorro", valor => "US$ " + formatoNumero(valor));
    mostrarTotal("kpiHoras", "notaHoras", "horas", formatoNumero);
    mostrarTotal("kpiEjecuciones", "notaEjecuciones", "ejecuciones", formatoNumero);
    mostrarTotal("kpiPlaybooks", "notaPlaybooks", "playbooks", formatoNumero);

    pintarResultadosPorProyecto(metricasCapaUno, "resultadosCapaUno");
    pintarResultadosPorProyecto(metricasCapaDos);
    pintarTotalesGlobales(globales);
    pintarGraficaGlobales(metricasCapaTres);
    pintarHorasAhorradasAcumuladas(horasAcumuladas || null);
}

async function cargarResumenCompatible() {
    const opciones = { headers: { Authorization: "Bearer " + tokenInicio } };
    const [respuestaMetricas, respuestaProyectos] = await Promise.all([
        fetch(API_INICIO + "/calculos", opciones),
        fetch(API_INICIO + "/proyectos", opciones)
    ]);

    if (respuestaMetricas.status === 401 || respuestaMetricas.status === 403 ||
        respuestaProyectos.status === 401 || respuestaProyectos.status === 403) {
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("usuario");
        window.location.replace("../auth/login.html");
        return false;
    }
    if (!respuestaMetricas.ok) {
        mostrarErrorInicio("No se pudieron cargar las métricas (error " + respuestaMetricas.status + ").");
        return false;
    }

    const [todasLasMetricas, listaProyectos] = await Promise.all([
        respuestaMetricas.json(),
        respuestaProyectos.ok ? respuestaProyectos.json() : Promise.resolve(null)
    ]);
    const paisesPorProyecto = new Map((listaProyectos || []).map(proyecto => [
        String(proyecto.id),
        proyecto.pais_nombre
    ]));
    const activas = todasLasMetricas.filter(m => m.estado === "activa");

    if (!activas.length) {
        actualizarIndicadores([], listaProyectos ? listaProyectos.length : null, null);
        mostrarEjemplos();
        guardarCacheResumen({
            metricas: [],
            proyectos_prisma: listaProyectos ? listaProyectos.length : null,
            horas_ahorradas_acumuladas: null
        });
        return true;
    }

    const resultados = await Promise.all(activas.map(async metrica => {
        try {
            const respuesta = await fetch(API_INICIO + "/calculos/previsualizar", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + tokenInicio
                },
                body: JSON.stringify({
                    proyecto_id: metrica.proyecto_id,
                    ecuacion: metrica.ecuacion
                })
            });
            if (respuesta.status === 401) {
                sessionStorage.removeItem("token");
                sessionStorage.removeItem("usuario");
                window.location.replace("../auth/login.html");
                return null;
            }
            const resultado = await respuesta.json();
            return respuesta.ok
                ? {
                    ...metrica,
                    pais_nombre: metrica.pais_nombre || paisesPorProyecto.get(String(metrica.proyecto_id)),
                    tipo_resultado: metrica.tipo_resultado || "unica",
                    valor: resultado.resultado,
                    error: null
                }
                : {
                    ...metrica,
                    pais_nombre: metrica.pais_nombre || paisesPorProyecto.get(String(metrica.proyecto_id)),
                    tipo_resultado: metrica.tipo_resultado || "unica",
                    valor: null,
                    error: "No se pudo calcular con los datos actuales."
                };
        } catch (error) {
            console.error("No se pudo calcular la métrica " + metrica.nombre + ":", error);
            return {
                ...metrica,
                pais_nombre: metrica.pais_nombre || paisesPorProyecto.get(String(metrica.proyecto_id)),
                tipo_resultado: metrica.tipo_resultado || "unica",
                valor: null,
                error: "No se pudo conectar para calcular esta métrica."
            };
        }
    }));

    const metricasCalculadas = resultados.filter(Boolean);
    actualizarIndicadores(metricasCalculadas, listaProyectos ? listaProyectos.length : null, null);
    guardarCacheResumen({
        metricas: metricasCalculadas,
        proyectos_prisma: listaProyectos ? listaProyectos.length : null,
        horas_ahorradas_acumuladas: null
    });
    return true;
}

function guardarCacheResumen(datos) {
    try {
        sessionStorage.setItem(claveCacheResumen, JSON.stringify({
            version: 6,
            actualizado_en: Date.now(),
            datos
        }));
    } catch (error) {
        console.warn("No se pudo guardar la copia temporal del resumen:", error);
    }
}

function cargarCacheResumen() {
    try {
        const cache = JSON.parse(sessionStorage.getItem(claveCacheResumen) || "null");
        if (!cache || cache.version !== 6 || !cache.datos || !Array.isArray(cache.datos.metricas)) {
            sessionStorage.removeItem(claveCacheResumen);
            return false;
        }
        actualizarIndicadores(
            cache.datos.metricas,
            cache.datos.proyectos_prisma,
            cache.datos.horas_ahorradas_acumuladas || null
        );
        const hora = new Date(cache.actualizado_en).toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit"
        });
        actualizarEstadoResumen("Mostrando datos guardados · última actualización " + hora);
        if (!cache.datos.metricas.length) mostrarEjemplos();
        return true;
    } catch (error) {
        console.warn("No se pudo leer la copia temporal del resumen:", error);
        sessionStorage.removeItem(claveCacheResumen);
        return false;
    }
}

async function cargarResumen() {
    if (!tokenInicio || resumenCargando) return;
    resumenCargando = true;
    const habiaCache = cargarCacheResumen();
    actualizarEstadoResumen(habiaCache ? "Actualizando datos…" : "Cargando indicadores…");
    try {
        const respuesta = await fetch(API_INICIO + "/dashboard/resumen", {
            headers: { Authorization: "Bearer " + tokenInicio }
        });
        if (respuesta.status === 401 || respuesta.status === 403) {
            sessionStorage.removeItem("token");
            sessionStorage.removeItem("usuario");
            window.location.replace("../auth/login.html");
            return;
        }
        if (respuesta.status === 404) {
            const actualizado = await cargarResumenCompatible();
            actualizarEstadoResumen(actualizado
                ? "Actualizado " + new Date().toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit"
                }) + " · actualización cada 15 min"
                : habiaCache ? "No se pudo actualizar; se conservan los últimos datos cargados." : "");
            return;
        }
        if (!respuesta.ok) {
            if (!habiaCache) {
                pintarHorasAhorradasAcumuladas(null);
                mostrarErrorInicio("No se pudieron cargar los resultados (error " + respuesta.status + ").");
            }
            actualizarEstadoResumen(habiaCache ? "No se pudo actualizar; se conservan los últimos datos cargados." : "");
            return;
        }

        const datos = await respuesta.json();
        actualizarIndicadores(datos.metricas, datos.proyectos_prisma, datos.horas_ahorradas_acumuladas || null);
        guardarCacheResumen({
            metricas: datos.metricas,
            proyectos_prisma: datos.proyectos_prisma,
            horas_ahorradas_acumuladas: datos.horas_ahorradas_acumuladas || null
        });
        actualizarEstadoResumen("Actualizado " + new Date().toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit"
        }) + " · actualización cada 15 min");

        if (!datos.metricas.length) {
            mostrarEjemplos();
            return;
        }

    } catch (error) {
        console.error("No se pudo cargar el resumen:", error);
        if (!habiaCache) {
            pintarHorasAhorradasAcumuladas(null);
            mostrarErrorInicio("No se pudo conectar con el servidor. Verifica que el backend esté iniciado.");
        }
        actualizarEstadoResumen(habiaCache ? "Sin conexión; se conservan los últimos datos cargados." : "");
    } finally {
        resumenCargando = false;
    }
}

if (transicionInicio) {
    window.setTimeout(() => {
        document.documentElement.classList.add("transicion-saliendo");
        window.setTimeout(() => {
            document.documentElement.classList.remove("transicion-entrada", "transicion-saliendo");
            document.body.style.overflow = "";
        }, duracionTransicionInicioMs < 300 ? 150 : 700);
    }, duracionTransicionInicioMs);
}

cargarResumen();
window.setInterval(cargarResumen, INTERVALO_ACTUALIZACION_RESUMEN);
