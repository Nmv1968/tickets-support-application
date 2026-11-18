import ExcelJS from 'exceljs';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, moduleFullName } from '../common/labels';
import { EXCEL_FORMAT, paintHeader } from '../common/xlsx';
import type { PrismaService } from '../prisma.service';
import { TEXT_MAX } from '../tickets/ticket-input';
import type { ColumnKey } from './sheet-import';

// The spreadsheet people fill in to import cases, with what the system has to choose from.

/** Rows of the template that carry the cell checks. Rows below them import the same, without the checks. */
export const TEMPLATE_ROWS = 2_000;

/** Sheet of the template with what the system has: the lists of "Casos" read it, and so does the person. */
export const TEMPLATE_VALUES_SHEET = 'Valores del sistema';

/** The lists of "Valores del sistema". */
type ListKey = 'companies' | 'statuses' | 'priorities' | 'modules' | 'assignees' | 'supportTypes';

/** What the catalogs offer when the template is downloaded: the names of their active entries. */
export interface TemplateValues {
  companies: string[];
  /** Full names: "Ventas > Facturas". */
  modules: string[];
  assignees: string[];
  supportTypes: string[];
}

interface TemplateColumn {
  /** Field of the import that reads the column. Both "responsable" columns go to the same one, and so do both "tipo" columns. */
  key: ColumnKey;
  header: string;
  width: number;
  required: boolean;
  /** What goes in it. A column with a list of a catalog adds where that list comes from: see `TemplateList`. */
  help: string;
  /** The list its cells choose from. */
  list?: ListKey;
}

/**
 * The columns of the import template, in order. Each header is one the import recognises
 * (`HEADER_PATTERNS`). `help` is what the person reads about the column: as a note on its
 * header cell and in the "Instrucciones" sheet.
 */
export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  {
    key: 'date',
    header: 'Fecha',
    width: 14,
    required: false,
    help: 'Día en que el cliente reportó el caso. Escríbela como fecha, por ejemplo 15/03/2026. Vacía: toma la fecha de la fila de arriba; en la primera fila, la de hoy.',
  },
  { key: 'time', header: 'Hora', width: 9, required: false, help: 'Hora en que el cliente reportó el caso, por ejemplo 14:35. Vacía: el caso queda solo con la fecha.' },
  { key: 'company', header: 'Empresa', width: 30, required: true, list: 'companies', help: 'Empresa que reporta el caso.' },
  { key: 'description', header: 'Descripción', width: 60, required: true, help: `Qué pasó o qué se pidió. Máximo ${TEXT_MAX} caracteres.` },
  { key: 'status', header: 'Estado', width: 16, required: false, list: 'statuses', help: 'Pendiente, Resuelto o Sin resolver. Vacío: Pendiente.' },
  { key: 'priority', header: 'Prioridad', width: 12, required: false, list: 'priorities', help: 'Baja, Media, Alta o Crítica. Vacía: sin prioridad.' },
  { key: 'module', header: 'Módulo', width: 30, required: false, list: 'modules', help: 'Módulo del sistema al que corresponde el caso. Vacío: sin módulo.' },
  { key: 'assignees', header: 'Responsable', width: 24, required: false, list: 'assignees', help: 'Persona a cargo. Vacío: sin asignar.' },
  {
    key: 'assignees',
    header: 'Otro responsable',
    width: 24,
    required: false,
    list: 'assignees',
    help: 'Un segundo responsable, para el caso que tiene más de uno.',
  },
  { key: 'supportTypes', header: 'Tipo de soporte', width: 24, required: false, list: 'supportTypes', help: 'Qué clase de soporte fue. Vacío: sin tipo.' },
  {
    key: 'supportTypes',
    header: 'Otro tipo de soporte',
    width: 24,
    required: false,
    list: 'supportTypes',
    help: 'Un segundo tipo de soporte, para el caso que tiene más de uno.',
  },
  { key: 'note', header: 'Observación', width: 60, required: false, help: `Nota o solución del caso. Máximo ${TEXT_MAX} caracteres.` },
];

const STATUS_OPTIONS = [STATUS_LABEL.PENDING, STATUS_LABEL.RESOLVED, STATUS_LABEL.UNRESOLVED];
const PRIORITY_OPTIONS = PRIORITIES.map((priority) => PRIORITY_LABEL[priority]);

/** Excel shows this much of the title and of the text of the message a cell rule answers with. */
export const RULE_TITLE_MAX = 32;
export const RULE_MESSAGE_MAX = 255;

interface TemplateList {
  key: ListKey;
  /** Title of its column in "Valores del sistema". */
  header: string;
  width: number;
  /** What Excel answers to a value that is not in the list. */
  errorTitle: string;
  error: string;
  /** For a catalog: where its values come from, added to the help of the columns that choose from it. */
  source?: string;
  /** And what the help says instead while the catalog has nothing registered. */
  empty?: string;
}

/**
 * The texts of the list of a catalog, from the words for its entries and the tab of Configuración
 * that registers them. A value that is not in the list has to be registered first: the cell does not take it.
 */
const catalogList = (words: { one: string; the: string; many: string; register: string; tab: string }): Pick<TemplateList, 'error' | 'source' | 'empty'> => ({
  error: `Elige ${words.one} de la lista. Si no está, ${words.register} primero en Configuración > ${words.tab} y descarga la plantilla otra vez.`,
  source: `Se elige de la lista: ${words.the} ${words.many} en Configuración > ${words.tab}.`,
  empty: `Todavía no hay ${words.many} en Configuración > ${words.tab}.`,
});

/** The lists of the sheet "Valores del sistema", in the order of its columns. A cell of "Casos" that chooses from one takes nothing else. */
const TEMPLATE_LISTS: TemplateList[] = [
  {
    key: 'companies',
    header: 'Empresas',
    width: 34,
    errorTitle: 'Empresa no registrada',
    ...catalogList({ one: 'una empresa', the: 'las', many: 'empresas registradas', register: 'regístrala', tab: 'Empresas' }),
  },
  {
    key: 'statuses',
    header: 'Estados',
    width: 16,
    errorTitle: 'Estado no válido',
    error: `Elige ${STATUS_OPTIONS.join(', ')}. Vacío se toma como ${STATUS_LABEL.PENDING}.`,
  },
  {
    key: 'priorities',
    header: 'Prioridades',
    width: 14,
    errorTitle: 'Prioridad no válida',
    error: `Elige ${PRIORITY_OPTIONS.join(', ')}. Vacía: el caso queda sin prioridad.`,
  },
  {
    key: 'modules',
    header: 'Módulos',
    width: 34,
    errorTitle: 'Módulo no registrado',
    ...catalogList({ one: 'un módulo', the: 'los', many: 'módulos registrados', register: 'regístralo', tab: 'Módulos' }),
  },
  {
    key: 'assignees',
    header: 'Responsables',
    width: 26,
    errorTitle: 'Responsable no registrado',
    ...catalogList({ one: 'un responsable', the: 'los', many: 'responsables registrados', register: 'regístralo', tab: 'Responsables' }),
  },
  {
    key: 'supportTypes',
    header: 'Tipos de soporte',
    width: 28,
    errorTitle: 'Tipo de soporte no registrado',
    ...catalogList({ one: 'un tipo de soporte', the: 'los', many: 'tipos de soporte registrados', register: 'regístralo', tab: 'Tipos de soporte' }),
  },
];

const TEMPLATE_RULES = [
  'No cambies los nombres de las columnas y deja "Casos" como primera hoja: es la que lee el sistema.',
  'Una fila sin Empresa o sin Descripción no se importa.',
  `Empresa, Estado, Prioridad, Módulo, Responsable y los tipos de soporte se eligen de listas. La hoja "${TEMPLATE_VALUES_SHEET}" muestra lo que había registrado al descargar la plantilla. ` +
    'Cambiar esa hoja no registra nada: lo que falte se registra en Configuración, y después se descarga la plantilla otra vez.',
  'Una fila con una empresa, un responsable, un tipo de soporte, un módulo, una prioridad o un estado que no existe en el sistema se rechaza: no se importa, y la vista previa dice cuál es y por qué. ' +
    'Al importar se puede pedir que se creen las empresas, los responsables y los tipos de soporte que falten; los módulos, las prioridades y los estados, no.',
  'Un caso puede tener varios responsables y varios tipos de soporte: usa las columnas "Otro responsable" y "Otro tipo de soporte". ' +
    'En un archivo propio, o en uno exportado de Casos, una sola celda también puede llevar varios, separados por comas o punto y coma.',
  'Un caso con la misma fecha, empresa y descripción que uno ya registrado se omite, así que importar dos veces el mismo archivo no duplica casos.',
  'La "Fecha" de la plantilla es la fecha del caso. La fecha de registro de cada caso es el momento de la importación.',
  `Las listas y los avisos de las celdas llegan hasta la fila ${TEMPLATE_ROWS + 1}. Puedes seguir más abajo: esas filas se importan igual, sin avisos.`,
];

/**
 * Puts one cell rule on a whole range of a sheet. ExcelJS types only the rule of a single cell,
 * and a column filled cell by cell is written as ranges that overlap (it sorts "A10" before "A2"),
 * which Excel does not accept. A rule stored under the range goes to the file as that one range.
 */
function addRangeRule(sheet: ExcelJS.Worksheet, range: string, rule: ExcelJS.DataValidation): void {
  (sheet as unknown as { dataValidations: { add(address: string, rule: ExcelJS.DataValidation): void } }).dataValidations.add(range, rule);
}

/**
 * The import template. It has the columns `import` reads and cell rules against the usual
 * mistakes: a date typed as text, a status worded another way, a company or a person that is not
 * registered. "Casos" is the first sheet because `import` reads that one. `values` is what the
 * catalogs offer: it fills the sheet "Valores del sistema", which the lists of "Casos" read.
 */
export function buildTemplate(values: TemplateValues): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const options: Record<ListKey, string[]> = { ...values, statuses: STATUS_OPTIONS, priorities: PRIORITY_OPTIONS };
  // What a person reads about a column. One that chooses from a catalog says where its list comes
  // from, or that nothing is registered there yet.
  const help = (column: TemplateColumn): string => {
    const list = TEMPLATE_LISTS.find((entry) => entry.key === column.list);
    const about = list && (options[list.key].length ? list.source : list.empty);
    return about ? `${column.help} ${about}` : column.help;
  };

  const sheet = workbook.addWorksheet('Casos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    // A date cell keeps what is typed as a real date, so day and month cannot be swapped on import.
    style: column.key === 'date' ? { numFmt: EXCEL_FORMAT.day } : column.key === 'time' ? { numFmt: EXCEL_FORMAT.time } : { alignment: { vertical: 'top', wrapText: true } },
  }));
  const header = sheet.getRow(1);
  paintHeader(header);
  TEMPLATE_COLUMNS.forEach((column, index) => {
    header.getCell(index + 1).note = `${column.required ? 'Obligatoria' : 'Opcional'}. ${help(column)}`;
  });

  // The values go in their own sheet: a list written inside the rule is limited to 255 characters.
  // It is in sight on purpose: besides feeding the lists, it tells the person what is registered.
  const lists = workbook.addWorksheet(TEMPLATE_VALUES_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  lists.columns = TEMPLATE_LISTS.map((list) => ({ header: list.header, width: list.width }));
  paintHeader(lists.getRow(1));
  TEMPLATE_LISTS.forEach((list, index) => {
    options[list.key].forEach((value, row) => (lists.getCell(row + 2, index + 1).value = value));
  });

  /** The cells of a column of "Casos" that carry its rule. */
  const rows = (index: number): string => {
    const letter = sheet.getColumn(index + 1).letter;
    return `${letter}2:${letter}${TEMPLATE_ROWS + 1}`;
  };
  TEMPLATE_COLUMNS.forEach((column, index) => {
    if (column.key === 'date') {
      addRangeRule(sheet, rows(index), {
        type: 'date',
        operator: 'between',
        formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2099, 11, 31))],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Fecha no válida',
        error: 'Escribe una fecha, por ejemplo 15/03/2026.',
      });
    }
    // Excel keeps a time as the part of a day that has gone by: 0 is midnight and 0.5 is noon.
    if (column.key === 'time') {
      addRangeRule(sheet, rows(index), {
        type: 'decimal',
        operator: 'between',
        formulae: [0, 0.99999],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Hora no válida',
        error: 'Escribe una hora, por ejemplo 14:35.',
      });
    }

    const list = TEMPLATE_LISTS.find((entry) => entry.key === column.list);
    const count = list ? options[list.key].length : 0;
    // A catalog with nothing registered gives no list: there are no cells to point the rule at.
    // The column takes any text, and the import rejects the rows that name what it does not know.
    if (!list || !count) return;
    const letter = lists.getColumn(TEMPLATE_LISTS.indexOf(list) + 1).letter;
    addRangeRule(sheet, rows(index), {
      type: 'list',
      formulae: [`'${TEMPLATE_VALUES_SHEET}'!$${letter}$2:$${letter}$${count + 1}`],
      allowBlank: true,
      // Strict: Excel refuses what is not in the list, as the import would reject the row.
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: list.errorTitle,
      error: list.error,
    });
  });

  const guide = workbook.addWorksheet('Instrucciones');
  guide.columns = [{ width: 22 }, { width: 13 }, { width: 110 }];
  /** Characters of a line of text across the three columns, with room to spare. */
  const GUIDE_LINE_CHARS = 125;
  const line = (text: string): ExcelJS.Row => {
    const row = guide.addRow([text]);
    guide.mergeCells(row.number, 1, row.number, 3);
    row.alignment = { vertical: 'top', wrapText: true };
    // Excel does not fit the height of a row to a merged cell: a text of several lines says how many it takes.
    const lines = Math.ceil(text.length / GUIDE_LINE_CHARS);
    if (lines > 1) row.height = lines * 15;
    return row;
  };
  line('Plantilla para importar casos de soporte').font = { bold: true, size: 14 };
  line('Llena la hoja "Casos", una fila por caso, y súbela en Casos > Importar. Antes de guardar nada verás una vista previa.');
  guide.addRow([]);
  paintHeader(guide.addRow(['Columna', 'Obligatoria', 'Qué va en ella']));
  for (const column of TEMPLATE_COLUMNS) {
    guide.addRow([column.header, column.required ? 'Sí' : 'No', help(column)]).alignment = { vertical: 'top', wrapText: true };
  }
  guide.addRow([]);
  TEMPLATE_RULES.forEach(line);

  return workbook;
}

/**
 * The spreadsheet people fill in to import cases. Its lists offer what a new case can take:
 * the active entries of each catalog, in the order the screens show them.
 */
export async function templateFile(prisma: PrismaService): Promise<Buffer> {
  const active = { where: { active: true }, select: { name: true } } as const;
  const [companies, people, types, modules] = await Promise.all([
    prisma.company.findMany(active),
    prisma.assignee.findMany(active),
    prisma.supportType.findMany(active),
    prisma.systemModule.findMany({ where: { active: true }, select: { name: true, parent: { select: { name: true } } } }),
  ]);
  // Sorted here and not by the database, whose order depends on its locale: "Ñ" after "Z", capitals first.
  const sorted = (names: string[]): string[] => names.sort((a, b) => a.localeCompare(b, 'es'));
  const names = (rows: { name: string }[]): string[] => sorted(rows.map((row) => row.name));
  const workbook = buildTemplate({
    companies: names(companies),
    modules: sorted(modules.map((module) => moduleFullName(module))),
    assignees: names(people),
    supportTypes: names(types),
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
