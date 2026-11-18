const API_METRICAS = "http://localhost:3000";
const tokenMetricas = sessionStorage.getItem("token");
const usuarioMetricas = JSON.parse(sessionStorage.getItem("usuario")) || {};
const puedeDesactivarMetricas = usuarioMetricas.rol === "admin_super";
const cuerpoMetricas = document.getElementById("cuerpo");
const POR_PAGINA = 10;
let metricasActivas = [];
let pagina = 1;
let totalPaginas = 1;

if (!puedeDesactivarMetricas) document.getElementById("thAcciones").remove();

function celdaMetrica(valor) {
    const td = document.createElement("td");
    if (valor instanceof Node) td.append(valor);
    else td.textContent = valor === null || valor === undefined || valor === "" ? "—" : valor;
    return td;
}

function etiquetaTipoResultado(tipo) {
    const badge = document.createElement("span");
    badge.className = "badge text-bg-" + (tipo === "global" ? "primary" : "secondary");
    badge.textContent = tipo === "global" ? "Global" : "Única";
    return badge;
}

function mensajeTabla(texto) {
    cuerpoMetricas.replaceChildren();
    const fila = document.createElement("tr");
    const celda = celdaMetrica(texto);
    celda.colSpan = puedeDesactivarMetricas ? 10 : 9;
    celda.className = "text-center text-body-secondary py-4";
    fila.append(celda);
    cuerpoMetricas.append(fila);
}

function pintarMetricasActivas() {
    const busqueda = document.getElementById("buscar").value.trim().toLocaleLowerCase();
    const proyecto = document.getElementById("proyecto").value;
    const formato = document.getElementById("formato").value;
    const filasFiltradas = metricasActivas.filter(m => {
        const contenido = [m.nombre, m.proyecto_nombre, m.descripcion, m.ecuacion, m.creado_por, m.tipo_resultado]
            .filter(Boolean).join(" ").toLocaleLowerCase();
        return (!busqueda || contenido.includes(busqueda)) &&
            (!proyecto || String(m.proyecto_id) === proyecto) &&
            (!formato || m.formato === formato);
    }).sort((a, b) => {
        const fechaA = Date.parse(a.creado_en || a.enviada_en) || 0;
        const fechaB = Date.parse(b.creado_en || b.enviada_en) || 0;
        return fechaB - fechaA || Number(b.id) - Number(a.id);
    });

    document.getElementById("contador").textContent =
        filasFiltradas.length + (filasFiltradas.length === 1 ? " métrica" : " métricas") + " encontradas";
    totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / POR_PAGINA));
    pagina = Math.min(Math.max(pagina, 1), totalPaginas);
    document.getElementById("estadoPagina").textContent =
        "Mostrando " + (filasFiltradas.length ? (pagina - 1) * POR_PAGINA + 1 : 0) +
        "–" + Math.min(pagina * POR_PAGINA, filasFiltradas.length) + " de " + filasFiltradas.length;
    document.getElementById("numeroPagina").value = pagina;
    document.getElementById("numeroPagina").max = totalPaginas;
    document.getElementById("totalPaginas").textContent = totalPaginas;
    document.getElementById("paginaAnterior").disabled = pagina <= 1;
    document.getElementById("primeraPagina").disabled = pagina <= 1;
    document.getElementById("paginaSiguiente").disabled = pagina >= totalPaginas;
    document.getElementById("ultimaPagina").disabled = pagina >= totalPaginas;

    cuerpoMetricas.replaceChildren();

    if (!filasFiltradas.length) {
        mensajeTabla(metricasActivas.length ? "No hay métricas que coincidan con esos filtros." : "Aún no hay métricas activas.");
        return;
    }

    const inicio = (pagina - 1) * POR_PAGINA;
    filasFiltradas.slice(inicio, inicio + POR_PAGINA).forEach((m, i) => {
        const fila = document.createElement("tr");
        fila.append(
            celdaMetrica(inicio + i + 1),
            celdaMetrica(m.nombre),
            celdaMetrica(m.proyecto_nombre),
            celdaMetrica(etiquetaTipoResultado(m.tipo_resultado)),
            celdaMetrica(m.ecuacion),
            celdaMetrica(m.descripcion),
            celdaMetrica(m.formato === "tabla" ? "Tabla" : "Texto plano"),
            celdaMetrica(m.enviada_en ? new Date(m.enviada_en).toLocaleString("es-CO") : "—"),
            celdaMetrica(m.creado_por)
        );
        if (puedeDesactivarMetricas) {
            const acciones = document.createElement("td");
            const boton = document.createElement("button");
            boton.type = "button";
            boton.className = "btn btn-sm btn-outline-danger";
            boton.textContent = "Desactivar";
            boton.addEventListener("click", () => desactivarMetrica(m));
            acciones.append(boton);
            fila.append(acciones);
        }
        cuerpoMetricas.append(fila);
    });
}

async function desactivarMetrica(metrica) {
    if (!window.confirm('¿Desactivar la métrica "' + metrica.nombre + '"? Pasará al historial.')) return;
    try {
        const respuesta = await fetch(API_METRICAS + "/calculos/" + metrica.id + "/desactivar", {
            method: "PATCH",
            headers: { Authorization: "Bearer " + tokenMetricas }
        });
        if (respuesta.status === 401 || respuesta.status === 403) {
            window.location.replace("../auth/login.html");
            return;
        }
        if (!respuesta.ok) {
            const datos = await respuesta.json().catch(() => ({}));
            window.alert(datos.mensaje || "No se pudo desactivar la métrica.");
            return;
        }
        await cargarMetricasActivas();
    } catch (error) {
        console.error("No se pudo desactivar la métrica:", error);
        window.alert("No se pudo conectar con el servidor para desactivar la métrica.");
    }
}

async function cargarMetricasActivas() {
    if (!tokenMetricas) {
        window.location.replace("../auth/login.html");
        return;
    }
    try {
        const respuesta = await fetch(API_METRICAS + "/calculos", {
            headers: { Authorization: "Bearer " + tokenMetricas }
        });
        if (respuesta.status === 401 || respuesta.status === 403) {
            window.location.replace("../auth/login.html");
            return;
        }
        if (!respuesta.ok) {
            mensajeTabla("No se pudo cargar el listado (error " + respuesta.status + ").");
            return;
        }

        const datos = await respuesta.json();
        metricasActivas = datos.filter(m => m.estado === "activa");
        pagina = 1;
        const proyectos = new Map(metricasActivas.map(m => [String(m.proyecto_id), m.proyecto_nombre]));
        const select = document.getElementById("proyecto");
        select.replaceChildren(new Option("Todos los proyectos", ""));
        [...proyectos.entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || "", "es"))
            .forEach(([id, nombre]) => {
                const opcion = document.createElement("option");
                opcion.value = id;
                opcion.textContent = nombre || "Proyecto";
                select.append(opcion);
            });
        pintarMetricasActivas();
    } catch (error) {
        console.error("No se pudo cargar el listado de métricas:", error);
        mensajeTabla("No se pudo conectar con el servidor. Verifica que el backend esté iniciado.");
    }
}

["buscar", "proyecto", "formato"].forEach(id =>
    document.getElementById(id).addEventListener(id === "buscar" ? "input" : "change", function () {
        pagina = 1;
        pintarMetricasActivas();
    }));

document.getElementById("primeraPagina").addEventListener("click", function () {
    if (pagina > 1) { pagina = 1; pintarMetricasActivas(); }
});
document.getElementById("paginaAnterior").addEventListener("click", function () {
    if (pagina > 1) { pagina--; pintarMetricasActivas(); }
});
document.getElementById("paginaSiguiente").addEventListener("click", function () {
    if (pagina < totalPaginas) { pagina++; pintarMetricasActivas(); }
});
document.getElementById("ultimaPagina").addEventListener("click", function () {
    if (pagina < totalPaginas) { pagina = totalPaginas; pintarMetricasActivas(); }
});
document.getElementById("numeroPagina").addEventListener("change", function () {
    const solicitada = Number.parseInt(this.value, 10);
    if (!Number.isInteger(solicitada)) {
        this.value = pagina;
        return;
    }
    pagina = Math.min(Math.max(solicitada, 1), totalPaginas);
    pintarMetricasActivas();
});
document.getElementById("numeroPagina").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") {
        evento.preventDefault();
        this.dispatchEvent(new Event("change"));
    }
});

cargarMetricasActivas();
