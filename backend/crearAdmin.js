require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const readline = require("node:readline");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const ROLES = ["admin_super", "admin", "usuario"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const variablesObligatorias = ["DB_USER", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT"];

function preguntar(texto) {
    const terminal = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => terminal.question(texto, resolve))
        .finally(() => terminal.close());
}

function preguntarClave(texto) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        return Promise.reject(new Error("Ejecuta este comando en una terminal interactiva de VS Code."));
    }

    return new Promise((resolve, reject) => {
        const entrada = process.stdin;
        const modoOriginal = entrada.isRaw;
        let valor = "";

        readline.emitKeypressEvents(entrada);
        entrada.setRawMode(true);
        entrada.resume();
        process.stdout.write(texto);

        function limpiar() {
            entrada.removeListener("keypress", alPresionar);
            entrada.setRawMode(modoOriginal);
            process.stdout.write("\n");
        }

        function alPresionar(caracter, tecla) {
            if (tecla && tecla.ctrl && tecla.name === "c") {
                limpiar();
                reject(new Error("Operación cancelada."));
                return;
            }
            if (tecla && (tecla.name === "return" || tecla.name === "enter")) {
                limpiar();
                resolve(valor);
                return;
            }
            if (tecla && tecla.name === "backspace") {
                if (valor.length > 0) {
                    valor = valor.slice(0, -1);
                    process.stdout.write("\b \b");
                }
                return;
            }
            if (caracter && tecla && !tecla.ctrl && !tecla.meta) {
                valor += caracter;
                process.stdout.write("*");
            }
        }

        entrada.on("keypress", alPresionar);
    });
}

async function main() {
    const faltantes = variablesObligatorias.filter(nombre => !process.env[nombre]);
    if (faltantes.length > 0) {
        throw new Error("Faltan variables en backend/.env: " + faltantes.join(", "));
    }

    console.log("Crear usuario activo para MIDAS");
    const nombre = (await preguntar("Nombre: ")).trim();
    const email = (await preguntar("Correo: ")).trim().toLowerCase();

    console.log("Rol: 1) admin_super  2) admin  3) usuario");
    const opcionRol = (await preguntar("Elige un rol [1-3]: ")).trim();
    const rol = ({ "1": "admin_super", "2": "admin", "3": "usuario" })[opcionRol];

    if (!nombre || nombre.length > 100) {
        throw new Error("El nombre es obligatorio y debe tener como máximo 100 caracteres.");
    }
    if (email.length > 150 || !EMAIL_REGEX.test(email)) {
        throw new Error("Escribe un correo válido de hasta 150 caracteres.");
    }
    if (!ROLES.includes(rol)) {
        throw new Error("El rol debe ser 1, 2 o 3.");
    }

    const password = await preguntarClave("Contraseña (8 a 72 caracteres): ");
    const confirmarPassword = await preguntarClave("Confirma la contraseña: ");
    if (password.length < 8 || password.length > 72) {
        throw new Error("La contraseña debe tener entre 8 y 72 caracteres.");
    }
    if (password !== confirmarPassword) {
        throw new Error("Las contraseñas no coinciden.");
    }

    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT
    });

    try {
        const hash = await bcrypt.hash(password, 10);
        const resultado = await pool.query(
            `INSERT INTO public.usuarios (nombre, email, password_hash, rol, activo)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, nombre, email, rol, activo`,
            [nombre, email, hash, rol]
        );
        console.log("Usuario creado y activo:", resultado.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            throw new Error("Ya existe una cuenta con ese correo.");
        }
        throw error;
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error("No se pudo crear el usuario:", error.message);
    process.exitCode = 1;
});