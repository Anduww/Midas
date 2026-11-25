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
    return etiqueta(tipo === "global" ? "Global" : "Ãšnica", tipo === "global" ? "primary" : "secondary");
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
if (usuario.rol === "usuario") {
    document.getElementById("navAdministracion").hidden = true;
    document.getElementById("encabezadoSeccion").hidden = true;
    document.getElementById("contenidoAdministracion").hidden = true;
}

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

const catalogosPrismaPorProyecto = new Map();

function claveUsoVariablesPrisma(fuente) {
    return "midas:variables-uso:" + fuente;
}

function obtenerUsoVariablesPrisma(fuente) {
    try {
        const guardado = JSON.parse(localStorage.getItem(claveUsoVariablesPrisma(fuente)) || "{}");
        return guardado && typeof guardado === "object" ? guardado : {};
    } catch (error) {
        return {};
    }
}

function variablePrismaHabilitada(fuente, nombre) {
    const uso = obtenerUsoVariablesPrisma(fuente);
    if (!Object.prototype.hasOwnProperty.call(uso, nombre)) return true;
    return uso[nombre] !== false;
}

function establecerVariablePrismaHabilitada(fuente, nombre, habilitada) {
    const uso = obtenerUsoVariablesPrisma(fuente);
    uso[nombre] = Boolean(habilitada);
    localStorage.setItem(claveUsoVariablesPrisma(fuente), JSON.stringify(uso));
}

function numeroFormateado(valor) {
    return Number(valor).toLocaleString("es-CO", { maximumFractionDigits: 4 });
}

function estadoValorVariablePrisma(variable) {
    if (!variable.disponible) {
        return etiqueta(variable.motivo || "No disponible", "secondary");
    }
    if (variable.valor === null || variable.valor === undefined || !Number.isFinite(Number(variable.valor))) {
        return etiqueta("Sin datos", "secondary");
    }
    return document.createTextNode(numeroFormateado(variable.valor));
}

function crearControlUsoVariablePrisma(variable) {
    const contenedor = document.createElement("label");
    contenedor.className = "form-check form-switch mb-0 d-inline-flex align-items-center gap-2";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.checked = variablePrismaHabilitada(variable.fuente, variable.nombre);
    input.disabled = !variable.disponible;
    input.addEventListener("change", function () {
        establecerVariablePrismaHabilitada(variable.fuente, variable.nombre, input.checked);
        if (String(proyectoModal || "") && document.getElementById("selProyectoVariables").value === String(proyectoModal || "")) {
            actualizarChipsEcuacion();
        } else if (!document.getElementById("editorMetrica").hidden) {
            actualizarChipsEcuacion();
        }
    });
    const texto = document.createElement("span");
    texto.className = "small";
    texto.textContent = input.checked ? "Disponible" : "Oculta";
    input.addEventListener("change", function () {
        texto.textContent = input.checked ? "Disponible" : "Oculta";
    });
    contenedor.append(input, texto);
    return contenedor;
}

function pintarFuentePrisma(fuente) {
    const tarjeta = document.createElement("details");
    tarjeta.className = "border rounded";

    const resumen = document.createElement("summary");
    resumen.className = "d-flex flex-wrap justify-content-between align-items-center gap-2 p-3";
    resumen.style.cursor = "pointer";

    const tituloContenedor = document.createElement("div");
    const titulo = document.createElement("div");
    titulo.className = "fw-semibold";
    titulo.textContent = fuente.nombre;
    const descripcion = document.createElement("div");
    descripcion.className = "small text-body-secondary";
    descripcion.textContent = fuente.descripcion || "";
    tituloContenedor.append(titulo, descripcion);

    const estado = document.createElement("div");
    estado.className = "d-flex align-items-center gap-2";
    estado.append(etiqueta(fuente.disponible ? "Disponible" : "No disponible", fuente.disponible ? "success" : "secondary"));
    resumen.append(tituloContenedor, estado);
    tarjeta.append(resumen);

    const contenido = document.createElement("div");
    contenido.className = "px-3 pb-3 border-top";

    if (!fuente.disponible) {
        const aviso = document.createElement("div");
        aviso.className = "alert alert-secondary py-2 px-3 small mb-0 mt-3";
        aviso.textContent = fuente.motivo || "Esta fuente no está disponible en PRISMA para este proyecto.";
        contenido.append(aviso);
        tarjeta.append(contenido);
        return tarjeta;
    }

    const tablaContenedor = document.createElement("div");
    tablaContenedor.className = "table-responsive mt-3";
    const tabla = document.createElement("table");
    tabla.className = "table table-sm table-hover align-middle mb-0";
    tabla.innerHTML = `<thead class="text-nowrap">
        <tr>
            <th>Variable</th>
            <th>Valor calculado</th>
            <th>Registros</th>
            <th>Uso en c?lculos</th>
        </tr>
    </thead>`;
    const cuerpo = document.createElement("tbody");

    (fuente.variables || []).forEach(variable => {
        const fila = document.createElement("tr");
        if (!variable.disponible) fila.classList.add("text-body-secondary");

        const celdaNombre = document.createElement("td");
        const nombre = document.createElement("div");
        nombre.className = "fw-semibold";
        nombre.textContent = variable.etiqueta || variable.nombre;
        celdaNombre.append(nombre);
        if (variable.descripcion) {
            const detalle = document.createElement("div");
            detalle.className = "small text-body-secondary";
            detalle.textContent = variable.descripcion;
            celdaNombre.append(detalle);
        }

        const celdaValor = document.createElement("td");
        celdaValor.append(estadoValorVariablePrisma(variable));

        const celdaRegistros = document.createElement("td");
        celdaRegistros.textContent = Number(variable.registros || 0).toLocaleString("es-CO");

        const celdaUso = document.createElement("td");
        if (variable.disponible) {
            celdaUso.append(crearControlUsoVariablePrisma(variable));
        } else {
            celdaUso.append(etiqueta("No aplica", "secondary"));
        }

        fila.append(celdaNombre, celdaValor, celdaRegistros, celdaUso);
        cuerpo.append(fila);
    });

    tabla.append(cuerpo);
    tablaContenedor.append(tabla);
    contenido.append(tablaContenedor);
    tarjeta.append(contenido);
    return tarjeta;
}

function pintarFuentesPrisma(proyectoId) {
    const contenedor = document.getElementById("contenedorFuentesPrisma");
    const estado = document.getElementById("estadoFuentesPrisma");
    contenedor.replaceChildren();

    const clave = String(proyectoId || "");
    const catalogo = catalogosPrismaPorProyecto.get(clave);
    if (!proyectoId || !catalogo) {
        estado.textContent = proyectos.length
            ? "Selecciona un proyecto en Cálculos de métricas por proyecto para ver sus variables."
            : "No hay proyectos disponibles para mostrar variables.";
        return;
    }

    estado.textContent = "Abre cada fuente para ver sus variables disponibles y elegir cuáles pueden usarse en las métricas.";
    (catalogo.fuentes || []).forEach(fuente => contenedor.append(pintarFuentePrisma(fuente)));
}

async function asegurarCatalogoPrisma(proyectoId, opciones = {}) {
    const clave = String(proyectoId || "");
    if (!clave) return false;
    if (catalogosPrismaPorProyecto.has(clave)) return true;
    const respuesta = await llamar("/variables/prisma?proyecto_id=" + encodeURIComponent(clave));
    if (!respuesta) return false;
    if (!respuesta.ok) {
        mostrarToast(await mensajeError(respuesta, "No se pudieron cargar las fuentes de variables de PRISMA."), "error");
        return false;
    }
    catalogosPrismaPorProyecto.set(clave, await respuesta.json());
    if (opciones.actualizarVista && String(proyectoElegido() || "") === clave) {
        pintarFuentesPrisma(clave);
    }
    return true;
}

function variablesPrismaDelProyecto(proyectoId, fuenteClave = null, soloHabilitadas = true) {
    const catalogo = catalogosPrismaPorProyecto.get(String(proyectoId));
    if (!catalogo) return [];
    const fuentes = (catalogo.fuentes || []).filter(fuente => !fuenteClave || fuente.clave === fuenteClave);
    return fuentes.flatMap(fuente => (fuente.variables || [])
        .filter(variable => variable.disponible && variable.valor !== null && Number.isFinite(Number(variable.valor)))
        .filter(variable => !soloHabilitadas || variablePrismaHabilitada(variable.fuente, variable.nombre))
        .map(variable => ({ ...variable, fuente: fuente.clave, fuenteNombre: fuente.nombre })));
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

    const select = document.getElementById("selProyecto");
    while (select.options.length > 1) select.remove(1);
    proyectos.forEach(p => {
        const op = document.createElement("option");
        op.value = p.id;
        op.textContent = p.nombre;
        select.append(op);
    });

    if (!select.value && proyectos.length) {
        select.value = String(proyectos[0].id);
    }

    if (select.value) {
        if (await asegurarCatalogoPrisma(select.value)) {
            pintarFuentesPrisma(select.value);
        }
    } else {
        pintarFuentesPrisma("");
    }
}

function cerrarEditorVariable() {
    editandoVariableId = null;
    const editor = document.getElementById("editorVariable");
    if (editor) editor.hidden = true;
}

async function abrirVariable(v) {
    if (!(await cargarPaises())) return;
    editandoVariableId = v ? v.id : null;
    const titulo = document.getElementById("tituloEditorVariable");
    if (titulo) titulo.textContent = v ? "Editar variable personalizada" : "Agregar variable personalizada";
    document.getElementById("varNombre").value = v ? v.nombre : "";
    document.getElementById("varValor").value = v && v.valor !== null && v.valor !== undefined ? Number(v.valor) : "";
    document.getElementById("varPais").value = v && v.pais_codigo ? v.pais_codigo : "";

    const editor = document.getElementById("editorVariable");
    if (editor) {
        editor.hidden = false;
        editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    document.getElementById("varNombre").focus();
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

    cerrarEditorVariable();
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

function variablesPersonalizadasUtilizables(proyId) {
    const reservadas = new Set(
        variablesPrismaDelProyecto(proyId, null, false).map(variable => variable.nombre.toLowerCase())
    );
    return variablesDatos.filter(v =>
        v.habilitada &&
        (v.proyecto_id === null || String(v.proyecto_id) === String(proyId)) &&
        !reservadas.has(v.nombre.toLowerCase()));
}

function etiquetaChipVariable(variable, esPersonalizada = false) {
    if (esPersonalizada) return variable.nombre;
    return variable.etiqueta || variable.nombre;
}

function actualizarChipsEcuacion() {
    const contenedor = document.getElementById("chipsVariables");
    const selectorFuente = document.getElementById("metFuenteVariables");
    const ayuda = document.getElementById("ayudaFuenteVariables");
    if (!contenedor || !selectorFuente) return;

    if (!Number.isInteger(proyectoModal)) {
        contenedor.replaceChildren(document.createTextNode("Selecciona un proyecto para ver variables."));
        if (ayuda) ayuda.textContent = "Selecciona una fuente para ver sus variables disponibles.";
        return;
    }

    const fuenteClave = selectorFuente.value === "ejecuciones_automatizacion"
        ? "ejecuciones_automatizacion"
        : "beneficios";
    if (selectorFuente.value !== fuenteClave) selectorFuente.value = fuenteClave;

    const catalogo = catalogosPrismaPorProyecto.get(String(proyectoModal));
    const fuente = catalogo ? (catalogo.fuentes || []).find(item => item.clave === fuenteClave) : null;
    const listaFuente = variablesPrismaDelProyecto(proyectoModal, fuenteClave, true);
    const personalizadas = variablesPersonalizadasUtilizables(proyectoModal);

    if (ayuda) {
        const base = fuente
            ? (fuente.descripcion + (fuente.disponible ? "" : " " + (fuente.motivo || "")))
            : "Selecciona una fuente para ver sus variables disponibles.";
        ayuda.textContent = base + " Las variables personalizadas tambi?n est?n disponibles.";
    }

    const nodos = [];

    if (listaFuente.length) {
        nodos.push(...listaFuente.map(variable => {
            const botonChip = chip(etiquetaChipVariable(variable, false), "btn-outline-info", () => insertarEnEcuacion(variable.nombre));
            botonChip.title = variable.nombre + (variable.etiqueta && variable.etiqueta !== variable.nombre ? " ? " + variable.etiqueta : "");
            if (variable.etiqueta && variable.etiqueta !== variable.nombre) {
                botonChip.classList.add("text-start");
            }
            return botonChip;
        }));
    } else {
        const aviso = document.createElement("div");
        aviso.className = "small text-body-secondary mb-2";
        aviso.textContent = fuente && !fuente.disponible
            ? (fuente.motivo || "La fuente no est? disponible en PRISMA.")
            : "No hay variables disponibles para usar en esta fuente. Revisa la selecci?n en la secci?n Variables.";
        nodos.push(aviso);
    }

    if (personalizadas.length) {
        const separador = document.createElement("div");
        separador.className = "small text-body-secondary " + (listaFuente.length ? "mt-2 mb-1" : "mb-1");
        separador.textContent = "Variables personalizadas";
        nodos.push(separador);
        nodos.push(...personalizadas.map(variable => {
            const botonChip = chip(etiquetaChipVariable(variable, true), "btn-outline-warning", () => insertarEnEcuacion(variable.nombre));
            botonChip.title = variable.nombre;
            return botonChip;
        }));
    }

    if (!listaFuente.length && !personalizadas.length) {
        nodos.length = 0;
        nodos.push(document.createTextNode(fuente && !fuente.disponible
            ? (fuente.motivo || "La fuente no est? disponible en PRISMA y no hay variables personalizadas activas.")
            : "No hay variables disponibles en esta fuente ni variables personalizadas activas."));
    }

    contenedor.replaceChildren(...nodos);
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
        m => "Capa " + (m.capa || 1),
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
        m => "Capa " + (m.capa || 1),
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
    if (this.value) {
        if (await asegurarCatalogoPrisma(this.value)) {
            pintarFuentesPrisma(this.value);
        }
    } else {
        pintarFuentesPrisma("");
    }
    if (!document.getElementById("editorMetrica").hidden && String(proyectoModal || "") === String(this.value)) {
        actualizarChipsEcuacion();
    }
    pintarCalculos();
});
document.getElementById("metFuenteVariables")?.addEventListener("change", actualizarChipsEcuacion);
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
    if (!Number.isInteger(proyectoModal)) return;
    await Promise.all([
        variablesCargadas ? Promise.resolve(true) : cargarVariables(),
        asegurarCatalogoPrisma(proyectoModal)
    ]);

    const nombreProy = m ? m.proyecto_nombre : (proyectos.find(p => p.id === proyectoModal) || {}).nombre;

    document.getElementById("tituloEditorMetrica").textContent = m ? "Editar borrador" : "Nueva métrica";
    document.getElementById("metProyectoTexto").textContent = nombreProy || "";
    document.getElementById("metNombre").value = m ? m.nombre : "";
    document.getElementById("metEcuacion").value = m ? m.ecuacion : "";
    document.getElementById("metDescripcion").value = (m && m.descripcion) ? m.descripcion : "";
    document.getElementById("metCapa").value = m ? String(m.capa || 1) : "1";
    document.getElementById("metTipoResultado").value = m ? (m.tipo_resultado || "unica") : "";
    actualizarOpcionesGrupoGlobal();
    document.getElementById("metGrupoGlobal").value = m && m.grupo_global_id
        ? String(m.grupo_global_id)
        : "";
    actualizarCampoGrupoGlobal();
    const previa = document.getElementById("resultadoPrevia");
    previa.replaceChildren();
    previa.hidden = true;

    const selectorFuente = document.getElementById("metFuenteVariables");
    if (selectorFuente && !selectorFuente.value) selectorFuente.value = "beneficios";

    const ops = document.getElementById("chipsOperadores");
    ops.replaceChildren(...OPERADORES.map(o => chip(o, "btn-outline-secondary", () => insertarEnEcuacion(o))));

    actualizarChipsEcuacion();

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
            capa: Number(document.getElementById("metCapa").value),
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

// 6. HISTORIALES DE MÃ‰TRICAS (solo las desactivadas)
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

    if (!cuerpo.email.trim().toLowerCase().endsWith("@sonda.com")) {
        mostrarToast("El correo debe ser corporativo (@sonda.com)", "error");
        document.getElementById("usEmail").focus();
        return;
    }

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

function alternarMenuPerfil(enPerfil) {
    document.querySelectorAll(".dropdown-menu .solo-super").forEach(el => {
        el.hidden = !esSuper || perfilDesdeResumen;
    });
    const btnVolverResumen = document.getElementById("btnVolverResumen");
    if (btnVolverResumen) {
        btnVolverResumen.classList.toggle("d-none", !!enPerfil);
        btnVolverResumen.classList.toggle("d-flex", !enPerfil);
    }
    const btnVolverPanel = document.getElementById("btnVolverPanel");
    if (btnVolverPanel) {
        btnVolverPanel.hidden = false;
        btnVolverPanel.classList.toggle("d-none", !enPerfil);
        btnVolverPanel.classList.toggle("d-flex", !!enPerfil);
    }
}

function mostrarPanelAdministracion() {
    panelPerfil.hidden = true;
    document.getElementById("navAdministracion").hidden = false;
    document.getElementById("encabezadoSeccion").hidden = false;
    document.getElementById("contenidoAdministracion").hidden = false;
    alternarMenuPerfil(false);
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
    alternarMenuPerfil(true);
    panelPerfil.hidden = false;
    panelPerfil.scrollIntoView({ behavior: "smooth", block: "start" });
});

if (usuario.rol === "usuario" || window.location.hash === "#perfil") {
    document.getElementById("btnPerfil").click();
}

const volverAResumen = perfilDesdeResumen || usuario.rol === "usuario";
document.getElementById("btnVolverPanelTexto").textContent = volverAResumen
    ? "Volver al resumen"
    : "Volver al panel";
document.getElementById("btnVolverPanel").addEventListener("click", function (evento) {
    if (volverAResumen) {
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

    const emailPerfil = document.getElementById("perEmail").value.trim().toLowerCase();
    if (!emailPerfil.endsWith("@sonda.com")) {
        mostrarToast("El correo debe ser corporativo (@sonda.com)", "error");
        document.getElementById("perEmail").focus();
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

function nombrePeriodoComparacion(mes, anio) {
    const numeroMes = Number(mes);
    const numeroAnio = Number(anio);
    const nombre = new Intl.DateTimeFormat("es-CO", {
        month: "long",
        timeZone: "UTC"
    }).format(new Date(Date.UTC(2026, (Number.isInteger(numeroMes) ? numeroMes : 1) - 1, 1)));
    const mesNombre = nombre.charAt(0).toLocaleUpperCase("es") + nombre.slice(1);
    return mesNombre + " " + (Number.isInteger(numeroAnio) ? numeroAnio : "");
}

function leerPeriodosComparacionMensual() {
    return [
        {
            mes: Number(document.getElementById("mesComparacionA").value),
            anio: Number(document.getElementById("anioComparacionA").value)
        },
        {
            mes: Number(document.getElementById("mesComparacionB").value),
            anio: Number(document.getElementById("anioComparacionB").value)
        }
    ];
}

function clavePeriodoComparacion(periodo) {
    return periodo.anio + "-" + String(periodo.mes).padStart(2, "0");
}

function mostrarRetroComparacionMensual(texto = "", tipo = "info") {
    const retro = document.getElementById("retroComparacionMensual");
    if (!retro) return;
    retro.textContent = texto || "";
    if (texto) retro.dataset.tipo = tipo;
    else retro.removeAttribute("data-tipo");
}

function prepararComparacionMensual() {
    const contenedor = document.getElementById("comparacionMensualTabla");
    if (!document.getElementById("formComparacionMensual")) return;
    if (contenedor && !contenedor.dataset.cargado) contenedor.replaceChildren();
    mostrarRetroComparacionMensual(
        "Elige dos periodos y pulsa Comparar. Ejemplos: Enero 2026 vs Abril 2026, o Noviembre 2025 vs Noviembre 2026 (si hay datos en esos meses).",
        "info"
    );
}

function dibujarComparacionMensual(datos) {
    const contenedor = document.getElementById("comparacionMensualTabla");
    contenedor.replaceChildren();
    const resultados = Array.isArray(datos.resultados) ? datos.resultados : [];
    const periodos = Array.isArray(datos.periodos) ? datos.periodos : resultados.map(r => ({ mes: r.mes, anio: r.anio }));

    if (!Array.isArray(datos.grupos) || !datos.grupos.length) {
        mostrarRetroComparacionMensual(
            "No hay métricas Globales activas asignadas a grupos. Crea/activa métricas globales y asígnalas a un grupo para poder comparar.",
            "warn"
        );
        return;
    }

    if (resultados.length !== 2 || periodos.length !== 2) {
        mostrarRetroComparacionMensual("No se pudo mostrar la comparación. Revisa los periodos e inténtalo de nuevo.", "error");
        return;
    }

    if (datos.fuente_temporal === "sin_vigencias") {
        mostrarRetroComparacionMensual(
            "BENEFICIOS no tiene fechas de vigencia: los periodos pueden mostrar la misma base. MIDAS no inventa históricos.",
            "warn"
        );
    } else {
        const detalles = resultados.map(periodo => {
            const cobertura = periodo.cobertura_anio || {};
            const enAnio = Number(cobertura.registros_en_anio) || 0;
            const conVigencia = Number(cobertura.registros_con_vigencia) || 0;
            const etiqueta = nombrePeriodoComparacion(periodo.mes, periodo.anio);
            if (enAnio === 0) return etiqueta + ": sin registros en " + periodo.anio;
            if (conVigencia === 0) return etiqueta + ": " + enAnio + " registro(s) sin fecha (vigentes todo " + periodo.anio + ")";
            return etiqueta + ": " + conVigencia + "/" + enAnio + " con vigencia en " + periodo.anio;
        });
        const hayAdvertencia = resultados.some(periodo => {
            const cobertura = periodo.cobertura_anio || {};
            return (Number(cobertura.registros_en_anio) || 0) === 0 || (Number(cobertura.registros_con_vigencia) || 0) === 0;
        });
        mostrarRetroComparacionMensual(
            "Comparación calculada por vigencias de BENEFICIOS. " + detalles.join(" · ") + ".",
            hayAdvertencia ? "warn" : "ok"
        );
    }

    const etiquetas = periodos.map(p => nombrePeriodoComparacion(p.mes, p.anio));
    const tabla = document.createElement("table");
    tabla.className = "table table-dark table-hover table-bordered align-middle comparacion-mensual-tabla";
    const encabezado = document.createElement("thead");
    const filaEncabezado = document.createElement("tr");
    ["Grupo Global", "Periodo A · " + etiquetas[0], "Periodo B · " + etiquetas[1], "Diferencia (B - A)"].forEach(titulo => {
        const celda = document.createElement("th");
        celda.scope = "col";
        celda.textContent = titulo;
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

        const valores = resultados.map(periodo => {
            const valorGrupo = (periodo.valores || []).find(valor => valor.grupo_id === grupo.id);
            const valor = valorGrupo && valorGrupo.valor !== null &&
                valorGrupo.valor !== undefined && Number.isFinite(Number(valorGrupo.valor))
                ? Number(valorGrupo.valor)
                : null;
            const celda = document.createElement("td");
            if (valor === null) {
                const sinDatos = document.createElement("span");
                sinDatos.className = "comparacion-mensual-valor text-warning";
                sinDatos.textContent = "Sin datos";
                celda.append(sinDatos);
                celda.title = valorGrupo && valorGrupo.metricas_con_error
                    ? "No se pudieron calcular " + valorGrupo.metricas_con_error + " métrica(s) de este grupo en el periodo."
                    : "No se calcularon métricas para este grupo en el periodo.";
            } else {
                const cifra = document.createElement("span");
                cifra.className = "comparacion-mensual-valor";
                cifra.textContent = numeroEs(valor);
                celda.append(cifra);
                if (valorGrupo.metricas_con_error > 0) {
                    const parcial = document.createElement("small");
                    parcial.className = "comparacion-mensual-parcial";
                    parcial.textContent = "Parcial";
                    parcial.title = "No se pudieron calcular " + valorGrupo.metricas_con_error + " métrica(s) de este grupo.";
                    celda.append(parcial);
                }
            }
            const cobertura = document.createElement("small");
            cobertura.className = "comparacion-mensual-cobertura-mes";
            cobertura.textContent = (valorGrupo ? valorGrupo.metricas_calculadas : 0) +
                "/" + (grupo.metricas_asignadas || 0) + " métricas";
            celda.append(cobertura);
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
            diferenciaCelda.title = "La diferencia requiere que las métricas del grupo se calculen correctamente en ambos periodos.";
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
                ? (diferencia === 0 ? "0%" : "Base A en 0")
                : (diferencia > 0 ? "+" : "") + numeroEs(diferencia / Math.abs(valorA.valor) * 100) + "%";
            diferenciaCelda.append(porcentaje);
            if (diferencia === 0) gruposIguales++;
        }
        fila.append(diferenciaCelda);
        cuerpo.append(fila);
    });
    tabla.append(encabezado, cuerpo);
    contenedor.append(tabla);
    contenedor.dataset.cargado = "true";

    if (gruposIguales === datos.grupos.length) {
        const avisoIgual = document.createElement("p");
        avisoIgual.className = "comparacion-mensual-nota-pie text-warning mb-0";
        avisoIgual.textContent = "Todos los grupos dieron el mismo total en ambos periodos. Puede pasar si los beneficios vigentes/cantidades no cambian entre esos periodos.";
        contenedor.append(avisoIgual);
    }
}

let generacionComparacionMensual = 0;

function contenedorScrollComparacion() {
    const raiz = document.scrollingElement || document.documentElement;
    let nodo = document.getElementById("comparacionMensualTabla");
    while (nodo && nodo !== document.body && nodo !== raiz) {
        const estilo = window.getComputedStyle(nodo);
        const overflowY = estilo.overflowY;
        const scrollable = (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
            nodo.scrollHeight > nodo.clientHeight;
        if (scrollable) return nodo;
        nodo = nodo.parentElement;
    }
    return raiz;
}

function guardarScrollComparacion() {
    const contenedorScroll = contenedorScrollComparacion();
    return {
        contenedor: contenedorScroll,
        top: contenedorScroll ? contenedorScroll.scrollTop : 0,
        winX: window.scrollX,
        winY: window.scrollY
    };
}

function restaurarScrollComparacion(estado) {
    if (!estado) return;
    const aplicar = () => {
        if (estado.contenedor) estado.contenedor.scrollTop = estado.top;
        window.scrollTo(estado.winX || 0, estado.winY || 0);
    };
    aplicar();
    requestAnimationFrame(aplicar);
}

async function cargarComparacionMensual(forzar = false) {
    const form = document.getElementById("formComparacionMensual");
    if (!form) return false;
    const generacion = ++generacionComparacionMensual;
    const boton = document.getElementById("btnCargarComparacionMensual");
    const contenedor = document.getElementById("comparacionMensualTabla");
    const panel = document.getElementById("panel-comparacion-mensual");

    const periodos = leerPeriodosComparacionMensual();
    const [periodoA, periodoB] = periodos;
    const claves = periodos.map(clavePeriodoComparacion).join("|");

    const valido = (p) => Number.isInteger(p.mes) && p.mes >= 1 && p.mes <= 12 &&
        Number.isInteger(p.anio) && p.anio >= 1900 && p.anio <= 2100;
    const scrollInicio = guardarScrollComparacion();
    let irAResultados = false;

    const preservarAltura = (activo) => {
        if (!contenedor) return;
        if (activo) {
            const alto = contenedor.offsetHeight;
            if (alto > 0) contenedor.style.minHeight = alto + "px";
        } else {
            contenedor.style.minHeight = "";
        }
    };

    if (!valido(periodoA) || !valido(periodoB)) {
        preservarAltura(true);
        contenedor.replaceChildren();
        mostrarRetroComparacionMensual("Revisa los periodos: cada uno debe tener mes y año válidos (1900–2100).", "error");
        preservarAltura(false);
        restaurarScrollComparacion(scrollInicio);
        return false;
    }
    if (clavePeriodoComparacion(periodoA) === clavePeriodoComparacion(periodoB)) {
        preservarAltura(true);
        contenedor.replaceChildren();
        mostrarRetroComparacionMensual("Elige dos periodos distintos. Ejemplo: Enero 2026 vs Abril 2026, o Noviembre 2025 vs Noviembre 2026.", "warn");
        preservarAltura(false);
        restaurarScrollComparacion(scrollInicio);
        return false;
    }
    if (!forzar && panel && panel.dataset.loadedPeriods === claves && contenedor.dataset.cargado === "true") {
        mostrarRetroComparacionMensual("Ya se muestra " + nombrePeriodoComparacion(periodoA.mes, periodoA.anio) +
            " vs " + nombrePeriodoComparacion(periodoB.mes, periodoB.anio) + ".", "info");
        return true;
    }

    if (boton) boton.disabled = true;
    preservarAltura(true);
    contenedor.replaceChildren();
    mostrarRetroComparacionMensual("Calculando " + nombrePeriodoComparacion(periodoA.mes, periodoA.anio) +
        " vs " + nombrePeriodoComparacion(periodoB.mes, periodoB.anio) + "…", "info");
    restaurarScrollComparacion(scrollInicio);
    try {
        const respuesta = await llamar(
            "/dashboard/comparacion-mensual?mes_a=" + encodeURIComponent(periodoA.mes) +
            "&anio_a=" + encodeURIComponent(periodoA.anio) +
            "&mes_b=" + encodeURIComponent(periodoB.mes) +
            "&anio_b=" + encodeURIComponent(periodoB.anio)
        );
        if (!respuesta) {
            if (generacion !== generacionComparacionMensual) return false;
            mostrarRetroComparacionMensual(
                "No se pudo conectar con el servidor. Verifica que el backend de MIDAS esté activo (p. ej. http://localhost:3000), que tu sesión siga iniciada y vuelve a intentar. Ejemplo: Enero 2026 vs Abril 2026.",
                "error"
            );
            return false;
        }
        if (!respuesta.ok) {
            if (generacion !== generacionComparacionMensual) return false;
            const mensaje = await mensajeError(respuesta, "No se pudo cargar la comparación.");
            const pista = respuesta.status >= 500
                ? " Revisa que la base de datos/PRISMA estén disponibles y que existan métricas Globales activas en grupos."
                : "";
            mostrarRetroComparacionMensual(mensaje + pista + " Ejemplo: Enero 2026 vs Abril 2026.", "error");
            return false;
        }
        const datos = await respuesta.json();
        if (generacion !== generacionComparacionMensual) return false;
        dibujarComparacionMensual(datos);
        if (panel) panel.dataset.loadedPeriods = claves;
        irAResultados = forzar === true && contenedor && contenedor.dataset.cargado === "true";
        return true;
    } catch (error) {
        if (generacion !== generacionComparacionMensual) return false;
        console.error("No se pudo cargar la comparación mensual:", error);
        mostrarRetroComparacionMensual(
            "Ocurrió un error al calcular la comparación. Intenta de nuevo. Ejemplo: Enero 2026 vs Abril 2026 (con métricas Globales activas y beneficios vigentes en PRISMA).",
            "error"
        );
        return false;
    } finally {
        if (generacion === generacionComparacionMensual) {
            preservarAltura(false);
            if (irAResultados) {
                requestAnimationFrame(() => {
                    const retro = document.getElementById("retroComparacionMensual");
                    const objetivo = retro || document.getElementById("comparacionMensualTabla");
                    if (objetivo) objetivo.scrollIntoView({ behavior: "smooth", block: "start" });
                });
            } else {
                restaurarScrollComparacion(scrollInicio);
            }
            if (boton) boton.disabled = false;
        }
    }
}

(function inicializarComparacionMensual() {
    const form = document.getElementById("formComparacionMensual");
    if (!form) return;
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const anioActual = hoy.getFullYear();
    const fechaAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const mesAnterior = fechaAnterior.getMonth() + 1;
    const anioAnterior = fechaAnterior.getFullYear();

    const mesA = document.getElementById("mesComparacionA");
    const anioA = document.getElementById("anioComparacionA");
    const mesB = document.getElementById("mesComparacionB");
    const anioB = document.getElementById("anioComparacionB");
    if (mesA) mesA.value = String(mesAnterior);
    if (anioA) anioA.value = String(anioAnterior);
    if (mesB) mesB.value = String(mesActual);
    if (anioB) anioB.value = String(anioActual);

    form.addEventListener("submit", evento => {
        evento.preventDefault();
        cargarComparacionMensual(true);
    });

    prepararComparacionMensual();
})();

// 8. Pestañas: cada una carga sus datos al mostrarse
const CARGADORES = {
    "#panel-variables": cargarVariables,
    "#panel-calculos": cargarCalculos,
    "#panel-grupos": cargarGruposGlobales,
    "#panel-comparacion-mensual": () => prepararComparacionMensual(),
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
document.getElementById("btnCancelarVariable")?.addEventListener("click", cerrarEditorVariable);
document.getElementById("btnCancelarVariableSec")?.addEventListener("click", cerrarEditorVariable);
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
