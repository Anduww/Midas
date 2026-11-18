const API = "http://localhost:3000";

const token = sessionStorage.getItem("token");
const usuario = JSON.parse(sessionStorage.getItem("usuario")) || {};
const perfilDesdeResumen = new URLSearchParams(window.location.search).get("volver") === "resumen";
const transicionAdmin = document.documentElement.classList.contains("transicion-admin-entrada");
const duracionTransicionAdminMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 650;
let salidaEnCurso = false;
let temporizadorTransicionAdmin;
let transicionAdminTiempoCumplido = !transicionAdmin;

const esSuper = usuario.rol === "admin_super";
const puedeAgregar = usuario.rol === "admin_super" || usuario.rol === "admin";
const ETIQUETA_ROL = { admin_super: "Admin Super", admin: "Admin", usuario: "Usuario" };

// 1. Sin sesión, de vuelta al login
function irAlLogin() {
    // replace: sustituye esta página en el historial, así "Atrás" no vuelve al panel
    window.location.replace("../auth/login.html");
}

// Evita mostrar el panel antes de comprobar la sesión; la transición revela el contenido suavemente.
document.body.hidden = !transicionAdmin;

if (!token) {
    irAlLogin();
}

if (transicionAdmin) {
    temporizadorTransicionAdmin = window.setTimeout(() => {
        transicionAdminTiempoCumplido = true;
        revelarPanelAdmin();
    }, duracionTransicionAdminMs);
}

function revelarPanelAdmin() {
    document.body.hidden = false;
    if (!transicionAdmin || !transicionAdminTiempoCumplido ||
        document.documentElement.classList.contains("transicion-admin-listo")) return;

    document.documentElement.classList.add("transicion-admin-listo", "transicion-admin-desvanecer");
    temporizadorTransicionAdmin = window.setTimeout(() => {
        document.documentElement.classList.remove(
            "transicion-admin-entrada",
            "transicion-admin-listo",
            "transicion-admin-desvanecer"
        );
    }, duracionTransicionAdminMs);
}

function cerrarSesion() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("usuario");
    irAlLogin();
}

function mostrarTransicionSalidaAdmin(titulo, mensaje, destino, duracion = duracionTransicionAdminMs) {
    if (salidaEnCurso) return;
    salidaEnCurso = true;
    window.clearTimeout(temporizadorTransicionAdmin);
    document.documentElement.classList.remove("transicion-admin-desvanecer");
    document.getElementById("transicionAdminTitulo").textContent = titulo;
    document.getElementById("transicionAdminMensaje").textContent = mensaje;
    if (duracion < duracionTransicionAdminMs) {
        document.documentElement.classList.add("transicion-admin-rapida");
    }
    document.documentElement.classList.add("transicion-admin-entrada", "transicion-admin-navegando");
    window.setTimeout(destino, duracion);
}

function irAlResumenDesdePanel(event) {
    event.preventDefault();
    mostrarTransicionSalidaAdmin("Dirigiéndote al resumen", "Cargando tus resultados", () => {
        window.location.href = "../resumen/inicio.html";
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 220);
}

document.getElementById("btnLogoMidas").addEventListener("click", irAlResumenDesdePanel);
document.getElementById("btnVolverResumen").addEventListener("click", irAlResumenDesdePanel);

// Si el navegador muestra esta página desde su memoria (botón Atrás),
// se revisa la sesión de nuevo y, si ya no hay, se oculta todo y se manda al login
window.addEventListener("pageshow", function () {
    if (!sessionStorage.getItem("token")) {
        document.body.hidden = true;
        irAlLogin();
    }
});

// Evita revisar el rol dos veces a la vez
let revisandoRol = false;

// 2. Toda petición pasa por aquí: agrega el token y maneja la sesión vencida
async function llamar(ruta, opciones = {}) {
    let respuesta;
    try {
        respuesta = await fetch(API + ruta, {
            ...opciones,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            }
        });
    } catch (error) {
        revelarPanelAdmin();
        mostrarToast("No se pudo conectar con el servidor", "error");
        return null;
    }

    if (respuesta.status === 401) {
        cerrarSesion();
        return null;
    }

    revelarPanelAdmin();

    // 403: puede que tu rol haya cambiado y esta pantalla esté desactualizada
    if (respuesta.status === 403) {
        revisarRol();
    }

    return respuesta;
}

// Mensaje de error que devuelve el servidor (o uno por defecto)
async function mensajeError(respuesta, porDefecto) {
    try {
        const datos = await respuesta.json();
        return datos.mensaje || porDefecto;
    } catch (error) {
        return porDefecto;
    }
}

// ----- Utilidades para armar las tablas (siempre con textContent: nunca interpreta HTML) -----
function celda(contenido) {
    const td = document.createElement("td");
    if (contenido instanceof Node) {
        td.append(contenido);
    } else {
        td.textContent = (contenido === null || contenido === undefined || contenido === "") ? "—" : contenido;
    }
    return td;
}

function etiqueta(texto, color) {
    const span = document.createElement("span");
    span.className = "badge text-bg-" + color;
    span.textContent = texto;
    return span;
}

function etiquetaTipoResultado(tipo) {
    return etiqueta(tipo === "global" ? "Global" : "Única", tipo === "global" ? "primary" : "secondary");
}

function codigo(texto) {
    const c = document.createElement("code");
    c.textContent = texto;
    return c;
}

function boton(texto, clase, accion) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-sm " + clase + " ms-1";
    b.textContent = texto;
    b.addEventListener("click", accion);
    return b;
}

function fecha(valor) {
    return valor ? new Date(valor).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

// Dibuja una tabla: "columnas" son funciones que reciben la fila y devuelven el contenido
function pintarTabla(idCuerpo, filas, columnas, acciones, hayAcciones = esSuper) {
    const cuerpo = document.getElementById(idCuerpo);
    cuerpo.replaceChildren();

    const conAcciones = hayAcciones && typeof acciones === "function";

    if (filas.length === 0) {
        const tr = document.createElement("tr");
        const td = celda("Sin registros");
        td.colSpan = columnas.length + (conAcciones ? 1 : 0);
        td.className = "text-center text-body-secondary py-3";
        tr.append(td);
        cuerpo.append(tr);
        return;
    }

    filas.forEach((fila, i) => {
        const tr = document.createElement("tr");
        columnas.forEach(columna => tr.append(celda(columna(fila, i))));

        if (conAcciones) {
            const td = document.createElement("td");
            td.className = "text-nowrap text-end position-sticky end-0 bg-body";
            td.append(...acciones(fila));
            tr.append(td);
        }

        cuerpo.append(tr);
    });
}

// ----- Modales de Bootstrap -----
function modal(id) {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
}

// Pregunta con un modal; devuelve una promesa: true si aceptó, false si canceló
function confirmar(titulo, texto, textoBoton) {
    return new Promise(resolve => {
        const el = document.getElementById("modalConfirmar");
        el.querySelector(".modal-title").textContent = titulo;
        el.querySelector(".modal-body").textContent = texto;

        const ok = document.getElementById("btnConfirmarOk");
        ok.textContent = textoBoton || "Confirmar";

        let respondido = false;
        ok.onclick = function () {
            respondido = true;
            modal("modalConfirmar").hide();
            resolve(true);
        };
        el.addEventListener("hidden.bs.modal", function () {
            if (!respondido) resolve(false);
        }, { once: true });

        modal("modalConfirmar").show();
    });
}

// 3. Cabecera y permisos visuales (la seguridad real la dan los middlewares del backend)

// Pinta el nombre y el rol en el botón de perfil (arriba a la derecha)
function pintarQuien() {
    document.getElementById("quienNombre").textContent = usuario.nombre || "";
    document.getElementById("quienRol").textContent = ETIQUETA_ROL[usuario.rol] || usuario.rol || "";
}
pintarQuien();

document.getElementById("btnSalir").addEventListener("click", () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("usuario");
    mostrarTransicionSalidaAdmin("Cerrando sesión", "Hasta pronto", irAlLogin);
});

if (!esSuper) document.querySelectorAll(".solo-super").forEach(el => el.remove());
if (!puedeAgregar) document.querySelectorAll(".solo-agregar").forEach(el => el.remove());

// Cambiar de estado (desactivar o reactivar) y eliminar sirven para variables y métricas
const RECARGAR = {
    variables: () => cargarVariables(),
    calculos: () => cargarCalculos()
};

async function cambiarEstado(recurso, item, habilitar) {
    const verbo = habilitar ? "Reactivar" : "Desactivar";
    const ok = await confirmar(verbo, "¿" + verbo + " \"" + item.nombre + "\"?", verbo);
    if (!ok) return;

    const respuesta = await llamar("/" + recurso + "/" + item.id + (habilitar ? "/activar" : "/desactivar"), {
        method: "PATCH"
    });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo cambiar el estado"), "error");
        return;
    }
    mostrarToast(habilitar ? "Reactivada" : "Desactivada", habilitar ? "exito" : "aviso");
    RECARGAR[recurso]();
}

async function eliminar(recurso, item) {
    const ok = await confirmar("Eliminar", "¿Eliminar \"" + item.nombre + "\"? Esta acción no se puede deshacer.", "Eliminar");
    if (!ok) return;

    const respuesta = await llamar("/" + recurso + "/" + item.id, { method: "DELETE" });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo eliminar"), "error");
        return;
    }
    mostrarToast("Eliminada", "exito");
    RECARGAR[recurso]();
}

// 4. VARIABLES
let editandoVariableId = null;

// Los países solo se necesitan al abrir el editor de variables.
let paisesCargados = false;
let cargaPaisesEnCurso = null;

async function cargarPaises() {
    if (paisesCargados) return true;
    if (cargaPaisesEnCurso) return cargaPaisesEnCurso;

    cargaPaisesEnCurso = (async function () {
        const respuesta = await llamar("/paises");
        if (!respuesta) return false;
        if (!respuesta.ok) {
            mostrarToast(await mensajeError(respuesta, "No se pudieron cargar los países."), "error");
            return false;
        }

        const select = document.getElementById("varPais");
        (await respuesta.json()).forEach(function (p) {
            const op = document.createElement("option");
            op.value = p.codigo;
            op.textContent = p.nombre + " (" + p.codigo + ")";
            select.append(op);
        });
        paisesCargados = true;
        return true;
    })().finally(function () {
        cargaPaisesEnCurso = null;
    });

    return cargaPaisesEnCurso;
}

let variablesDatos = [];
let variablesCargadas = false;
let cargaVariablesEnCurso = null;

function pintarVariables() {
    const datos = variablesDatos;

    const columnas = [
        (v, i) => i + 1, // N° de fila (el id real queda en la base)
        v => v.nombre,
        v => etiqueta(v.pais || v.pais_codigo || "Global", v.pais_codigo ? "info" : "secondary"),
        v => Number(v.valor).toLocaleString("es-CO", { maximumFractionDigits: 4 }),
        v => etiqueta(v.habilitada ? "Sí" : "No", v.habilitada ? "success" : "secondary"),
        v => fecha(v.creado_en),
        v => fecha(v.habilitada_en),
        v => v.modificado_por,
        v => v.creado_por
    ];
    const bloqueada = v => [etiqueta("Bloqueada: la usa una métrica", "secondary")];

    pintarTabla("tablaVarActivas", datos.filter(v => v.habilitada), columnas, v => v.en_uso ? bloqueada(v) : [
        boton("Editar", "btn-outline-light", () => abrirVariable(v)),
        boton("Desactivar", "btn-outline-danger", () => cambiarEstado("variables", v, false))
    ]);

    pintarTabla("tablaVarInactivas", datos.filter(v => !v.habilitada), columnas, v => v.en_uso ? bloqueada(v) : [
        boton("Editar", "btn-outline-light", () => abrirVariable(v)),
        boton("Reactivar", "btn-outline-success", () => cambiarEstado("variables", v, true)),
        boton("Eliminar", "btn-danger", () => eliminar("variables", v))
    ]);
}

const variablesBeneficiosPorProyecto = new Map();

function pintarVariablesBeneficios(proyectoId) {
    const cuerpo = document.getElementById("tablaVariablesBeneficios");
    const variables = variablesBeneficiosPorProyecto.get(String(proyectoId));
    cuerpo.replaceChildren();
    if (!variables) {
        const fila = document.createElement("tr");
        const celdaMensaje = celda("Selecciona un proyecto para cargar sus variables.");
        celdaMensaje.colSpan = 3;
        celdaMensaje.className = "text-center text-body-secondary py-3";
        fila.append(celdaMensaje);
        cuerpo.append(fila);
        return;
    }

    variables.forEach(variable => {
        const fila = document.createElement("tr");
        fila.append(
            celda(codigo(variable.nombre)),
            celda(!variable.disponible
                ? "No está en la tabla BENEFICIOS de PRISMA"
                : variable.valor === null
                    ? "Sin registros para este proyecto"
                    : Number(variable.valor).toLocaleString("es-CO", { maximumFractionDigits: 4 })),
            celda(Number(variable.registros).toLocaleString("es-CO"))
        );
        cuerpo.append(fila);
    });
}

async function asegurarVariablesBeneficios(proyectoId) {
    const clave = String(proyectoId);
    if (variablesBeneficiosPorProyecto.has(clave)) return true;
    const respuesta = await llamar("/variables/beneficios?proyecto_id=" + encodeURIComponent(clave));
    if (!respuesta) return false;
    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudieron cargar las variables de BENEFICIOS."), "error");
        return false;
    }
    variablesBeneficiosPorProyecto.set(clave, await respuesta.json());
    if (document.getElementById("selProyectoVariables").value === clave) {
        pintarVariablesBeneficios(clave);
    }
    return true;
}

async function cargarVariables() {
    if (cargaVariablesEnCurso) return cargaVariablesEnCurso;

    cargaVariablesEnCurso = (async function () {
        const respuesta = await llamar("/variables");
        if (!respuesta || !respuesta.ok) return false;
        variablesDatos = await respuesta.json();
        variablesCargadas = true;
        pintarVariables();
        return true;
    })().finally(function () {
        cargaVariablesEnCurso = null;
    });

    return cargaVariablesEnCurso;
}

// Proyectos de PRISMA: llenan los filtros de métricas
let proyectos = [];

async function cargarProyectos() {
    const respuesta = await llamar("/proyectos");
    if (!respuesta || !respuesta.ok) return;
    proyectos = await respuesta.json();

    ["selProyecto"].forEach(id => {
        const select = document.getElementById(id);
        while (select.options.length > 1) select.remove(1);
        proyectos.forEach(p => {
            const op = document.createElement("option");
            op.value = p.id;
            op.textContent = p.nombre;
            select.append(op);
        });
    });

    const selectorVariables = document.getElementById("selProyectoVariables");
    while (selectorVariables.options.length > 1) selectorVariables.remove(1);
    proyectos.forEach(p => {
        const op = document.createElement("option");
        op.value = p.id;
        op.textContent = p.nombre;
        selectorVariables.append(op);
    });
}

document.getElementById("selProyectoVariables").addEventListener("change", async function () {
    if (!this.value) {
        pintarVariablesBeneficios("");
        return;
    }
    if (await asegurarVariablesBeneficios(this.value)) pintarVariablesBeneficios(this.value);
});

async function abrirVariable(v) {
    if (!(await cargarPaises())) return;
    editandoVariableId = v ? v.id : null;
    document.getElementById("tituloModalVariable").textContent = v ? "Editar variable" : "Agregar variable";
    document.getElementById("varNombre").value = v ? v.nombre : "";
    document.getElementById("varValor").value = v ? Number(v.valor) : "";
    document.getElementById("varPais").value = v && v.pais_codigo ? v.pais_codigo : "";
    modal("modalVariable").show();
}

async function guardarVariable() {
    const editando = editandoVariableId !== null;

    const respuesta = await llamar(editando ? "/variables/" + editandoVariableId : "/variables", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify({
            nombre: document.getElementById("varNombre").value,
            proyecto_id: "",
            pais_codigo: document.getElementById("varPais").value,
            valor: document.getElementById("varValor").value
        })
    });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo guardar la variable"), "error");
        return;
    }

    modal("modalVariable").hide();
    mostrarToast(editando ? "Variable actualizada" : "Variable agregada", "exito");
    cargarVariables();
}

// 5. CÁLCULOS DE MÉTRICAS POR PROYECTO
let editandoMetricaId = null;
let nombreTablaMetrica = "";
let metricasDatos = [];
let gruposGlobales = [];
let gruposGlobalesCargados = false;
let editandoGrupoGlobalId = null;
const METRICAS_ACTIVAS_POR_PAGINA = 10;
let paginaMetricasActivas = 1;
let totalPaginasMetricasActivas = 1;
const OPERADORES = ["+", "-", "*", "/", "%", "^", "(", ")"];

const proyectoElegido = () => document.getElementById("selProyecto").value;
const numeroEs = n => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 6 });

function nombreTablaDesdeMetrica(nombre) {
    let tabla = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);
    if (tabla.length < 3 && tabla) tabla = ("met_" + tabla).slice(0, 63);
    return tabla;
}

// Variables que se pueden usar en el proyecto elegido: las del proyecto y las generales, habilitadas
function variablesUtilizables(proyId) {
    const delProyecto = variablesBeneficiosPorProyecto.get(String(proyId)) || [];
    const reservadas = new Set(delProyecto.map(variable => variable.nombre.toLowerCase()));
    const disponibles = variablesDatos.filter(v =>
        v.habilitada &&
        (v.proyecto_id === null || String(v.proyecto_id) === String(proyId)) &&
        !reservadas.has(v.nombre.toLowerCase()));
    const porNombre = new Map(disponibles.map(variable => [variable.nombre.toLowerCase(), variable]));
    delProyecto.filter(variable => variable.valor !== null).forEach(variable => {
        porNombre.set(variable.nombre.toLowerCase(), {
            ...variable,
            proyecto_id: null,
            habilitada: true
        });
    });
    return [...porNombre.values()];
}

function pintarCalculos() {
    const proy = proyectoElegido();
    const texto = document.getElementById("buscarMetrica").value.trim().toLowerCase();

    const nueva = document.getElementById("btnNuevaMetrica");
    if (nueva) {
        nueva.disabled = !proy;
        nueva.title = proy ? "" : "Elige un proyecto primero";
    }

    const filas = metricasDatos.filter(m =>
        (!proy || String(m.proyecto_id) === proy) &&
        (!texto || [m.nombre, m.grupo_global_nombre].filter(Boolean).join(" ").toLowerCase().includes(texto)));

    pintarTabla("tablaMetBorradores", filas.filter(m => m.estado === "borrador"), [
        (m, i) => i + 1,
        m => m.nombre,
        m => m.proyecto_nombre,
        m => codigo(m.ecuacion),
        m => etiquetaTipoResultado(m.tipo_resultado),
        m => m.grupo_global_nombre,
        m => m.descripcion,
        m => m.creado_por
    ], m => [
        boton("Editar", "btn-outline-light", () => abrirMetrica(m)),
        boton("Rectificar y enviar", "btn-success", () => abrirRectificar(m)),
        boton("Eliminar", "btn-danger", () => eliminarBorrador(m))
    ], puedeAgregar);

    pintarMetricasActivas();
}

function pintarMetricasActivas() {
    const texto = document.getElementById("buscarMetricaActiva").value.trim().toLowerCase();
    const filasFiltradas = metricasDatos.filter(m =>
        m.estado === "activa" &&
        (!texto || [m.nombre, m.grupo_global_nombre, m.proyecto_nombre, m.descripcion, m.ecuacion, m.creado_por, m.tipo_resultado]
            .filter(Boolean).join(" ").toLowerCase().includes(texto)))
        .sort((a, b) => {
            const fechaA = Date.parse(a.creado_en || a.enviada_en) || 0;
            const fechaB = Date.parse(b.creado_en || b.enviada_en) || 0;
            return fechaB - fechaA || Number(b.id) - Number(a.id);
        });

    totalPaginasMetricasActivas = Math.max(1, Math.ceil(filasFiltradas.length / METRICAS_ACTIVAS_POR_PAGINA));
    paginaMetricasActivas = Math.min(Math.max(paginaMetricasActivas, 1), totalPaginasMetricasActivas);
    const inicio = (paginaMetricasActivas - 1) * METRICAS_ACTIVAS_POR_PAGINA;
    document.getElementById("estadoPaginaMetricas").textContent =
        "Mostrando " + (filasFiltradas.length ? inicio + 1 : 0) +
        "–" + Math.min(inicio + METRICAS_ACTIVAS_POR_PAGINA, filasFiltradas.length) +
        " de " + filasFiltradas.length + " métricas";
    document.getElementById("numeroPaginaMetricas").value = paginaMetricasActivas;
    document.getElementById("numeroPaginaMetricas").max = totalPaginasMetricasActivas;
    document.getElementById("totalPaginasMetricas").textContent = totalPaginasMetricasActivas;
    document.getElementById("primeraPaginaMetricas").disabled = paginaMetricasActivas <= 1;
    document.getElementById("paginaAnteriorMetricas").disabled = paginaMetricasActivas <= 1;
    document.getElementById("paginaSiguienteMetricas").disabled = paginaMetricasActivas >= totalPaginasMetricasActivas;
    document.getElementById("ultimaPaginaMetricas").disabled = paginaMetricasActivas >= totalPaginasMetricasActivas;

    pintarTabla("tablaMetActivas", filasFiltradas.slice(inicio, inicio + METRICAS_ACTIVAS_POR_PAGINA), [
        (m, i) => inicio + i + 1,
        m => m.nombre,
        m => m.proyecto_nombre,
        m => etiquetaTipoResultado(m.tipo_resultado),
        m => m.grupo_global_nombre,
        m => codigo(m.ecuacion),
        m => m.formato === "tabla" ? "Tabla" : "Texto plano",
        m => m.descripcion,
        m => fecha(m.enviada_en),
        m => m.creado_por
    ], m => [
        boton("Desactivar", "btn-outline-danger", () => desactivarMetrica(m))
    ], esSuper);
}

async function cargarCalculos() {
    const [rm, gruposCargados] = await Promise.all([
        llamar("/calculos"),
        gruposGlobalesCargados ? Promise.resolve(true) : cargarGruposGlobales(),
        variablesCargadas ? Promise.resolve(true) : cargarVariables()
    ]);
    if (!rm || !rm.ok || !gruposCargados) return;
    metricasDatos = await rm.json();
    pintarCalculos();
}

async function cargarGruposGlobales() {
    const respuesta = await llamar("/grupos-globales");
    if (!respuesta || !respuesta.ok) {
        gruposGlobalesCargados = false;
        if (respuesta && !respuesta.ok) {
            mostrarToast(await mensajeError(respuesta, "No se pudieron cargar los grupos Globales"), "error");
        }
        return false;
    }

    gruposGlobales = await respuesta.json();
    gruposGlobalesCargados = true;
    pintarGruposGlobales();
    actualizarOpcionesGrupoGlobal();
    return true;
}

function pintarGruposGlobales() {
    const cuerpo = document.getElementById("tablaGruposGlobales");
    if (!cuerpo) return;
    const encabezadoAcciones = cuerpo.closest("table").querySelector("thead th:last-child");
    if (encabezadoAcciones) encabezadoAcciones.hidden = !esSuper;
    pintarTabla("tablaGruposGlobales", gruposGlobales, [
        grupo => grupo.nombre,
        grupo => grupo.descripcion,
        grupo => numeroEs(grupo.metricas_asignadas)
    ], grupo => [
        boton("Editar", "btn-outline-light", () => abrirGrupoGlobal(grupo)),
        boton("Eliminar", "btn-outline-danger", () => eliminarGrupoGlobal(grupo))
    ]);
}

function actualizarOpcionesGrupoGlobal() {
    const selector = document.getElementById("metGrupoGlobal");
    if (!selector) return;
    const valorAnterior = selector.value;
    selector.replaceChildren(new Option("Selecciona un grupo", ""));
    gruposGlobales.forEach(grupo => {
        const descripcion = String(grupo.descripcion || "").trim();
        const detalle = descripcion.length > 60 ? descripcion.slice(0, 57) + "…" : descripcion;
        const opcion = new Option(grupo.nombre + (detalle ? " — " + detalle : ""), String(grupo.id));
        selector.append(opcion);
    });
    if (gruposGlobales.some(grupo => String(grupo.id) === valorAnterior)) {
        selector.value = valorAnterior;
    }
}

function actualizarCampoGrupoGlobal() {
    const requiereGrupo = document.getElementById("metTipoResultado").value === "global";
    const campo = document.getElementById("grupoGlobalCampo");
    const selector = document.getElementById("metGrupoGlobal");
    const ayuda = document.getElementById("ayudaGrupoGlobal");
    campo.hidden = !requiereGrupo;
    selector.required = requiereGrupo;
    if (requiereGrupo && !gruposGlobales.length) {
        ayuda.textContent = "No hay grupos disponibles. Solicita a un Admin Super que cree uno antes de guardar la métrica.";
    } else {
        ayuda.textContent = "Todos los resultados guardados en el grupo se sumarán en el Resumen.";
    }
}

function abrirGrupoGlobal(grupo) {
    editandoGrupoGlobalId = grupo ? grupo.id : null;
    document.getElementById("grupoGlobalId").value = grupo ? grupo.id : "";
    document.getElementById("grupoGlobalNombre").value = grupo ? grupo.nombre : "";
    document.getElementById("grupoGlobalDescripcion").value = grupo ? (grupo.descripcion || "") : "";
    document.getElementById("formGrupoGlobal").hidden = false;
    document.getElementById("grupoGlobalNombre").focus();
}

function cerrarEditorGrupoGlobal() {
    editandoGrupoGlobalId = null;
    document.getElementById("formGrupoGlobal").reset();
    document.getElementById("formGrupoGlobal").hidden = true;
}

async function guardarGrupoGlobal(evento) {
    evento.preventDefault();
    const editando = editandoGrupoGlobalId !== null;
    const respuesta = await llamar(
        editando ? "/grupos-globales/" + editandoGrupoGlobalId : "/grupos-globales",
        {
            method: editando ? "PUT" : "POST",
            body: JSON.stringify({
                nombre: document.getElementById("grupoGlobalNombre").value,
                descripcion: document.getElementById("grupoGlobalDescripcion").value
            })
        }
    );
    if (!respuesta) return;
    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo guardar el grupo Global"), "error");
        return;
    }

    cerrarEditorGrupoGlobal();
    mostrarToast(editando ? "Grupo Global actualizado" : "Grupo Global creado", "exito");
    gruposGlobalesCargados = false;
    await cargarGruposGlobales();
    await cargarCalculos();
}

async function eliminarGrupoGlobal(grupo) {
    const ok = await confirmar(
        "Eliminar grupo Global",
        '¿Eliminar "' + grupo.nombre + '"? Solo se pueden eliminar grupos sin métricas asignadas.',
        "Eliminar"
    );
    if (!ok) return;

    const respuesta = await llamar("/grupos-globales/" + grupo.id, { method: "DELETE" });
    if (!respuesta) return;
    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo eliminar el grupo Global"), "error");
        return;
    }

    mostrarToast("Grupo Global eliminado", "exito");
    gruposGlobalesCargados = false;
    await cargarGruposGlobales();
    await cargarCalculos();
}

document.getElementById("selProyecto").addEventListener("change", async function () {
    if (this.value) await asegurarVariablesBeneficios(this.value);
    pintarCalculos();
});
document.getElementById("buscarMetrica").addEventListener("input", pintarCalculos);
document.getElementById("buscarMetricaActiva").addEventListener("input", function () {
    paginaMetricasActivas = 1;
    pintarMetricasActivas();
});

document.getElementById("primeraPaginaMetricas").addEventListener("click", function () {
    if (paginaMetricasActivas > 1) { paginaMetricasActivas = 1; pintarMetricasActivas(); }
});
document.getElementById("paginaAnteriorMetricas").addEventListener("click", function () {
    if (paginaMetricasActivas > 1) { paginaMetricasActivas--; pintarMetricasActivas(); }
});
document.getElementById("paginaSiguienteMetricas").addEventListener("click", function () {
    if (paginaMetricasActivas < totalPaginasMetricasActivas) { paginaMetricasActivas++; pintarMetricasActivas(); }
});
document.getElementById("ultimaPaginaMetricas").addEventListener("click", function () {
    if (paginaMetricasActivas < totalPaginasMetricasActivas) {
        paginaMetricasActivas = totalPaginasMetricasActivas;
        pintarMetricasActivas();
    }
});
document.getElementById("numeroPaginaMetricas").addEventListener("change", function () {
    const solicitada = Number.parseInt(this.value, 10);
    if (!Number.isInteger(solicitada)) {
        this.value = paginaMetricasActivas;
        return;
    }
    paginaMetricasActivas = Math.min(Math.max(solicitada, 1), totalPaginasMetricasActivas);
    pintarMetricasActivas();
});
document.getElementById("numeroPaginaMetricas").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") {
        evento.preventDefault();
        this.dispatchEvent(new Event("change"));
    }
});

document.getElementById("btnCrearEjemplosKpi").addEventListener("click", async function () {
    const proyecto = proyectoElegido();
    if (!proyecto) {
        mostrarToast("Selecciona un proyecto antes de agregar los ejemplos.", "aviso");
        return;
    }

    const ok = await confirmar(
        "Agregar 2 métricas de demostración",
        "Se crearán y activarán dos métricas Globales de ahorro y horas usando los valores sintéticos de BENEFICIOS. Solo se pueden agregar a proyectos [DEMO]. ¿Continuar?",
        "Agregar 2 ejemplos"
    );
    if (!ok) return;

    const botonEjemplos = this;
    botonEjemplos.disabled = true;
    try {
        const respuesta = await llamar("/dashboard/ejemplos", {
            method: "POST",
            body: JSON.stringify({ proyecto_id: proyecto })
        });
        if (!respuesta) return;
        if (respuesta.status === 404) {
            mostrarToast("El servidor aún no reconoce esta función. Reinicia el backend y vuelve a intentarlo.", "error");
            return;
        }
        if (!respuesta.ok) {
            mostrarToast(await mensajeError(respuesta, "No se pudieron agregar los ejemplos."), "error");
            return;
        }

        const datos = await respuesta.json();
        const nombreProyecto = document.getElementById("selProyecto").selectedOptions[0].textContent.trim();
        mostrarToast(datos.existian
            ? "Los dos borradores de ejemplo ya existen para " + nombreProyecto + ". Revísalos y rectifícalos antes de activarlos."
            : "Se crearon dos borradores para " + nombreProyecto + ". Revísalos y rectifícalos antes de activarlos.",
        "exito");
        try {
            await cargarCalculos();
        } catch (error) {
            console.error("Las métricas de ejemplo se crearon, pero no se pudo actualizar su lista:", error);
        }
    } catch (error) {
        mostrarToast("No se pudo completar la creación de ejemplos. Inténtalo nuevamente.", "error");
    } finally {
        botonEjemplos.disabled = false;
    }
});

async function desactivarMetrica(m) {
    const ok = await confirmar("Desactivar métrica", "¿Desactivar \"" + m.nombre + "\"? Pasará al historial de métricas.", "Desactivar");
    if (!ok) return;
    const r = await llamar("/calculos/" + m.id + "/desactivar", { method: "PATCH" });
    if (!r) return;
    if (!r.ok) { mostrarToast(await mensajeError(r, "No se pudo desactivar"), "error"); return; }
    mostrarToast("Métrica desactivada: ahora está en el historial", "aviso");
    cargarCalculos();
}

async function eliminarBorrador(m) {
    const ok = await confirmar("Eliminar borrador", "¿Eliminar el borrador \"" + m.nombre + "\"?", "Eliminar");
    if (!ok) return;
    const r = await llamar("/calculos/" + m.id, { method: "DELETE" });
    if (!r) return;
    if (!r.ok) { mostrarToast(await mensajeError(r, "No se pudo eliminar"), "error"); return; }
    mostrarToast("Borrador eliminado", "exito");
    cargarCalculos();
}

// ----- Editor de métrica (borrador) -----
let proyectoModal = null;

function insertarEnEcuacion(texto) {
    const t = document.getElementById("metEcuacion");
    const ini = t.selectionStart ?? t.value.length, fin = t.selectionEnd ?? t.value.length;
    const antes = t.value.slice(0, ini), despues = t.value.slice(fin);
    const sep = (/\s$/.test(antes) || antes === "") ? "" : " ";
    t.value = antes + sep + texto + " " + despues;
    t.focus();
    const pos = (antes + sep + texto + " ").length;
    t.setSelectionRange(pos, pos);
}

function chip(texto, clase, accion) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-sm " + clase + " me-1 mb-1";
    b.textContent = texto;
    b.addEventListener("click", accion);
    return b;
}

async function abrirMetrica(m) {
    editandoMetricaId = m ? m.id : null;
    nombreTablaMetrica = m ? m.nombre_tabla : "";
    document.getElementById("panelRectificar").hidden = true;
    proyectoModal = m ? m.proyecto_id : Number(proyectoElegido());
    if (!Number.isInteger(proyectoModal) || !(await asegurarVariablesBeneficios(proyectoModal))) return;
    const nombreProy = m ? m.proyecto_nombre : (proyectos.find(p => p.id === proyectoModal) || {}).nombre;

    document.getElementById("tituloEditorMetrica").textContent = m ? "Editar borrador" : "Nueva métrica";
    document.getElementById("metProyectoTexto").textContent = nombreProy || "";
    document.getElementById("metNombre").value = m ? m.nombre : "";
    document.getElementById("metEcuacion").value = m ? m.ecuacion : "";
    document.getElementById("metDescripcion").value = (m && m.descripcion) ? m.descripcion : "";
    document.getElementById("metTipoResultado").value = m ? (m.tipo_resultado || "unica") : "";
    actualizarOpcionesGrupoGlobal();
    document.getElementById("metGrupoGlobal").value = m && m.grupo_global_id
        ? String(m.grupo_global_id)
        : "";
    actualizarCampoGrupoGlobal();
    const previa = document.getElementById("resultadoPrevia");
    previa.replaceChildren();
    previa.hidden = true;

    const ops = document.getElementById("chipsOperadores");
    ops.replaceChildren(...OPERADORES.map(o => chip(o, "btn-outline-secondary", () => insertarEnEcuacion(o))));

    const vars = document.getElementById("chipsVariables");
    const lista = variablesUtilizables(proyectoModal);
    vars.replaceChildren(...(lista.length
        ? lista.map(v => chip(v.nombre, "btn-outline-info", () => insertarEnEcuacion(v.nombre)))
        : [document.createTextNode("No hay variables disponibles.")]));

    const mets = document.getElementById("chipsMetricas");
    const activas = metricasDatos.filter(x => x.estado === "activa" && x.proyecto_id === proyectoModal);
    mets.replaceChildren(...(activas.length
        ? activas.map(x => chip(x.nombre, "btn-outline-success", () => insertarEnEcuacion(x.nombre)))
        : [document.createTextNode("Aún no hay métricas activas en este proyecto.")]));

    const editor = document.getElementById("editorMetrica");
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("metNombre").focus({ preventScroll: true });
}

// Muestra el resultado (o el error) en un contenedor
function pintarResultado(caja, datos, ok) {
    caja.replaceChildren();
    caja.hidden = false;
    if (!ok) {
        const d = document.createElement("div");
        d.className = "alert alert-danger mb-0";
        d.textContent = datos.mensaje || "No se pudo calcular";
        caja.append(d);
        return;
    }
    const t = document.createElement("table");
    t.className = "table table-sm table-hover align-middle mb-0";
    const encabezado = document.createElement("thead");
    const filaEncabezado = document.createElement("tr");
    ["Elemento", "Tipo", "Valor"].forEach(texto => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = texto;
        filaEncabezado.append(th);
    });
    encabezado.append(filaEncabezado);
    const cuerpo = document.createElement("tbody");
    const agregarFila = (nombre, tipo, valor, destacada = false) => {
        const fila = document.createElement("tr");
        if (destacada) fila.className = "table-active fw-semibold";
        [nombre, tipo, numeroEs(valor)].forEach((texto, indice) => {
            const celda = document.createElement("td");
            celda.textContent = texto;
            if (indice === 2) celda.className = "text-end";
            fila.append(celda);
        });
        cuerpo.append(fila);
    };
    datos.detalle.forEach(u => {
        agregarFila(u.nombre, u.tipo === "metrica" ? "Métrica" : "Variable", u.valor);
    });
    agregarFila(document.getElementById("metNombre").value.trim() || "Resultado", "Resultado", datos.resultado, true);
    t.append(encabezado, cuerpo);
    caja.append(t);
}

async function previsualizar(proyectoId, ecuacion) {
    const r = await llamar("/calculos/previsualizar", {
        method: "POST",
        body: JSON.stringify({ proyecto_id: proyectoId, ecuacion })
    });
    if (!r) return null;
    return { ok: r.ok, datos: await r.json() };
}

document.getElementById("btnPrevisualizar").addEventListener("click", async function () {
    const res = await previsualizar(proyectoModal, document.getElementById("metEcuacion").value);
    if (res) pintarResultado(document.getElementById("resultadoPrevia"), res.datos, res.ok);
});

function cerrarEditorMetrica() {
    document.getElementById("editorMetrica").hidden = true;
    document.getElementById("panelRectificar").hidden = true;
    document.getElementById("resultadoPrevia").replaceChildren();
    document.getElementById("resultadoPrevia").hidden = true;
    document.getElementById("metGrupoGlobal").value = "";
    actualizarCampoGrupoGlobal();
    editandoMetricaId = null;
    nombreTablaMetrica = "";
}

document.getElementById("btnCancelarMetrica").addEventListener("click", cerrarEditorMetrica);
document.getElementById("btnCancelarMetricaPie").addEventListener("click", cerrarEditorMetrica);

async function guardarMetrica() {
    const editando = editandoMetricaId !== null;
    const tipoResultado = document.getElementById("metTipoResultado").value;
    const grupoGlobal = document.getElementById("metGrupoGlobal").value;
    if (tipoResultado === "global" && !grupoGlobal) {
        mostrarToast("Selecciona un grupo para la métrica Global.", "aviso");
        document.getElementById("metGrupoGlobal").focus();
        return;
    }

    const respuesta = await llamar(editando ? "/calculos/" + editandoMetricaId : "/calculos", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify({
            proyecto_id: proyectoModal,
            nombre: document.getElementById("metNombre").value,
            nombre_tabla: nombreTablaMetrica || nombreTablaDesdeMetrica(document.getElementById("metNombre").value),
            ecuacion: document.getElementById("metEcuacion").value,
            descripcion: document.getElementById("metDescripcion").value,
            tipo_resultado: tipoResultado,
            grupo_global_id: grupoGlobal || null
        })
    });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo guardar la métrica"), "error");
        return;
    }

    cerrarEditorMetrica();
    mostrarToast("Borrador guardado. Usa \"Rectificar y enviar\" cuando esté listo", "exito");
    cargarCalculos();
}

// ----- Rectificar y previsualizar antes de enviar -----
let rectificando = null;
let resultadoRect = null;

function pintarVistaRectificar() {
    const caja = document.getElementById("recVista");
    caja.replaceChildren();
    if (!resultadoRect || !resultadoRect.ok) {
        pintarResultado(caja, resultadoRect ? resultadoRect.datos : { mensaje: "No se pudo calcular" }, false);
        return;
    }
    const { resultado, detalle } = resultadoRect.datos;
    const formato = document.querySelector('input[name="recFormato"]:checked').value;

    if (formato === "texto") {
        const pre = document.createElement("pre");
        pre.className = "mb-0";
        pre.textContent = detalle.map(u => "  " + u.nombre + " = " + numeroEs(u.valor)).join("\n") +
            "\n  " + rectificando.nombre + " = " + numeroEs(resultado);
        caja.append(pre);
    } else {
        const t = document.createElement("table");
        t.className = "table table-sm mb-0";
        const cab = document.createElement("thead");
        cab.innerHTML = "<tr><th>Concepto</th><th>Tipo</th><th class=\"text-end\">Valor</th></tr>";
        const cuerpo = document.createElement("tbody");
        const fila = (a, b, c, clase) => {
            const tr = document.createElement("tr");
            if (clase) tr.className = clase;
            [a, b, c].forEach((x, i) => { const td = document.createElement("td"); td.textContent = x; if (i === 2) td.className = "text-end"; tr.append(td); });
            cuerpo.append(tr);
        };
        detalle.forEach(u => fila(u.nombre, u.tipo === "metrica" ? "Métrica" : "Variable", numeroEs(u.valor)));
        fila(rectificando.nombre, "Resultado", numeroEs(resultado), "table-active fw-semibold");
        t.append(cab, cuerpo);
        caja.append(t);
    }
}

async function abrirRectificar(m) {
    rectificando = m;
    document.getElementById("recProyecto").textContent = m.proyecto_nombre;
    document.getElementById("recNombre").textContent = m.nombre;
    document.getElementById("recTipoResultado").textContent =
        m.tipo_resultado === "global"
            ? "Global — se sumará en el grupo " + (m.grupo_global_nombre || "seleccionado")
            : "Única — se mostrará por separado";
    document.getElementById("recEcuacion").textContent = m.ecuacion;
    document.getElementById("recTexto").checked = true;
    resultadoRect = await previsualizar(m.proyecto_id, m.ecuacion);
    pintarVistaRectificar();
    document.getElementById("btnEnviarMetrica").disabled = !(resultadoRect && resultadoRect.ok);
    document.getElementById("editorMetrica").hidden = true;
    const revision = document.getElementById("panelRectificar");
    revision.hidden = false;
    revision.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll('input[name="recFormato"]').forEach(r => r.addEventListener("change", pintarVistaRectificar));

document.getElementById("btnVolverEditar").addEventListener("click", function () {
    const m = rectificando;
    document.getElementById("panelRectificar").hidden = true;
    abrirMetrica(m);
});

document.getElementById("btnCerrarRectificar").addEventListener("click", function () {
    document.getElementById("panelRectificar").hidden = true;
    rectificando = null;
});

document.getElementById("btnEnviarMetrica").addEventListener("click", async function () {
    const r = await llamar("/calculos/" + rectificando.id + "/enviar", {
        method: "POST",
        body: JSON.stringify({ formato: document.querySelector('input[name="recFormato"]:checked').value })
    });
    if (!r) return;
    if (!r.ok) { mostrarToast(await mensajeError(r, "No se pudo enviar"), "error"); return; }
    document.getElementById("panelRectificar").hidden = true;
    rectificando = null;
    mostrarToast("Métrica enviada: ya está activa", "exito");
    cargarCalculos();
});

// 6. HISTORIALES DE MÉTRICAS (solo las desactivadas)
let historialDatos = [];

function pintarHistorial() {
    const texto = document.getElementById("histTexto").value.trim().toLowerCase();
    const dia = document.getElementById("histFecha").value; // YYYY-MM-DD

    const filas = historialDatos.filter(h =>
        (!texto || [h.nombre, h.grupo_global_nombre, h.desactivada_por].some(x => (x || "").toLowerCase().includes(texto))) &&
        (!dia || (h.desactivada_en && new Date(h.desactivada_en).toLocaleDateString("en-CA") === dia)));

    pintarTabla("tablaHistorial", filas, [
        (h, i) => i + 1,
        h => h.nombre,
        h => h.proyecto_nombre,
        h => etiquetaTipoResultado(h.tipo_resultado),
        h => h.grupo_global_nombre,
        h => codigo(h.ecuacion),
        h => fecha(h.desactivada_en),
        h => h.desactivada_por
    ], h => [
        boton("Activar", "btn-outline-success", () => activarMetrica(h))
    ]);
}

async function activarMetrica(h) {
    const ok = await confirmar("Activar métrica", "¿Activar de nuevo \"" + h.nombre + "\"? Saldrá del historial.", "Activar");
    if (!ok) return;
    const r = await llamar("/calculos/" + h.id + "/activar", { method: "PATCH" });
    if (!r) return;
    if (!r.ok) { mostrarToast(await mensajeError(r, "No se pudo activar"), "error"); return; }
    mostrarToast("Métrica activada", "exito");
    cargarHistorial();
}

async function cargarHistorial() {
    const respuesta = await llamar("/historial");
    if (!respuesta || !respuesta.ok) return;
    historialDatos = await respuesta.json();
    pintarHistorial();
}

["histTexto", "histFecha"].forEach(id =>
    document.getElementById(id).addEventListener("input", pintarHistorial));

// 7. USUARIOS (solo admin super)
let editandoUsuarioId = null;
let usuariosDatos = [];

function estadoUsuario(u) {
    if (u.desactivado) return "desactivado";
    return u.activo ? "activo" : "pendiente";
}

function inicialesUsuario(nombre) {
    return String(nombre || "?").trim().split(/\s+/).slice(0, 2)
        .map(parte => parte.charAt(0).toLocaleUpperCase("es"))
        .join("") || "?";
}

function actualizarResumenUsuarios(datos) {
    const pendientes = datos.filter(u => estadoUsuario(u) === "pendiente").length;
    document.getElementById("usuariosTotal").textContent = datos.length.toLocaleString("es-CO");
    document.getElementById("usuariosActivos").textContent =
        datos.filter(u => estadoUsuario(u) === "activo").length.toLocaleString("es-CO");
    document.getElementById("usuariosPendientes").textContent = pendientes.toLocaleString("es-CO");
    document.getElementById("usuariosDesactivados").textContent =
        datos.filter(u => estadoUsuario(u) === "desactivado").length.toLocaleString("es-CO");

    const contador = document.getElementById("contadorPendientes");
    contador.textContent = pendientes;
    contador.hidden = pendientes === 0;
}

function pintarUsuarios() {
    const busqueda = document.getElementById("buscarUsuario").value.trim().toLocaleLowerCase("es");
    const estadoSeleccionado = document.getElementById("filtroEstadoUsuario").value;
    const filtrados = usuariosDatos.filter(u => {
        const coincideBusqueda = !busqueda ||
            [u.nombre, u.email, ETIQUETA_ROL[u.rol] || u.rol, u.id]
                .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(busqueda);
        return coincideBusqueda &&
            (estadoSeleccionado === "todos" || estadoUsuario(u) === estadoSeleccionado);
    });

    pintarTabla("tablaUsuarios", filtrados, [
        u => {
            const cuenta = document.createElement("div");
            cuenta.className = "usuario-cuenta";
            const avatar = document.createElement("span");
            avatar.className = "usuario-avatar";
            avatar.setAttribute("aria-hidden", "true");
            avatar.textContent = inicialesUsuario(u.nombre);
            const datos = document.createElement("span");
            const nombre = document.createElement("span");
            nombre.className = "usuario-cuenta-nombre";
            nombre.textContent = u.nombre || "Sin nombre";
            const email = document.createElement("span");
            email.className = "usuario-cuenta-email";
            email.textContent = u.email || "Sin correo";
            const id = document.createElement("span");
            id.className = "usuario-id";
            id.textContent = "ID " + u.id;
            datos.append(nombre, email, id);
            cuenta.append(avatar, datos);
            return cuenta;
        },
        u => {
            const rol = document.createElement("span");
            rol.className = "usuario-rol";
            rol.dataset.rol = u.rol || "usuario";
            const icono = document.createElement("i");
            icono.className = u.rol === "admin_super" ? "bi bi-shield-fill-check" :
                u.rol === "admin" ? "bi bi-shield-check" : "bi bi-person";
            icono.setAttribute("aria-hidden", "true");
            rol.append(icono, document.createTextNode(ETIQUETA_ROL[u.rol] || u.rol || "Usuario"));
            return rol;
        },
        u => {
            const estado = estadoUsuario(u);
            const etiquetaEstado = document.createElement("span");
            etiquetaEstado.className = "usuario-estado";
            etiquetaEstado.dataset.estado = estado;
            etiquetaEstado.textContent = estado === "activo" ? "Activo" :
                estado === "pendiente" ? "Pendiente" : "Desactivado";
            return etiquetaEstado;
        }
    ], u => {
        const acciones = document.createElement("div");
        acciones.className = "usuario-acciones";
        const agregarAccion = (texto, clase, icono, accion) => {
            const control = boton(texto, clase, accion);
            control.classList.remove("ms-1");
            const iconoAccion = document.createElement("i");
            iconoAccion.className = "bi " + icono + " me-1";
            iconoAccion.setAttribute("aria-hidden", "true");
            control.prepend(iconoAccion);
            acciones.append(control);
        };

        agregarAccion("Editar", "btn-outline-info", "bi-pencil", () => abrirUsuario(u));
        if (u.desactivado) {
            agregarAccion("Reactivar", "btn-outline-success", "bi-person-check", () => activarUsuario(u));
            agregarAccion("Eliminar", "btn-outline-danger", "bi-trash3", () => eliminarUsuario(u, false));
        } else if (!u.activo) {
            agregarAccion("Activar", "btn-success", "bi-check2-circle", () => activarUsuario(u));
            agregarAccion("Rechazar", "btn-outline-danger", "bi-x-circle", () => eliminarUsuario(u, true));
        } else if (String(u.id) !== String(usuario.id)) {
            agregarAccion("Desactivar", "btn-outline-danger", "bi-person-dash", () => desactivarUsuario(u));
            agregarAccion("Eliminar", "btn-outline-danger", "bi-trash3", () => eliminarUsuario(u, false));
        }
        return [acciones];
    });
}

async function cargarUsuarios() {
    const respuesta = await llamar("/usuarios");
    if (!respuesta || !respuesta.ok) return;

    usuariosDatos = await respuesta.json();
    actualizarResumenUsuarios(usuariosDatos);
    pintarUsuarios();
}

document.getElementById("buscarUsuario").addEventListener("input", pintarUsuarios);
document.getElementById("filtroEstadoUsuario").addEventListener("change", pintarUsuarios);
document.getElementById("usRol").addEventListener("change", actualizarAyudaRolUsuario);

async function activarUsuario(u) {
    const respuesta = await llamar("/usuarios/" + u.id + "/activar", { method: "PATCH" });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo activar el usuario"), "error");
        return;
    }
    mostrarToast("Cuenta activada", "exito");
    cargarUsuarios();
}

async function desactivarUsuario(u) {
    const ok = await confirmar("Desactivar cuenta", "¿Desactivar la cuenta de " + u.email + "? No podrá ingresar hasta que la reactives.", "Desactivar");
    if (!ok) return;

    const respuesta = await llamar("/usuarios/" + u.id + "/desactivar", { method: "PATCH" });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo desactivar el usuario"), "error");
        return;
    }
    mostrarToast("Cuenta desactivada", "aviso");
    cargarUsuarios();
}

async function eliminarUsuario(u, esPendiente) {
    const ok = await confirmar(
        esPendiente ? "Rechazar solicitud" : "Eliminar usuario",
        esPendiente
            ? "¿Rechazar la solicitud de " + u.email + "? Se borrará su registro."
            : "¿Eliminar al usuario " + u.email + "? Esta acción no se puede deshacer.",
        esPendiente ? "Rechazar" : "Eliminar"
    );
    if (!ok) return;

    const respuesta = await llamar("/usuarios/" + u.id, { method: "DELETE" });
    if (!respuesta) return;

    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo eliminar el usuario"), "error");
        return;
    }
    mostrarToast("Usuario eliminado", "exito");
    cargarUsuarios();
}

function abrirUsuario(u) {
    editandoUsuarioId = u ? u.id : null;

    document.getElementById("tituloModalUsuario").textContent = u ? "Editar cuenta" : "Crear usuario";
    document.getElementById("subtituloModalUsuario").textContent = u
        ? "Actualiza la información y los permisos de " + u.email + "."
        : "Completa los datos de acceso y asigna los permisos adecuados.";
    document.getElementById("usNombre").value = u ? u.nombre : "";
    document.getElementById("usEmail").value = u ? u.email : "";
    document.getElementById("usPassword").value = "";
    document.getElementById("usRol").value = u ? u.rol : "usuario";
    document.getElementById("ayudaPassword").textContent = u
        ? "Déjala vacía para conservar la contraseña actual. Si la cambias, usa al menos 8 caracteres."
        : "Mínimo 8 caracteres.";
    document.getElementById("etiquetaPasswordOpcional").textContent = u ? "(opcional)" : "";

    // No puedes cambiarte el rol a ti mismo
    const esCuentaPropia = !!u && String(u.id) === String(usuario.id);
    document.getElementById("usRol").disabled = esCuentaPropia;
    document.getElementById("avisoRolPropio").hidden = !esCuentaPropia;
    const botonGuardarUsuario = document.getElementById("btnGuardarUsuario");
    const iconoGuardar = document.createElement("i");
    iconoGuardar.className = u ? "bi bi-check2 me-1" : "bi bi-person-plus me-1";
    iconoGuardar.setAttribute("aria-hidden", "true");
    botonGuardarUsuario.replaceChildren(
        iconoGuardar,
        document.createTextNode(u ? "Guardar cambios" : "Crear usuario")
    );
    actualizarAyudaRolUsuario();

    modal("modalUsuario").show();
}

function actualizarAyudaRolUsuario() {
    const ayuda = {
        usuario: {
            texto: "Puede consultar la información y los resultados del sistema.",
            icono: "bi-info-circle-fill"
        },
        admin: {
            texto: "Puede consultar y agregar información, variables y métricas.",
            icono: "bi-shield-check"
        },
        admin_super: {
            texto: "Tiene control completo: puede editar, administrar cuentas y eliminar registros.",
            icono: "bi-shield-fill-check"
        }
    }[document.getElementById("usRol").value];
    document.getElementById("usRolAyuda").textContent = ayuda.texto;
    document.getElementById("iconoAyudaRol").className = "bi " + ayuda.icono;
}

async function guardarUsuario() {
    const editando = editandoUsuarioId !== null;

    const cuerpo = {
        nombre: document.getElementById("usNombre").value,
        email: document.getElementById("usEmail").value,
        rol: document.getElementById("usRol").value
    };

    // Al editar, la contraseña solo se envía si escribieron una nueva
    const password = document.getElementById("usPassword").value;
    if (!editando || password !== "") cuerpo.password = password;

    const respuesta = await llamar(editando ? "/usuarios/" + editandoUsuarioId : "/usuarios", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify(cuerpo)
    });
    if (!respuesta) return;

    const datos = await respuesta.json();

    if (!respuesta.ok) {
        mostrarToast(datos.mensaje || "No se pudo guardar el usuario", "error");
        return;
    }

    // Si editaste tu propia cuenta, refrescar el nombre guardado y el del botón de perfil
    if (editando && datos.id === usuario.id) {
        usuario.nombre = datos.nombre;
        sessionStorage.setItem("usuario", JSON.stringify(usuario));
        pintarQuien();
    }

    modal("modalUsuario").hide();
    mostrarToast(editando ? "Cambios guardados" : "Usuario " + datos.email + " creado", "exito");
    cargarUsuarios();
}

// 7c. MI PERFIL
const panelPerfil = document.getElementById("perfil");

function actualizarResumenPerfil(datos) {
    document.getElementById("perfilResumenNombre").textContent = datos.nombre || "";
    document.getElementById("perfilResumenEmail").textContent = datos.email || "";
    document.getElementById("perfilResumenRol").textContent = ETIQUETA_ROL[datos.rol] || datos.rol || "";
}

function mostrarPanelAdministracion() {
    panelPerfil.hidden = true;
    document.getElementById("navAdministracion").hidden = false;
    document.getElementById("encabezadoSeccion").hidden = false;
    document.getElementById("contenidoAdministracion").hidden = false;
}

document.getElementById("btnPerfil").addEventListener("click", async function () {
    const respuesta = await llamar("/yo");
    if (!respuesta) return;
    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudo cargar tu perfil"), "error");
        return;
    }

    const datos = await respuesta.json();
    document.getElementById("perNombre").value = datos.nombre || "";
    document.getElementById("perEmail").value = datos.email || "";
    document.getElementById("perActual").value = "";
    document.getElementById("perNueva").value = "";
    document.getElementById("perConfirmar").value = "";
    actualizarResumenPerfil(datos);

    document.getElementById("navAdministracion").hidden = true;
    document.getElementById("encabezadoSeccion").hidden = true;
    document.getElementById("contenidoAdministracion").hidden = true;
    panelPerfil.hidden = false;
    panelPerfil.scrollIntoView({ behavior: "smooth", block: "start" });
});

if (window.location.hash === "#perfil") {
    document.getElementById("btnPerfil").click();
}

document.getElementById("btnVolverPanelTexto").textContent = perfilDesdeResumen
    ? "Volver al resumen"
    : "Volver al panel";
document.getElementById("btnVolverPanel").addEventListener("click", function (evento) {
    if (perfilDesdeResumen) {
        irAlResumenDesdePanel(evento);
        return;
    }
    mostrarPanelAdministracion();
});

document.getElementById("formPerfil").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const nueva = document.getElementById("perNueva").value;
    const confirmar = document.getElementById("perConfirmar").value;
    if (nueva !== confirmar) {
        mostrarToast("La nueva contraseña y su confirmación no coinciden.", "error");
        document.getElementById("perConfirmar").focus();
        return;
    }
    if (Boolean(nueva) !== Boolean(document.getElementById("perActual").value)) {
        mostrarToast("Para cambiar la contraseña, completa la contraseña actual y la nueva.", "aviso");
        return;
    }

    const botonGuardar = document.getElementById("btnGuardarPerfil");
    botonGuardar.disabled = true;
    try {
        const respuesta = await llamar("/perfil", {
            method: "PUT",
            body: JSON.stringify({
                nombre: document.getElementById("perNombre").value,
                email: document.getElementById("perEmail").value,
                passwordActual: document.getElementById("perActual").value,
                passwordNueva: nueva
            })
        });
        if (!respuesta) return;
        if (!respuesta.ok) {
            mostrarToast(await mensajeError(respuesta, "No se pudo guardar el perfil"), "error");
            return;
        }

        const nuevo = await respuesta.json();
        usuario.nombre = nuevo.nombre;
        usuario.rol = nuevo.rol;
        sessionStorage.setItem("usuario", JSON.stringify(usuario));
        pintarQuien();
        actualizarResumenPerfil(nuevo);
        document.getElementById("perActual").value = "";
        document.getElementById("perNueva").value = "";
        document.getElementById("perConfirmar").value = "";
        mostrarToast("Cambios del perfil guardados.", "exito");
    } catch (error) {
        mostrarToast("No se pudieron guardar los cambios del perfil.", "error");
    } finally {
        botonGuardar.disabled = false;
    }
});

function dibujarComparacionMensual(datos) {
    const contenedor = document.getElementById("comparacionMensualTabla");
    contenedor.replaceChildren();
    const aviso = document.getElementById("avisoComparacionMensual");
    const registrosAnio = Number(datos.cobertura_temporal && datos.cobertura_temporal.registros_en_anio) || 0;
    const registrosConVigencia = Number(datos.cobertura_temporal && datos.cobertura_temporal.registros_con_vigencia) || 0;
    if (datos.fuente_temporal === "sin_vigencias") {
        aviso.textContent = "La tabla BENEFICIOS conectada no tiene fechas de vigencia. MIDAS no puede distinguir los datos de cada mes y mostrará la misma base; no inventa valores. Para obtener diferencias reales se requieren registros con fechas mensuales.";
        aviso.classList.add("text-warning");
    } else if (registrosAnio === 0) {
        aviso.textContent = "No hay registros de BENEFICIOS vigentes en " + datos.anio + ". La comparación no tiene datos de ese año.";
        aviso.classList.add("text-warning");
    } else if (registrosConVigencia === 0) {
        aviso.textContent = "BENEFICIOS no tiene registros con fechas de vigencia para " + datos.anio + ". Los registros sin fecha se consideran vigentes todo el año; por eso los meses pueden dar el mismo valor.";
        aviso.classList.add("text-warning");
    } else {
        aviso.textContent = registrosConVigencia + " de " + registrosAnio +
            " registros vigentes tienen fechas. Cada mes suma los beneficios vigentes en ese periodo; si un beneficio mantiene la misma vigencia y cantidad en ambos meses, su aporte será igual. MIDAS no conserva históricos mensuales. Las variables personalizadas usan su valor actual.";
        aviso.classList.remove("text-warning");
    }

    if (!datos.grupos.length) {
        contenedor.textContent = "No hay métricas Globales activas asignadas a grupos. Activa métricas y asígnalas a un grupo para compararlas.";
        return;
    }

    const meses = Array.isArray(datos.meses) ? datos.meses : [];
    if (meses.length !== 2) {
        contenedor.textContent = "Selecciona dos meses distintos para ver la comparación.";
        return;
    }

    const tabla = document.createElement("table");
    tabla.className = "table table-dark table-hover table-bordered align-middle comparacion-mensual-tabla";
    const encabezado = document.createElement("thead");
    const filaEncabezado = document.createElement("tr");
    ["Grupo Global", nombreMesComparacion(meses[0].numero), nombreMesComparacion(meses[1].numero), "Diferencia"].forEach((titulo, indice) => {
        const celda = document.createElement("th");
        celda.scope = "col";
        celda.textContent = titulo;
        if (indice === 1 || indice === 2) {
            celda.textContent += " " + datos.anio;
        }
        filaEncabezado.append(celda);
    });
    encabezado.append(filaEncabezado);

    const cuerpo = document.createElement("tbody");
    let gruposIguales = 0;
    datos.grupos.forEach(grupo => {
        const fila = document.createElement("tr");
        const encabezadoGrupo = document.createElement("th");
        encabezadoGrupo.scope = "row";
        encabezadoGrupo.textContent = grupo.nombre;
        if (grupo.descripcion) {
            const descripcion = document.createElement("small");
            descripcion.className = "comparacion-mensual-grupo-descripcion";
            descripcion.textContent = grupo.descripcion;
            encabezadoGrupo.append(descripcion);
        }
        fila.append(encabezadoGrupo);

        const valores = meses.map(mes => {
            const valorGrupo = mes.valores.find(valor => valor.grupo_id === grupo.id);
            const valor = valorGrupo && valorGrupo.valor !== null &&
                valorGrupo.valor !== undefined && Number.isFinite(Number(valorGrupo.valor))
                ? Number(valorGrupo.valor)
                : null;
            const celda = document.createElement("td");
            if (valor === null) {
                const sinDatos = document.createElement("span");
                sinDatos.className = "comparacion-mensual-valor text-warning";
                sinDatos.textContent = "No disponible";
                celda.append(sinDatos);
                celda.title = valorGrupo && valorGrupo.metricas_con_error
                    ? "No se pudieron calcular " + valorGrupo.metricas_con_error + " métricas de este grupo."
                    : "No se calculó ninguna métrica para este mes.";
            } else {
                const cifra = document.createElement("span");
                cifra.className = "comparacion-mensual-valor";
                cifra.textContent = numeroEs(valor);
                celda.append(cifra);
                if (valorGrupo.metricas_con_error > 0) {
                    const parcial = document.createElement("small");
                    parcial.className = "comparacion-mensual-parcial";
                    parcial.textContent = "Parcial";
                    parcial.title = "No se pudieron calcular " + valorGrupo.metricas_con_error + " métricas de este grupo.";
                    celda.append(parcial);
                }
            }
            const coberturaMes = document.createElement("small");
            coberturaMes.className = "comparacion-mensual-cobertura-mes";
            coberturaMes.textContent = (valorGrupo ? valorGrupo.metricas_calculadas : 0) +
                "/" + (grupo.metricas_asignadas || 0) + " métricas";
            celda.append(coberturaMes);
            fila.append(celda);
            return { valor, valorGrupo };
        });

        const diferenciaCelda = document.createElement("td");
        const [valorA, valorB] = valores;
        if (valorA.valor === null || valorB.valor === null ||
            !valorA.valorGrupo || !valorB.valorGrupo ||
            valorA.valorGrupo.metricas_con_error > 0 || valorB.valorGrupo.metricas_con_error > 0) {
            diferenciaCelda.textContent = "No disponible";
            diferenciaCelda.classList.add("text-warning");
            diferenciaCelda.title = "La diferencia requiere que las métricas del grupo se calculen en ambos meses.";
        } else {
            const diferencia = valorB.valor - valorA.valor;
            const resultado = document.createElement("span");
            resultado.className = "comparacion-mensual-valor comparacion-mensual-diferencia";
            resultado.dataset.direccion = diferencia > 0 ? "sube" : diferencia < 0 ? "baja" : "igual";
            resultado.textContent = (diferencia > 0 ? "+" : "") + numeroEs(diferencia);
            diferenciaCelda.append(resultado);
            const porcentaje = document.createElement("small");
            porcentaje.className = "comparacion-mensual-cobertura-mes";
            porcentaje.textContent = valorA.valor === 0
                ? (diferencia === 0 ? "0%" : "Base inicial 0")
                : (diferencia > 0 ? "+" : "") + numeroEs(diferencia / Math.abs(valorA.valor) * 100) + "%";
            diferenciaCelda.append(porcentaje);
            if (diferencia === 0) gruposIguales++;
        }
        fila.append(diferenciaCelda);
        cuerpo.append(fila);
    });
    tabla.append(encabezado, cuerpo);
    contenedor.append(tabla);
    if (gruposIguales === datos.grupos.length) {
        const avisoIgual = document.createElement("p");
        avisoIgual.className = "small text-warning px-3 py-2 mb-0";
        avisoIgual.textContent = "Los grupos tienen el mismo total en ambos meses. Esto ocurre cuando los BENEFICIOS conectados conservan los mismos valores y vigencia; para ver cambios reales, PRISMA debe tener cantidades o vigencias distintas por mes.";
        contenedor.append(avisoIgual);
    }
}

function nombreMesComparacion(numeroMes) {
    const nombre = new Intl.DateTimeFormat("es-CO", {
        month: "long",
        timeZone: "UTC"
    }).format(new Date(Date.UTC(2026, numeroMes - 1, 1)));
    return nombre.charAt(0).toLocaleUpperCase("es") + nombre.slice(1);
}

let generacionComparacionMensual = 0;

async function cargarComparacionMensual(forzar = false) {
    const generacion = ++generacionComparacionMensual;
    const anioInput = document.getElementById("anioComparacionMensual");
    const boton = document.getElementById("btnCargarComparacionMensual");
    const estado = document.getElementById("estadoComparacionMensual");
    const contenedor = document.getElementById("comparacionMensualTabla");
    const panel = document.getElementById("panel-comparacion-mensual");
    const anio = Number(anioInput.value);
    const meses = [
        Number(document.getElementById("mesComparacionA").value),
        Number(document.getElementById("mesComparacionB").value)
    ];
    const claveMeses = meses.join(",");
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2100) {
        boton.disabled = false;
        estado.textContent = "Escribe un año entre 1900 y 2100.";
        anioInput.focus();
        return false;
    }
    if (meses[0] === meses[1]) {
        boton.disabled = false;
        estado.textContent = "Elige dos meses diferentes para compararlos.";
        contenedor.textContent = "Selecciona dos meses distintos para ver la comparación.";
        return false;
    }
    if (!forzar && panel.dataset.loadedYear === String(anio) &&
        panel.dataset.loadedMonths === claveMeses) {
        boton.disabled = false;
        return true;
    }

    boton.disabled = true;
    estado.textContent = "Calculando la comparación…";
    contenedor.textContent = "Calculando los resultados de los dos meses…";
    try {
        const respuesta = await llamar(
            "/dashboard/comparacion-mensual?anio=" + encodeURIComponent(anio) +
            "&meses=" + encodeURIComponent(claveMeses)
        );
        if (!respuesta) {
            if (generacion !== generacionComparacionMensual) return false;
            estado.textContent = "No se pudo cargar la comparación mensual.";
            contenedor.textContent = estado.textContent;
            return false;
        }
        if (!respuesta.ok) {
            if (generacion !== generacionComparacionMensual) return false;
            estado.textContent = await mensajeError(respuesta, "No se pudo cargar la comparación mensual.");
            contenedor.textContent = estado.textContent;
            return false;
        }
        const datos = await respuesta.json();
        if (generacion !== generacionComparacionMensual) return false;
        dibujarComparacionMensual(datos);
        panel.dataset.loadedYear = String(datos.anio);
        panel.dataset.loadedMonths = claveMeses;
        estado.textContent = "Comparación " + nombreMesComparacion(meses[0]) + " vs. " +
            nombreMesComparacion(meses[1]) + " de " + datos.anio + " lista.";
        return true;
    } catch (error) {
        if (generacion !== generacionComparacionMensual) return false;
        console.error("No se pudo cargar la comparación mensual:", error);
        estado.textContent = "No se pudo procesar la comparación mensual.";
        contenedor.textContent = estado.textContent;
        return false;
    } finally {
        if (generacion === generacionComparacionMensual) boton.disabled = false;
    }
}

document.getElementById("anioComparacionMensual").value = String(new Date().getFullYear());
document.getElementById("formComparacionMensual").addEventListener("submit", evento => {
    evento.preventDefault();
    cargarComparacionMensual(true);
});
["mesComparacionA", "mesComparacionB", "anioComparacionMensual"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
        cargarComparacionMensual(true);
    });
});

// 8. Pestañas: cada una carga sus datos al mostrarse
const CARGADORES = {
    "#panel-variables": cargarVariables,
    "#panel-calculos": cargarCalculos,
    "#panel-grupos": cargarGruposGlobales,
    "#panel-comparacion-mensual": () => cargarComparacionMensual(),
    "#panel-metricas": cargarCalculos,
    "#panel-historial": cargarHistorial,
    "#panel-usuarios": cargarUsuarios
};

document.querySelectorAll('[data-bs-toggle="tab"]').forEach(boton => {
    boton.addEventListener("click", function () {
        bootstrap.Tab.getOrCreateInstance(boton).show();
    });
    boton.addEventListener("shown.bs.tab", function (evento) {
        // El encabezado muestra el título de la sección elegida
        if (evento.target.dataset.titulo) {
            document.getElementById("tituloSeccion").textContent = evento.target.dataset.titulo;
            document.getElementById("subtituloSeccion").textContent = evento.target.dataset.sub || "";
        }
        const cargar = CARGADORES[evento.target.getAttribute("data-bs-target")];
        if (cargar) cargar();
    });
});

// 9. Botones de los modales (los de "agregar" solo existen si tu rol lo permite)
document.getElementById("btnNuevaVariable")?.addEventListener("click", () => abrirVariable(null));
document.getElementById("btnNuevaMetrica")?.addEventListener("click", () => abrirMetrica(null));
document.getElementById("btnNuevoUsuario")?.addEventListener("click", () => abrirUsuario(null));

document.getElementById("btnGuardarVariable").addEventListener("click", guardarVariable);
document.getElementById("btnGuardarMetrica").addEventListener("click", guardarMetrica);
document.getElementById("btnGuardarUsuario").addEventListener("click", guardarUsuario);
document.getElementById("metTipoResultado").addEventListener("change", actualizarCampoGrupoGlobal);
document.getElementById("formGrupoGlobal")?.addEventListener("submit", guardarGrupoGlobal);
document.getElementById("btnNuevoGrupoGlobal")?.addEventListener("click", () => abrirGrupoGlobal(null));
document.getElementById("btnCancelarGrupoGlobal")?.addEventListener("click", cerrarEditorGrupoGlobal);

// "Usuarios" vive ahora en el menú del perfil: abre la pestaña oculta del lateral
document.getElementById("btnIrUsuarios")?.addEventListener("click", function () {
    mostrarPanelAdministracion();
    bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-bs-target="#panel-usuarios"]')).show();
});

// 10. Vigilar la sesión
// Si te cambian el rol, la pantalla se recarga sola con los permisos nuevos.
// Si desactivan o eliminan tu cuenta, llamar() recibe un 401 y cierra la sesión.
async function revisarRol() {
    if (revisandoRol) return;
    revisandoRol = true;

    try {
        const respuesta = await llamar("/yo");
        if (!respuesta || !respuesta.ok) return;

        const actual = await respuesta.json();

        if (actual.rol !== usuario.rol || actual.nombre !== usuario.nombre) {
            if (actual.rol !== usuario.rol) {
                sessionStorage.setItem("avisoRol", "Tu rol cambió a " + (ETIQUETA_ROL[actual.rol] || actual.rol));
            }
            sessionStorage.setItem("usuario", JSON.stringify({
                id: actual.id,
                nombre: actual.nombre,
                rol: actual.rol
            }));
            window.location.reload();
        }
    } finally {
        revisandoRol = false;
    }
}

// Revisa periódicamente y también al volver a la pestaña o ventana.
setInterval(function () { if (!document.hidden) revisarRol(); }, 30000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) revisarRol(); });
window.addEventListener("focus", revisarRol);

// 11. Carga primero los datos necesarios para la pestaña visible.
Promise.all([cargarProyectos(), cargarVariables()]).then(function () {
    revisarRol();

    // Tras una recarga por cambio de rol, se avisa en una tarjeta
    const aviso = sessionStorage.getItem("avisoRol");
    if (aviso) {
        sessionStorage.removeItem("avisoRol");
        mostrarToast(aviso, "aviso");
    }
    if (esSuper) cargarUsuarios();
});