const API = "http://localhost:3000";

const inputNombre = document.getElementById("nombre");
const inputEmail = document.getElementById("email");
const inputPassword = document.getElementById("password");
const inputPassword2 = document.getElementById("password2");
const boton = document.getElementById("btnRegistro");
const formulario = document.getElementById("formRegistro");
let registroEnCurso = false;

async function registrarse(evento) {
    evento.preventDefault();
    if (registroEnCurso) return;

    // Validación en el navegador (el backend valida otra vez)
    const correo = inputEmail.value.trim().toLowerCase();
    if (!correo.endsWith("@sonda.com")) {
        mostrarToast("El correo debe ser corporativo (@sonda.com)", "error");
        inputEmail.focus();
        return;
    }
    if (inputPassword.value !== inputPassword2.value) {
        inputPassword2.setCustomValidity("Las contraseñas no coinciden.");
        inputPassword2.reportValidity();
        return;
    }

    registroEnCurso = true;
    boton.disabled = true;
    boton.textContent = "Enviando solicitud…";
    try {
        const respuesta = await fetch(API + "/registro", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre: inputNombre.value,
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

        if (!respuesta.ok) {
            mostrarToast(data.mensaje || "No se pudo completar el registro. Inténtalo de nuevo.", "error");
            return;
        }

        // Registro recibido: la cuenta queda pendiente hasta que un admin la active.
        // Los campos se dejan llenos a propósito.
        mostrarToast(data.mensaje || "Solicitud recibida. Tu cuenta queda pendiente de aprobación.", "exito");

    } catch (error) {
        mostrarToast("No se pudo conectar con el servidor", "error");
    } finally {
        registroEnCurso = false;
        boton.disabled = false;
        boton.textContent = "Crear cuenta";
    }
}

inputPassword2.addEventListener("input", () => inputPassword2.setCustomValidity(""));
inputPassword.addEventListener("input", () => inputPassword2.setCustomValidity(""));
formulario.addEventListener("submit", registrarse);