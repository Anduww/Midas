const API = "http://localhost:3000";
const token = sessionStorage.getItem("token");
const usuario = JSON.parse(sessionStorage.getItem("usuario")) || {};
const ETIQUETA_ROL = { admin_super: "Admin Super", admin: "Admin", usuario: "Usuario" };
const ETIQUETA_NIVEL = { info: "Info", warn: "Advertencia", error: "Error" };
const CLASE_NIVEL = { info: "text-info", warn: "text-warning", error: "text-danger" };

if (!token || usuario.rol !== "admin_super") {
    window.location.replace("../auth/login.html");
}

const cuerpo = document.getElementById("cuerpo");
let pagina = 1;
let totalPaginas = 1;
let solicitudActual = 0;

let paginaLogs = 1;
let totalPaginasLogs = 1;
let solicitudLogsActual = 0;
let logsCargados = false;
let tabActual = "actividad";

function celda(texto) {
    const td = document.createElement("td");
    td.textContent = (texto === null || texto === undefined || texto === "") ? "?" : texto;
    return td;
}

function mostrarMensaje(texto) {
    cuerpo.replaceChildren();
    const tr = document.createElement("tr");
    const td = celda(texto);
    td.colSpan = 5;
    td.className = "text-center text-warning py-3";
    tr.append(td);
    cuerpo.append(tr);
    document.getElementById("estadoPagina").textContent = "";
}

function mostrarMensajeLogs(texto) {
    const cuerpoLogs = document.getElementById("cuerpoLogs");
    cuerpoLogs.replaceChildren();
    const tr = document.createElement("tr");
    const td = celda(texto);
    td.colSpan = 7;
    td.className = "text-center text-warning py-3";
    tr.append(td);
    cuerpoLogs.append(tr);
    document.getElementById("estadoPaginaLogs").textContent = "";
}

async function cargar() {
    const solicitud = ++solicitudActual;
    const params = new URLSearchParams({
        q: document.getElementById("texto").value,
        desde: document.getElementById("desde").value,
        hasta: document.getElementById("hasta").value,
        orden: document.getElementById("orden").value,
        pagina: String(pagina)
    });

    let respuesta;
    try {
        respuesta = await fetch(API + "/auditoria?" + params, {
            headers: { Authorization: "Bearer " + token }
        });
    } catch (error) {
        mostrarMensaje("No se pudo conectar con el servidor. ?Est? corriendo el backend (npm start)?");
        return;
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
        window.location.replace("../auth/login.html");
        return;
    }
    if (!respuesta.ok) {
        let mensaje = "No se pudo cargar el registro de actividad (error " + respuesta.status + ").";
        try {
            const error = await respuesta.json();
            if (error.mensaje) mensaje = error.mensaje;
        } catch (error) {
            console.error("La respuesta de error del registro no contiene JSON v?lido:", error);
        }
        if (solicitud === solicitudActual) mostrarMensaje(mensaje);
        return;
    }

    let datosRespuesta;
    try {
        datosRespuesta = await respuesta.json();
    } catch (error) {
        if (solicitud === solicitudActual) {
            mostrarMensaje("El servidor devolvi? una respuesta inv?lida. Reinicia el backend y vuelve a cargar la p?gina.");
        }
        return;
    }
    if (solicitud !== solicitudActual) return;

    let datos = datosRespuesta;
    if (Array.isArray(datosRespuesta)) {
        const totalPaginasCompatibles = Math.max(1, Math.ceil(datosRespuesta.length / 10));
        const paginaCompatible = Math.min(pagina, totalPaginasCompatibles);
        datos = {
            registros: datosRespuesta.slice((paginaCompatible - 1) * 10, paginaCompatible * 10),
            total: datosRespuesta.length,
            pagina: paginaCompatible,
            por_pagina: 10,
            total_paginas: totalPaginasCompatibles
        };
    }
    if (!Array.isArray(datos.registros) || !Number.isInteger(datos.pagina) ||
        !Number.isInteger(datos.total_paginas) || !Number.isInteger(datos.por_pagina)) {
        mostrarMensaje(datos.mensaje || "La respuesta del registro no tiene el formato esperado. Reinicia el backend y recarga la p?gina.");
        return;
    }

    pagina = datos.pagina;
    totalPaginas = datos.total_paginas;
    document.getElementById("contador").textContent =
        datos.total + (datos.total === 1 ? " registro" : " registros") + " encontrados.";
    document.getElementById("estadoPagina").textContent =
        "Mostrando " + (datos.total ? (pagina - 1) * datos.por_pagina + 1 : 0) +
        "?" + Math.min(pagina * datos.por_pagina, datos.total) + " de " + datos.total;
    document.getElementById("numeroPagina").value = pagina;
    document.getElementById("numeroPagina").max = totalPaginas;
    document.getElementById("totalPaginas").textContent = totalPaginas;
    document.getElementById("paginaAnterior").disabled = pagina <= 1;
    document.getElementById("paginaSiguiente").disabled = pagina >= totalPaginas;
    document.getElementById("primeraPagina").disabled = pagina <= 1;
    document.getElementById("ultimaPagina").disabled = pagina >= totalPaginas;
    cuerpo.replaceChildren();

    if (datos.registros.length === 0) {
        const tr = document.createElement("tr");
        const td = celda("Sin registros");
        td.colSpan = 5;
        td.className = "text-center text-body-secondary py-3";
        tr.append(td);
        cuerpo.append(tr);
        return;
    }

    datos.registros.forEach((a, i) => {
        const tr = document.createElement("tr");
        const persona = celda(a.usuario_nombre);
        const rol = document.createElement("small");
        rol.className = "d-block text-body-secondary";
        rol.textContent = ETIQUETA_ROL[a.rol] || a.rol || "";
        persona.append(rol);

        const accion = celda(accionLegible(a.accion, a.entidad));
        accion.classList.add("fw-semibold");

        const numeroRegistro = Number.isInteger(Number(a.id))
            ? Number(a.id)
            : (pagina - 1) * datos.por_pagina + i + 1;
        tr.append(celda(numeroRegistro), celda(new Date(a.creado_en).toLocaleString("es-CO")), persona, accion, celda(detalleLegible(a)));
        cuerpo.append(tr);
    });
}

function accionLegible(accion, entidad) {
    const acciones = {
        crear: "Cre?",
        editar: "Edit?",
        modificar: "Actualiz?",
        activar: "Activ?",
        desactivar: "Desactiv?",
        eliminar: "Elimin?",
        enviar: "Activ?"
    };
    const entidades = {
        variables: "una variable",
        calculos: "una m?trica",
        usuarios: "una cuenta de usuario",
        perfil: "su perfil"
    };
    return (acciones[accion] || "Realiz? un cambio en") + " " + (entidades[entidad] || "la informaci?n");
}

function detalleLegible(registro) {
    const nombre = (registro.detalle || "").match(/"([^"]+)"/);
    if (nombre) return "Elemento: ?" + nombre[1] + "?.";
    if (registro.accion === "enviar") return "La m?trica qued? activa y disponible para consulta.";
    if (registro.accion === "desactivar") return "El elemento dej? de estar disponible y pas? al historial.";
    if (registro.accion === "activar") return "El elemento volvi? a estar disponible.";
    if (registro.accion === "eliminar") return "El elemento se elimin? del sistema.";
    if (registro.accion === "editar") return "Se guardaron los cambios del elemento.";
    if (registro.accion === "crear") return "Se agreg? un elemento nuevo.";
    return "Cambio registrado correctamente.";
}

async function cargarLogs() {
    const solicitud = ++solicitudLogsActual;
    const cuerpoLogs = document.getElementById("cuerpoLogs");
    const params = new URLSearchParams({
        q: document.getElementById("logTexto").value,
        nivel: document.getElementById("logNivel").value,
        desde: document.getElementById("logDesde").value,
        hasta: document.getElementById("logHasta").value,
        orden: document.getElementById("logOrden").value,
        pagina: String(paginaLogs)
    });

    let respuesta;
    try {
        respuesta = await fetch(API + "/logs-sistema?" + params, {
            headers: { Authorization: "Bearer " + token }
        });
    } catch (error) {
        mostrarMensajeLogs("No se pudo conectar con el servidor. ?Est? corriendo el backend (npm start)?");
        return;
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
        window.location.replace("../auth/login.html");
        return;
    }
    if (!respuesta.ok) {
        let mensaje = "No se pudieron cargar los logs (error " + respuesta.status + ").";
        try {
            const error = await respuesta.json();
            if (error.mensaje) mensaje = error.mensaje;
        } catch (error) {
            console.error("La respuesta de error de logs no contiene JSON v?lido:", error);
        }
        if (solicitud === solicitudLogsActual) mostrarMensajeLogs(mensaje);
        return;
    }

    let datos;
    try {
        datos = await respuesta.json();
    } catch (error) {
        if (solicitud === solicitudLogsActual) mostrarMensajeLogs("El servidor devolvi? una respuesta inv?lida.");
        return;
    }
    if (solicitud !== solicitudLogsActual) return;
    if (!Array.isArray(datos.registros)) {
        mostrarMensajeLogs(datos.mensaje || "La respuesta de logs no tiene el formato esperado.");
        return;
    }

    logsCargados = true;
    paginaLogs = datos.pagina;
    totalPaginasLogs = datos.total_paginas;
    document.getElementById("contadorLogs").textContent =
        datos.total + (datos.total === 1 ? " log" : " logs") + " encontrados.";
    document.getElementById("estadoPaginaLogs").textContent =
        "Mostrando " + (datos.total ? (paginaLogs - 1) * datos.por_pagina + 1 : 0) +
        "?" + Math.min(paginaLogs * datos.por_pagina, datos.total) + " de " + datos.total;
    document.getElementById("numeroPaginaLogs").value = paginaLogs;
    document.getElementById("numeroPaginaLogs").max = totalPaginasLogs;
    document.getElementById("totalPaginasLogs").textContent = totalPaginasLogs;
    document.getElementById("paginaAnteriorLogs").disabled = paginaLogs <= 1;
    document.getElementById("paginaSiguienteLogs").disabled = paginaLogs >= totalPaginasLogs;
    document.getElementById("primeraPaginaLogs").disabled = paginaLogs <= 1;
    document.getElementById("ultimaPaginaLogs").disabled = paginaLogs >= totalPaginasLogs;
    cuerpoLogs.replaceChildren();

    if (datos.registros.length === 0) {
        const tr = document.createElement("tr");
        const td = celda("Sin logs registrados");
        td.colSpan = 7;
        td.className = "text-center text-body-secondary py-3";
        tr.append(td);
        cuerpoLogs.append(tr);
        return;
    }

    datos.registros.forEach((log, i) => {
        const tr = document.createElement("tr");
        const numero = Number.isInteger(Number(log.id)) ? Number(log.id) : (paginaLogs - 1) * datos.por_pagina + i + 1;
        const nivel = celda(ETIQUETA_NIVEL[log.nivel] || log.nivel || "Info");
        nivel.className = "fw-semibold " + (CLASE_NIVEL[log.nivel] || "text-info");

        const usuarioCelda = celda(log.usuario_nombre);
        const rol = document.createElement("small");
        rol.className = "d-block text-body-secondary";
        rol.textContent = ETIQUETA_ROL[log.rol] || log.rol || "";
        if (log.usuario_nombre) usuarioCelda.append(rol);

        const detalle = celda(log.detalle);
        detalle.classList.add("small");
        tr.append(
            celda(numero),
            celda(new Date(log.creado_en).toLocaleString("es-CO")),
            nivel,
            celda(log.origen),
            celda(log.mensaje),
            detalle,
            usuarioCelda
        );
        cuerpoLogs.append(tr);
    });
}

function mostrarTab(tab) {
    tabActual = tab;
    const esActividad = tab === "actividad";
    document.getElementById("panelActividad").classList.toggle("d-none", !esActividad);
    document.getElementById("panelLogs").classList.toggle("d-none", esActividad);
    document.getElementById("tabActividad").classList.toggle("btn-info", esActividad);
    document.getElementById("tabActividad").classList.toggle("btn-outline-info", !esActividad);
    document.getElementById("tabLogs").classList.toggle("btn-info", !esActividad);
    document.getElementById("tabLogs").classList.toggle("btn-outline-info", esActividad);
    document.getElementById("tabActividad").setAttribute("aria-selected", String(esActividad));
    document.getElementById("tabLogs").setAttribute("aria-selected", String(!esActividad));
    if (!esActividad && !logsCargados) cargarLogs();
}

document.getElementById("tabActividad").addEventListener("click", () => mostrarTab("actividad"));
document.getElementById("tabLogs").addEventListener("click", () => mostrarTab("logs"));

document.getElementById("btnBuscar").addEventListener("click", function () { pagina = 1; cargar(); });
document.getElementById("orden").addEventListener("change", function () { pagina = 1; cargar(); });
document.getElementById("primeraPagina").addEventListener("click", function () { if (pagina > 1) { pagina = 1; cargar(); } });
document.getElementById("paginaAnterior").addEventListener("click", function () { if (pagina > 1) { pagina--; cargar(); } });
document.getElementById("paginaSiguiente").addEventListener("click", function () { if (pagina < totalPaginas) { pagina++; cargar(); } });
document.getElementById("ultimaPagina").addEventListener("click", function () { if (pagina < totalPaginas) { pagina = totalPaginas; cargar(); } });
document.getElementById("numeroPagina").addEventListener("change", function () {
    const solicitada = Number.parseInt(this.value, 10);
    if (!Number.isInteger(solicitada)) { this.value = pagina; return; }
    pagina = Math.min(Math.max(solicitada, 1), totalPaginas);
    cargar();
});
document.getElementById("numeroPagina").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") { evento.preventDefault(); this.dispatchEvent(new Event("change")); }
});
["texto", "desde", "hasta"].forEach(id =>
    document.getElementById(id).addEventListener("keydown", e => {
        if (e.key === "Enter") { pagina = 1; cargar(); }
    }));

document.getElementById("btnBuscarLogs").addEventListener("click", function () { paginaLogs = 1; cargarLogs(); });
document.getElementById("logOrden").addEventListener("change", function () { paginaLogs = 1; cargarLogs(); });
document.getElementById("logNivel").addEventListener("change", function () { paginaLogs = 1; cargarLogs(); });
document.getElementById("primeraPaginaLogs").addEventListener("click", function () { if (paginaLogs > 1) { paginaLogs = 1; cargarLogs(); } });
document.getElementById("paginaAnteriorLogs").addEventListener("click", function () { if (paginaLogs > 1) { paginaLogs--; cargarLogs(); } });
document.getElementById("paginaSiguienteLogs").addEventListener("click", function () { if (paginaLogs < totalPaginasLogs) { paginaLogs++; cargarLogs(); } });
document.getElementById("ultimaPaginaLogs").addEventListener("click", function () { if (paginaLogs < totalPaginasLogs) { paginaLogs = totalPaginasLogs; cargarLogs(); } });
document.getElementById("numeroPaginaLogs").addEventListener("change", function () {
    const solicitada = Number.parseInt(this.value, 10);
    if (!Number.isInteger(solicitada)) { this.value = paginaLogs; return; }
    paginaLogs = Math.min(Math.max(solicitada, 1), totalPaginasLogs);
    cargarLogs();
});
document.getElementById("numeroPaginaLogs").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") { evento.preventDefault(); this.dispatchEvent(new Event("change")); }
});
["logTexto", "logDesde", "logHasta"].forEach(id =>
    document.getElementById(id).addEventListener("keydown", e => {
        if (e.key === "Enter") { paginaLogs = 1; cargarLogs(); }
    }));

if (token) cargar();
