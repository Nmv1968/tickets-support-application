# Skills para asistentes de IA

Esta carpeta trae la skill que le enseña a un asistente de IA cuándo y cómo usar las herramientas
del servidor MCP de Soporte (`mcp/`).

| Skill | Para qué |
| --- | --- |
| [`soporte-casos`](soporte-casos/SKILL.md) | Registrar un caso desde una captura o un mensaje, consultar pendientes, cerrar un caso y redactar la respuesta para el cliente. |

Una skill es una carpeta con un archivo `SKILL.md`, en el formato abierto
[Agent Skills](https://agentskills.io). Se instala copiando la carpeta `soporte-casos` al lugar donde
tu asistente busca sus skills. La tabla con la ubicación para cada asistente está en el
[README principal](../README.md#asistentes-de-ia-mcp-y-skills).

La skill es corta a propósito. Las reglas del equipo (cómo redactar un caso, qué prioridad poner,
cómo escribirle al cliente) no viven en ella, sino junto al servidor, en `mcp/GUIA.md` y en la guía de
estilo: el asistente las pide con la herramienta `leer_guia`. Así todos los asistentes siguen las
mismas reglas y basta editar un archivo para cambiarlas.
