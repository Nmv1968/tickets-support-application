# Soporte

**Gestión de casos de soporte técnico para equipos pequeños. Autoalojada, de código abierto y con IA opcional.**

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
![Angular 20](https://img.shields.io/badge/Angular-20-dd0031)
![NestJS 11](https://img.shields.io/badge/NestJS-11-e0234e)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ed)

> *Self-hosted help desk and support ticket tracker for small teams. The interface and this documentation are in Spanish.*

Soporte reemplaza la hoja de cálculo donde muchos equipos anotan sus casos. Cada caso tiene fecha,
empresa, descripción, estado, responsable y observaciones, y se edita en una tabla igual que en la
hoja. Encima de eso agrega lo que la hoja no da: tablero, tiempos y SLA, avisos de casos olvidados,
adjuntos, historial de cambios, métricas y, si quieres, un asistente de IA que registra casos desde una
captura de pantalla y redacta la respuesta para el cliente.

Se instala en tu propia máquina o servidor con un comando. Tus datos no salen de ahí.

![Lista de casos](docs/img/casos.png)

| Detalle del caso | Tablero |
| --- | --- |
| ![Detalle del caso](docs/img/caso.png) | ![Tablero Kanban](docs/img/tablero.png) |

| Dashboard (tema oscuro) | Importar desde Excel |
| --- | --- |
| ![Dashboard](docs/img/dashboard.png) | ![Importar](docs/img/importar.png) |

*Las capturas usan datos inventados.*

## Contenido

- [Características](#características)
- [Instalación con Docker](#instalación-con-docker) (recomendada para usarla)
- [Desarrollo en local](#desarrollo-en-local) (para modificarla)
- [Configuración](#configuración)
- [Respaldos](#respaldos)
- [Inteligencia artificial](#inteligencia-artificial)
- [Asistentes de IA: MCP y skills](#asistentes-de-ia-mcp-y-skills)
- [Importar una hoja de cálculo](#importar-una-hoja-de-cálculo)
- [Cómo funciona un caso](#cómo-funciona-un-caso)
- [Arquitectura](#arquitectura)
- [Seguridad](#seguridad)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

## Características

- **Casos en una tabla editable.** Alta rápida en la primera fila; estado y responsable se cambian en
  la celda. Búsqueda sin distinguir tildes ni mayúsculas, filtros y paginación.
- **Detalle del caso.** Prioridad, módulo, tiempo estimado y real con cronómetro, fecha límite por
  SLA, promesa de entrega, observaciones con fecha y autor, adjuntos (arrastrar o pegar con Ctrl+V) e
  historial de cada cambio. Todo se guarda solo, sin botón "Guardar".
- **Tablero Kanban.** Una columna por estado; arrastrar una tarjeta cambia el estado.
- **Avisos.** La campana lista los casos olvidados (abiertos y sin movimiento durante el tiempo que
  configures), los vencidos por SLA y las promesas de entrega que vencen hoy o están por vencer.
- **Dashboard.** Casos por mes, responsable, empresa, módulo y prioridad; tiempo de resolución y
  cumplimiento de SLA.
- **Actualización en vivo.** Lo que registra otra persona, otra pestaña o un asistente aparece al
  instante, sin recargar.
- **Importar y exportar.** Importa tu hoja actual (.xlsx o .csv) con vista previa, o descarga una
  plantilla de Excel lista para llenar. Exporta a Excel o PDF con los filtros activos.
- **IA opcional, con tu propia API key.** Anthropic (Claude), OpenAI, Google Gemini o cualquier
  servidor compatible con la API de OpenAI (OpenRouter, Groq, Ollama local…). Crea el borrador de un
  caso desde una foto, una captura o un texto pegado, y redacta el mensaje para el cliente al resolver.
- **Servidor MCP y skill para asistentes.** Claude, Codex, Gemini, Cursor o Copilot pueden buscar,
  registrar y cerrar casos conversando.
- **Tu logo.** Sube el logo de tu empresa y reemplaza el icono del menú, de la pantalla de ingreso y
  de la pestaña del navegador.
- **Respaldos automáticos** de la base de datos y los adjuntos, con restauración documentada.
- **Tema claro y oscuro**, y diseño que se adapta al teléfono.

Sin la IA configurada, todo lo demás funciona igual.

## Instalación con Docker

Es la forma recomendada de usar la aplicación. Levanta cuatro contenedores: la base de datos, el API,
la web y el servicio de respaldos.

**Requisitos:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) o
Docker Engine con el plugin Compose (Linux).

1. Descarga el proyecto:

   ```bash
   git clone https://github.com/Nmv1968/tickets-support-application.git
   cd tickets-support-application
   ```

2. Crea tu archivo de configuración a partir del ejemplo:

   ```bash
   cp .env.example .env
   ```

   En PowerShell: `Copy-Item .env.example .env`.

3. Abre `.env` y reemplaza **todos** los `change-me`. Para `JWT_SECRET` y `APP_SECRET` usa cadenas
   largas y aleatorias; puedes generarlas así:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   o con `openssl rand -hex 32`. `POSTGRES_PASSWORD` solo admite letras y números.

4. Levanta la aplicación:

   ```bash
   docker compose up -d --build
   ```

5. Abre <http://localhost:4300> e ingresa con el `ADMIN_USERNAME` y el `ADMIN_PASSWORD` que pusiste
   en `.env`.

El primer arranque crea las tablas, el usuario inicial, un catálogo de módulos de ejemplo y los SLA
por defecto. Desde **Configuración** se crean los demás usuarios y se ajusta el resto.

Si el API no arranca, `docker compose logs api` dice por qué. Lo habitual es un valor de `.env` que
sigue en `change-me`: el API se niega a iniciar así.

### Uso diario

```bash
docker compose ps                 # estado de los contenedores
docker compose logs -f api        # log del API
docker compose down               # detener; los datos se conservan
docker compose up -d              # volver a encender
```

Los contenedores se reinician solos cuando arranca Docker. En Docker Desktop, activa "Start Docker
Desktop when you sign in" para que la aplicación vuelva sola después de reiniciar la máquina.

> [!WARNING]
> `docker compose down -v` borra los volúmenes, es decir, la base de datos y los adjuntos. Úsalo solo
> si quieres empezar de cero.

### Actualizar

```bash
git pull
docker compose up -d --build
```

Las migraciones de la base de datos se aplican solas al arrancar el API.

### Acceso desde otras máquinas

Los demás equipos de la red entran con `http://<ip-de-la-máquina>:4300`. El puerto se cambia con
`WEB_PORT` en `.env`.

La aplicación sirve HTTP sin cifrar: está pensada para una red interna. Para publicarla en internet,
ponla detrás de un proxy inverso con HTTPS (Caddy, nginx, Traefik). El proxy no debe retener en búfer
la ruta `/api/events`, que es un flujo abierto para la actualización en vivo.

## Desarrollo en local

Para modificar el código. No necesita Docker ni tener PostgreSQL instalado: `devdb/` descarga y
arranca uno propio.

**Requisitos:** [Node.js 22](https://nodejs.org/) y Google Chrome (solo para las pruebas de la web).

1. Configuración, una sola vez:

   ```bash
   cp .env.example .env            # secretos y primer usuario (reemplaza los change-me)
   cp api/.env.example api/.env    # conexión a la base de desarrollo; sirve tal cual
   ```

2. Cada parte en su propia terminal:

   ```bash
   # Terminal 1: base de datos en localhost:5433
   cd devdb
   npm install
   npm start
   ```

   ```bash
   # Terminal 2: API en http://localhost:3300
   cd api
   npm install
   npm run db:migrate      # crea las tablas; repítelo después de cada actualización del código
   npm run start:dev
   ```

   ```bash
   # Terminal 3: web en http://localhost:4300
   cd web
   npm install
   npm start
   ```

3. Abre <http://localhost:4300>. El API y la web se recargan solos al guardar un archivo.

La web de desarrollo y la instalación con Docker usan el mismo puerto, 4300. Si tienes las dos en la
misma máquina, detén una o cambia `WEB_PORT`. Cada una tiene su propia base de datos.

### Pruebas

Ninguna necesita la base de datos ni el API encendidos:

```bash
cd api && npm test            # API: Jest
cd web && npm run test:ci     # web: Karma con Chrome sin ventana, una sola pasada
```

`cd web && npm test` deja las pruebas de la web en modo observación.

### Cambios en la base de datos

Después de editar `api/prisma/schema.prisma`, con la base de desarrollo encendida:

```bash
cd api && npx prisma migrate dev --name describe_el_cambio
```

<details>
<summary>Pasar a Docker los datos de la base de desarrollo</summary>

Sirve una sola vez, con los volúmenes de Docker recién creados. Copia casos, usuarios, módulos,
configuración y adjuntos. La base de desarrollo debe estar encendida.

```bash
# 1. Solo la base de datos de Docker, con sus tablas vacías
docker compose up -d db
docker compose run --rm --no-deps api npx prisma migrate deploy

# 2. Datos, leídos con un cliente de la versión de la base de desarrollo (PostgreSQL 18)
docker run --rm postgres:18-alpine pg_dump "postgresql://support:support@host.docker.internal:5433/support" --data-only --disable-triggers --exclude-table-data=_prisma_migrations --no-owner > datos.sql
docker compose exec -T db psql -U support -d support -v ON_ERROR_STOP=1 < datos.sql

# 3. El resto de la aplicación, y los adjuntos
docker compose up -d
docker compose cp ./api/uploads/. api:/data/uploads/
docker compose exec -u root api chown -R node:node /data/uploads
```

`datos.sql` lleva las contraseñas cifradas de los usuarios: bórralo al terminar. Usa el mismo `.env`
en ambos lados; con otro `APP_SECRET`, las API keys de IA guardadas no se pueden leer.

</details>

## Configuración

Todo va en el archivo `.env` de la raíz, que nunca se sube al repositorio.

| Variable | Para qué sirve | Por defecto |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Contraseña de la base de datos de Docker. Solo letras y números. | obligatoria |
| `JWT_SECRET` | Firma las sesiones. Cadena larga y aleatoria. | obligatoria |
| `APP_SECRET` | Cifra las API keys de IA guardadas. Si la cambias, hay que ingresar las keys otra vez. | obligatoria |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Primer usuario. Se crea solo cuando no existe ninguno. | `admin`, obligatoria, `Administrador` |
| `MCP_USERNAME`, `MCP_NAME`, `MCP_PASSWORD` | Usuario para asistentes de IA por MCP. Deja `MCP_PASSWORD` vacía para no crearlo. | `claude`, `Claude`, vacía |
| `WEB_PORT` | Puerto donde se publica la web. | `4300` |
| `TZ` | Zona horaria. Define qué día es "hoy" para fechas, avisos y respaldos. | `America/Guayaquil` |
| `BACKUP_DIR` | Carpeta de la máquina que recibe los respaldos. | `./backups` |
| `BACKUP_KEEP_DAYS` | Días que se conserva un respaldo de la base de datos. | `14` |
| `BACKUP_INTERVAL_HOURS` | Horas entre respaldos mientras la máquina está encendida. | `6` |

El API revisa estos valores al arrancar. No inicia sin `JWT_SECRET` y `APP_SECRET`, ni, en producción
(Docker), mientras `JWT_SECRET`, `APP_SECRET`, `ADMIN_PASSWORD` o `MCP_PASSWORD` sigan en `change-me`.

Lo demás se configura desde la aplicación, en **Configuración**: usuarios, catálogo de módulos, horas
de SLA por prioridad, recordatorios, proveedor de IA y logo de la empresa.

### Personalizar

- **Logo.** En **Configuración > Empresa** sube el logo de tu empresa (PNG, JPG, WebP o SVG). Se
  guarda reducido y se usa en el menú, en la pantalla de ingreso y como icono de la pestaña del
  navegador. Va en la base de datos, así que entra en los respaldos.
- **Módulos.** El catálogo inicial es un ejemplo para un software de gestión. Cámbialo por los
  módulos o áreas de tu producto en **Configuración > Módulos**.
- **Guía de estilo de los mensajes a clientes.** La IA redacta siguiendo
  `api/assets/estilo-respuestas.md`. Para usar la guía de tu equipo sin tocar la del proyecto, crea
  junto a ella `api/assets/estilo-respuestas.local.md`: si existe, se usa esa. Git la ignora. Con
  Docker, vuelve a construir la imagen después de cambiarla (`docker compose up -d --build api`).
- **Reglas para asistentes.** `mcp/GUIA.md` dice a los asistentes cómo registrar y cerrar casos, y
  `skills/soporte-casos/SKILL.md`, cuándo usar las herramientas.

## Respaldos

El servicio `backup` copia los datos a la carpeta `backups/` del proyecto, fuera de los volúmenes de
Docker:

- `soporte-AAAA-MM-DD.dump`: la base de datos, un archivo por día. Se vuelve a escribir cada 6 horas,
  así que el de hoy tiene el estado del último respaldo del día.
- `adjuntos/`: copia de todos los adjuntos. Solo se copian los nuevos. Un adjunto eliminado en la
  aplicación se conserva aquí.

Hace un respaldo cada vez que arranca (si la máquina estuvo apagada, se pone al día al encender) y
borra los de más de 14 días, siempre después de guardar uno nuevo.

```bash
docker compose logs backup                      # una línea "Respaldo listo" por cada respaldo
docker compose run --rm backup backup.sh once   # hacer uno ahora
```

> [!IMPORTANT]
> `backups/` está en el mismo disco que la aplicación: protege de un borrado o de un error, no de un
> disco dañado. Para eso, apunta `BACKUP_DIR` a una carpeta que se sincronice a otro lugar (OneDrive,
> Google Drive, un disco de red) y ejecuta `docker compose up -d backup`.

### Restaurar

Restaurar reemplaza todo lo que hay en la base de datos por lo que había el día del respaldo:

```bash
# 1. Detener el API para que nadie escriba mientras tanto
docker compose stop api

# 2. Base de datos (cambia la fecha por la del respaldo que quieres)
docker compose run --rm backup pg_restore --dbname=support --clean --if-exists --no-owner /backups/soporte-2026-01-31.dump

# 3. Adjuntos
docker compose cp ./backups/adjuntos/. api:/data/uploads/
docker compose run --rm --no-deps -u root api chown -R node:node /data/uploads

# 4. Encender de nuevo
docker compose start api
```

## Inteligencia artificial

La IA es opcional y usa tu propia cuenta con el proveedor. En **Configuración > IA**:

1. Elige el proveedor: Anthropic (Claude), OpenAI, Google Gemini o un servidor compatible con la API
   de OpenAI (OpenRouter, Groq, Ollama…).
2. Pega la API key y pulsa **Cargar modelos**: la lista sale del proveedor con esa key.
3. Elige un modelo y pulsa **Guardar y probar**. La prueba envía una imagen de un color y confirma
   que el modelo la lee; hace falta un modelo que lea imágenes para crear casos desde capturas.
4. **Guardar y activar** deja ese proveedor en uso. Solo uno está activo a la vez.

Qué hace:

- **Nuevo con IA.** Una foto, una captura o un texto pegado se convierte en un borrador de caso
  (empresa, descripción, módulo, prioridad, tiempo estimado). Una persona lo revisa antes de guardar.
- **Respuesta para el cliente.** Al resolver un caso, redacta el mensaje para quien pidió el soporte
  a partir del caso y sus observaciones. Se puede editar, volver a generar y copiar con un botón.

Sobre las API keys y la privacidad:

- La key se guarda cifrada en la base de datos (AES-256-GCM con `APP_SECRET`) y nunca vuelve al
  navegador.
- Una key guardada solo se envía al servidor con el que se guardó. En un servidor compatible queda
  ligada a su URL: si cambias la URL, hay que escribir la key de nuevo.
- Las imágenes y los textos de "Nuevo con IA", y los datos del caso al redactar una respuesta, se
  envían al proveedor elegido. No envíes contraseñas ni información que no deba salir de tu empresa.
  Con un servidor local como Ollama, nada sale de tu red.

Con Ollama en la misma máquina y la aplicación en Docker, la URL del servidor es
`http://host.docker.internal:11434/v1`.

## Asistentes de IA: MCP y skills

Un asistente de IA puede trabajar con tus casos conversando: le envías la captura que mandó un
cliente y registra el caso; le dices "el caso SOP-00042 ya está" y lo cierra y te devuelve el mensaje
para el cliente. Para eso el proyecto trae dos piezas:

- **`mcp/`: el servidor [MCP](https://modelcontextprotocol.io).** Le da al asistente las herramientas
  para buscar, registrar, actualizar y cerrar casos. Usa el mismo API que la web.
- **`skills/`: la skill `soporte-casos`.** Le enseña al asistente cuándo usar esas herramientas. Es
  opcional pero recomendable.

Cómo se comporta el asistente:

- Entra solo, con el usuario asistente (`MCP_USERNAME` y `MCP_PASSWORD` de `.env`). El API crea ese
  usuario al arrancar. Todo lo que hace queda en el historial de cada caso con ese nombre.
- No tiene herramienta para eliminar casos.
- Antes de actuar lee las reglas del equipo con la herramienta `leer_guia`: `mcp/GUIA.md` (cómo
  registrar y cerrar un caso) y la guía de estilo de los mensajes a clientes. Editar esos archivos
  cambia el comportamiento de todos los asistentes, sin tocar código.

### 1. Preparar el servidor MCP

Hace falta [Node.js 22](https://nodejs.org/) en la máquina donde corre el asistente, y la aplicación
encendida.

```bash
cd mcp
npm install
```

El servidor se configura con variables de entorno, todas opcionales:

| Variable | Para qué sirve | Por defecto |
| --- | --- | --- |
| `SUPPORT_API_URL` | Dirección del API. | `http://localhost:4300/api`, la instalación con Docker en la misma máquina |
| `SUPPORT_USERNAME`, `SUPPORT_PASSWORD` | Usuario asistente. | `MCP_USERNAME` y `MCP_PASSWORD` del `.env` del proyecto |
| `SUPPORT_ENV_FILE` | Archivo `.env` de donde leer ese usuario. | `../.env` |

En desarrollo, el API está en `http://localhost:3300/api`. Si la aplicación corre en otra máquina,
pon su dirección en `SUPPORT_API_URL` y el usuario asistente en `SUPPORT_USERNAME` y
`SUPPORT_PASSWORD`.

### 2. Conectar tu asistente

En todos los casos se registra el mismo comando: `node` con la ruta completa a `mcp/server.mjs`.
Cambia `/ruta/al/proyecto` por la carpeta donde clonaste el repositorio; en Windows escribe la ruta
con barras normales, por ejemplo `C:/proyectos/soporte/mcp/server.mjs`.

<details open>
<summary><strong>Claude Code</strong></summary>

Con un comando:

```bash
claude mcp add --transport stdio --env SUPPORT_API_URL=http://localhost:4300/api soporte -- node /ruta/al/proyecto/mcp/server.mjs
```

O en un archivo `.mcp.json` en la raíz de la carpeta donde trabajas:

```json
{
  "mcpServers": {
    "soporte": {
      "command": "node",
      "args": ["/ruta/al/proyecto/mcp/server.mjs"],
      "env": { "SUPPORT_API_URL": "http://localhost:4300/api" }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

**Settings > Developer > Edit Config** abre `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`). Agrega el mismo
bloque `mcpServers` del ejemplo de Claude Code y reinicia la aplicación.

</details>

<details>
<summary><strong>Cursor</strong></summary>

Archivo `.cursor/mcp.json` del proyecto, o `~/.cursor/mcp.json` para todos tus proyectos, con el
mismo bloque `mcpServers` del ejemplo de Claude Code.

</details>

<details>
<summary><strong>VS Code (GitHub Copilot)</strong></summary>

Archivo `.vscode/mcp.json`. La clave es `servers`, no `mcpServers`:

```json
{
  "servers": {
    "soporte": {
      "type": "stdio",
      "command": "node",
      "args": ["/ruta/al/proyecto/mcp/server.mjs"],
      "env": { "SUPPORT_API_URL": "http://localhost:4300/api" }
    }
  }
}
```

También se puede agregar con el comando **MCP: Add Server** de la paleta, opción *Command (stdio)*.

</details>

<details>
<summary><strong>Codex (OpenAI)</strong></summary>

Con un comando:

```bash
codex mcp add soporte --env SUPPORT_API_URL=http://localhost:4300/api -- node /ruta/al/proyecto/mcp/server.mjs
```

O en `~/.codex/config.toml` (o `.codex/config.toml` del proyecto):

```toml
[mcp_servers.soporte]
command = "node"
args = ["/ruta/al/proyecto/mcp/server.mjs"]

[mcp_servers.soporte.env]
SUPPORT_API_URL = "http://localhost:4300/api"
```

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Con un comando:

```bash
gemini mcp add -e SUPPORT_API_URL=http://localhost:4300/api soporte node /ruta/al/proyecto/mcp/server.mjs
```

O en `~/.gemini/settings.json` (o `.gemini/settings.json` del proyecto), con el mismo bloque
`mcpServers` del ejemplo de Claude Code.

</details>

Cualquier otro cliente MCP sirve igual: registra un servidor de tipo *stdio* con ese comando.

Para comprobar la conexión, pídele al asistente: *"¿qué casos de soporte están pendientes?"*.

### 3. Instalar la skill

Copia la carpeta `skills/soporte-casos` al lugar donde tu asistente busca sus skills. Todos usan el
mismo formato ([Agent Skills](https://agentskills.io)); solo cambia la carpeta:

| Asistente | Para ti, en todos tus proyectos | Solo en un proyecto |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex (OpenAI) | `~/.agents/skills/` | `.agents/skills/` |
| Gemini CLI | `~/.gemini/skills/` | `.gemini/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| VS Code (GitHub Copilot) | `~/.copilot/skills/` | `.github/skills/` |

Codex, Gemini CLI, Cursor y VS Code leen además `.agents/skills/`, así que esa carpeta sirve para
varios a la vez.

Por ejemplo, para Claude Code:

```bash
mkdir -p ~/.claude/skills
cp -r skills/soporte-casos ~/.claude/skills/
```

En PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse skills\soporte-casos "$HOME\.claude\skills\"
```

En la **aplicación de Claude** (escritorio y web) las skills se suben: comprime la carpeta
`soporte-casos` en un `.zip` y cárgalo en **Customize > Skills > + > Create skill > Upload a skill**.

Si tu asistente no usa skills, no pasa nada: el servidor MCP ya le indica que lea la guía antes de
registrar o cerrar un caso. La skill solo le ayuda a reconocer antes cuándo le estás hablando de
casos de soporte.

## Importar una hoja de cálculo

**Casos > Importar** acepta `.xlsx` o `.csv` con una fila de encabezados. Reconoce las columnas
Fecha, Empresa, Descripción, Estado, Responsable y Observación; solo Empresa y Descripción son
obligatorias.

Para armar la hoja desde cero, el mismo diálogo tiene **Descargar plantilla**: un Excel con esas
columnas listas para llenar, que evita los errores de formato más comunes:

- La columna Fecha es de tipo fecha, así que el día y el mes no se confunden.
- Estado se elige de una lista (Pendiente, Resuelto, Sin resolver).
- Responsable ofrece las personas activas del sistema y "Cliente"; también admite un nombre nuevo.
- Cada encabezado tiene una nota con lo que va en la columna, y la hoja "Instrucciones" resume las
  reglas.

Cómo se importa:

- Primero muestra una vista previa: cuántos casos entran, cuántos ya existen y las primeras filas.
- Un caso con la misma fecha, empresa y descripción que uno existente se omite, así que importar dos
  veces el mismo archivo no duplica.
- Los responsables que no existen se crean como personas sin acceso. Para que inicien sesión, ponles
  contraseña en **Configuración > Usuarios**.
- "Cliente" como responsable marca el caso como a cargo del cliente.
- Si las fechas están escritas como texto, elige el orden (mes/día/año o día/mes/año) antes de
  importar.

Las exportaciones tienen un límite: el PDF admite hasta 5.000 casos y el Excel hasta 20.000. Con más,
la exportación no se genera y avisa que hay que acotar los filtros; nunca entrega un archivo
incompleto.

## Cómo funciona un caso

- **Dos fechas.** La *fecha del caso* es el día en que el cliente reportó el problema: la escribe
  quien registra, por defecto es hoy y no puede ser futura. La *fecha de registro* es el momento en
  que se creó el caso en el sistema: la pone el servidor y no se edita. Los filtros y el dashboard
  usan la primera; el SLA cuenta desde la segunda.
- **Estados.** Sin resolver, Pendiente y Resuelto. Un caso nuevo empieza en Pendiente.
- **Responsable.** Un usuario, "Cliente" o nadie. Quien registra el caso queda como responsable si no
  elige otro.
- **Fecha límite.** Hora de registro más las horas del SLA de la prioridad, en horas corridas. Sin
  prioridad no hay fecha límite. Un caso abierto cuya fecha límite pasó está *vencido*.
- **Promesa de entrega.** Fecha opcional en que se le prometió al cliente tener el caso resuelto.
  Aparece en Avisos el día prometido y mientras esté vencida; se puede activar además un aviso con
  días de anticipación.
- **Olvidado.** Caso abierto sin movimiento desde hace más del tiempo configurado (2 días por
  defecto; 0 lo apaga). Movimiento es una observación, un adjunto, el cronómetro, la respuesta para
  el cliente o cualquier cambio. En un caso importado, el último movimiento es su fecha del caso.
- **Usuarios.** Todos tienen el mismo acceso; no hay roles.

## Arquitectura

```mermaid
flowchart LR
  N[Navegador] -->|HTTP :4300| W[web<br/>nginx + Angular]
  M[Asistente<br/>por MCP] -->|/api| W
  W -->|/api| A[api<br/>NestJS + Prisma]
  A --> D[(db<br/>PostgreSQL)]
  A --> U[(adjuntos)]
  A -.->|tu API key| P[Proveedor de IA]
  B[backup] --> D
  B --> U
  B --> F[carpeta backups/]
```

| Parte | Tecnología |
| --- | --- |
| `web/` | Angular 20 (componentes standalone, signals), Tailwind CSS 4, Angular CDK, Chart.js |
| `api/` | NestJS 11, Prisma 6, PostgreSQL |
| `mcp/`, `skills/` | Servidor MCP en Node.js sobre el API HTTP, y skill para asistentes |
| Despliegue | Docker Compose: `db` (PostgreSQL 17), `api`, `web` (nginx), `backup` |

```
api/
  prisma/                  modelo de datos y migraciones
  assets/                  guía de estilo de los mensajes a clientes
  src/auth/                login con usuario y contraseña (JWT)
  src/tickets/             casos, observaciones, adjuntos, cronómetro
  src/ai/                  proveedores de IA, borrador de casos y respuestas
  src/transfer/            importación, plantilla y exportación (Excel, PDF)
  src/dashboard/           métricas
  src/catalog/             módulos y SLA
  src/settings/            recordatorios
  src/branding/            logo de la empresa
  src/events/              aviso en vivo de cada cambio (Server-Sent Events)
  src/common/              sesión, cifrado, fechas, revisión de la configuración al arrancar
web/
  src/app/core/            cliente del API, sesión, tema, utilidades
  src/app/layout/          menú y campana de avisos
  src/app/pages/           pantallas: casos, tablero, dashboard, configuración
  src/styles.css           paleta de colores y componentes base
mcp/                       servidor MCP y guía para asistentes
skills/                    skill para asistentes de IA (formato Agent Skills)
backup/                    contenedor de respaldos
devdb/                     PostgreSQL local para desarrollo
docker-compose.yml
```

## Seguridad

- **Pensada para un equipo de confianza.** El acceso es con usuario y contraseña, sin roles: toda
  persona con cuenta ve y edita todos los casos y la configuración, incluido el proveedor de IA.
- **HTTP sin cifrar.** Úsala en una red interna o detrás de un proxy con HTTPS.
- **Secretos fuera del repositorio.** `.env` está en `.gitignore`. El API no arranca con secretos
  ausentes ni, en producción, con los valores de ejemplo.
- **Contraseñas** guardadas con bcrypt. Tras cinco intentos fallidos, el inicio de sesión de ese
  usuario se bloquea un minuto.
- **API keys de IA** cifradas en la base de datos; una key solo se envía al servidor con el que se
  guardó.
- **Adjuntos** servidos siempre como descarga, nunca interpretados por el navegador.
- **Logo** visible sin iniciar sesión, porque lo usa la pantalla de ingreso. El servidor solo acepta
  imágenes PNG, JPG o WebP comprobadas por su contenido; un SVG se convierte en imagen en el navegador
  antes de enviarse.
- **Contenedores.** El API corre sin privilegios de administrador y la base de datos no publica su
  puerto fuera de Docker.

Si encuentras una vulnerabilidad, repórtala en privado con **Security > Report a vulnerability** en
el repositorio de GitHub, no en un issue público.

## Contribuir

Las contribuciones son bienvenidas: reportes de errores, ideas y pull requests. Lee
[CONTRIBUTING.md](CONTRIBUTING.md) para preparar el entorno y conocer las convenciones del código.

## Licencia

[MIT](LICENSE). Puedes usar, modificar y distribuir el software, también con fines comerciales,
conservando el aviso de copyright.
