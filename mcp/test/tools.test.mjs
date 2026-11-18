// The tools of server.mjs against a fake API: what each one sends and what it answers.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { TEST_PASSWORD, TEST_USERNAME, startFakeApi } from './fake-api.mjs';
import { startMcpOn } from './mcp-client.mjs';

let api;
let mcp;
let files;

before(async () => {
  api = await startFakeApi();
  mcp = await startMcpOn(api);
  files = await mkdtemp(join(tmpdir(), 'soporte-mcp-pruebas-'));
});

after(async () => {
  await mcp?.close();
  await api?.close();
  if (files) await rm(files, { recursive: true, force: true });
});

beforeEach(() => api.reset());

/** The answer of a tool that worked, parsed. */
function ok(result) {
  assert.equal(result.isError, false, result.text);
  return result.json();
}

/** A tool error that says every one of `fragments`. */
function fails(result, ...fragments) {
  assert.equal(result.isError, true, `expected an error, got: ${result.text}`);
  assert.match(result.text, /^Error: /);
  for (const fragment of fragments) assert.ok(result.text.includes(fragment), `"${fragment}" missing in: ${result.text}`);
}

/** The only request of `method path`, so the test can look at what was sent. */
function onlyCall(method, path) {
  const calls = api.calls(method, path);
  assert.equal(calls.length, 1, `${method} ${path}: ${calls.length} requests`);
  return calls[0];
}

const noWrites = () => assert.deepEqual(api.writes(), [], 'nothing may be written');

describe('tool list', () => {
  test('offers the 13 tools', async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'actualizar_caso',
      'adjuntar_archivos',
      'agregar_observacion',
      'buscar_casos',
      'cerrar_caso',
      'crear_caso',
      'crear_empresa',
      'crear_modulo',
      'crear_responsable',
      'crear_tipo_soporte',
      'leer_guia',
      'listar_catalogos',
      'ver_caso',
    ]);
    for (const t of tools) assert.ok(t.description?.length > 20, `${t.name} has no description`);
  });

  test('leer_guia returns the guide with the style guide for client messages', async () => {
    const result = await mcp.call('leer_guia');
    assert.equal(result.isError, false);
    assert.ok(result.text.includes('# Guía de estilo para mensajes al cliente'));
    assert.equal(api.requests.length, 0, 'the guide is read from disk');
  });

  test('a call with arguments the schema refuses sends nothing', async () => {
    const result = await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Algo', fecha_caso: '13/11/2026' });
    assert.equal(result.isError, true);
    assert.match(result.text, /AAAA-MM-DD/);
    noWrites();
  });
});

describe('listar_catalogos', () => {
  test('offers only the active entries', async () => {
    const catalogs = ok(await mcp.call('listar_catalogos'));
    assert.deepEqual(catalogs, {
      empresas: ['Acme Industrial S.A.', 'Acme Logística', 'Ferretería Andina', 'Panadería El Trigo'],
      modulos: ['Inventario', 'Ventas', 'Ventas > Notas de crédito'],
      responsables: ['Cliente', 'María Pérez', 'Mario Ruiz'],
      tipos_soporte: ['Capacitación', 'Falla del sistema'],
      estados: ['Sin resolver', 'Pendiente', 'Resuelto'],
      prioridades: ['Baja', 'Media', 'Alta', 'Crítica'],
    });
    // The modules come active from the API: asked without `all`.
    assert.deepEqual(onlyCall('GET', 'modules').query, {});
  });
});

describe('names that are not in a catalog are never created', () => {
  const base = { empresa: 'Acme Logística', descripcion: 'No abre el sistema.' };

  test('crear_caso with an unknown company asks the person and names crear_empresa', async () => {
    fails(await mcp.call('crear_caso', { ...base, empresa: 'Distribuidora Sol' }), 'No existe la empresa "Distribuidora Sol"', 'pregunta a la persona', 'crear_empresa', 'No hay otra empresa con un nombre parecido.');
    noWrites();
  });

  test('crear_caso with an unknown responsible names crear_responsable', async () => {
    fails(await mcp.call('crear_caso', { ...base, responsable: 'Pedro Sánchez' }), 'No existe el responsable "Pedro Sánchez"', 'pregunta a la persona', 'crear_responsable', 'Responsables existentes: Cliente, María Pérez, Mario Ruiz.');
    noWrites();
  });

  test('crear_caso with an unknown module names crear_modulo', async () => {
    fails(await mcp.call('crear_caso', { ...base, modulo: 'Contabilidad' }), 'No existe el módulo "Contabilidad"', 'pregunta a la persona', 'crear_modulo', 'Módulos existentes: Inventario; Ventas; Ventas > Notas de crédito.');
    noWrites();
  });

  test('crear_caso with an unknown support type names crear_tipo_soporte', async () => {
    fails(await mcp.call('crear_caso', { ...base, tipos_soporte: ['Capacitación', 'Consultoría'] }), 'No existe el tipo de soporte "Consultoría"', 'pregunta a la persona', 'crear_tipo_soporte');
    noWrites();
  });

  test('actualizar_caso with unknown names sends no change', async () => {
    fails(await mcp.call('actualizar_caso', { caso: 'SOP-00007', empresa: 'Distribuidora Sol' }), 'crear_empresa');
    fails(await mcp.call('actualizar_caso', { caso: '7', responsable: 'Pedro' }), 'crear_responsable');
    fails(await mcp.call('actualizar_caso', { caso: '7', modulo: 'Contabilidad' }), 'crear_modulo');
    fails(await mcp.call('actualizar_caso', { caso: '7', tipos_soporte: ['Consultoría'] }), 'crear_tipo_soporte');
    noWrites();
  });

  test('an inactive entry is told apart from a missing one', async () => {
    fails(await mcp.call('crear_caso', { ...base, empresa: 'acme antigua' }), 'La empresa "Acme Antigua" existe pero está inactiva', 'Configuración > Empresas');
    fails(await mcp.call('crear_caso', { ...base, responsable: 'Lucía Gómez' }), '"Lucía Gómez" está en la lista de responsables pero inactivo', 'Configuración > Responsables');
    fails(await mcp.call('crear_caso', { ...base, modulo: 'Nómina' }), 'El módulo "Nómina" existe pero está inactivo', 'Configuración > Módulos');
    fails(await mcp.call('crear_caso', { ...base, modulo: 'Ventas > Cotizaciones' }), 'El módulo "Ventas > Cotizaciones" existe pero está inactivo');
    fails(await mcp.call('crear_caso', { ...base, tipos_soporte: ['Migración'] }), 'El tipo de soporte "Migración" existe pero está inactivo', 'Configuración > Tipos de soporte');
    // Nothing to create: the error asks about reactivating it, not about crear_empresa.
    assert.ok(!(await mcp.call('crear_caso', { ...base, empresa: 'Acme Antigua' })).text.includes('crear_empresa'));
    noWrites();
  });

  test('a partial company name gets the similar active companies, never one picked', async () => {
    const result = await mcp.call('crear_caso', { ...base, empresa: 'Acme' });
    fails(result, 'No existe la empresa "Acme"', 'Empresas con un nombre parecido: Acme Industrial S.A.; Acme Logística.');
    assert.ok(!result.text.includes('Acme Antigua'), 'an inactive company is not offered');
    // A shared word counts too.
    fails(await mcp.call('crear_caso', { ...base, empresa: 'Industrial del Norte' }), 'Empresas con un nombre parecido: Acme Industrial S.A.');
    noWrites();
  });

  test('a responsible that more than one name starts with is put to the person', async () => {
    fails(await mcp.call('crear_caso', { ...base, responsable: 'mar' }), 'Hay varios responsables que coinciden con "mar": María Pérez, Mario Ruiz', 'Pregunta a la persona');
    fails(await mcp.call('crear_caso', { ...base, responsables: ['Cliente', 'mar'] }), 'Hay varios responsables que coinciden con "mar"');
    noWrites();
  });

  test('one unknown or inactive name in a list of responsibles sends nothing', async () => {
    fails(await mcp.call('crear_caso', { ...base, responsables: ['María Pérez', 'Pedro Sánchez'] }), 'No existe el responsable "Pedro Sánchez"', 'crear_responsable');
    fails(await mcp.call('crear_caso', { ...base, responsables: ['Lucía Gómez', 'Mario Ruiz'] }), '"Lucía Gómez" está en la lista de responsables pero inactivo');
    fails(await mcp.call('actualizar_caso', { caso: '7', responsables: ['Mario', 'Pedro'] }), 'crear_responsable');
    noWrites();
  });
});

describe('crear_empresa, crear_responsable, crear_modulo, crear_tipo_soporte', () => {
  test('crear_empresa sends the name and passes the 409 of the API through', async () => {
    assert.deepEqual(ok(await mcp.call('crear_empresa', { nombre: 'Distribuidora Sol' })), {
      empresa: 'Distribuidora Sol',
      mensaje: '"Distribuidora Sol" ya está en el catálogo de empresas. Úsala con ese nombre.',
    });
    assert.deepEqual(onlyCall('POST', 'companies').body, { name: 'Distribuidora Sol' });
    fails(await mcp.call('crear_empresa', { nombre: 'FERRETERIA ANDINA' }), 'Ya existe una empresa con ese nombre');
  });

  test('crear_responsable sends the name and passes the 409 of the API through', async () => {
    assert.equal(ok(await mcp.call('crear_responsable', { nombre: 'Pedro Sánchez' })).responsable, 'Pedro Sánchez');
    assert.deepEqual(onlyCall('POST', 'assignees').body, { name: 'Pedro Sánchez' });
    fails(await mcp.call('crear_responsable', { nombre: 'maria perez' }), 'Ya existe un responsable con ese nombre');
  });

  test('crear_tipo_soporte sends grey unless a colour is given, and passes the 409 through', async () => {
    assert.deepEqual(ok(await mcp.call('crear_tipo_soporte', { nombre: 'Consultoría' })), {
      tipo_soporte: 'Consultoría',
      color: '#64748b',
      mensaje: '"Consultoría" ya está en el catálogo de tipos de soporte. Úsalo con ese nombre.',
    });
    await mcp.call('crear_tipo_soporte', { nombre: 'Reporte', color: '#1A2B3C' });
    assert.deepEqual(
      api.calls('POST', 'support-types').map((r) => r.body),
      [
        { name: 'Consultoría', color: '#64748b' },
        { name: 'Reporte', color: '#1A2B3C' },
      ],
    );
    fails(await mcp.call('crear_tipo_soporte', { nombre: 'migracion' }), 'Ya existe un tipo de soporte con ese nombre');
  });

  test('crear_modulo creates a main module or a submodule of an active main one', async () => {
    assert.deepEqual(ok(await mcp.call('crear_modulo', { nombre: '  Contabilidad  ' })), {
      modulo: 'Contabilidad',
      mensaje: 'El módulo "Contabilidad" ya está en el catálogo. Úsalo con ese nombre.',
    });
    assert.equal(ok(await mcp.call('crear_modulo', { nombre: 'Facturas', dentro_de: 'VENTAS' })).modulo, 'Ventas > Facturas');
    assert.deepEqual(
      api.calls('POST', 'modules').map((r) => r.body),
      [
        { name: 'Contabilidad', parentId: null },
        { name: 'Facturas', parentId: 1 },
      ],
    );
    // It reads the inactive modules too, to tell a repeated name.
    assert.ok(api.calls('GET', 'modules').every((r) => r.query.all === '1'));
  });

  test('crear_modulo refuses an unknown parent and a name the catalog has, active or not', async () => {
    fails(await mcp.call('crear_modulo', { nombre: 'Facturas', dentro_de: 'Compras' }), 'No existe el módulo principal "Compras"', 'Módulos principales: Inventario; Ventas.');
    fails(await mcp.call('crear_modulo', { nombre: 'notas de credito', dentro_de: 'Ventas' }), 'El módulo "Ventas > Notas de crédito" ya existe: úsalo con ese nombre.');
    fails(await mcp.call('crear_modulo', { nombre: 'Nomina' }), 'El módulo "Nómina" ya existe pero está inactivo', 'Configuración > Módulos');
    noWrites();
  });

  // Someone may add the same module between the list the tool reads and its POST: the unique index
  // of the API refuses the second one, and the tool says what the API said.
  test('crear_modulo passes the 409 of the API through', async () => {
    const message = 'Ya existe un módulo con ese nombre en Ventas';
    api.answerNext('POST', 'modules', 409, { message, error: 'Conflict', statusCode: 409 });

    fails(await mcp.call('crear_modulo', { nombre: 'Facturas', dentro_de: 'Ventas' }), message);
    assert.deepEqual(onlyCall('POST', 'modules').body, { name: 'Facturas', parentId: 1 });
  });
});

describe('crear_caso', () => {
  test('resolves names ignoring case and accents and sends the whole body', async () => {
    const created = ok(
      await mcp.call('crear_caso', {
        empresa: '  ferreteria   ANDINA ',
        descripcion: 'No imprime la factura.',
        fecha_caso: '2026-11-12',
        hora_caso: '14:35',
        estado: 'Sin resolver',
        prioridad: 'Crítica',
        modulo: 'ventas > notas de credito',
        minutos_estimados: 45,
        promesa_entrega: '2026-11-20',
        responsables: ['mario', 'maria', 'María Pérez'],
        tipos_soporte: ['FALLA DEL SISTEMA', 'capacitacion', 'Falla del sistema'],
        observacion: 'Error 500 al imprimir.',
      }),
    );
    assert.deepEqual(onlyCall('POST', 'tickets').body, {
      companyId: 3,
      description: 'No imprime la factura.',
      date: '2026-11-12',
      time: '14:35',
      status: 'UNRESOLVED',
      priority: 'CRITICAL',
      moduleId: 2,
      estimatedMinutes: 45,
      promisedDate: '2026-11-20',
      // A responsible or a type named twice counts once.
      assigneeIds: [2, 1],
      supportTypeIds: [1, 2],
      note: 'Error 500 al imprimir.',
      aiGenerated: true,
    });
    assert.equal(created.codigo, 'SOP-00021');
    assert.equal(created.empresa, 'Ferretería Andina');
    assert.equal(created.estado, 'Sin resolver');
    assert.equal(created.prioridad, 'Crítica');
    assert.equal(created.modulo, 'Ventas > Notas de crédito');
    // By name, as the support types.
    assert.deepEqual(created.responsables, ['María Pérez', 'Mario Ruiz']);
    assert.equal('responsable' in created, false);
    assert.deepEqual(created.tipos_soporte, ['Capacitación', 'Falla del sistema']);
    assert.equal(created.minutos_estimados, 45);
    assert.deepEqual(created.observaciones.map((n) => n.texto), ['Error 500 al imprimir.']);
  });

  // What assistants sent before a case could have several: one name, which is a list of one.
  test('still takes a single `responsable`, but not together with `responsables`', async () => {
    const created = ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Saldos.', responsable: 'maria' }));
    assert.deepEqual(onlyCall('POST', 'tickets').body.assigneeIds, [1]);
    assert.deepEqual(created.responsables, ['María Pérez']);

    api.reset();
    ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Saldos.', responsable: 'ninguno' }));
    assert.deepEqual(onlyCall('POST', 'tickets').body.assigneeIds, []);

    api.reset();
    fails(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Saldos.', responsable: 'maria', responsables: ['Mario Ruiz'] }), 'solo en `responsables`');
    noWrites();
  });

  test('a module is found by its own name too', async () => {
    ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Saldos.', modulo: 'Notas de Crédito' }));
    assert.equal(onlyCall('POST', 'tickets').body.moduleId, 2);
  });

  test('without the optional fields the case is unassigned, without module, priority or types', async () => {
    const created = ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Consulta.' }));
    assert.deepEqual(onlyCall('POST', 'tickets').body, {
      companyId: 2,
      description: 'Consulta.',
      priority: null,
      moduleId: null,
      estimatedMinutes: null,
      promisedDate: null,
      assigneeIds: [],
      supportTypeIds: [],
      aiGenerated: true,
    });
    assert.equal(created.estado, 'Pendiente');
    assert.deepEqual(created.responsables, []);
    assert.equal(created.prioridad, null);
    assert.equal(created.archivado, false);
    assert.equal(created.aviso, undefined);
  });

  test('attaches the images after creating the case', async () => {
    const image = join(files, 'pantalla.png');
    const log = join(files, 'registro.txt');
    await writeFile(image, 'png');
    await writeFile(log, 'texto del registro');
    const created = ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Error.', imagenes: [image, log] }));
    assert.deepEqual(
      onlyCall('POST', 'tickets/21/attachments').body.files.map(({ field, name, type, text }) => ({ field, name, type, text })),
      [
        { field: 'files', name: 'pantalla.png', type: 'image/png', text: 'png' },
        { field: 'files', name: 'registro.txt', type: 'text/plain', text: 'texto del registro' },
      ],
    );
    assert.deepEqual(created.adjuntos, ['pantalla.png', 'registro.txt']);
  });

  test('a file that cannot be read leaves the case registered, with a warning', async () => {
    const created = ok(await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Error.', imagenes: [join(files, 'no-existe.png')] }));
    assert.equal(created.codigo, 'SOP-00021');
    assert.match(created.aviso, /^El caso se registró, pero no se pudieron adjuntar los archivos: No se pudo leer el archivo/);
    assert.equal(api.calls('POST', 'tickets/21/attachments').length, 0);
  });
});

describe('actualizar_caso', () => {
  test('sends only the fields given, mapped to the API', async () => {
    const updated = ok(
      await mcp.call('actualizar_caso', {
        caso: 'SOP-00007',
        estado: 'Pendiente',
        prioridad: 'Baja',
        modulo: 'Inventario',
        responsable: 'Mario Ruiz',
        empresa: 'Panaderia el trigo',
        descripcion: 'Nueva descripción.',
        fecha_caso: '2026-11-09',
        hora_caso: '08:00',
        promesa_entrega: '2026-11-30',
        minutos_estimados: 90,
        minutos_reales: 30,
        respuesta_cliente: 'Ya quedó.',
        archivar: true,
      }),
    );
    assert.deepEqual(onlyCall('PATCH', 'tickets/7').body, {
      status: 'PENDING',
      priority: 'LOW',
      moduleId: 3,
      assigneeIds: [2],
      companyId: 5,
      description: 'Nueva descripción.',
      date: '2026-11-09',
      time: '08:00',
      promisedDate: '2026-11-30',
      estimatedMinutes: 90,
      spentMinutes: 30,
      customerReply: 'Ya quedó.',
      archived: true,
    });
    assert.equal(updated.archivado, true);
    assert.equal(updated.estado, 'Pendiente');
    assert.equal(updated.respuesta_cliente, 'Ya quedó.');
  });

  test('null, empty and "ninguno" take a value off', async () => {
    ok(await mcp.call('actualizar_caso', { caso: '7', prioridad: null, modulo: '', responsable: 'ninguno', hora_caso: null, promesa_entrega: null, minutos_estimados: null, respuesta_cliente: '', tipos_soporte: [], archivar: false }));
    assert.deepEqual(onlyCall('PATCH', 'tickets/7').body, {
      priority: null,
      moduleId: null,
      assigneeIds: [],
      supportTypeIds: [],
      time: null,
      promisedDate: null,
      estimatedMinutes: null,
      customerReply: '',
      archived: false,
    });
  });

  test('replaces the responsibles with the list given, reading the case once for it and the types', async () => {
    const updated = ok(await mcp.call('actualizar_caso', { caso: '7', responsables: ['Mario Ruiz', 'María Pérez', 'Cliente'], tipos_soporte: ['Capacitación'] }));
    assert.deepEqual(onlyCall('PATCH', 'tickets/7').body, { assigneeIds: [2, 1, 4], supportTypeIds: [2] });
    assert.equal(onlyCall('GET', 'tickets/7').method, 'GET');
    assert.deepEqual(updated.responsables, ['Cliente', 'María Pérez', 'Mario Ruiz']);

    api.reset();
    ok(await mcp.call('actualizar_caso', { caso: '7', responsables: [] }));
    assert.deepEqual(onlyCall('PATCH', 'tickets/7').body, { assigneeIds: [] });
  });

  test('an inactive responsible the case already has may stay; a new inactive one may not', async () => {
    // Case 12 is given the inactive "Lucía Gómez" by hand, as the web lets a case keep her.
    api.data.tickets.find((t) => t.id === 12).assignees = [{ id: 3, name: 'Lucía Gómez' }];
    ok(await mcp.call('actualizar_caso', { caso: '12', responsables: ['Lucía Gómez', 'Mario Ruiz'] }));
    assert.deepEqual(onlyCall('PATCH', 'tickets/12').body, { assigneeIds: [3, 2] });

    api.reset();
    fails(await mcp.call('actualizar_caso', { caso: '7', responsables: ['Lucía Gómez'] }), '"Lucía Gómez" está en la lista de responsables pero inactivo');
    noWrites();
  });

  test('an inactive support type the case already carries may stay; a new inactive one may not', async () => {
    // Case 7 carries "Falla del sistema" and the inactive "Migración".
    ok(await mcp.call('actualizar_caso', { caso: '7', tipos_soporte: ['Migración', 'Falla del sistema', 'Capacitación'] }));
    assert.deepEqual(onlyCall('PATCH', 'tickets/7').body, { supportTypeIds: [3, 1, 2] });
    assert.equal(onlyCall('GET', 'tickets/7').method, 'GET');

    api.reset();
    fails(await mcp.call('actualizar_caso', { caso: '12', tipos_soporte: ['Migración'] }), 'El tipo de soporte "Migración" existe pero está inactivo');
    noWrites();
  });

  test('without changes, or with a code that is not one, nothing is sent', async () => {
    fails(await mcp.call('actualizar_caso', { caso: '7' }), 'No se indicó ningún cambio.');
    fails(await mcp.call('actualizar_caso', { caso: 'el de Acme', estado: 'Resuelto' }), '"el de Acme" no es un código de caso. Ejemplo: SOP-00020.');
    noWrites();
  });
});

describe('buscar_casos', () => {
  test('without filters asks for the newest 20, archived left out', async () => {
    const found = ok(await mcp.call('buscar_casos'));
    assert.deepEqual(onlyCall('GET', 'tickets').query, { dir: 'desc', pageSize: '20' });
    assert.equal(found.total, 1);
    assert.deepEqual(found.casos[0], {
      codigo: 'SOP-00007',
      fecha_caso: '2026-11-10',
      hora_caso: '09:15',
      fecha_registro: found.casos[0].fecha_registro,
      empresa: 'Acme Industrial S.A.',
      descripcion: 'No se puede emitir una nota de crédito.',
      estado: 'Sin resolver',
      responsables: ['María Pérez'],
      prioridad: 'Alta',
      modulo: 'Ventas > Notas de crédito',
      tipos_soporte: ['Falla del sistema', 'Migración'],
      vencido: true,
      promesa_entrega: '2026-11-13',
      estado_promesa: 'vence hoy',
      olvidado: false,
      ultimo_movimiento: found.casos[0].ultimo_movimiento,
      archivado: false,
      ultima_observacion: 'Se revisó el log del servidor.',
    });
  });

  test('sends every filter with the names of the API', async () => {
    ok(
      await mcp.call('buscar_casos', {
        texto: 'nota de crédito',
        estado: 'Sin resolver',
        empresa: 'acme industrial s.a.',
        responsable: 'María',
        tipo_soporte: 'falla del sistema',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        solo_vencidos: true,
        solo_olvidados: true,
        promesa: 'por atender',
        archivados: 'solo',
        limite: 5,
      }),
    );
    assert.deepEqual(onlyCall('GET', 'tickets').query, {
      q: 'nota de crédito',
      status: 'UNRESOLVED',
      companyId: '1',
      assignee: '1',
      supportType: '1',
      archived: 'only',
      from: '2026-11-01',
      to: '2026-11-30',
      overdue: '1',
      stale: '1',
      promise: 'due',
      dir: 'desc',
      pageSize: '5',
    });
  });

  test('maps the archived, promise and responsible filters', async () => {
    const query = async (args) => {
      api.reset();
      ok(await mcp.call('buscar_casos', args));
      return onlyCall('GET', 'tickets').query;
    };
    assert.equal((await query({ archivados: 'no' })).archived, undefined);
    assert.equal((await query({ archivados: 'todos' })).archived, 'all');
    assert.equal((await query({ responsable: 'ninguno' })).assignee, 'none');
    assert.equal((await query({ responsable: 'Sin asignar' })).assignee, 'none');
    assert.equal((await query({ responsable: '' })).assignee, 'none');
    assert.equal((await query({ empresa: '' })).companyId, undefined);
    assert.equal((await query({ solo_vencidos: false, solo_olvidados: false })).overdue, undefined);
    const promises = { 'con promesa': 'any', 'por atender': 'due', vencida: 'overdue', hoy: 'today', proxima: 'soon' };
    for (const [label, value] of Object.entries(promises)) assert.equal((await query({ promesa: label })).promise, value);
  });

  test('a filter takes inactive entries: their cases are still there', async () => {
    ok(await mcp.call('buscar_casos', { empresa: 'Acme Antigua', responsable: 'Lucía Gómez', tipo_soporte: 'Migración' }));
    const { query } = onlyCall('GET', 'tickets');
    assert.deepEqual([query.companyId, query.assignee, query.supportType], ['4', '3', '3']);
  });

  test('an unknown name in a filter is put to the person, without searching', async () => {
    fails(await mcp.call('buscar_casos', { empresa: 'Acme' }), 'No existe la empresa "Acme": el filtro necesita el nombre exacto', 'Empresas con un nombre parecido: Acme Industrial S.A.; Acme Logística; Acme Antigua.', '`texto`');
    fails(await mcp.call('buscar_casos', { responsable: 'Pedro' }), 'No existe el responsable "Pedro".', 'Lucía Gómez');
    fails(await mcp.call('buscar_casos', { tipo_soporte: 'Consultoría' }), 'No existe el tipo de soporte "Consultoría": el filtro necesita el nombre exacto');
    assert.equal(api.calls('GET', 'tickets').length, 0);
  });
});

describe('ver_caso, agregar_observacion, adjuntar_archivos, cerrar_caso', () => {
  test('ver_caso returns the whole case, the notes in chronological order', async () => {
    const shown = ok(await mcp.call('ver_caso', { caso: 'SOP-00007' }));
    onlyCall('GET', 'tickets/7');
    assert.deepEqual(
      shown.observaciones.map((n) => n.texto),
      ['El error aparece al guardar.', 'Se revisó el log del servidor.'],
    );
    assert.deepEqual(shown.observaciones[0], { fecha: '2026-11-10T09:20:00.000Z', autor: 'Ana Torres', texto: 'El error aparece al guardar.' });
    assert.deepEqual(shown.adjuntos, ['captura.png']);
    assert.equal(shown.minutos_estimados, 60);
    assert.equal(shown.minutos_reales, 0);
    assert.equal(shown.fecha_limite, '2026-11-11T09:15:00.000Z');
    assert.equal('ultima_observacion' in shown, false);

    const archived = ok(await mcp.call('ver_caso', { caso: '12' }));
    assert.equal(archived.archivado, true);
    assert.equal(archived.estado, 'Resuelto');
    assert.deepEqual(archived.responsables, []);
    assert.equal(archived.respuesta_cliente, 'El cierre ya cuadra.');
  });

  test('a case that does not exist answers the message of the API', async () => {
    fails(await mcp.call('ver_caso', { caso: 'SOP-00999' }), 'El caso no existe');
  });

  test('agregar_observacion sends the text', async () => {
    const updated = ok(await mcp.call('agregar_observacion', { caso: 'SOP-00007', texto: 'Se llamó al cliente.' }));
    assert.deepEqual(onlyCall('POST', 'tickets/7/notes').body, { text: 'Se llamó al cliente.' });
    assert.equal(updated.observaciones.at(-1).texto, 'Se llamó al cliente.');
  });

  test('adjuntar_archivos sends the files as a form', async () => {
    const pdf = join(files, 'Factura 001.PDF');
    await writeFile(pdf, '%PDF');
    const updated = ok(await mcp.call('adjuntar_archivos', { caso: '7', rutas: [pdf] }));
    const [file] = onlyCall('POST', 'tickets/7/attachments').body.files;
    assert.deepEqual({ field: file.field, name: file.name, type: file.type }, { field: 'files', name: 'Factura 001.PDF', type: 'application/pdf' });
    assert.deepEqual(updated.adjuntos, ['captura.png', 'Factura 001.PDF']);
  });

  test('cerrar_caso saves the solution as a note, then resolves with the reply', async () => {
    const closed = ok(await mcp.call('cerrar_caso', { caso: 'SOP-00007', respuesta_cliente: 'Ya puede emitir la nota.', solucion: '  Se corrigió la serie.  ' }));
    assert.deepEqual(
      api.writes().map((r) => [r.method, r.path, r.body]),
      [
        ['POST', 'tickets/7/notes', { text: 'Solución: Se corrigió la serie.' }],
        ['PATCH', 'tickets/7', { status: 'RESOLVED', customerReply: 'Ya puede emitir la nota.' }],
      ],
    );
    assert.equal(closed.estado, 'Resuelto');
    assert.equal(closed.respuesta_cliente, 'Ya puede emitir la nota.');
    assert.ok(closed.resuelto_el);
  });

  test('cerrar_caso without a solution adds no note', async () => {
    ok(await mcp.call('cerrar_caso', { caso: '7', respuesta_cliente: 'Listo.', solucion: '   ' }));
    assert.deepEqual(
      api.writes().map((r) => [r.method, r.path]),
      [['PATCH', 'tickets/7']],
    );
  });
});

describe('login and errors of the API', () => {
  test('logs in once with the configured user and sends the token', async () => {
    // Earlier tests already logged in: start again from an expired token.
    api.expireTokens();
    ok(await mcp.call('listar_catalogos'));
    ok(await mcp.call('ver_caso', { caso: '7' }));
    const logins = api.calls('POST', 'auth/login');
    assert.equal(logins.length, 1, 'the four parallel reads of listar_catalogos share one login');
    assert.deepEqual(logins[0].body, { username: TEST_USERNAME, password: TEST_PASSWORD });
    // The four reads were refused with the old token and repeated with the new one, like ver_caso after them.
    const fresh = api.requests.at(-1).authorization;
    assert.match(fresh, /^Bearer token-\d+$/);
    assert.equal(api.requests.filter((r) => r.authorization === fresh).length, 5);
  });

  test('a 401 logs in again and repeats the request once', async () => {
    ok(await mcp.call('ver_caso', { caso: '7' }));
    api.reset();
    api.expireTokens();
    const shown = ok(await mcp.call('ver_caso', { caso: '7' }));
    assert.equal(shown.codigo, 'SOP-00007');
    assert.deepEqual(
      api.requests.map((r) => [r.method, r.path]),
      [
        ['GET', 'tickets/7'],
        ['POST', 'auth/login'],
        ['GET', 'tickets/7'],
      ],
    );
    assert.notEqual(api.requests[0].authorization, api.requests[2].authorization);
  });

  test('a rejected login says which user and what to check', async () => {
    api.expireTokens();
    api.state.rejectLogin = true;
    fails(await mcp.call('ver_caso', { caso: '7' }), `El sistema de soporte rechazó el ingreso del usuario "${TEST_USERNAME}" (HTTP 401)`, 'MCP_PASSWORD');
    api.state.rejectLogin = false;
    ok(await mcp.call('ver_caso', { caso: '7' }));
  });

  // The limit of logins per address, or the lock of the user after failed attempts.
  test('a login refused for too many attempts says to wait, not to check the password', async () => {
    api.expireTokens();
    const message = 'Demasiados intentos de ingreso desde este equipo. Espera un minuto y vuelve a intentarlo.';
    api.answerNext('POST', 'auth/login', 429, { message, error: 'Too Many Requests', statusCode: 429 });
    const result = await mcp.call('ver_caso', { caso: '7' });
    fails(result, `El sistema de soporte no deja ingresar por ahora al usuario "${TEST_USERNAME}" (HTTP 429). ${message}`);
    assert.ok(!result.text.includes('MCP_PASSWORD'), result.text);

    api.answerNext('POST', 'auth/login', 429, null);
    fails(await mcp.call('ver_caso', { caso: '7' }), '(HTTP 429). Espera un minuto y vuelve a intentarlo.');
    ok(await mcp.call('ver_caso', { caso: '7' }));
  });

  test('a 401 after logging in again is not retried forever, and its message reaches the assistant', async () => {
    ok(await mcp.call('ver_caso', { caso: '7' }));
    api.reset();
    const refused = { statusCode: 401, error: 'Unauthorized', message: 'La sesión terminó o no es válida. Vuelve a ingresar.' };
    api.answerNext('GET', 'tickets/7', 401, refused);
    api.answerNext('GET', 'tickets/7', 401, refused);
    fails(await mcp.call('ver_caso', { caso: '7' }), 'Error: La sesión terminó o no es válida. Vuelve a ingresar.');
    assert.equal(api.calls('GET', 'tickets/7').length, 2);
  });

  test('the messages of the API reach the assistant', async () => {
    api.answerNext('POST', 'tickets/7/notes', 400, { message: ['La observación está vacía', 'Otra regla'], error: 'Bad Request', statusCode: 400 });
    fails(await mcp.call('agregar_observacion', { caso: '7', texto: 'x' }), 'Error: La observación está vacía. Otra regla');

    api.answerNext('GET', 'tickets/7', 500, null);
    fails(await mcp.call('ver_caso', { caso: '7' }), 'El sistema de soporte respondió HTTP 500');

    // What a proxy in front of the API answers when the API is down: a page, not JSON.
    api.answerNext('GET', 'tickets/7', 502, '<html><body>502 Bad Gateway</body></html>');
    fails(await mcp.call('ver_caso', { caso: '7' }), 'El sistema de soporte respondió HTTP 502');
  });
});
