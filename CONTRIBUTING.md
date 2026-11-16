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
  escritos en el componente, para que funcionen en tema claro y oscuro. Cada uno tiene su uso, y
  `src/styles.spec.ts` mide su contraste en los dos temas: `primary`, `success`, `warning` y `danger`
  son de texto, iconos, bordes y tintes (`bg-danger/10`), legibles como texto chico sobre la página,
  la superficie y el gris elevado (4.5:1); un fondo con texto blanco encima (un botón primario, el
  menú activo, el encabezado de la tabla, un contador) es `bg-primary-fill` o `bg-danger-fill`; el
  borde de un campo, un select o un interruptor es `control-line` (3:1 contra lo que lo rodea), y
  `line` queda para los divisores. Los gráficos tienen sus colores (`--chart-*`), que lee
  `Theme.palette`. Un elemento no se atenúa con `opacity` para decir que está inactivo: lo dice su
  insignia, y su nombre va en `text-muted`. Tampoco un grupo de campos apagados: cada campo deshabilitado lo dice
  él mismo (`.input:disabled`, en el gris elevado y con su texto en `text-muted`, como un select).
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
  el ancho de un teléfono y el alto de una laptop (`src/test.ts`):
  una prueba de una pantalla que se dibuja distinto en una pantalla ancha (`wideScreen()`, de
  `src/app/core/wide-screen.ts`) elige su ancho con `provideScreenWidth`. Una prueba de si algo cabe
  en un ancho le da ese ancho al elemento del componente (`users-tab.spec.ts`): las clases de
  Tailwind de un contenedor (`@container`, `@min-[…]:`) responden a él. Una prueba de cómo se ve en
  una pantalla de cierto tamaño (un teléfono, una pantalla baja, el zoom al 400 %, que deja
  320 × 200) la elige con `resizeScreen` (`src/app/testing/viewport.ts`): las clases de la pantalla
  (`md:`, `lg:`, `short:`) responden a ella, y vuelve a su tamaño al terminar la prueba.
- Las pantallas bajas (`short:`, hasta 30rem de alto: un teléfono de lado, el zoom al 400 %) no
  dejan fijo nada que les quite el alto: la barra del teléfono, y el encabezado y el pie de los
  paneles y diálogos (`.overlay` y `.overlay-body`), se desplazan con el contenido. Ahí no hay barra
  de pestañas después del contenido, a miles de píxeles: las cuatro pantallas están detrás del botón
  "Menú" del encabezado, que las abre debajo de él (`aria-expanded`; Escape lo cierra y deja el foco
  en el botón). En un teléfono de altura normal sigue la barra de pestañas. El
  texto de las personas se parte donde haga falta (`overflow-wrap: anywhere` en el `body`): un
  contenedor flexible o una celda no crece por una palabra larga.
- Un formulario de dos columnas (el caso, el caso nuevo, el paso 2 del caso con IA, los filtros) tiene
  una sola por debajo de `xs:` (26rem, `src/styles.css`): ahí la mitad de la pantalla cortaba a media
  palabra el nombre elegido en un select. Sus campos de toda la fila llevan `xs:col-span-2`, no
  `col-span-2`, que en una columna crearía otra. El valor elegido de un select se escribe entero, en
  las líneas que necesite, y un chip de tipo de soporte (`app-type-chip`) también: nada se acorta con
  puntos suspensivos dejando el resto en un `title`.
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
  El objetivo es WCAG 2.2 AA, en los dos temas y desde 320 px de ancho; `e2e/tests/accessibility.spec.ts`
  (a 1280 × 800, y a 375 × 812 lo que solo muestra un teléfono) y `e2e/tests/responsive.spec.ts` (de
  320 a 1920 px de ancho, y un teléfono de lado de 360 px de alto) lo vigilan (ver "Pruebas de extremo
  a extremo"). En concreto:
  - Un botón que se deshabilita mientras tiene el foco (el que guarda y espera la respuesta, el que
    su propia acción deja sin uso, como "Restablecer") lleva `[appSoftDisabled]` de
    `src/app/core/soft-disabled.ts` en vez de `[disabled]`: queda `aria-disabled`, se ve igual que uno
    deshabilitado y no hace nada al pulsarlo, pero conserva el foco. Con `disabled`, el navegador
    manda el foco a ninguna parte. También el botón que dice por qué no se puede usar, con
    `aria-describedby` hacia un texto en pantalla: uno deshabilitado no se alcanza para leerlo.
  - El botón que envía un formulario de varios campos obligatorios (el ingreso, el caso nuevo, el
    segundo paso del caso con IA, el usuario nuevo) no se deshabilita por un campo vacío: al
    pulsarlo, cada campo que falta se marca (`aria-invalid`), dice qué necesita en un `.field-error`
    atado con `aria-describedby`, y el foco va al primero con `focusProblem` de
    `src/app/core/focus.ts`. Ese da el foco después de dibujar el mensaje, para que el lector de
    pantalla lo lea con el campo, y si el foco ya estaba en el campo dice el mensaje por el
    `Announcer` (`src/app/core/announcer.ts`). Un `.focus()` directo en el mismo paso que marca los
    campos llega antes que el mensaje. El asterisco de un campo obligatorio se
    explica una vez en el formulario ("* Obligatorio."); el campo lleva `required` o `aria-required`.
    El de un formulario corto cuyas etiquetas ya dicen lo que piden (agregar a un catálogo, una
    observación, "Cambiar contraseña" en Mi cuenta) queda en `[appSoftDisabled]` mientras falta algo.
  - Cuando un `@if` quita o cambia el control que tiene el foco (un paso de un diálogo, el botón del
    cronómetro, una fila borrada), el foco va a donde siga la persona con `focusAfterRender` de
    `src/app/core/focus.ts`, que solo actúa si el foco quedó perdido. Un panel que se cierra y no
    encuentra lo que lo abrió da el foco a la fila o la tarjeta del caso (`data-case-id`) o al
    buscador.
  - Lo que cambia sin mover el foco (la cuenta de la lista, "Cargando…", "Actualizando…") se dice en
    un `<app-status>` (`src/app/core/status.ts`), que está siempre en pantalla y cambia su texto. Llega
    vacío y su contenido entra un momento después (`STATUS_DELAY_MS`): un texto que llega junto con
    su región puede no leerse. En las pruebas, lo que dice un `<app-status>` recién dibujado se mira
    tras ese tiempo.
  - Un mensaje que aparece con sus palabras (dentro de un `@if`: un error, un aviso, "Abriendo…") no
    es una región viva: nada de `role="status"`, `role="alert"` ni `aria-live` en él. Lleva `appSay`
    (`Say` de `src/app/core/announcer.ts`), que dice sus palabras por el `Announcer` al aparecer,
    `sayAs="assertive"` si es un error, y otra vez cada vez que cambia lo que se le da
    (`[appSay]="error()"`); se quitan cuando el mensaje se va. Un botón nunca va dentro de una región
    viva (se leería con cada mensaje): el aviso "Este caso cambió en otra pantalla." dice sus
    palabras y deja fuera su "Ver la versión actual".
  - "Actualizando…" y la cuenta de la lista se dicen solo por una lectura que pidió la persona: la
    primera, un filtro, la búsqueda, una página, el orden, el periodo o el botón "Actualizar". La que
    se hace porque otro cambió un caso se ve igual (el icono que gira, el texto de la lista, la cuenta
    nueva) pero no se dice: en un `liveResource` es `reread()` y no `refresh()`, y lo que se dice va
    por `asked`, no por `loading`. Lo que se ve queda `aria-hidden` y el `<app-status>` (`sr-only`)
    dice la cuenta que dejó la última lectura pedida.
  - Los avisos (`Toast`, `src/app/core/toast.ts`) no son una región viva: su mensaje, sin el botón
    "Cerrar aviso", lo dice el `Announcer`, con cortesía si salió bien y de inmediato si es un error.
    Lo que se dice sin nada en pantalla va por `Announcer.say`, no por una región nueva. Las dos
    regiones del `Announcer` están fuera de todo diálogo, y VoiceOver no lee lo que queda fuera de uno
    con `aria-modal`: mientras una tiene un mensaje y hay un diálogo así abierto, el de más arriba la
    toma en su `aria-owns` (además de lo que ya tenía), como hace el `LiveAnnouncer` de Angular CDK, y
    la suelta cuando se va su último mensaje. Escape
    cierra primero el error más nuevo, antes que el diálogo o el panel (una pulsación para el error
    y otra para el diálogo): dentro de un diálogo el foco no llega a su "Cerrar aviso". Los avisos de
    lo que salió bien no toman Escape. Antes que el error se cierra lo más interno que esté abierto:
    la lista de un select, el texto de un "?" y lo que se despliega con un botón `aria-expanded`
    ("Menú", "Columnas", "Exportar") cuando el foco está en ese botón o en lo que muestra
    (`aria-controls`). Lo que se cierra con Escape detiene la tecla (`stopPropagation()`); cancelarla
    (`preventDefault()`) no basta, porque ng-select cancela todo Escape, también con su lista
    cerrada. Si nada la detuvo (lo que "Filtros" o "Nuevo caso" muestran en la página no se cierra
    con Escape, tampoco un select de ellos), la tecla vuelve y se lleva el error. Cuando se va
    el aviso cuyo "Cerrar aviso" tiene el foco (con Escape o un clic), el foco pasa al "Cerrar aviso"
    del aviso siguiente, o vuelve a lo que lo tenía antes de entrar a los avisos, o a `#contenido` si
    eso ya no está. Un control que recibe el foco bajo los avisos se desplaza
    hasta quedar sobre ellos, y al final de una lista esa caja recibe el espacio que le falta mientras
    haya avisos (WCAG 2.4.11).
  - No se dice nada solo con un color: la prioridad y el estado de una promesa tienen icono propio
    (`PRIORITY_ICON`, `PROMISE_ICON` de `src/app/core/ui.ts`), y lo vencido se escribe.
  - Un `title` no lleva nada que no esté también en pantalla: solo lo ve un ratón que se queda encima,
    nunca el teclado ni un dedo. Lo que explica una etiqueta, el encabezado de una columna o una
    casilla va en un "?" a su lado, `<app-hint textId="…" about="…" text="…">` de
    `src/app/core/hint.ts`: un botón de 24 px que muestra y oculta el texto (clic, toque, Enter o
    Espacio; Escape, otro clic o el foco en otra parte lo ocultan, y Escape no sigue hasta el panel o
    el diálogo). Un toque o un clic fuera que cae en el fondo de un diálogo o de un panel
    (`BACKDROP` de `src/app/core/backdrop-click.ts`) solo oculta el texto, como con la lista de un
    select abierta: el siguiente cierra el diálogo. El texto, con el id `textId`, está siempre en la
    página: describe al "?" y el campo lo apunta con `aria-describedby`. Un texto de más de una frase
    (con iconos, como la leyenda de los indicadores) va entre las etiquetas de `app-hint`, sin
    `text`. En un `<th>`, el encabezado se nombra con `aria-label` por su etiqueta sola. El `title`
    puede quedar como copia.
  - Los iconos de los indicadores de un caso (`app-ticket-flags`) son imágenes con nombre para el
    lector de pantalla; a la vista llevan sus palabras al lado donde la fila tiene espacio
    (`labelled`, la tarjeta del teléfono), y donde no (la columna de los códigos, la tarjeta del
    tablero) su leyenda está detrás de un "?" (`app-ticket-flags-legend`, en el encabezado de los
    códigos y junto a la ayuda del tablero). Un botón que no se puede usar y cuyo motivo no está
    escrito a su lado (`appSoftDisabled` con `aria-describedby` a un texto oculto) lo dice también al
    pulsarlo, con `(refused)`: la papelera de una entrada con casos muestra el motivo en un aviso de
    error, como lo haría el API. Los que tienen su motivo escrito debajo ("Generar con IA",
    "Detener cronómetro") no lo necesitan.
  - Un botón cuyo texto es todo un caso (una tarjeta del tablero, de la lista en el teléfono, de la
    campana) se nombra con `aria-labelledby` por su código y su empresa, y el resto es su
    descripción. Los botones repetidos en una lista llevan el nombre de su fila ("Desactivar Acme").
  - Los gráficos (`app-chart`) llevan sus números en una tabla para el lector de pantalla y no se
    animan con "reducir movimiento"; sus series se separan con una línea del color de la tarjeta.
  - Con "reducir movimiento" nada tiene transición (`transition: none` al final de `src/styles.css`)
    y una animación dura un instante: un icono que gira se queda quieto. Por eso nada espera el fin
    de una transición, y lo que decía un icono que gira se dice también con palabras: el botón que
    trabaja cambia su texto ("Guardando…", "Subiendo…", "Cargando modelos…"), y el tablero escribe
    "Actualizando…" junto a su botón (`motion-reduce:inline`, `aria-hidden`: al lector de pantalla
    se lo dice su `<app-status>`). En Karma, `reduceMotion()` de `src/app/testing/reduced-motion.ts`
    dibuja la página como con "reducir movimiento" hasta el final de la prueba.
  - Un botón que muestra solo su icono, en toda pantalla o solo en el teléfono (Importar, Filtros),
    lleva la clase `btn-icon` de `src/styles.css`, con `btn` y su estilo (`btn btn-ghost btn-icon
    px-2`) o sola en uno sin estilo de botón (el "×" de un aviso): mide 24 px por lado como mínimo
    (WCAG 2.5.8) y 44 px por debajo de 768 px, donde la app se dibuja para un teléfono. Nada de
    `min-h-11` botón por botón. Las excepciones se quedan en 24 px también en el teléfono: el "×" de
    un chip dentro de un select, para no hacer cada chip tan alto como un campo; el "×" que vacía un
    select entero (el de ng-select), porque uno de 44 px haría más fácil quitar todos los chips sin
    querer; y el "?" de `app-hint`, que no debe hacer la línea de una etiqueta o el encabezado de una
    tabla tan alto como un campo. `e2e/support/layout.ts` mide cada botón que muestra solo su icono
    (un SVG, o un signo escrito como texto, oculto al lector de pantalla o no: "×", "?") en todas las
    pantallas y tamaños de `responsive.spec.ts`, y nombra estas excepciones en `SMALL_ON_PURPOSE`:
    un botón de un icono de 24 px fuera de ellas falla.
  - El anillo del foco de un campo (`.input`) se dibuja con `:focus-within`: un campo de fecha o de
    hora tiene una parada más del tabulador, el botón de su calendario o de su reloj, en la que el
    campo no es `:focus`. Lo vigila `e2e/tests/focus-and-motion.spec.ts`.
  - En las pruebas, `isDisabled` de `src/app/testing/screen.ts` vale para un control `disabled` o
    `aria-disabled`.
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
- Las guardas de accesibilidad (`tests/accessibility.spec.ts`, axe con las reglas de WCAG 2.0, 2.1 y
  2.2, A y AA, en los dos temas, como administrador y como agente, a 1280 × 800) y de pantallas
  (`tests/responsive.spec.ts`, a cada tamaño de `SCREENS` en `support/layout.ts`: 360 × 740,
  320 × 568, 740 × 360, 768 × 1024, 1280 × 800 y 1920 × 1080) recorren las mismas pantallas y diálogos,
  con los datos que cada prueba crea con `makeShowcase` de `support/screens.ts`: todo lo que una
  pantalla puede mostrar, en su versión más larga, y la lista, el tablero y el dashboard reducidos a
  ellos. Su navegador se prepara con `watchShowcase`: del flujo en vivo solo le llegan los cambios de
  esos casos, no los avisos ni las listas que cambian las demás pruebas mientras tanto. Una pantalla
  o un diálogo nuevo se agrega a los dos recorridos, con su forma de abrirlo en `support/screens.ts`,
  que espera su contenido (`settled`: ninguna petición al API sin respuesta). Lo que solo un teléfono
  muestra (las tarjetas de la lista, el encabezado y la barra de pestañas, el enlace "Saltar al
  contenido" con el foco, el panel del caso y la campana a lo ancho de la pantalla) pasa también por
  axe a 375 × 812, con el teléfono emulado como tal (`isMobile`, `hasTouch`: lo que en un escritorio
  aparece al pasar el puntero, ahí está siempre a la vista); una pantalla que en un teléfono cambia
  de forma, y no solo de ancho, se agrega a esa pasada. El teléfono de lado (740 × 360) es la única
  pantalla baja de `SCREENS` (`short:`, 30rem de alto como máximo): ahí el recorrido abre también el
  "Menú" del encabezado.
- `expectAccessible` (`support/a11y.ts`) falla con cada infracción grave o crítica; las demás quedan
  adjuntas al informe. Ninguna regla se apaga para una página: un hallazgo que no es una falla va a
  `ACCEPTED`, para esa regla y los elementos que nombra, con el motivo. También falla con cada región
  viva (`role="status"`, `role="alert"`, `aria-live`) que llegó a la página con sus palabras o que
  tiene un control: cada página de las pruebas se vigila desde antes de su primer script
  (`watchLiveRegions`, en `support/fixtures.ts`). `expectLayout`
  (`support/layout.ts`) falla si la página o una caja se desplaza de lado, salvo las que lo hacen a
  propósito (`SIDEWAYS`: una tabla, las pestañas de Configuración, las columnas del tablero), si un
  control queda cortado por su caja o fuera de la pantalla sin forma de llegar a él, o si un botón que
  muestra solo su icono (un SVG o un signo escrito como texto) mide menos de 24 px por lado, o de 44
  px por debajo de 768 px (`btn-icon`), salvo los de `SMALL_ON_PURPOSE`, que miden 24. La guarda
  misma tiene su prueba, en una página propia, en `tests/responsive.spec.ts`.
- Lo que se ve solo en el navegador de verdad y no en Karma (las paradas del tabulador dentro de un
  campo de fecha, la media query de "reducir movimiento") está en `tests/focus-and-motion.spec.ts`.
  Las pantallas bajas (el menú del encabezado a 740 × 360 y a 320 × 200, y que la lista de cada select
  del panel del caso quepa entera a 320 × 200, con el select al inicio, al centro y al final de la
  pantalla) están en `tests/short-screens.spec.ts`.

### Integración continua

Cada push y cada pull request a `main` corre `.github/workflows/ci.yml`: el API (tipos, lint, Jest y que
`schema.prisma` coincida con las migraciones), la web (tipos, lint, Karma y compilación), el servidor MCP y las pruebas de extremo a extremo. Si fallan las de extremo a extremo, descarga el
artefacto `playwright-report` de la ejecución y ábrelo con `npx playwright show-report` (las
trazas, con `npx playwright show-trace`).

### Datos de prueba

Usa siempre empresas, personas y casos inventados en pruebas, ejemplos y capturas.

## Licencia

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE) del proyecto.
