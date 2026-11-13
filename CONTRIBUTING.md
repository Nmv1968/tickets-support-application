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
   cd web && npx ng build && npm run test:ci
   ```

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

- Angular con componentes standalone, signals y detección de cambios `OnPush`.
- Estilos con Tailwind CSS. Los colores salen de las variables de `src/styles.css`, nunca de valores
  escritos en el componente, para que funcionen en tema claro y oscuro.
- Lo que se repite en varias pantallas va a una clase de `@layer components` o a un componente.
- Los desplegables son `ng-select`, con un solo tema en `src/styles.css`: no se les da estilo en
  cada componente. En las pruebas se manejan como lo haría una persona, con las funciones de
  `src/app/testing/ng-select.ts`.
- Lo que no se puede deshacer (eliminar) pregunta antes con el servicio `Confirm`, no con el
  `confirm` del navegador.
- El fondo oscuro de un diálogo o de un panel lateral lleva la clase `modal-backdrop` o
  `panel-backdrop` de `src/styles.css`. Por ella un desplegable abierto sabe que el clic que cierra
  su lista no debe cerrar también el diálogo.
- Accesibilidad: todo control tiene nombre, se llega a todo con el teclado y el contraste es legible.
- Toda escritura de un caso pasa por `Api`, que avisa el cambio a las demás pantallas.
- Las preferencias de vista de cada persona se leen y se guardan con `Api.preference` y
  `Api.savePreference`, no en la configuración que comparten todos.

### Asistentes (`mcp/`, `skills/`)

- `mcp/server.mjs` usa el mismo API que la web. Un cambio en una ruta o en un campo que el servidor
  usa lleva, en el mismo pull request, el cambio en sus herramientas, en `mcp/GUIA.md` y en
  `skills/soporte-casos/SKILL.md`.
- Un nombre que no está en un catálogo nunca se resuelve en el servidor, ni creando la entrada ni
  eligiendo la más parecida: el error le dice al asistente qué preguntarle a la persona.
- No tiene pruebas automáticas. `node --check mcp/server.mjs` comprueba la sintaxis; lo demás se
  prueba contra un API de desarrollo, nunca contra una instalación con casos reales.

### Datos de prueba

Usa siempre empresas, personas y casos inventados en pruebas, ejemplos y capturas.

## Licencia

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE) del proyecto.
