const API = "http://localhost:3000";

const inputEmail = document.getElementById("email");
const inputPassword = document.getElementById("password");
const boton = document.getElementById("btnLogin");
const formulario = document.getElementById("formLogin");
let loginEnCurso = false;

// Limpieza: borra cualquier sesión vieja que haya quedado en localStorage
localStorage.removeItem("token");
localStorage.removeItem("usuario");

async function iniciarSesion(evento) {
    evento.preventDefault();
    if (loginEnCurso) return;
    loginEnCurso = true;
    boton.disabled = true;
    boton.textContent = "Validando credenciales…";
    try {
        const respuesta = await fetch(API + "/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: inputEmail.value,
                password: inputPassword.value
            })
        });

        let data;
        try {
            data = await respuesta.json();
        } catch (error) {
            data = {};
        }

        // Si el servidor rechazó el login, mostrar su mensaje en una tarjeta
        // (naranja y más duradera para cuenta desactivada, roja para los demás errores)
        if (!respuesta.ok) {
            mostrarToast(data.mensaje || "No se pudo iniciar sesión. Revisa tus credenciales e inténtalo de nuevo.",
                data.codigo === "DESACTIVADA" ? "aviso" : "error");
            return;
        }

        if (!data.token || !data.usuario || typeof data.usuario !== "object") {
            mostrarToast("El servidor respondió sin los datos de sesión esperados.", "error");
            return;
        }

        // Guardar la sesión (solo dura mientras la pestaña esté abierta) y pasar al dashboard
        sessionStorage.setItem("token", data.token);
        sessionStorage.setItem("usuario", JSON.stringify(data.usuario));
        sessionStorage.setItem("midas.transicionInicio", "1");
        document.getElementById("transicionSonda").classList.add("conectando");
        document.getElementById("transicionSonda").setAttribute("aria-hidden", "false");
        const esperaTransicion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 350;
        await new Promise(resolve => window.setTimeout(resolve, esperaTransicion));
        window.location.replace("../resumen/inicio.html");

    } catch (error) {
        mostrarToast("No se pudo conectar con el servidor", "error");
    } finally {
        if (window.location.pathname.endsWith("/login.html") && loginEnCurso) {
            loginEnCurso = false;
            boton.disabled = false;
            boton.textContent = "Iniciar sesión";
        }
    }
}

formulario.addEventListener("submit", iniciarSesion);