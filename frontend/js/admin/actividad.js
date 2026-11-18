const API = "http://localhost:3000";
const token = sessionStorage.getItem("token");
const usuario = JSON.parse(sessionStorage.getItem("usuario")) || {};
const ETIQUETA_ROL = { admin_super: "Admin Super", admin: "Admin", usuario: "Usuario" };

// Solo el rol más alto entra aquí (el servidor lo vuelve a comprobar en cada consulta)
if (!token || usuario.rol !== "admin_super") {
    window.location.replace("../auth/login.html");
}

const cuerpo = document.getElementById("cuerpo");
let pagina = 1;
let totalPaginas = 1;
let solicitudActual = 0;

function celda(texto) {
    const td = document.createElement("td");
    td.textContent = (texto === null || texto === undefined || texto === "") ? "—" : texto;
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
        mostrarMensaje("No se pudo conectar con el servidor. ¿Está corriendo el backend (npm start)?");
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
            console.error("La respuesta de error del registro no contiene JSON válido:", error);
        }
        if (solicitud === solicitudActual) mostrarMensaje(mensaje);
        return;
    }

    let datosRespuesta;
    try {
        datosRespuesta = await respuesta.json();
    } catch (error) {
        if (solicitud === solicitudActual) {
            mostrarMensaje("El servidor devolvió una respuesta inválida. Reinicia el backend y vuelve a cargar la página.");
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
        mostrarMensaje(datos.mensaje || "La respuesta del registro no tiene el formato esperado. Reinicia el backend y recarga la página.");
        return;
    }

    pagina = datos.pagina;
    totalPaginas = datos.total_paginas;
    document.getElementById("contador").textContent =
        datos.total + (datos.total === 1 ? " registro" : " registros") + " encontrados.";
    document.getElementById("estadoPagina").textContent =
        "Mostrando " + (datos.total ? (pagina - 1) * datos.por_pagina + 1 : 0) +
        "–" + Math.min(pagina * datos.por_pagina, datos.total) + " de " + datos.total;
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
        crear: "Creó",
        editar: "Editó",
        modificar: "Actualizó",
        activar: "Activó",
        desactivar: "Desactivó",
        eliminar: "Eliminó",
        enviar: "Activó"
    };
    const entidades = {
        variables: "una variable",
        calculos: "una métrica",
        usuarios: "una cuenta de usuario",
        perfil: "su perfil"
    };
    return (acciones[accion] || "Realizó un cambio en") + " " + (entidades[entidad] || "la información");
}

function detalleLegible(registro) {
    const nombre = (registro.detalle || "").match(/"([^"]+)"/);
    if (nombre) return "Elemento: “" + nombre[1] + "”.";
    if (registro.accion === "enviar") return "La métrica quedó activa y disponible para consulta.";
    if (registro.accion === "desactivar") return "El elemento dejó de estar disponible y pasó al historial.";
    if (registro.accion === "activar") return "El elemento volvió a estar disponible.";
    if (registro.accion === "eliminar") return "El elemento se eliminó del sistema.";
    if (registro.accion === "editar") return "Se guardaron los cambios del elemento.";
    if (registro.accion === "crear") return "Se agregó un elemento nuevo.";
    return "Cambio registrado correctamente.";
}

// Se busca al pulsar "Buscar" o Enter
document.getElementById("btnBuscar").addEventListener("click", function () { pagina = 1; cargar(); });
document.getElementById("orden").addEventListener("change", function () { pagina = 1; cargar(); });
document.getElementById("primeraPagina").addEventListener("click", function () {
    if (pagina > 1) { pagina = 1; cargar(); }
});
document.getElementById("paginaAnterior").addEventListener("click", function () {
    if (pagina > 1) { pagina--; cargar(); }
});
document.getElementById("paginaSiguiente").addEventListener("click", function () {
    if (pagina < totalPaginas) { pagina++; cargar(); }
});
document.getElementById("ultimaPagina").addEventListener("click", function () {
    if (pagina < totalPaginas) { pagina = totalPaginas; cargar(); }
});
document.getElementById("numeroPagina").addEventListener("change", function () {
    const solicitada = Number.parseInt(this.value, 10);
    if (!Number.isInteger(solicitada)) {
        this.value = pagina;
        return;
    }
    pagina = Math.min(Math.max(solicitada, 1), totalPaginas);
    cargar();
});
document.getElementById("numeroPagina").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") {
        evento.preventDefault();
        this.dispatchEvent(new Event("change"));
    }
});
["texto", "desde", "hasta"].forEach(id =>
    document.getElementById(id).addEventListener("keydown", e => {
        if (e.key === "Enter") { pagina = 1; cargar(); }
    }));

if (token) cargar();