# Cómo contribuir

Gracias por tu interés en mejorar Soporte. Esta guía explica cómo reportar un problema, proponer una
idea y enviar cambios.

## Reportar un error o proponer una mejora

Abre un issue en GitHub. Para un error, incluye:

- Qué hiciste, qué esperabas y qué pasó.
- Cómo usas la aplicación: Docker o desarrollo local, y el navegador.
- El mensaje de error, si lo hay. Con Docker: `docker compose logs api`.

Antes de pegar una captura o un log, quita los datos de tus clientes y cualquier contraseña o API key.

**Vulnerabilidades de seguridad:** no abras un issue público. Usa **Security > Report a
vulnerability** en el repositorio.

## Preparar el entorno

Sigue la sección [Desarrollo en local](README.md#desarrollo-en-local) del README. En resumen: Node.js
22, `devdb/` para la base de datos, `api/` y `web/` cada uno en su terminal.

## Enviar cambios

1. Haz un fork y crea una rama a partir de `main`.
2. Haz el cambio, con sus pruebas.
3. Comprueba que todo pasa:

   ```bash
   cd api && npx tsc --noEmit -p tsconfig.json && npm run lint && npm test
   cd web && npm run lint && npx ng build && npm run test:ci
   cd mcp && npm test
   ```

   Si el cambio toca algo que una persona hace en la pantalla, corre también las pruebas de extremo
   a extremo (ver [Pruebas](README.md#pruebas)): `cd e2e && npm run stack:up && npm test`, y al
   terminar `npm run stack:down`.

4. Abre un pull request que explique qué cambia y por qué. Si cambia algo que se ve, agrega una
   captura (con datos inventados).

Un pull request pequeño y con un solo propósito se revisa mucho más rápido que uno grande.

## Convenciones del código

- **Idiomas.** Todo lo que lee una persona en la aplicación está en español. El código, los nombres y
  los comentarios están en inglés.
- **Comentarios.** Explican por qué, no qué. Si el código necesita un comentario para entender qué
  hace, suele poder escribirse más claro.
- **Simple primero.** La solución más pequeña que resuelve el problema completo. Sin capas ni
  abstracciones que todavía no hacen falta.
- **Reutiliza.** Antes de crear un tipo, una constante o un componente, busca si ya existe uno.

### API (`api/`)

- NestJS con un módulo por parte del API (`TicketsModule`, `CatalogsModule`, `TransferModule`,
  `AiModule`, `AuthModule`…), que `AppModule` reúne con lo que vale para toda solicitud: los guards
  globales, el interceptor de los avisos en vivo y los filtros de errores de Prisma y de las rutas.
  `PrismaModule` es global y el único que da `PrismaService`. Un controlador nuevo se registra en el
  módulo de su carpeta: `src/app.module.spec.ts` falla si alguno queda fuera. Los controladores
  validan la entrada con DTO de `class-validator`.
- Al detenerse (`SIGTERM` de `docker stop`, o Ctrl+C), `main.ts` cierra la aplicación antes de
  terminar el proceso (`closeOnStopSignals` de `src/app.setup.ts`): Nest llama a los
  `beforeApplicationShutdown` (los flujos de `/api/events` terminan, o el servidor esperaría por
  ellos), el servidor termina las solicitudes que tiene y después los `onApplicationShutdown`
  (`PrismaService` cierra sus conexiones). Lo que deba cerrarse al detenerse va en esos ganchos: un
  temporizador o una conexión que quede abierta no impide que el proceso termine, pero se corta.
- Un controlador declara sus rutas, lee la solicitud (los parámetros, el cuerpo, el usuario de la
  sesión) y escribe lo propio de HTTP, como los encabezados de un archivo, y nada más: las reglas y
  las lecturas y escrituras de la base de datos están en el servicio de su carpeta (`*.service.ts`),
  junto con los DTO que lee, y las pruebas llegan a ellas sin HTTP. `src/app.module.spec.ts` falla
  si un controlador recibe `PrismaService`, salvo el de los avisos en vivo, que solo revisa en cada
  latido que la sesión de su flujo siga en pie.
- Un archivo por tarea. En `src/tickets/`, la entrada de un caso (`ticket-input.ts`), los filtros de
  la lista (`ticket-filters.ts`), lo que se responde de un caso (`ticket-mappers.ts`), lo que escribe
  una edición (`ticket-update.ts`) y el servicio, que solo lee y escribe en la base de datos. En
  `src/transfer/`, la lectura del archivo, los catálogos de nombres, la importación, la plantilla y
  cada exportación, con `TransferService` como entrada del controlador. Lo que comparten los PDF
  del API (el encabezado y el pie de cada página, los colores) está en `src/common/pdf.ts`; las
  hojas de Excel (el encabezado, el formato de las fechas), en `src/common/xlsx.ts`, y todo archivo
  que el API entrega (la descarga con su tipo y su nombre con la fecha, y el límite de casos que se
  cuenta antes de armarlo, `refuseOverLimit`), en `src/common/exports.ts`. Las pruebas van al lado
  del archivo que prueban; lo que comparten las de una carpeta, en su `testing.ts`, y lo que
  comparten las de varias (la fecha de un caso, el administrador de prueba, el texto de una
  sentencia SQL, la aplicación armada como en `main.ts`), en `src/common/testing.ts`. La compilación
  deja fuera todos los `testing.ts` (`tsconfig.build.json`).
- Lo que se repite se escribe una vez, junto a lo que lo produce, y se importa: un mensaje (el 404
  de un caso, `TICKET_NOT_FOUND`; el 400 de una entrada que no está en su catálogo, `MISSING_ENTRY`,
  que es el mismo texto que da el catálogo), un límite (`TEXT_MAX`, lo más largo de una descripción,
  una observación o una respuesta), una regla (`tooLong` de `src/common/validation.ts` para el texto
  demasiado largo de un campo; `byName` y `supportTypesText` de `src/common/labels.ts` para el orden
  y el texto de los tipos de soporte). Un nombre de usuario se guarda con `loginName` y una
  contraseña con `hashPassword` (`src/users/credentials.ts`), en el ingreso, en Configuración >
  Usuarios y en el arranque: un solo costo de bcrypt, el de `DUMMY_HASH`. Los usuarios que crea el
  arranque (el asistente y el primer administrador) se leen del .env con `seededUsernames`, el mismo
  para el arranque y para `checkEnv`, que no deja que sean uno solo. Si una sesión sigue en pie
  lo dice `sessionStands` (`src/common/session-token.ts`), para `JwtGuard` y para el flujo de avisos.
- `npm run lint` (ESLint con typescript-eslint, en `eslint.config.mjs`) revisa el código sin
  cambiar nada, y no el formato: Prettier no corre en el lint ni en la integración continua.
  `.prettierrc` tiene el ancho de línea del código (170 columnas), para que `npm run format` o el
  formateo del editor no partan cada línea larga; aun así reacomoda parte de los archivos, así que
  úsalo solo sobre lo que cambias.
- Los mensajes de error que llegan al usuario van en español. Los de validación también, sin hacer
  nada: el `ValidationPipe` global (`validationPipe()` de `src/common/validation.ts`) escribe en
  español cada regla de `class-validator` que no trae mensaje propio, con el nombre del campo en el
  API (`El campo «name» no puede estar vacío`, `«items.0.hours»` dentro de una lista), y deja tal
  cual el mensaje propio de un decorador, que se escribe cuando el nombre del campo no basta. Un
  campo que el DTO no declara se rechaza (`El campo «x» no se admite`). Una regla de
  `class-validator` que todavía no se usa lleva su frase en `SENTENCES` (sin ella, la respuesta dice
  que el valor no es válido) y un valor que la rompa en `BREAKERS` de
  `src/common/dto-messages.spec.ts`: esa prueba carga todo `src/`, recorre cada DTO con valores que
  rompen cada regla de cada campo y falla si una respuesta trae un texto de `class-validator` en
  inglés. Un id de la URL se lee con `IdPipe` (`src/common/id.pipe.ts`), nunca con `ParseIntPipe`,
  cuyo 400 está en inglés. Un 401 de una sesión que no vale se lanza con `sessionOver()`
  (`src/common/auth.ts`), nunca con `new UnauthorizedException()`, cuyo texto es `Unauthorized`. Lo que
  Nest y Express responden antes de llegar a una ruta también sale en español: la ruta que no existe
  y el parámetro de la URL mal codificado (`RouteErrorsFilter`, `src/common/route-errors.filter.ts`),
  y lo que rechaza body-parser, por tamaño, codificación o JSON inválido (`bodyErrorsInSpanish`, en
  `src/common/validation.ts`, justo después de los dos lectores del cuerpo de `configureApp`).
- Un cambio en `prisma/schema.prisma` lleva su migración (`npx prisma migrate dev --name ...`). Si
  la migración mueve datos que ya existen, se termina a mano para que no se pierdan. La integración
  continua aplica todas las migraciones en una base vacía y falla si el resultado no es lo que dice
  `schema.prisma` (`prisma migrate diff --exit-code`).
- Toda columna de `Ticket` por la que la lista, las exportaciones, el dashboard o la campana filtran
  u ordenan los casos tiene un índice en `schema.prisma`. `src/tickets/tickets.service.spec.ts`
  recorre las consultas de la lista con cada filtro y cada orden, y las de la campana, y falla si
  una columna queda sin índice. Las que no lo llevan a propósito están en su lista `UNINDEXED`, con
  el motivo: la prioridad, de cuatro valores, y el texto de la búsqueda, que se busca con `contains`.
- Las empresas, los tipos de soporte y los responsables no repiten nombre, comparado sin mayúsculas,
  tildes ni espacios (`searchKey`), y un módulo no repite el de otro del mismo lugar (los submódulos
  de un módulo, o los módulos principales). Lo asegura la base de datos: cada catálogo guarda la
  clave del nombre (`Company.sortKey`, `nameKey` en los demás) con un índice único, y el API
  convierte su rechazo (P2002, `violatesUnique` en `src/common/prisma-exception.filter.ts`) en el
  409 de cada catálogo, también para un cambio de nombre y para dos peticiones simultáneas. Toda
  escritura de un nombre escribe su clave al lado; sin ella, la creación no compila. La importación
  agrega lo que falta con `skipDuplicates` y toma la entrada que alguien registró mientras tanto.
- El índice de los módulos es `NULLS NOT DISTINCT`, para que los módulos principales (sin padre)
  tampoco repitan nombre. Prisma no sabe escribirlo en `schema.prisma` ni lo compara, así que solo
  está en la migración `20261114120000_unique_catalog_names`: una migración que rehaga ese índice
  tiene que conservarlo a mano.
- Esos tres son un mismo catálogo de nombres: `NamedCatalogService` (`src/common/named-catalog.ts`)
  lista, crea, edita y elimina las entradas de cualquiera de ellos (el orden, los espacios del
  nombre, el nombre repetido, el nombre reservado, la entrada que no se elimina mientras tiene
  casos), y cada uno le da sus reglas en su `*.service.ts` (`COMPANIES`, `ASSIGNEES`,
  `SUPPORT_TYPES`): su tabla, sus mensajes, lo que guarda además del nombre (la clave de orden de
  una empresa, el color de un tipo) y lo que un cambio de nombre arrastra a los casos. La
  importación agrega lo que falta con el `newEntry` de esas mismas reglas. Un cambio en cómo se
  guarda o se compara un nombre se hace ahí, una vez; los módulos usan de ahí el nombre reservado
  y el nombre obligatorio.
- Lo que es de todo el equipo se guarda en `settings`. Lo que cada persona elige para su propia
  vista (las columnas de la lista de casos, por ejemplo) va en `preferences`, que siempre trabaja
  sobre el usuario de la sesión: una preferencia nunca es global. Su valor es una columna `json`
  (no `jsonb`, que reordena las claves de un objeto): vuelve tal como se envió.
- Toda ruta cuenta para el límite general de `src/common/throttle.ts`, sin hacer nada: por usuario
  cuando la solicitud trae un token válido (se revisan la firma y la caducidad, sin leer la base de
  datos) y por dirección IP cuando no. La dirección es `req.ip`, que sale del `X-Forwarded-For` de
  nginx por el `trust proxy` de `src/app.setup.ts`, agrupada con `clientAddress`: nunca se lee ese
  encabezado a mano.
- El ingreso tiene además dos contadores en memoria, en `src/auth/`: los ingresos fallidos de cada
  dirección (`AddressFailures`, `LOGIN_RATE_LIMIT`) y los intentos fallidos seguidos de cada usuario
  (`LoginFailures`), que también cuentan las contraseñas actuales incorrectas de
  `POST /auth/password`. Cada intento se cuenta antes de comparar la contraseña, sin nada esperado
  entre la revisión y la cuenta, y uno correcto lo descuenta: así, intentos enviados a la vez no
  pasan juntos la revisión. Un 429 propio se lanza con `TooManyAttemptsException`
  (`src/common/retry-after.ts`), que escribe `Retry-After` con los segundos que faltan.
- Toda ruta pide una sesión, salvo las marcadas `@Public()`, y está abierta a los agentes, salvo las
  marcadas `@AdminOnly()` (`src/common/auth.ts`). `RolesGuard` responde 403 con el rol que `JwtGuard`
  leyó de la base de datos en esa misma solicitud, nunca con el del token. Una ruta nueva solo para
  administradores se agrega también a la lista de `src/common/auth.spec.ts`, que falla si una ruta
  gana o pierde la marca sin que nadie lo decida.
- Todo lo que cambia la contraseña, el rol o el estado activo de un usuario escribe además
  `END_SESSIONS` (`src/common/session-token.ts`) en el mismo `update`: sube su `tokenVersion`, y
  `JwtGuard` rechaza desde entonces todo token firmado antes. Un token se firma siempre con
  `tokenPayload(user)`, que lleva esa versión. Una vez hecha la escritura (y confirmada la
  transacción, si la hay), avisa con `EventsService.sessionsEnded(id)`: `JwtGuard` mira el token del
  flujo de `/api/events` solo al abrirlo, y ese aviso cierra al instante los flujos de ese usuario.
  Sin él quedarían abiertos hasta la siguiente comprobación del flujo, cada 25 segundos.
  `src/events/events.controller.spec.ts` busca en `src/` los archivos que importan `END_SESSIONS` y
  falla si alguno no avisa, y falla también si algún archivo escribe `tokenVersion` por su cuenta (un
  `increment`, un valor, una asignación o el SQL de una consulta escrita a mano) en vez de usar
  `END_SESSIONS`.
- Una ruta que recibe archivos fija en `limits` de multer el tamaño y el número de archivos, y los
  campos de texto que admite (`FEW_FIELDS` de `src/common/uploads.ts` si no lee ninguno), y pone
  `uploadErrors(limits)` antes de su `FileInterceptor` o `FilesInterceptor`: los mensajes de multer
  llegan en inglés. Lo que se guarda en disco va con `diskStorage` a una carpeta temporal en el mismo
  volumen y se mueve a su lugar con sus registros, como los adjuntos
  (`src/tickets/attachments.controller.ts` y `attachments.service.ts`). Una subida nueva más
  grande que las de hoy cambia también `client_max_body_size` de `web/nginx.conf`, y una lectura
  más pesada en memoria se mide contra el `mem_limit` del API en `docker-compose.yml`.
- Las pruebas no usan base de datos: sustituyen `PrismaService` por un objeto con las llamadas que
  esperan. `src/app.http.spec.ts` arranca el `AppModule` entero, con `configureApp` como `main.ts`, y
  le habla por HTTP con supertest: ahí se prueba lo que solo existe al unir las piezas (los guards
  globales y su orden, el `ValidationPipe`, el filtro de errores de Prisma). Jest carga el
  `@nestjs/jwt` real, que se publica solo como módulo ES: `jest.esm-transform.cjs` lo pasa a
  CommonJS (los paquetes que convierte están en `transformIgnorePatterns` de `package.json`).
  `@nestjs/config` se sustituye siempre en las pruebas, para que nunca lean un `.env`.

### Web (`web/`)

- Angular con componentes standalone, signals y detección de cambios `OnPush`, sin zone.js
  (`provideZonelessChangeDetection`). Una pantalla se vuelve a dibujar cuando cambia un signal que
  lee o tras un evento de su plantilla, no tras cualquier temporizador o promesa: lo que muestra
  una plantilla es un signal o un `computed`, nunca un campo que cambia sin avisar. Las pruebas
  corren igual, sin zonas (`src/test.ts`), y fallan si un valor de una plantilla cambió sin avisar.
  zone.js queda solo en las pruebas, para `fakeAsync`. Sin zonas, Angular también actualiza la
  pantalla por su cuenta tras un cambio, en el siguiente cuadro o la siguiente tarea del navegador,
  lo que llegue primero: una prueba que espera la siguiente tarea (`nextTask`) no sabe si esa
  actualización ya pasó. Lo que una prueba revisa a medio camino no se responde solo: lo responde la
  prueba (ver `src/app/core/loading.spec.ts`).
- `npm run lint` (ESLint con angular-eslint, en `eslint.config.mjs`) revisa el código y las
  plantillas sin cambiar nada. Exige lo que se describe aquí: `OnPush`, `input()`, `output()` y
  `viewChild()` en vez de sus decoradores, `@if` y `@for` en vez de `*ngIf` y `*ngFor`, componentes
  standalone, `inject()` y `host` en vez de `@HostBinding` y `@HostListener`, además de las reglas de
  accesibilidad de las plantillas. Una regla se apaga solo en la línea que lo necesita y con el
  motivo: `// eslint-disable-next-line regla -- por qué` (en una plantilla, en un comentario
  `<!-- … -->`).
- Estilos con Tailwind CSS. Los colores salen de las variables de `src/styles.css`, nunca de valores
  escritos en el componente, para que funcionen en tema claro y oscuro.
- Los iconos son `<app-icon name="…" />` (`src/app/core/icon.ts`): SVG de Material Design Icons
  (`@mdi/js`), del tamaño y el color del texto, que se les dan con clases como al texto. Solo van en
  la aplicación los de `src/app/core/icons.ts`: un icono nuevo se agrega ahí antes de usarlo. Son
  decorativos y quedan ocultos para el lector de pantalla; uno que dice algo que ningún texto a su
  lado dice lleva `label`.
- Lo que se repite en varias pantallas va a una clase de `@layer components` o a un componente.
- Los desplegables son `ng-select`, con un solo tema en `src/styles.css`: no se les da estilo en
  cada componente. Los de los campos de un caso (empresa, estado, responsable, prioridad, módulo y
  tipos de soporte) son los de `src/app/core/case-selects.ts`: cada pantalla les da sus opciones.
  En las pruebas se manejan como lo haría una persona, con las funciones de
  `src/app/testing/ng-select.ts`. Las demás ayudas de las pruebas (un caso de ejemplo, botones,
  campos, avisos, el texto de un elemento con `textOf`, y `httpTestBed()` para la prueba que
  responde ella misma las peticiones al API) están en `src/app/testing/`. La ventana de Karma tiene
  el ancho de un teléfono:
  una prueba de una pantalla que se dibuja distinto en una pantalla ancha (`wideScreen()`, de
  `src/app/core/wide-screen.ts`) elige su ancho con `provideScreenWidth`. Una prueba de si algo cabe
  en un ancho le da ese ancho al elemento del componente (`users-tab.spec.ts`): las clases de
  Tailwind de un contenedor (`@container`, `@min-[…]:`) responden a él; las de la pantalla (`md:`,
  `lg:`), no.
- Lo que no se puede deshacer (eliminar) pregunta antes con el servicio `Confirm`, no con el
  `confirm` del navegador.
- Lo que solo puede usar un administrador (pestañas, botones) se oculta a un agente con
  `Auth.isAdmin()`, no se deshabilita. El API responde 403 de todas formas: ocultarlo es para no
  ofrecer lo que no va a funcionar. La configuración de la IA no se lee para saber si está lista:
  para eso está `Catalogs.aiReady`, que sale de `GET /ai/status`. Un texto que manda a una pestaña
  de administradores (Usuarios, SLA, Recordatorios, IA, Logo) le dice a un agente, que no la ve,
  que eso lo hace un administrador, y su prueba revisa los dos roles. Un mensaje del API que llega
  también a un agente (los de la IA sin configurar, en `ai.service.ts`) lo dice para cualquiera de
  los dos: "Un administrador debe ... en Configuración > IA".
- El token de la sesión solo lo guarda `Auth` (`src/app/core/auth.ts`). Un 401 vuelve a la pantalla
  de ingreso, salvo cuando un cambio de contraseña acaba de dejar otro token (`Auth.changePassword`,
  en esta pestaña o en otra del mismo usuario): entonces la petición sale otra vez con el nuevo.
  El cambio de contraseña mismo no espera a nada: si el API lo rechaza con 401, vuelve al ingreso.
- El fondo oscuro de un diálogo o de un panel lateral lleva la clase `modal-backdrop` o
  `panel-backdrop` de `src/styles.css`. Por ella un desplegable abierto sabe que el clic que cierra
  su lista no debe cerrar también el diálogo. Un diálogo se cierra con un clic en su fondo con
  `(appBackdropClick)`, que no cuenta los clics dentro del diálogo.
- Accesibilidad: todo control tiene nombre, se llega a todo con el teclado y el contraste es legible.
- Toda escritura de un caso pasa por `Api`, que avisa el cambio a las demás pantallas.
- Lo que una pantalla lee y vuelve a leer cuando cambian sus filtros o los casos (la lista, el
  tablero, el dashboard) es un `liveResource` de `src/app/core/loading.ts`, hecho con `resource()`
  de Angular. Una lectura que se pide paso a paso (la de un caso en su panel, la vista previa de una
  importación) lleva su turno con `latest()`, del mismo archivo. En los dos, solo cuenta la última
  respuesta y la lectura anterior se cancela: nada de contadores propios. Una escritura nunca se
  cancela.
- Las preferencias de vista de cada persona se leen y se guardan con `Api.preference` y
  `Api.savePreference`, no en la configuración que comparten todos.
- La web corre bajo la `Content-Security-Policy` de `web/security-headers.conf`: solo los scripts
  de su compilación, sin `eval` ni scripts o manejadores en línea (por eso `angular.json` deja
  `inlineCritical` apagado: carga el resto de los estilos con un `onload`), sin fuentes, scripts ni
  conexiones de otros sitios, e imágenes propias, `blob:` o `data:`. La aplica el nginx de la
  imagen de Docker, no `ng serve`: una infracción se ve en las pruebas de extremo a extremo, o en la
  consola del navegador con la pila de esas pruebas. Lo que necesite otra cosa cambia también la
  política, a propósito, y `e2e/tests/security-headers.spec.ts`, que comprueba cada directiva y
  recorre las pantallas buscando infracciones: una pantalla o un diálogo nuevo se agrega a ese
  recorrido. Un bloque `location` de `web/nginx.conf` con un `add_header` propio incluye otra vez
  ese archivo, porque nginx no le pasa las cabeceras del bloque `server`; la misma prueba lo revisa.

### Asistentes (`mcp/`, `skills/`)

- `mcp/server.mjs` usa el mismo API que la web. Un cambio en una ruta o en un campo que el servidor
  usa lleva, en el mismo pull request, el cambio en sus herramientas, en `mcp/GUIA.md` y en
  `skills/soporte-casos/SKILL.md`.
- Un nombre que no está en un catálogo nunca se resuelve en el servidor, ni creando la entrada ni
  eligiendo la más parecida: el error le dice al asistente qué preguntarle a la persona.
- `cd mcp && npm test` prueba sus herramientas con `node:test`, sin dependencias nuevas: el
  servidor se arranca como lo haría un asistente y habla con un API simulado
  (`mcp/test/fake-api.mjs`) que anota cada petición; `startMcpOn(api)` de `mcp/test/mcp-client.mjs`
  lo arranca contra ese API con su usuario de prueba. Un cambio en lo que el servidor envía o
  responde lleva su prueba. `mcp/test/contract.test.mjs` lee `api/src` y falla si desaparece una
  ruta, un parámetro o un campo que el servidor o el API simulado usan: al cambiar el API, ajusta
  también el simulado. Antes de publicar, pruébalo además contra un API de desarrollo, nunca contra
  una instalación con casos reales.

### Pruebas de extremo a extremo (`e2e/`)

- Playwright con Chromium, contra la aplicación construida con Docker Compose bajo el proyecto
  `support-e2e` (`scripts/stack.mjs`). Nunca contra una instalación con casos reales, y nunca con el
  servicio `backup` encendido.
- Cada prueba crea sus propios datos, con nombres únicos (el `uid` de `support/fixtures.ts`), a
  través del API o de la pantalla. Ninguna depende de otra ni del orden: corren en paralelo sobre la
  misma base de datos. Lo que se guarda por usuario (columnas, filtros a la vista) se prueba con un
  usuario propio de la prueba (`newUser` y `pageAs`). `newUser()` crea un agente y
  `newUser('ADMIN')`, un administrador; las pruebas que no dicen con quién corren como el
  administrador de la pila.
- Los selectores son los que usa una persona: roles, etiquetas y textos en español de las
  plantillas. Los desplegables se eligen con `chooseOption` de `support/ui.ts`.
- Lo que una prueba hace en el API sin pasar por la pantalla está en `support/`: `Api` (como el
  administrador, `Api.as(token)` o `Api.loggedIn(usuario)` en una sesión nueva), `login` y
  `loginStatus`, `adminHeaders()` para el `request` de Playwright, y `repoFile(...)` para leer un
  archivo del repositorio.
- Sin esperas fijas: se espera lo que muestra la pantalla o la respuesta del API.

### Integración continua

Cada push y cada pull request a `main` corre `.github/workflows/ci.yml`: el API (tipos, lint, Jest y que
`schema.prisma` coincida con las migraciones), la web (tipos, lint, Karma y compilación), el servidor MCP y las pruebas de extremo a extremo. Si fallan las de extremo a extremo, descarga el
artefacto `playwright-report` de la ejecución y ábrelo con `npx playwright show-report` (las
trazas, con `npx playwright show-trace`).

### Datos de prueba

Usa siempre empresas, personas y casos inventados en pruebas, ejemplos y capturas.

## Licencia

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE) del proyecto.
