---
name: soporte-casos
description: Registrar, consultar, dar seguimiento y cerrar casos de soporte técnico en el sistema de casos del equipo, y redactar mensajes para clientes. Úsala cuando la persona envía una captura, una foto o un mensaje de un cliente para registrarlo como caso; cuando dice que un caso ya fue solucionado ("el caso SOP-00020 ya está", "cierra el de Acme"); cuando pregunta por casos pendientes o vencidos; o cuando dicta una respuesta para un cliente y pide dejarla lista para enviar.
---

# Casos de soporte

El sistema de casos se maneja con las herramientas del servidor MCP `soporte`
(`leer_guia`, `listar_catalogos`, `buscar_casos`, `ver_caso`, `crear_caso`, `actualizar_caso`,
`agregar_observacion`, `adjuntar_archivos`, `cerrar_caso`, `crear_responsable`, `crear_modulo`).

Las reglas del equipo no están en este archivo: viven junto al servidor para que cualquier
asistente las reciba igual. Por eso el primer paso siempre es el mismo:

1. Llama a `leer_guia` una vez por conversación y sigue lo que dice. Trae las reglas para
   registrar y cerrar casos y la guía de estilo para mensajes a clientes.
2. Llama a `listar_catalogos` antes de registrar o modificar un caso.

Recordatorios que la guía desarrolla:

- Registrar desde una imagen: lee la imagen, arma el borrador, confírmalo con la persona y
  crea el caso. Si la imagen es un archivo en disco, pasa su ruta en `imagenes` para adjuntarla.
- Cerrar un caso: identifica el caso, redacta la respuesta para el cliente con la guía de
  estilo, llama a `cerrar_caso` y devuelve el mensaje completo en un bloque listo para copiar.
- Empresa y solución no se suponen: si faltan, pregunta.
- Si la persona nombra un responsable o un módulo que no existe, no lo crees ni elijas otro por
  tu cuenta: pregúntale si lo agregas (`crear_responsable`, `crear_modulo`), si usas uno de los
  existentes o si el caso queda sin ese dato.

Si las herramientas de `soporte` no están disponibles o responden que no pueden conectar, el
sistema está apagado: dilo y no intentes otra vía. Se enciende con los comandos del `README.md`
del proyecto.
