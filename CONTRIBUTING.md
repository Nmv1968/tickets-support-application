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
   cd api && npx tsc --noEmit -p tsconfig.json && npm test
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

- NestJS con un solo módulo. Los controladores validan la entrada con DTO de `class-validator`.
- Los mensajes de error que llegan al usuario van en español.
- Un cambio en `prisma/schema.prisma` lleva su migración (`npx prisma migrate dev --name ...`). Si
  la migración mueve datos que ya existen, se termina a mano para que no se pierdan.
- Las empresas, los tipos de soporte y los responsables no repiten nombre, comparado sin mayúsculas
  ni tildes (`searchKey`). Ninguna restricción de la base de datos compara así, de modo que una
  entrada nueva se agrega dentro de `withCatalogLock` (`src/common/catalog-lock.ts`): sin él, dos
  peticiones simultáneas guardarían el mismo nombre dos veces.
- Lo que es de todo el equipo se guarda en `settings`. Lo que cada persona elige para su propia
  vista (las columnas de la lista de casos, por ejemplo) va en `preferences`, que siempre trabaja
  sobre el usuario de la sesión: una preferencia nunca es global.
- Las pruebas no usan base de datos: sustituyen `PrismaService` por un objeto con las llamadas que
  esperan.

### Web (`web/`)

- Angular con componentes standalone, signals y detección de cambios `OnPush`, sin zone.js
  (`provideZonelessChangeDetection`). Una pantalla se vuelve a dibujar cuando cambia un signal que
  lee o tras un evento de su plantilla, no tras cualquier temporizador o promesa: lo que muestra
  una plantilla es un signal o un `computed`, nunca un campo que cambia sin avisar. Las pruebas
  corren igual, sin zonas (`src/test.ts`), y fallan si un valor de una plantilla cambió sin avisar.
  zone.js queda solo en las pruebas, para `fakeAsync`.
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
  campos, avisos) están en `src/app/testing/`. La ventana de Karma tiene el ancho de un teléfono:
  una prueba de una pantalla que se dibuja distinto en una pantalla ancha (`wideScreen()`, de
  `src/app/core/wide-screen.ts`) elige su ancho con `provideScreenWidth`.
- Lo que no se puede deshacer (eliminar) pregunta antes con el servicio `Confirm`, no con el
  `confirm` del navegador.
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

### Asistentes (`mcp/`, `skills/`)

- `mcp/server.mjs` usa el mismo API que la web. Un cambio en una ruta o en un campo que el servidor
  usa lleva, en el mismo pull request, el cambio en sus herramientas, en `mcp/GUIA.md` y en
  `skills/soporte-casos/SKILL.md`.
- Un nombre que no está en un catálogo nunca se resuelve en el servidor, ni creando la entrada ni
  eligiendo la más parecida: el error le dice al asistente qué preguntarle a la persona.
- `cd mcp && npm test` prueba sus herramientas con `node:test`, sin dependencias nuevas: el
  servidor se arranca como lo haría un asistente y habla con un API simulado
  (`mcp/test/fake-api.mjs`) que anota cada petición. Un cambio en lo que el servidor envía o
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
  usuario propio de la prueba (`newUser` y `pageAs`).
- Los selectores son los que usa una persona: roles, etiquetas y textos en español de las
  plantillas. Los desplegables se eligen con `chooseOption` de `support/ui.ts`.
- Sin esperas fijas: se espera lo que muestra la pantalla o la respuesta del API.

### Integración continua

Cada push y cada pull request a `main` corre `.github/workflows/ci.yml`: el API (tipos y Jest), la
web (tipos, lint, Karma y compilación), el servidor MCP y las pruebas de extremo a extremo. Si fallan las de extremo a extremo, descarga el
artefacto `playwright-report` de la ejecución y ábrelo con `npx playwright show-report` (las
trazas, con `npx playwright show-trace`).

### Datos de prueba

Usa siempre empresas, personas y casos inventados en pruebas, ejemplos y capturas.

## Licencia

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE) del proyecto.
