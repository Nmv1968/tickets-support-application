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
- Un cambio en `prisma/schema.prisma` lleva su migración (`npx prisma migrate dev --name ...`).
- Las pruebas no usan base de datos: sustituyen `PrismaService` por un objeto con las llamadas que
  esperan.

### Web (`web/`)

- Angular con componentes standalone, signals y detección de cambios `OnPush`.
- Estilos con Tailwind CSS. Los colores salen de las variables de `src/styles.css`, nunca de valores
  escritos en el componente, para que funcionen en tema claro y oscuro.
- Lo que se repite en varias pantallas va a una clase de `@layer components` o a un componente.
- Accesibilidad: todo control tiene nombre, se llega a todo con el teclado y el contraste es legible.
- Toda escritura de un caso pasa por `Api`, que avisa el cambio a las demás pantallas.

### Datos de prueba

Usa siempre empresas, personas y casos inventados en pruebas, ejemplos y capturas.

## Licencia

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE) del proyecto.
