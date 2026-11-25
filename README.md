# MIDAS

Aplicación web para consultar resultados por proyecto y administrar variables y métricas. El proyecto está compuesto por un frontend estático, una API en Node.js/Express y una base de datos PostgreSQL. Puede leer una réplica local de PRISMA, datos sintéticos de demostración o una base PostgreSQL autorizada configurada como solo lectura.

> **Estado de integraciones:** Power BI todavía no está conectado a MIDAS. La API nueva de PRISMA está en desarrollo y MIDAS aún no la consume. Este proyecto tampoco tiene una configuración Docker validada.

## Contenido

- [Qué hace MIDAS](#qué-hace-midas)
- [Requisitos](#requisitos)
- [Instalación local desde cero](#instalación-local-desde-cero)
- [Elegir los datos de PRISMA](#elegir-los-datos-de-prisma)
- [Crear el primer usuario](#crear-el-primer-usuario)
- [Iniciar y abrir MIDAS](#iniciar-y-abrir-midas)
- [Cómo usar la aplicación](#cómo-usar-la-aplicación)
- [Roles y permisos](#roles-y-permisos)
- [Ecuaciones de métricas](#ecuaciones-de-métricas)
- [Rutas de la API](#rutas-de-la-api)
- [Power BI, API de PRISMA y Docker](#power-bi-api-de-prisma-y-docker)
- [Seguridad y datos](#seguridad-y-datos)
- [Solución de problemas](#solución-de-problemas)
- [Estructura del proyecto](#estructura-del-proyecto)

## Qué hace MIDAS

- Permite iniciar sesión y administrar usuarios mediante los roles `admin_super`, `admin` y `usuario`.
- Consulta los proyectos implementados y los datos disponibles de BENEFICIOS desde la conexión de PRISMA configurada.
- Administra variables personalizadas y métricas por proyecto.
- Permite revisar una métrica antes de activarla; las métricas activas aparecen en el Resumen y las desactivadas quedan en el historial.
- Organiza métricas Globales en grupos y presenta las métricas Únicas por separado.
- Permite asignar métricas a una de tres capas del Resumen; las de capas superiores también aparecen en las capas anteriores.
- Muestra en la capa 3 del Resumen un indicador de horas ahorradas acumuladas por mes (todos los proyectos), con selección de mes.
- Incluye una comparación mensual entre dos periodos (mes y año) basada en las fechas de vigencia que existan en BENEFICIOS.
- Registra acciones de administración para consulta por `admin_super`.

Los valores que se pueden calcular dependen de las columnas existentes en BENEFICIOS. Si falta un dato de origen o una métrica no se puede evaluar, la aplicación lo indica; no debe interpretarse un dato ausente como cero.

## Requisitos

- Windows 10/11.
- Node.js 18 o superior y npm.
- PostgreSQL y, opcionalmente, `psql` en el `PATH`. Como alternativa se puede usar pgAdmin.
- Visual Studio Code con la extensión Live Server, o cualquier servidor para archivos estáticos.

## Instalación local desde cero

### 1. Abrir la carpeta del proyecto

Abre la carpeta raíz `DashboardPostgres` en Visual Studio Code. Los comandos de esta guía se ejecutan desde esa carpeta, salvo que se indique lo contrario.

### 2. Crear la base de MIDAS

Crea una base local llamada `dashboard_db` y carga su esquema:

```powershell
psql -U postgres -c "CREATE DATABASE dashboard_db;"
psql -U postgres -d dashboard_db -f .\database\schema.sql
```

También puedes crear la base desde pgAdmin, abrir `database/schema.sql` en Query Tool y ejecutar el script sobre `dashboard_db`.

El backend crea o actualiza al arrancar algunas estructuras auxiliares de MIDAS, incluida la tabla de auditoría. Su preparación de esquema modifica las tablas propias de MIDAS indicadas en el código; no elimina restricciones de otras tablas de `public`.

### 3. Cargar una fuente para los proyectos

MIDAS necesita consultar proyectos y BENEFICIOS. Elige **una** fuente:

- **Réplica local de PRISMA:** carga `database/export_bd_prisma_postgres.sql` en `dashboard_db`. El script reemplaza el esquema `prisma` existente: contiene `DROP SCHEMA prisma CASCADE`, por lo que **solo debe ejecutarse en una base local/de desarrollo donde se pueda reemplazar ese esquema**. No lo ejecutes sobre producción ni sobre una base que tenga información que debas conservar.
- **Datos sintéticos de demostración:** sigue [Elegir los datos de PRISMA](#elegir-los-datos-de-prisma) para crear el esquema aislado `prisma_demo`.
- **Base PostgreSQL de PRISMA:** solicita al responsable de PRISMA el host, base, esquema y una cuenta con permisos de solo lectura. Configura esos valores en las variables `PRISMA_DB_*` descritas más abajo. No uses credenciales de producción sin autorización.

La conexión a PRISMA se configura en modo de solo lectura. MIDAS no escribe sobre la base de PRISMA.

### 4. Configurar el backend

En `backend`, crea un archivo local llamado `.env` con este formato:

```env
DB_USER=postgres
DB_HOST=localhost
DB_NAME=dashboard_db
DB_PASSWORD=REEMPLAZA_CON_LA_CLAVE_LOCAL
DB_PORT=5432
JWT_SECRET=REEMPLAZA_CON_UN_SECRETO_ALEATORIO_LARGO
JWT_EXPIRES=2h
```

Genera un secreto JWT en una terminal de PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copia el resultado en `JWT_SECRET`. Debe tener al menos 32 caracteres. Para conectar a una base/esquema de PRISMA diferente del predeterminado, agrega las variables necesarias:

```env
PRISMA_DB_HOST=localhost
PRISMA_DB_PORT=5432
PRISMA_DB_NAME=nombre_de_base_prisma
PRISMA_DB_USER=usuario_solo_lectura
PRISMA_DB_PASSWORD=CLAVE_SUMINISTRADA_POR_EL_RESPONSABLE
PRISMA_DB_SCHEMA=public
```

Las variables `PRISMA_DB_*` no son obligatorias. Si no se indican, MIDAS utiliza la misma conexión de `DB_*` y busca el esquema `prisma`. Los valores `PRISMA_DB_*` que no se especifiquen usan el valor equivalente `DB_*`. `PRISMA_DB_SCHEMA` debe ser el esquema real donde estén las tablas requeridas.

No compartas ni subas `backend/.env`, contraseñas ni tokens. No pegues secretos en capturas, tickets ni mensajes.

### 5. Instalar dependencias

Desde la carpeta raíz:

```powershell
Set-Location .\backend
npm install
```

### 6. Crear el primer usuario

El alta inicial se hace desde una **terminal interactiva** de VS Code. Abre otra terminal, entra a `backend` y ejecuta:

```powershell
Set-Location .\backend
npm run crear-usuario
```

El asistente solicita nombre, correo, rol y contraseña. La contraseña se escribe dos veces y aparece enmascarada; debe tener entre 8 y 72 caracteres. Para el primer usuario, elige el rol `1` (`admin_super`). La cuenta queda activa al terminar.

Roles disponibles:

1. `admin_super`: administración completa; gestiona cuentas y es el único rol con acceso al registro de actividad.
2. `admin`: consulta y agrega variables, grupos Globales y borradores de métricas; puede previsualizar y enviar métricas.
3. `usuario`: consulta información y resultados.

Si el asistente informa que faltan tablas, revisa que `database/schema.sql` se ejecutó en `dashboard_db` y que `backend/.env` apunta a esa base.

> El registro desde la página web, si está habilitado para el entorno, crea una cuenta pendiente. Un `admin_super` debe activarla antes de que pueda iniciar sesión.

## Elegir los datos de PRISMA

### Usar datos sintéticos `[DEMO]`

Los datos de demostración son inventados. Sirven para probar proyectos, cálculos y comparación mensual; no son información real y no se deben presentar como resultados reales.

1. Instala las dependencias desde `backend` si aún no lo hiciste.
2. Desde `backend`, genera el SQL:

   ```powershell
   npm run generar-demo
   ```

3. Desde la raíz del proyecto, carga el archivo en la base local `dashboard_db`:

   ```powershell
   psql -U postgres -d dashboard_db -f .\database\prisma_demo_seed.sql
   ```

   También se puede ejecutar el archivo en pgAdmin. El script crea/actualiza solamente el esquema `prisma_demo`; no modifica `public` ni el esquema `prisma`.
4. En `backend/.env`, añade o cambia:

   ```env
   PRISMA_DB_SCHEMA=prisma_demo
   ```

5. Comprueba que las variables `DB_*` apunten a la base local con el esquema `prisma_demo`, y reinicia el backend.

El generador produce 12 proyectos de demostración y 144 registros mensuales de BENEFICIOS para el año actual. Los proyectos incluyen `[DEMO]` en su nombre y usan IDs reservados para que volver a cargar el SQL actualice esos registros en vez de acumular duplicados. Este conjunto no crea métricas ni grupos de MIDAS.

### Usar la réplica local de PRISMA

Si cargaste `database/export_bd_prisma_postgres.sql` en `dashboard_db`, deja `PRISMA_DB_SCHEMA` sin definir o indica:

```env
PRISMA_DB_SCHEMA=prisma
```

Recuerda que ese archivo reemplaza el esquema `prisma`; úsalo únicamente en una base local/de desarrollo.

### Usar una base de PRISMA autorizada

Solicita al responsable de PRISMA los datos de conexión y un usuario de **solo lectura**. Configura las variables `PRISMA_DB_*` en `backend/.env`, indicando el esquema correcto, y reinicia el backend. Mantén `DB_*` apuntando a la base propia de MIDAS; no intercambies por accidente las conexiones.

## Iniciar y abrir MIDAS

### 1. Arrancar el backend

En una terminal:

```powershell
Set-Location .\backend
npm start
```

El backend escucha en `http://localhost:3000`. Deja la terminal abierta. Al inicio muestra el estado de conexión de la base de MIDAS y de PRISMA. Si aparece `SIN CONEXIÓN`, revisa la configuración antes de usar la aplicación.

### 2. Abrir el frontend

En Visual Studio Code, abre `frontend/auth/login.html` con Live Server (**Open with Live Server**). Inicia sesión con la cuenta creada en el paso anterior. Para otro entorno, el frontend actualmente espera la API en `http://localhost:3000`; cambiar host o puerto requiere actualizar las referencias en los scripts del frontend.

### 3. Cerrar

Cierra la pestaña del frontend y detén el backend con `Ctrl+C` en la terminal donde corre `npm start`.

## Cómo usar la aplicación

1. **Iniciar sesión:** introduce el correo y la contraseña de una cuenta activa.
2. **Resumen:** después de ingresar, MIDAS presenta los resultados de métricas activas. Los resultados Globales se consolidan por grupo; los Únicos se muestran individualmente por proyecto. En la capa 3 se muestra el acumulado mensual de horas ahorradas de todos los proyectos, con selección de mes.
3. **Panel de administración:** desde el Resumen abre el panel para gestionar variables, grupos, métricas y usuarios según el rol.
4. **Variables:** consulta las variables personalizadas y las disponibles desde BENEFICIOS. Una variable usada por una métrica enviada se bloquea para proteger ese cálculo.
5. **Grupos Globales:** crea o administra los grupos que organizan métricas Globales. Una métrica Global necesita un grupo; una Única no.
6. **Crear una métrica:** selecciona un proyecto implementado, elige la capa, escribe la ecuación y guarda el borrador. Puedes rectificar y previsualizar la métrica antes de enviarla.
7. **Enviar:** al enviar, el borrador pasa a activa y ya no se puede editar. Las métricas desactivadas aparecen en el historial y un `admin_super` puede reactivarlas si cumplen las validaciones.
8. **Comparación mensual:** elige dos periodos (mes y año) y pulsa **Comparar**. La comparación se basa en fechas de vigencia disponibles; MIDAS no inventa un histórico si el origen no contiene períodos distintos.
9. **Perfil y cierre de sesión:** el perfil permite actualizar nombre, correo y contraseña. Para cambiar la contraseña se solicita la actual. Cierra sesión desde el menú de usuario.

## Roles y permisos

| Acción | `admin_super` | `admin` | `usuario` |
|---|---:|---:|---:|
| Consultar Resumen, proyectos, variables y métricas activas | Sí | Sí | Sí |
| Administrar cuentas | Sí | No | No |
| Ver registro de actividad | Sí | No | No |
| Agregar variables personalizadas | Sí | Sí | No |
| Editar, activar, desactivar o eliminar variables | Sí | No | No |
| Crear y editar borradores de métricas | Sí | Sí | No |
| Enviar métricas | Sí | Sí | No |
| Desactivar o reactivar métricas activas | Sí | No | No |
| Administrar grupos Globales | Crear | Crear | Consultar |
| Editar o eliminar grupos Globales | Sí | No | No |
| Actualizar el perfil propio | Sí | Sí | Sí |

El backend verifica la sesión y el rol en cada ruta protegida. Cambiar u ocultar un botón en el navegador no concede ni revoca permisos.

## Ecuaciones de métricas

- Escribe nombres de variables o métricas tal como aparecen en MIDAS. Ejemplo: `Horas manuales * Valor hora`.
- Operadores disponibles: `+`, `-`, `*`, `/`, `%`, `^` y paréntesis. `%` calcula el residuo; los decimales pueden usar punto o coma.
- Se pueden usar variables disponibles para el proyecto y métricas activas del mismo proyecto.
- Una ecuación no puede llamarse a sí misma. No se puede desactivar una métrica activa si otra métrica activa depende de ella.
- La vista previa detecta errores, como nombres desconocidos, paréntesis incompletos o división por cero.

## Rutas de la API

La API local está en `http://localhost:3000`. Las rutas protegidas requieren una sesión iniciada; las operaciones administrativas aplican además permisos por rol.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/login` | Iniciar sesión. |
| `POST` | `/registro` | Enviar una solicitud de cuenta pendiente. |
| `GET` | `/yo` | Obtener los datos actuales de la sesión. |
| `PUT` | `/perfil` | Actualizar el perfil propio. |
| `GET` | `/paises` | Consultar países de PRISMA. |
| `GET` | `/proyectos` | Consultar proyectos Implementados. |
| `GET` | `/variables` | Listar variables. |
| `GET` | `/variables/beneficios?proyecto_id=ID` | Consultar valores de BENEFICIOS para un proyecto. |
| `POST` | `/variables` | Crear variable (`admin_super`, `admin`). |
| `PUT`, `PATCH`, `DELETE` | `/variables/:id` y subrutas | Modificar estado o eliminar (solo `admin_super`). |
| `GET` | `/grupos-globales` | Listar grupos Globales. |
| `POST` | `/grupos-globales` | Crear grupo (`admin_super`, `admin`). |
| `PUT`, `DELETE` | `/grupos-globales/:id` | Editar o eliminar grupo (solo `admin_super`). |
| `GET` | `/calculos` | Listar métricas visibles para el rol. |
| `POST` | `/calculos/previsualizar` | Calcular una ecuación sin guardarla (`admin_super`, `admin`). |
| `POST`, `PUT`, `DELETE` | `/calculos` y `/calculos/:id` | Crear, editar o eliminar borradores según permisos. |
| `POST` | `/calculos/:id/enviar` | Enviar un borrador y activarlo. |
| `PATCH` | `/calculos/:id/activar` o `/desactivar` | Cambiar estado (solo `admin_super`). |
| `GET` | `/dashboard/resumen` | Obtener el resumen de resultados. |
| `GET` | `/dashboard/comparacion-mensual?anio=AAAA&meses=M1,M2` | Comparar dos meses válidos. |
| `POST` | `/dashboard/ejemplos` | Crear dos borradores de demostración para un proyecto `[DEMO]`. |
| `GET` | `/historial` | Consultar métricas desactivadas. |
| `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | `/usuarios` y `/usuarios/:id` | Administrar cuentas (solo `admin_super`). |
| `GET` | `/auditoria` | Consultar el registro de actividad (solo `admin_super`). |

## Power BI, API de PRISMA y Docker

### Power BI

Power BI no está integrado ni configurado en esta versión de MIDAS. Power BI Desktop puede usarse localmente para desarrollar o probar un informe. Para una publicación o actualización desde Power BI Service con una fuente local, falta que la organización defina:

- qué servidor Windows corporativo puede alojar el gateway;
- quién administra ese servidor y habilita la conectividad;
- qué cuenta y licencia de Power BI se asignarán y qué modalidad de publicación/compartición se necesita.

El gateway es el puente entre Power BI Service y una fuente de datos local; no es una licencia. MIDAS no instala ni configura el gateway, ni administra licencias.

### API de PRISMA

El plan compartido describe una futura API de PRISMA para MIDAS, pero su implementación y habilitación deben confirmarse con el equipo de PRISMA. Este código todavía consulta PostgreSQL y no consume esa API. Antes de integrar se necesitarán el ambiente disponible, la documentación OpenAPI vigente y un mecanismo de acceso aprobado; no incluyas tokens en el repositorio.

### Docker

El proyecto aún no cuenta con `Dockerfile`, `docker-compose.yml` ni configuración Docker validada. Para prepararlo para un servidor se debe definir cómo se alojará PostgreSQL (contenedor o servicio administrado), dónde se guardarán los secretos, la URL del frontend/API, la red y los respaldos. No se deben incluir contraseñas ni secretos en imágenes, archivos versionados o logs.

## Seguridad y datos

- `backend/.env` contiene credenciales y secretos locales; no se comparte ni se sube.
- Las contraseñas de usuarios se almacenan como hashes; el secreto JWT debe ser largo, único y privado.
- Usa para PRISMA una cuenta autorizada de solo lectura. No conectes una base de producción durante pruebas sin autorización y respaldo.
- `database/export_bd_prisma_postgres.sql` elimina y recrea el esquema `prisma`: ejecútalo solo sobre una base local preparada para ello.
- Los datos `[DEMO]` son sintéticos; no representan cifras de proyectos reales.
- El proyecto no tiene un comando de pruebas automatizadas configurado en `backend/package.json`. Para cambios, al menos verifica sintaxis de JavaScript con `node --check`.
- La conexión del frontend usa HTTP local para desarrollo. Antes de exponer la aplicación fuera de un entorno local se deben definir HTTPS, CORS, gestión segura de secretos y controles de acceso acordes al entorno corporativo.

## Solución de problemas

### El backend no inicia por variables faltantes

Comprueba que `backend/.env` exista y tenga `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `JWT_SECRET` y `JWT_EXPIRES`. `JWT_SECRET` debe tener al menos 32 caracteres.

### No conecta a PostgreSQL

Confirma que PostgreSQL esté iniciado, que host/puerto/base/usuario/contraseña sean correctos y que `database/schema.sql` se haya ejecutado en `dashboard_db`. Revisa el mensaje de conexión en la terminal del backend.

### No aparecen proyectos

Confirma cuál fuente seleccionaste. Para la réplica, debe existir `prisma.iniciativas`; para datos sintéticos, configura `PRISMA_DB_SCHEMA=prisma_demo` y carga `database/prisma_demo_seed.sql`. Si usas la base corporativa, verifica el esquema y los permisos con su responsable.

### No abre el inicio de sesión o falla la conexión desde el navegador

Confirma que el backend siga activo en `http://localhost:3000`, que Live Server esté sirviendo la carpeta `frontend` y que el navegador no muestre un error de conexión. El frontend debe apuntar al mismo host y puerto donde escucha el backend.

### No puedo crear al usuario desde `npm run crear-usuario`

Ejecuta el comando desde una terminal interactiva, después de configurar `backend/.env`, instalar dependencias y crear el esquema de MIDAS. No funciona en una sesión que no permita entrada interactiva para la contraseña.

## Estructura del proyecto

```text
DashboardPostgres/
├── backend/
│   ├── app.js
│   ├── crearAdmin.js
│   ├── generarDatosDemo.js
│   ├── package.json
│   └── .env                  # local, no compartir
├── database/
│   ├── schema.sql
│   ├── export_bd_prisma_postgres.sql
│   └── prisma_demo_seed.sql
├── frontend/
│   ├── admin/
│   │   ├── actividad.html
│   │   ├── metricas.html
│   │   └── panel.html
│   ├── auth/
│   │   ├── login.html
│   │   └── registro.html
│   ├── assets/
│   ├── css/
│   ├── js/
│   └── resumen/
│       └── inicio.html
├── scripts/
│   └── reporte_metricas.py
└── README.md
```

El README está en la raíz para que sea lo primero que se encuentre al abrir el proyecto.

### Comandos disponibles

Ejecuta estos comandos desde `backend`:

| Comando | Descripción |
|---|---|
| `npm install` | Instala dependencias del backend. |
| `npm start` | Inicia la API en el puerto 3000. |
| `npm run crear-usuario` | Abre el asistente interactivo para crear un usuario activo. |
| `npm run generar-demo` | Genera el SQL de datos sintéticos en `database/prisma_demo_seed.sql`. |

### Reporte opcional en Excel

El script `scripts/reporte_metricas.py` puede exportar métricas activas, variables, resumen por proyecto e historial mediante la API de MIDAS. Requiere el backend en ejecución y los paquetes Python `requests` y `openpyxl`:

```powershell
python -m pip install requests openpyxl
python .\scripts\reporte_metricas.py
```

El script solicita credenciales interactivamente; no las pases como argumentos. El archivo de salida se guarda en la carpeta desde la que se ejecuta y los nombres `reporte_midas_*.xlsx` están ignorados por Git.
