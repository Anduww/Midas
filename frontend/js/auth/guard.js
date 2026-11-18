const API_GUARD = "http://localhost:3000";
let validacionAccesoActual = 0;
let redireccionAccesoEnCurso = false;

document.documentElement.style.visibility = "hidden";

function irALoginPorAcceso() {
    if (redireccionAccesoEnCurso) return;
    redireccionAccesoEnCurso = true;
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("usuario");
    window.location.replace("../auth/login.html");
}

async function validarAccesoProtegido() {
    const validacion = ++validacionAccesoActual;
    const token = sessionStorage.getItem("token");
    if (!token) {
        irALoginPorAcceso();
        return;
    }

    try {
        const respuesta = await fetch(API_GUARD + "/yo", {
            headers: { Authorization: "Bearer " + token },
            cache: "no-store"
        });
        if (validacion !== validacionAccesoActual) return;
        if (respuesta.status === 401) {
            irALoginPorAcceso();
            return;
        }
        if (!respuesta.ok) {
            console.error("No se pudo validar el acceso a la página (HTTP " + respuesta.status + ").");
            irALoginPorAcceso();
            return;
        }

        const usuario = await respuesta.json();
        const rolRequerido = document.documentElement.dataset.requiredRole;
        if (rolRequerido && usuario.rol !== rolRequerido) {
            window.location.replace("panel.html");
            return;
        }

        sessionStorage.setItem("usuario", JSON.stringify(usuario));
        document.documentElement.style.visibility = "";
    } catch (error) {
        console.error("No se pudo validar el acceso a la página:", error);
        irALoginPorAcceso();
    }
}

window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    document.documentElement.style.visibility = "hidden";
    validarAccesoProtegido();
});

validarAccesoProtegido();
