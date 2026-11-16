# Soporte

**Gestión de casos de soporte técnico para equipos pequeños. Autoalojada, de código abierto y con IA opcional.**

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
![Angular 20](https://img.shields.io/badge/Angular-20-dd0031)
![NestJS 11](https://img.shields.io/badge/NestJS-11-e0234e)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ed)

> *Self-hosted help desk and support ticket tracker for small teams. The interface and this documentation are in Spanish.*

Soporte reemplaza la hoja de cálculo donde muchos equipos anotan sus casos. Cada caso tiene fecha,
empresa, descripción, estado, responsable y observaciones, y todos se ven en una tabla, como en la
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
- [Exportar casos y reportes](#exportar-casos-y-reportes)
- [Cómo funciona un caso](#cómo-funciona-un-caso)
- [Usuarios y roles](#usuarios-y-roles)
- [Arquitectura](#arquitectura)
- [Seguridad](#seguridad)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

## Características

- **Casos en una tabla.** Búsqueda sin distinguir tildes ni mayúsculas, paginación y filtros por
  estado, responsable, empresa, módulo, prioridad, tipo de soporte, fechas y más. **Nuevo caso**
  abre un formulario sobre la tabla para registrar varios seguidos, cada uno con su estado,
  responsable, prioridad, módulo y tipos de soporte.
- **Columnas a tu medida.** Cada persona elige qué columnas ve en la tabla. La elección se guarda
  con su usuario: no cambia la vista de nadie más y la sigue a cualquier navegador.
- **Detalle del caso.** Prioridad, módulo, tipos de soporte, tiempo estimado y real con cronómetro,
  fecha límite por SLA, promesa de entrega, observaciones con fecha y autor, adjuntos (arrastrar o
  pegar con Ctrl+V; hasta 10 archivos de 15 MB cada vez) e historial de cada cambio. Los cambios se
  guardan juntos con **Actualizar**.
- **Catálogos propios.** Empresas, responsables, módulos y tipos de soporte (etiquetas de color para
  clasificar los casos) se administran desde la aplicación.
- **Archivar.** Un caso archivado sale de la lista, del tablero y de los avisos sin perderse, y se
  puede desarchivar.
- **Tablero Kanban.** Una columna por estado; arrastrar una tarjeta cambia el estado.
- **Avisos.** La campana lista los casos olvidados (abiertos y sin movimiento durante el tiempo que
  configures), los vencidos por SLA y las promesas de entrega que vencen hoy o están por vencer.
- **Dashboard.** Casos por mes, responsable, empresa, módulo, prioridad y tipo de soporte; tiempo de
  resolución y cumplimiento de SLA. El reporte se descarga en Excel, con una hoja de datos lista
  para tablas dinámicas o Power BI, y en PDF.
- **Actualización en vivo.** Lo que registra otra persona, otra pestaña o un asistente aparece al
  instante, sin recargar.
- **Importar y exportar.** Importa tu hoja actual (.xlsx o .csv) con vista previa, o descarga una
  plantilla de Excel que ya trae las empresas, responsables, módulos y tipos de soporte de tu
  sistema como listas. Exporta a Excel o PDF con los filtros activos.
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
Docker Engine con el plugin Compose (Linux), con unos 2 GB de memoria libres para los contenedores:
el API puede usar hasta 1,5 GB (`mem_limit` en `docker-compose.yml`), lo que la importación más
pesada que acepta necesita con margen.

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
   largas y aleatorias, de 32 caracteres o más (con menos, el API no inicia); puedes generarlas así:

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

El primer arranque crea las tablas, el usuario inicial (un administrador), un catálogo de módulos
de ejemplo y los SLA por defecto. Desde **Configuración** se crean los demás usuarios y se ajusta el
resto (ver [Usuarios y roles](#usuarios-y-roles)).

Si el API no arranca, `docker compose logs api` dice por qué. Lo habitual es un valor de `.env` que
sigue en `change-me`: el API se niega a iniciar así.

### Uso diario

```bash
docker compose ps                 # estado de los contenedores; el API, "healthy" cuando responde
docker compose logs -f api        # log del API
docker compose down               # detener; los datos se conservan
docker compose up -d              # volver a encender
```

El API dice si está en marcha y llega a su base de datos en `GET /api/health`, sin iniciar sesión
(`{"status":"ok","database":"ok"}`, o un 503 si la base de datos no responde): es lo que Docker
consulta para marcarlo "healthy", y la web se enciende cuando lo está. Sirve también para vigilar la
instalación desde otra máquina (<http://servidor:4300/api/health>). Al detenerse, el API deja de
recibir solicitudes, termina las que está atendiendo, cierra los avisos en vivo (cada navegador se
vuelve a conectar solo cuando el API vuelve) y las conexiones a la base de datos.

Los contenedores se reinician solos cuando arranca Docker. En Docker Desktop, activa "Start Docker
Desktop when you sign in" para que la aplicación vuelva sola después de reiniciar la máquina.

> [!WARNING]
> `docker compose down -v` borra los volúmenes, es decir, la base de datos y los adjuntos. Úsalo solo
> si quieres empezar de cero.

### Actualizar

```bash
# 1. La versión instalada, por si hay que volver a ella: anótala
git rev-parse --short HEAD

# 2. Un respaldo de este momento, y una copia suya con otro nombre
docker compose run --rm backup sh -c 'backup.sh once && cp /backups/soporte-$(date +%F).dump /backups/antes-de-actualizar-$(date +%F).dump'

# 3. Actualizar
git pull
docker compose up -d --build
```

Los comandos se escriben igual en bash y en PowerShell; el del paso 2, con sus comillas simples.

Las migraciones de la base de datos se aplican solas al arrancar el API, y `docker compose up`
espera a que termine y responda antes de encender la web (hasta dos minutos y medio; si no lo logra,
avisa que el API no quedó "healthy" y `docker compose logs api` dice por qué). Algunas reorganizan los
datos: la que trajo el catálogo de empresas, por ejemplo, convierte la empresa escrita en cada caso
en una entrada del catálogo y une en una sola las que solo se distinguían por mayúsculas, tildes o
espacios. Por eso los dos primeros pasos: son lo que permite volver atrás.

Al actualizar desde una versión en la que la base de datos no impedía repetir un nombre, la
migración revisa las empresas, los responsables, los tipos de soporte y los módulos. Si dos se
llaman igual salvo mayúsculas, tildes o espacios (dos registros al mismo tiempo podían dejarlos
así; en los módulos, dentro del mismo lugar), uno conserva el nombre (el activo, o el más antiguo
de los activos) y los demás pasan a llamarse "Nombre (2)", "Nombre (3)"…; sus casos no cambian, y
luego puedes renombrarlos o desactivarlos. Una preferencia de vista guardada con un texto que no
es JSON, que solo deja una edición a mano de la base de datos, se borra: ya se leía como no
guardada. Si dos adjuntos compartieran el mismo archivo guardado (no debería haber ninguno), el más
reciente pasa a buscarlo como `dup-<id>-<nombre>`: en la carpeta de adjuntos, copia el archivo
`<nombre>` con ese nombre nuevo.

Al actualizar desde una versión sin roles, todos los usuarios que ya existían quedan como
administradores, así que nadie pierde lo que podía hacer; el usuario asistente queda como agente.
Después, en **Configuración > Usuarios**, pasa a agente a quien no deba administrar.

Al actualizar desde una versión cuyas sesiones duraban 7 días, todos vuelven a ingresar una vez: las
sesiones abiertas antes no se aceptan (el servidor MCP ingresa de nuevo solo). Si `JWT_SECRET` o
`APP_SECRET` tienen menos de 32 caracteres, el API no inicia hasta que los cambies. Cambiar
`JWT_SECRET` solo cierra las sesiones; cambiar `APP_SECRET` deja ilegibles las API keys de IA
guardadas, que hay que ingresar otra vez en **Configuración > IA**.

El paso 2 hace un respaldo (ver [Respaldos](#respaldos)) y lo copia, dentro del contenedor, a
`antes-de-actualizar-AAAA-MM-DD.dump`, con la fecha de hoy, en la misma carpeta de respaldos. La
copia hace falta porque el respaldo del día, `soporte-AAAA-MM-DD.dump`, se vuelve a escribir cada 6
horas y cada vez que arranca el servicio de respaldos: después de actualizar ya tendría los datos
reorganizados. De la base de datos, ese servicio solo escribe y borra archivos `soporte-*.dump`,
así que la copia queda como está hasta que la borres tú.

Si la actualización no salió como esperabas, se vuelve a ese respaldo con los pasos de
[Restaurar un respaldo anterior a una actualización](#restaurar-un-respaldo-anterior-a-una-actualización).

### Acceso desde otras máquinas

Los demás equipos de la red entran con `http://<ip-de-la-máquina>:4300`. El puerto se cambia con
`WEB_PORT` en `.env`.

La aplicación sirve HTTP sin cifrar: está pensada para una red interna. Para publicarla en internet,
ponla detrás de un proxy inverso con HTTPS (Caddy, nginx, Traefik). El proxy no debe retener en búfer
la ruta `/api/events`, que es un flujo abierto para la actualización en vivo. Debe enviar la dirección
del cliente en `X-Forwarded-For` (Caddy y Traefik lo hacen solos), y en `.env` va
`TRUST_PROXY_HOPS=2`: sin eso, el API ve a todos los clientes con la dirección del proxy, y sus
ingresos fallidos y sus solicitudes sin sesión cuentan como de uno solo (las solicitudes con sesión
cuentan por usuario). Con ese proxy, cada equipo tiene su dirección real también con Docker
Desktop, que sin él muestra a todos con una sola dirección interna (ver [Seguridad](#seguridad)).
Con `TRUST_PROXY_HOPS=2`, el puerto de la web debe quedar al alcance del proxy y de nadie más (por
ejemplo `WEB_PORT=127.0.0.1:4300` si el proxy corre en la misma máquina): quien llegue a ese puerto
sin pasar por el proxy puede escribir en `X-Forwarded-For` la dirección que quiera, y con cada una
tendría de nuevo los ingresos fallidos y las solicitudes sin sesión de una dirección.

La web no envía `Strict-Transport-Security` (HSTS), porque se sirve por HTTP en la red interna. Si
la publicas por HTTPS, el proxy puede agregarlo; desde entonces, un navegador que lo recibió ya no
entra por HTTP a ese mismo nombre. Las demás cabeceras de seguridad (ver [Seguridad](#seguridad))
llegan a través del proxy tal como las envía la web.

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
cd mcp && npm test            # servidor MCP de los asistentes: node:test contra un API simulado
```

`cd web && npm test` deja las pruebas de la web en modo observación.

Las del API prueban cada controlador por separado, sobre una base de datos simulada, y en
`api/src/app.http.spec.ts` el API entero como lo arranca `main.ts`, por HTTP: una ruta pública
responde sin sesión y las demás piden un token vigente, un agente recibe 403 en una ruta de
administradores, un cuerpo inválido recibe el 400 en español, un fallo de la base de datos no
llega como un 500, una ruta que no existe, un cuerpo demasiado grande o una sesión terminada se
explican en español, y una señal de detención cierra el API antes de terminar el proceso.
`api/src/common/dto-messages.spec.ts` recorre todos los DTO del API, con un valor que rompe cada
regla de cada campo, y falla si alguna respuesta llega en inglés.

Las pruebas de extremo a extremo (`e2e/`, con [Playwright](https://playwright.dev/) en Chromium)
recorren la aplicación como lo haría una persona: ingresar, registrar un caso y crear su empresa,
editarlo, archivarlo y eliminarlo, elegir columnas, los tipos de soporte, la importación y los
reportes del dashboard. También revisan las cabeceras de seguridad y recorren cada pantalla
comprobando que el navegador no informe ninguna infracción de su política de contenido, y prueban los
límites de las subidas: el envío más grande de adjuntos, uno que nginx rechaza, y la hoja más pesada
que el API lee dentro de la memoria de su contenedor, además de que el API explique en español,
campo por campo, lo que no acepta de una solicitud. Corren contra una instalación desechable que se construye con Docker
Compose desde el código del repositorio, con su propio proyecto (`support-e2e`), sus propios
volúmenes y su propio puerto (4321). No tocan la instalación con Docker de la máquina ni sus
respaldos: el servicio `backup` nunca se enciende ahí.

```bash
cd e2e
npm install
npx playwright install chromium   # una sola vez
npm run stack:up                  # construye db, api y web y espera a /api/health
npm test                          # todas las pruebas; npm run test:ui para verlas paso a paso
npm run stack:down                # borra contenedores, volúmenes, red e imágenes de support-e2e
```

`stack:up` genera `e2e/.stack.env` con contraseñas aleatorias, el puerto y unos límites holgados
(todas las pruebas llegan al API desde la misma dirección, con ingresos fallidos entre ellas), y
`stack:down` lo borra.
Necesitan Docker, como la instalación. Para usar otro puerto: `E2E_PORT=4322 npm run stack:up` (en
PowerShell: `$env:E2E_PORT=4322; npm run stack:up`). Se niega a usar el proyecto
`support-tickets` o el puerto 4300, los de una instalación real. Si algo falla,
`npm run stack:logs` muestra lo que escribieron sus servicios y `npm run report` abre el informe
de la última corrida.

En GitHub, cada push y cada pull request a `main` pasa por
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): las pruebas del API, de la web y del
servidor MCP, la revisión de tipos, el lint del API y de la web, que el esquema de la base de datos
coincida con sus migraciones, la compilación de la web y las pruebas de extremo a extremo.
Cuando estas fallan, el informe de Playwright y sus trazas quedan como artefacto de la ejecución.

### Cambios en la base de datos

Después de editar `api/prisma/schema.prisma`, con la base de desarrollo encendida:

```bash
cd api && npx prisma migrate dev --name describe_el_cambio
```

La integración continua aplica todas las migraciones en una base vacía y falla si el resultado no
es lo que dice `schema.prisma`: un cambio del esquema sin su migración no pasa.

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
| `JWT_SECRET` | Firma las sesiones. Cadena larga y aleatoria, de 32 caracteres o más. | obligatoria |
| `JWT_EXPIRES_IN` | Cuánto dura una sesión antes de volver a ingresar: un número entero y `s`, `m`, `h` o `d` (segundos, minutos, horas o días), como `8h` o `7d`. | `12h` |
| `APP_SECRET` | Cifra las API keys de IA guardadas. Cadena larga y aleatoria, de 32 caracteres o más. Si la cambias, hay que ingresar las keys otra vez. | obligatoria |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Primer usuario, administrador. Se crea en el primer arranque; después solo si ningún administrador activo puede ingresar (entonces ese usuario vuelve a ser administrador, y si ya tiene contraseña la conserva). | `admin`, obligatoria, `Administrador` |
| `MCP_USERNAME`, `MCP_NAME`, `MCP_PASSWORD` | Usuario para asistentes de IA por MCP, con rol de agente. Deja `MCP_PASSWORD` vacía para no crearlo. | `claude`, `Claude`, vacía |
| `WEB_PORT` | Puerto donde se publica la web. | `4300` |
| `LOGIN_RATE_LIMIT` | Ingresos fallidos por minuto desde una misma dirección IP; pasado ese número, se rechaza todo ingreso desde ella hasta que termine el minuto. Los ingresos correctos no cuentan. Con Docker Desktop, todos los equipos llegan desde una sola dirección y el límite es de toda la instalación (ver [Seguridad](#seguridad)). | `20` |
| `API_RATE_LIMIT` | Solicitudes por minuto a todo el API: de cada usuario, con su sesión; de cada dirección IP, las que llegan sin sesión (el ingreso entre ellas). Un token que el API ya no acepta (de antes de un cambio de contraseña, por ejemplo) cuenta aparte del de las sesiones vigentes. | `1000` |
| `TRUST_PROXY_HOPS` | Proxies delante del API cuyo `X-Forwarded-For` se cree para saber la dirección de cada cliente. `1` es el nginx de la web; `2` si hay otro proxy delante (ver [Acceso desde otras máquinas](#acceso-desde-otras-máquinas)). | `1` |
| `TZ` | Zona horaria. Define qué día es "hoy" para fechas, avisos y respaldos. | `America/Guayaquil` |
| `BACKUP_DIR` | Carpeta de la máquina que recibe los respaldos. | `./backups` |
| `BACKUP_KEEP_DAYS` | Días que se conserva un respaldo de la base de datos. | `14` |
| `BACKUP_INTERVAL_HOURS` | Horas entre respaldos mientras la máquina está encendida. | `6` |

El API revisa estos valores al arrancar. No inicia sin `JWT_SECRET` y `APP_SECRET`, ni, en producción
(Docker), mientras `JWT_SECRET`, `APP_SECRET`, `ADMIN_PASSWORD` o `MCP_PASSWORD` sigan en `change-me`,
o `JWT_SECRET` o `APP_SECRET` tengan menos de 32 caracteres. Tampoco inicia si `LOGIN_RATE_LIMIT` o
`API_RATE_LIMIT` no son un número entero desde 1, si `TRUST_PROXY_HOPS` no lo es desde 0, si
`JWT_EXPIRES_IN` no es un número entero con su unidad (`12h`; un número solo, como `3600`, no vale), o si
`MCP_USERNAME` y `ADMIN_USERNAME` son el mismo usuario (el del asistente es un agente y el inicial, un
administrador).

Lo demás se configura desde la aplicación, en **Configuración**, que tiene una pestaña para cada
cosa: Usuarios, Responsables, Empresas, Tipos de soporte, Módulos, SLA (horas por prioridad),
Recordatorios, IA (el proveedor), Logo y Mi cuenta. Usuarios, SLA, Recordatorios, IA y Logo son
solo para administradores: un agente no ve esas pestañas, y donde la aplicación habla de una de
ellas (la IA apagada, los recordatorios apagados) le dice que eso lo activa un administrador.
Eliminar una empresa, un responsable o un tipo de soporte pide confirmación antes de borrarlo.

Esa configuración es de todo el equipo. Lo que cada persona elige para su propia vista (las columnas
de la lista de casos y si tiene los filtros a la vista) no está ahí: se guarda con su usuario, así
que no cambia lo que ven los demás.

### Personalizar

- **Logo.** En **Configuración > Logo** sube el logo de tu empresa (PNG, JPG, WebP o SVG). Se
  guarda reducido y se usa en el menú, en la pantalla de ingreso y como icono de la pestaña del
  navegador. Va en la base de datos, así que entra en los respaldos.
- **Empresas.** En **Configuración > Empresas** está el catálogo de tus clientes: cada caso es de
  una de ellas. También se puede crear una empresa en el momento de registrar un caso, desde su
  mismo selector.
- **Responsables.** En **Configuración > Responsables** agrega a quienes atienden los casos. Basta el
  nombre.
- **Tipos de soporte.** En **Configuración > Tipos de soporte** define las etiquetas con las que
  clasificas los casos ("Falla del sistema", "Capacitación"…), cada una con su color.
- **Módulos.** El catálogo inicial es un ejemplo para un software de gestión. Cámbialo por los
  módulos o áreas de tu producto en **Configuración > Módulos**. Dos módulos del mismo lugar (los
  principales, o los submódulos de un módulo) no pueden llamarse igual, sin contar mayúsculas,
  tildes ni espacios; dos submódulos de módulos distintos sí ("Ventas > Facturas" y "Compras >
  Facturas").
- **Columnas de la lista de casos.** El botón **Columnas** de la lista deja marcar cuáles ver y
  volver a las iniciales con **Restablecer**. Es una preferencia de cada usuario, no del equipo.
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
  aplicación se conserva aquí. Los archivos que todavía se están subiendo (la carpeta `.incoming` del
  volumen) no se copian.

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

Estos pasos son para un respaldo hecho con la versión de la aplicación que está instalada. Si
actualizaste después de ese respaldo, sigue los de la sección siguiente.

En Windows, ejecuta los comandos de restauración en PowerShell. Git Bash convierte las rutas que
empiezan con `/` (`/backups/...`, `/data/uploads`) en rutas de Windows, y el contenedor no las
encuentra.

### Restaurar un respaldo anterior a una actualización

Un respaldo guarda la base de datos con las tablas de la versión que lo escribió. Si una
actualización posterior las cambió, los pasos de arriba no sirven para ese respaldo:
`pg_restore --clean` solo quita lo que el respaldo conoce, tropieza con las tablas nuevas y deja la
base de datos a medio restaurar. Para volver a como estaba todo antes de actualizar hay que regresar
también al código de esa versión, y restaurar sobre una base de datos vacía. En Windows, también
estos comandos van en PowerShell y no en Git Bash, por lo que dice el párrafo anterior:

```bash
# 1. Detener el API, y los respaldos para que no guarden la base de datos a medio restaurar
docker compose stop api backup

# 2. Volver al código de antes de actualizar (cambia a1b2c3d por la versión que anotaste)
git checkout a1b2c3d

# 3. Vaciar la base de datos y restaurar el respaldo en ella (cambia la fecha por la de tu copia)
docker compose run --rm backup psql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose run --rm backup pg_restore --dbname=support --no-owner /backups/antes-de-actualizar-2026-01-31.dump

# 4. Adjuntos
docker compose cp ./backups/adjuntos/. api:/data/uploads/
docker compose run --rm --no-deps -u root api chown -R node:node /data/uploads

# 5. Construir esa versión y encender todo
docker compose up -d --build
```

- Si no anotaste la versión, `git reflog` muestra en qué versión estaba el código antes del
  `git pull`.
- `git checkout` con una versión deja el código fuera de su rama, y Git lo avisa: es lo esperado.
  Para actualizar de nuevo más adelante, vuelve antes a la rama con `git checkout main`.
- Lo mismo sirve con un `soporte-AAAA-MM-DD.dump` de un día anterior a la actualización.
- Para recuperar los datos de un respaldo viejo sin dejar la versión nueva, omite el paso 2: al
  arrancar, el API aplica otra vez las migraciones a lo restaurado.

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
  La empresa que la IA lee se busca en tu catálogo; si no está, el borrador ofrece crearla.
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
  para buscar, registrar, actualizar, archivar y cerrar casos, y para agregar empresas,
  responsables, módulos y tipos de soporte a los catálogos. Usa el mismo API que la web.
- **`skills/`: la skill `soporte-casos`.** Le enseña al asistente cuándo usar esas herramientas. Es
  opcional pero recomendable.

Cómo se comporta el asistente:

- Entra solo, con el usuario asistente (`MCP_USERNAME` y `MCP_PASSWORD` de `.env`). El API crea ese
  usuario al arrancar. Todo lo que hace queda en el historial de cada caso con ese nombre.
- Ese usuario es un agente (ver [Usuarios y roles](#usuarios-y-roles)): trabaja los casos y agrega
  entradas a los catálogos, pero no administra usuarios ni cambia el SLA, los recordatorios, la IA o
  el logo. El API lo deja como agente en cada arranque, aunque alguien lo haya hecho administrador.
- No tiene herramienta para eliminar casos. Sí puede archivar uno, o desarchivarlo, cuando se lo
  pides. Sus búsquedas dejan fuera los casos archivados, salvo que le pidas verlos, y encuentran
  también los casos de una empresa, un responsable o un tipo de soporte inactivo.
- Si le nombras una empresa, un responsable, un módulo o un tipo de soporte que no existe, no lo
  crea ni elige otro por su cuenta: te pregunta si lo agrega (`crear_empresa`, `crear_responsable`,
  `crear_modulo`, `crear_tipo_soporte`), si usa uno de los existentes o si deja el caso sin ese
  dato. Con una empresa te muestra además las que tienen un nombre parecido, para no registrar dos
  veces al mismo cliente.
- Los tipos de soporte de un caso los decides tú: el asistente puede proponerlos, y solo usa los del
  catálogo.
- Adjunta a un caso archivos del disco de la máquina donde corre (`adjuntar_archivos`, o
  `imagenes` al registrar): solo imágenes PNG, JPG, WEBP o GIF, PDF y texto `.txt` de hasta 15 MB,
  con su ruta completa. Nunca un archivo oculto o de una carpeta oculta (`.env`, `.ssh`...), ni
  una ruta de red; un enlace o una unión de carpetas se juzga por el archivo al que lleva. Si se
  pide más de un archivo y uno no se puede, no adjunta ninguno y te dice por qué. Para limitarlo a
  ciertas carpetas, usa `SUPPORT_ATTACH_DIRS`.
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
| `SUPPORT_ATTACH_DIRS` | Las únicas carpetas de donde el asistente puede adjuntar archivos, con sus subcarpetas. Rutas completas separadas por `;` en Windows y por `:` en Linux y macOS. | vacía: cualquier carpeta que no esté oculta |

En desarrollo, el API está en `http://localhost:3300/api`. Si la aplicación corre en otra máquina,
pon su dirección en `SUPPORT_API_URL` y el usuario asistente en `SUPPORT_USERNAME` y
`SUPPORT_PASSWORD`.

El asistente puede tomar la ruta de un archivo de lo que lee, por ejemplo de un mensaje que le pides
registrar. Si quieres que solo adjunte lo que guardas para eso, define `SUPPORT_ATTACH_DIRS`, por
ejemplo `C:/Users/usuario/Documents/Soporte;C:/Users/usuario/Downloads` en Windows. Una carpeta
oculta no sirve, porque sus archivos se rechazan igual. Una carpeta de red (`//servidor/capturas`,
o una unidad de red como `Z:`) solo funciona si está en esa lista.

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
Fecha, Hora, Empresa, Descripción, Estado, Prioridad, Módulo, Responsable, Tipo de soporte y
Observación; solo Empresa y Descripción son obligatorias.

Para armar la hoja desde cero, el mismo diálogo tiene **Descargar plantilla**: un Excel con esas
columnas listas para llenar y con los valores de tu sistema, que evita los errores más comunes:

- La columna Fecha es de tipo fecha, así que el día y el mes no se confunden.
- La columna Hora es de tipo hora y es opcional. Al importar una hoja propia también se acepta
  escrita como texto ("14:35", "2:35 p. m.") o dentro de la celda de la fecha.
- Empresa, Estado, Prioridad, Módulo, Responsable y Tipo de soporte se eligen de listas
  desplegables con lo que está registrado y activo en el sistema al descargar la plantilla. La
  celda no acepta un valor que no esté en su lista.
- La hoja "Valores del sistema" muestra esas listas completas: empresas, estados, prioridades,
  módulos, responsables y tipos de soporte. Escribir en ella no registra nada: lo que falte se
  registra en **Configuración**, y después se descarga la plantilla otra vez.
- Para el caso con más de un tipo de soporte hay una segunda columna, "Otro tipo de soporte". En
  una hoja propia también se pueden escribir varios en la misma celda, separados por coma o punto y
  coma.
- Cada encabezado tiene una nota con lo que va en la columna, y la hoja "Instrucciones" resume las
  reglas.

Cómo se importa:

- Primero muestra una vista previa: cuántos casos entran, cuántos ya existen, cuántas filas se
  rechazan y por qué, y las primeras filas.
- Un caso con la misma fecha, empresa y descripción que uno existente se omite, así que importar dos
  veces el mismo archivo no duplica.
- La empresa, el responsable, los tipos de soporte, el módulo y la prioridad de cada fila se buscan
  en el sistema por su nombre, sin distinguir mayúsculas ni tildes, también entre los inactivos. Un
  módulo se escribe con su nombre completo ("Ventas > Facturas") o solo con el suyo ("Facturas") si
  ningún otro se llama igual.
- El estado tiene que ser uno de los tres del sistema (Pendiente, Resuelto o Sin resolver), sin
  distinguir mayúsculas ni tildes. Una celda de Estado vacía deja el caso en Pendiente.
- Una fila que nombra algo que no existe se rechaza: no se importa. La vista previa dice qué fila
  de la hoja es y la razón ("La empresa «Acme» no existe", "El estado «Cerrado» no existe"), y
  lista los valores que no encontró: empresas, responsables, tipos de soporte, módulos,
  prioridades y estados. Las demás filas se importan con normalidad.
- La casilla **Crear las empresas, responsables y tipos de soporte que no existen** los agrega a
  sus catálogos y deja entrar esas filas; al marcarla, la vista previa se calcula de nuevo. Un tipo
  de soporte creado así queda en gris hasta que le pongas color en **Configuración**. Los módulos,
  las prioridades y los estados nunca se crean desde una hoja.
- Al terminar, un aviso dice cuántos casos se importaron y, si las hubo, cuántas filas se
  rechazaron y cuántas empresas, responsables y tipos de soporte se crearon.
- La importación es todo o nada: si algo falla a mitad de camino, no queda ningún caso ni ninguna
  entrada de catálogo de esa hoja, y se puede volver a importar tal cual.
- Una hoja admite hasta 20.000 filas. Con más, divídela en varias.
- El archivo puede pesar hasta 20 MB. Un `.xlsx` es un archivo comprimido, y su contenido, una vez
  descomprimido, puede ocupar hasta 50 MB: es lo que el API tiene que leer entero en memoria antes de
  contar las filas. 20.000 casos con descripción y observación de unos 1.000 caracteres cada una
  ocupan unos 47 MB. Uno más grande se rechaza con el tamaño que tiene, antes de abrirlo; divídelo en
  varios archivos.
- No se crean usuarios: un responsable es solo un nombre. Una celda de Responsable vacía, o con
  "Sin asignar", deja el caso sin responsable.
- La fecha de registro de un caso importado es el momento de la importación. Si la fila trae
  prioridad, la fecha límite de su SLA se cuenta desde ahí.
- Si las fechas están escritas como texto, elige el orden (mes/día/año o día/mes/año) antes de
  importar.

## Exportar casos y reportes

**Casos > Exportar** descarga en Excel o en PDF los casos que cumplen los filtros activos. Los
archivados solo van si el filtro los incluye, y el PDF dice en su encabezado qué filtros tenía.
El Excel dice de cada caso si está archivado en su última columna, `Archivado` (`Sí` o `No`), y en
el PDF un caso archivado lleva `(archivado)` bajo su código. El Excel usa los nombres de columna
que entiende la importación, así que la hoja se puede volver a importar: los casos que ya existen
se omiten. La importación no lee la columna `Archivado`: un caso que entra por una hoja nunca entra
archivado.

El **Dashboard** descarga su propio reporte con los botones **Excel** y **PDF**. Cubre el periodo
que está en pantalla, con los casos archivados o sin ellos según la casilla **Incluir archivados**:

- **Excel** (`reporte-soporte-AAAA-MM-DD.xlsx`), para analizar:
  - `Resumen`: el periodo, cuándo se generó, y los totales e indicadores de la pantalla.
  - `Por mes`, `Por responsable`, `Por empresa` (todas, no solo las primeras), `Por módulo`,
    `Por prioridad` y `Por tipo de soporte`.
  - `Datos`: una fila por caso (empresa, estado, responsable, prioridad, módulo, tipos de soporte,
    tiempos y fechas), como tabla de Excel con fechas y números de verdad. Es la hoja que se carga
    en una tabla dinámica o en Power BI.
- **PDF** (`reporte-soporte-AAAA-MM-DD.pdf`), para leer o imprimir: los indicadores y cada desglose
  con sus barras. De las empresas muestra las 15 con más casos y dice cuántas más hay.

Las exportaciones tienen un límite: el PDF de casos admite hasta 5.000, y el Excel de casos y el del
reporte, hasta 20.000. Con más, el archivo no se genera y avisa que hay que acotar los filtros o el
periodo; nunca entrega un archivo incompleto.

## Cómo funciona un caso

- **Dos fechas.** La *fecha del caso* es el día en que el cliente reportó el problema: la escribe
  quien registra, por defecto es hoy y no puede ser futura. La *fecha de registro* es el momento en
  que se creó el caso en el sistema: la pone el servidor y no se edita. Los filtros y el dashboard
  usan la primera; el SLA cuenta desde la segunda.
- **Hora del caso.** Opcional: la hora en que el cliente lo reportó, por ejemplo la de su mensaje. Un
  caso sin hora queda solo con su fecha. Se escribe al registrar el caso o en su detalle, y la IA la
  toma de la captura cuando se ve.
- **Empresa.** El cliente que reporta el caso. Sale de un catálogo (**Configuración > Empresas**),
  así cada cliente tiene un solo nombre en todos sus casos; cambiarle el nombre lo cambia en todos.
  Al registrar un caso se puede crear la empresa ahí mismo. Una empresa inactiva conserva sus casos
  y deja de ofrecerse para los nuevos; solo se puede eliminar la que no tiene casos.
- **Estados.** Sin resolver, Pendiente y Resuelto. Un caso nuevo empieza en Pendiente.
- **Responsable.** Quien atiende el caso: una persona de la lista de responsables, o nadie. La lista
  es un catálogo de nombres que se administra en **Configuración > Responsables**. Un caso nuevo
  queda sin responsable hasta que alguien elige uno. Un responsable inactivo conserva sus casos y
  deja de ofrecerse para los nuevos; solo se puede eliminar a quien no tiene casos.
- **Tipos de soporte.** Etiquetas con nombre y color que dicen qué clase de soporte fue el caso:
  una falla del sistema, una capacitación, un error del usuario… Cada equipo define las suyas en
  **Configuración > Tipos de soporte**, y un caso puede llevar varias o ninguna. Sirven para filtrar
  la lista y tienen su gráfico en el dashboard. Un tipo inactivo sigue en los casos que lo llevan y
  deja de ofrecerse; solo se puede eliminar el que no está en ningún caso.
- **Guardar.** Los campos de un caso se editan en su formulario y se guardan juntos con
  **Actualizar**; si sales con cambios sin guardar, la aplicación pregunta antes de descartarlos.
  Lo que no es un campo actúa al momento, con su propio botón: agregar una observación, adjuntar,
  el cronómetro, archivar y eliminar. Una observación escrita y todavía sin agregar cuenta como
  cambio sin guardar: **Actualizar** también la agrega, y **Descartar cambios** la borra. La lista
  de casos es de solo lectura.
- **Archivado.** Archivar un caso lo guarda: deja de aparecer en la lista, en el tablero y en los
  avisos, pero se conserva completo y se puede desarchivar. La lista lo muestra con el filtro
  **Archivados**, y el dashboard lo cuenta salvo que desmarques **Incluir archivados**. Archivar no
  cuenta como movimiento del caso. Eliminar, en cambio, borra el caso con sus observaciones y
  adjuntos, y pide confirmación.
- **Fecha límite.** Hora de registro más las horas del SLA de la prioridad, en horas corridas. Sin
  prioridad no hay fecha límite. Un caso abierto cuya fecha límite pasó está *vencido*.
- **Promesa de entrega.** Fecha opcional en que se le prometió al cliente tener el caso resuelto.
  Aparece en Avisos el día prometido y mientras esté vencida; se puede activar además un aviso con
  días de anticipación.
- **Olvidado.** Caso abierto sin movimiento desde hace más del tiempo configurado (2 días por
  defecto; 0 lo apaga). Movimiento es una observación, un adjunto, el cronómetro, la respuesta para
  el cliente o cualquier cambio. En un caso importado, el último movimiento es su fecha del caso.
- **Usuarios.** Un usuario es quien entra al sistema, no un responsable: registrar un caso no lo
  deja a su nombre. Cada usuario guarda sus propias preferencias de vista, como las columnas de la
  lista de casos. Cada uno tiene un rol (ver [Usuarios y roles](#usuarios-y-roles)).

## Usuarios y roles

- **Agente.** Trabaja los casos (registrar, editar, archivar, eliminar, importar, exportar, usar la
  IA) y agrega o edita responsables, empresas, tipos de soporte y módulos. Un usuario nuevo es agente,
  salvo que quien lo crea elija otro rol.
- **Administrador.** Además, crea y edita usuarios (sus contraseñas y su rol incluidos) y cambia el
  SLA, los recordatorios, la IA y el logo.
- **Siempre queda un administrador.** Nadie cambia su propio rol ni se desactiva a sí mismo, y el API
  no deja pasar a agente ni desactivar al último administrador activo. El rol se cambia en
  **Configuración > Usuarios**.
- **El usuario asistente** del MCP es un agente. El API lo deja así en cada arranque, aunque alguien
  lo haya hecho administrador.
- **Sesiones.** Una sesión dura 12 horas (`JWT_EXPIRES_IN`); después, la web vuelve a la pantalla de
  ingreso. Una contraseña nueva, otro rol o desactivar a un usuario cierra todas las sesiones que
  tenga abiertas, en cualquier navegador o equipo. La actualización en vivo termina con la sesión:
  al instante cuando el API la cierra, al vencer la sesión, o en la siguiente comprobación (cada
  25 segundos) si se cambió algo directamente en la base de datos; la pantalla abierta vuelve sola
  al ingreso, sin esperar a que la persona haga algo. Cada uno cambia su propia contraseña en
  **Configuración > Mi cuenta**, con la actual, y sigue en la sesión desde la que la cambió; en
  Usuarios, un administrador cambia la de los demás. Cinco intentos seguidos con una contraseña
  actual incorrecta bloquean un minuto a ese usuario, como cinco ingresos fallidos.

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
| `web/` | Angular 20 (componentes standalone, signals, sin zone.js), Tailwind CSS 4, Angular CDK, ng-select, Chart.js |
| `api/` | NestJS 11, Prisma 6, PostgreSQL |
| `mcp/`, `skills/` | Servidor MCP en Node.js sobre el API HTTP, y skill para asistentes |
| Despliegue | Docker Compose: `db` (PostgreSQL 17), `api`, `web` (nginx), `backup` |

```
api/
  prisma/                  modelo de datos y migraciones
  assets/                  guía de estilo de los mensajes a clientes
  src/auth/                login con usuario y contraseña (JWT), bloqueo de usuarios e ingresos fallidos por dirección
  src/tickets/             casos, observaciones, adjuntos, cronómetro
  src/companies/           catálogo de empresas
  src/assignees/           catálogo de responsables
  src/support-types/       catálogo de tipos de soporte
  src/catalog/             módulos y SLA
  src/ai/                  proveedores de IA, borrador de casos y respuestas
  src/transfer/            importación, plantilla y exportación (Excel, PDF)
  src/dashboard/           métricas y su reporte (Excel, PDF)
  src/users/               usuarios
  src/preferences/         preferencias de cada usuario (las columnas de la lista de casos…)
  src/settings/            recordatorios
  src/branding/            logo de la empresa
  src/events/              aviso en vivo de cada cambio (Server-Sent Events)
  src/health/              GET /api/health: el API está en marcha y llega a su base de datos
  src/common/              sesión, límites de solicitudes, validación de la entrada, cifrado, fechas, revisión de la configuración al arrancar, lo común a los catálogos de nombres, a los PDF, a las hojas de Excel y a los archivos que se descargan
web/
  src/app/core/            cliente del API, sesión, tema, utilidades
  src/app/layout/          menú y campana de avisos
  src/app/pages/           pantallas: casos, tablero, dashboard, configuración
  src/styles.css           paleta de colores y componentes base
mcp/                       servidor MCP y guía para asistentes
skills/                    skill para asistentes de IA (formato Agent Skills)
backup/                    contenedor de respaldos
devdb/                     PostgreSQL local para desarrollo
e2e/                       pruebas de extremo a extremo (Playwright) y su instalación desechable
docker-compose.yml
```

## Seguridad

- **Pensada para un equipo de confianza.** El acceso es con usuario y contraseña. Toda persona con
  cuenta ve y edita todos los casos y los catálogos.
- **Roles.** Los usuarios, las contraseñas de los demás, el SLA, los recordatorios, el proveedor de
  IA (sus keys y sus URL) y el logo son solo de los administradores (ver
  [Usuarios y roles](#usuarios-y-roles)). El API responde 403 a un agente en esas rutas, con el rol
  que el usuario tiene guardado en ese momento y no con el que tenía al iniciar sesión; la web,
  además, le oculta esas pestañas y botones. El usuario asistente del MCP es un agente.
- **HTTP sin cifrar.** Úsala en una red interna o detrás de un proxy con HTTPS.
- **Cabeceras de seguridad** en cada respuesta del nginx de la web (`web/security-headers.conf`):
  una `Content-Security-Policy` que solo deja correr los scripts de la propia aplicación (ni
  scripts en línea ni de otros sitios) y solo conectarse a su propio API, sin dejar que otra página
  la muestre dentro de un marco; además `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, `X-Frame-Options: DENY` y una `Permissions-Policy` que niega cámara, micrófono,
  ubicación y demás funciones del dispositivo (solo deja el portapapeles, para copiar la respuesta al
  cliente y pegar una captura). nginx no dice su versión. Sin HSTS, porque se sirve por HTTP (ver
  [Acceso desde otras máquinas](#acceso-desde-otras-máquinas)).
- **Secretos fuera del repositorio.** `.env` está en `.gitignore`. El API no arranca con secretos
  ausentes ni, en producción, con los valores de ejemplo o con `JWT_SECRET` o `APP_SECRET` de menos
  de 32 caracteres.
- **Sesiones** de 12 horas (`JWT_EXPIRES_IN`), guardadas en el navegador. El API cierra todas las de
  un usuario cuando cambia su contraseña (la cambie él o un administrador), su rol o su estado: un
  token firmado antes deja de valer, aunque no haya caducado.
- **Contraseñas** guardadas con bcrypt. Tras cinco intentos fallidos seguidos, el inicio de sesión de
  ese usuario se bloquea un minuto, venga de donde venga. Cuentan también las contraseñas actuales
  incorrectas al cambiar la propia en **Mi cuenta**, y el bloqueo vale para el ingreso y para el
  cambio: una sesión que quedó abierta no sirve para adivinar la contraseña. Un usuario que no existe
  tarda en ser rechazado lo mismo que uno que existe, así que la respuesta no dice qué usuarios hay.
- **Límites de solicitudes.** Cada usuario con sesión puede hacer 1000 solicitudes al API por minuto
  (`API_RATE_LIMIT`), desde donde sea; las que llegan sin sesión, o con un token falso o caducado,
  cuentan para su dirección IP, con el mismo límite, y el ingreso entre ellas. Un token que el API
  ya no acepta pero que no ha caducado (de antes de un cambio de contraseña o de rol) tiene su propio
  límite: quien lo conserve no gasta el de las sesiones vigentes de ese usuario. Además, desde una
  misma dirección se aceptan 20 ingresos fallidos por minuto (`LOGIN_RATE_LIMIT`), en un minuto que
  empieza con el primer intento de ingreso desde ella, correcto o no: pasado ese número, el API
  rechaza todo ingreso desde ella, aun con la contraseña correcta, hasta que termine ese minuto. Los
  ingresos correctos no cuentan, así que un equipo que llega desde una sola dirección nunca queda
  fuera por ingresar. Cada respuesta 429 pide en español que se espere, y la cabecera `Retry-After`
  dice cuántos segundos faltan. La dirección es la que ve el
  nginx de la web: la que un cliente escribe en `X-Forwarded-For` no cuenta.
- **Con Docker Desktop (Windows, macOS)**, el nginx de la web ve llegar a todos los equipos de la red
  desde una sola dirección interna, la de Docker. Los 20 ingresos fallidos por minuto son entonces de
  toda la instalación: cualquier equipo de la red que los gaste deja a todos sin poder ingresar
  hasta que termine ese minuto (quien ya tiene la sesión abierta sigue trabajando). Docker Engine en
  Linux, o un proxy con HTTPS delante y `TRUST_PROXY_HOPS=2` (ver
  [Acceso desde otras máquinas](#acceso-desde-otras-máquinas)), dan a cada equipo su dirección real.
- **API keys de IA** cifradas en la base de datos con AES-256-GCM y una clave que sale de
  `APP_SECRET`: quien lee la base de datos o un respaldo no las ve, y una key alterada ahí no se
  acepta. Una key solo se envía al servidor con el que se guardó.
- **Adjuntos** servidos siempre como descarga, nunca interpretados por el navegador.
- **Datos de entrada revisados** antes de que el API haga nada con ellos: cada campo contra las
  reglas de su ruta, y un campo que la ruta no admite se rechaza, de modo que nadie escribe lo que
  ninguna pantalla ofrece. El 400 dice en español qué campo falla, con el nombre que tiene en el API
  (`El campo «username» debe ser un texto`, `El campo «role» no se admite`). También en español: una
  ruta que no existe (`La ruta no existe.`), una sesión que terminó o un token que no vale (`La
  sesión terminó o no es válida. Vuelve a ingresar.`), un cuerpo de más de 100 KB o en otra
  codificación que UTF-8, y una dirección con caracteres mal codificados.
- **Subidas con límites de memoria.** Los adjuntos se escriben en disco a medida que llegan, en una
  carpeta aparte (`.incoming`), y pasan a la de los adjuntos solo si el caso existe; sus registros se
  guardan juntos, y si algo falla no queda ningún archivo suelto. Una importación o las imágenes para
  la IA se leen en memoria, con su límite de tamaño. Antes de abrir un `.xlsx`, el API comprueba
  cuánto ocupa descomprimido y que cada parte descomprima a lo que dice (un archivo pequeño hecho
  para inflarse a gigas se rechaza), y deja de leer un CSV pasadas las filas que se pueden importar.
  El nginx de la web no acepta solicitudes de más de 151 MB (el envío más grande: 10 adjuntos de
  15 MB), y el contenedor del API tiene 1,5 GB de memoria como máximo, sin swap. Los límites se
  explican en español al que los supera.
- **Archivos que adjunta el asistente.** El servidor MCP solo sube los de los tipos que acepta, de
  hasta 15 MB y con su ruta completa, nunca uno oculto o de una carpeta oculta (`.env`, `.ssh`...)
  ni de una ruta de red, y con `SUPPORT_ATTACH_DIRS` solo de esas carpetas (ver
  [Asistentes de IA](#asistentes-de-ia-mcp-y-skills)).
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
