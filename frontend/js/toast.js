// Avisos en tarjeta: aparecen abajo a la derecha y desaparecen solos.
// Uso: mostrarToast("Texto", "error" | "exito" | "aviso")
//
// Un solo reloj revisa cada 250 ms qué tarjetas vencieron y las cierra.
// Si se dispara el MISMO mensaje mientras sigue visible, no se crea otra tarjeta:
// la existente reinicia su tiempo y hace un pequeño rebote.
// Las clases se llaman "aviso" (y no "toast") para no chocar con Bootstrap.

(function () {
    // Tiempos en milisegundos: ajústalos aquí si los quieres más largos o más cortos
    const DURACION = { error: 2500, exito: 5000, aviso: 4000 };
    const MAX_VISIBLES = 4;
    const TIEMPO_TRAS_SALIR_MOUSE = 800;

    const estilo = document.createElement("style");
    estilo.textContent = `
        #avisos { position: fixed; bottom: 20px; right: 20px; z-index: 3000;
                  display: flex; flex-direction: column; gap: 10px;
                  width: min(340px, calc(100vw - 40px)); pointer-events: none; }
        .aviso { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px;
                 background: #18222c; color: #e6edf3; border: 1px solid #2a3846;
                 border-left: 5px solid #5cc0e0; border-radius: 8px; padding: 12px 14px;
                 font: .9rem/1.35 system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.4);
                 cursor: pointer; animation: aviso-entrar .25s ease-out; }
        .aviso-error { border-left-color: #ff8a80; }
        .aviso-exito { border-left-color: #4cc38a; }
        .aviso-aviso { border-left-color: #e0a34a; }
        .aviso span { flex: 1; }
        .aviso button { width: auto; background: transparent; border: 0; color: #93a1af;
                        font-size: 1.1rem; line-height: 1; padding: 0 2px; cursor: pointer; }
        .aviso.rebote { animation: aviso-rebote .3s ease-out; }
        .aviso.saliendo { animation: aviso-salir .25s ease-in forwards; }
        @keyframes aviso-entrar { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
        @keyframes aviso-salir { to { opacity: 0; transform: translateY(20px); } }
        @keyframes aviso-rebote { 0% { transform: scale(1); } 40% { transform: scale(1.04); } 100% { transform: scale(1); } }
    `;
    document.head.append(estilo);

    let contenedor = null;
    const activos = new Map(); // clave (tipo + texto) -> { el, expira, pausado }

    function obtenerContenedor() {
        if (!contenedor) {
            contenedor = document.createElement("div");
            contenedor.id = "avisos";
            document.body.append(contenedor);
        }
        return contenedor;
    }

    function cerrar(clave) {
        const t = activos.get(clave);
        if (!t) return;

        activos.delete(clave);
        t.el.classList.remove("rebote");
        t.el.classList.add("saliendo");
        t.el.dataset.cerrado = String(Date.now()); // el reloj la borra aunque la animación falle
    }

    // Reloj único: cierra las tarjetas vencidas y borra las que ya salieron
    setInterval(function () {
        const ahora = Date.now();

        activos.forEach(function (t, clave) {
            if (!t.pausado && ahora >= t.expira) cerrar(clave);
        });

        if (contenedor) {
            Array.from(contenedor.children).forEach(function (el) {
                if (el.dataset.cerrado && ahora - Number(el.dataset.cerrado) > 300) {
                    el.remove();
                }
            });
        }
    }, 250);

    window.mostrarToast = function (texto, tipo) {
        if (!texto) return;
        tipo = tipo || "error";

        const clave = tipo + "|" + texto;
        const duracion = DURACION[tipo] || 2500;
        const existente = activos.get(clave);

        // Mismo mensaje: reiniciar el tiempo y animar, sin crear otra tarjeta
        if (existente) {
            existente.expira = Date.now() + duracion;

            existente.el.classList.remove("rebote");
            void existente.el.offsetWidth; // fuerza a reiniciar la animación
            existente.el.classList.add("rebote");
            return;
        }

        // Nunca más de MAX_VISIBLES tarjetas: se cierra la más antigua
        if (activos.size >= MAX_VISIBLES) {
            cerrar(activos.keys().next().value);
        }

        const el = document.createElement("div");
        el.className = "aviso aviso-" + tipo;
        el.setAttribute("role", tipo === "error" ? "alert" : "status");

        const mensaje = document.createElement("span");
        mensaje.textContent = texto; // textContent: nunca interpreta HTML

        const cerrarBtn = document.createElement("button");
        cerrarBtn.textContent = "×";
        cerrarBtn.setAttribute("aria-label", "Cerrar aviso");

        el.append(mensaje, cerrarBtn);
        el.addEventListener("click", function () { cerrar(clave); }); // clic en la tarjeta la cierra

        const registro = { el: el, expira: Date.now() + duracion, pausado: false };

        // Con el mouse encima la tarjeta se queda; al quitarlo se cierra en poco tiempo
        el.addEventListener("mouseenter", function () { registro.pausado = true; });
        el.addEventListener("mouseleave", function () {
            registro.pausado = false;
            registro.expira = Date.now() + TIEMPO_TRAS_SALIR_MOUSE;
        });

        obtenerContenedor().append(el);
        activos.set(clave, registro);
    };
})();