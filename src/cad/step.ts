/**
 * Lector mínimo de archivos STEP (ISO 10303-21, AP203/AP214/AP242) para sacar las cajas envolventes
 * de cada pieza de un ensamble, ya colocadas en el mundo. Solo lee lo necesario (vértices del B-rep,
 * círculos y el árbol de ensamble con sus transformaciones); no triangula ni calcula volúmenes.
 * Unidades de salida: metros, en los ejes del archivo STEP (la orientación se resuelve en analyze.ts).
 */

export type Vec3 = [number, number, number];
export interface Box {
  min: Vec3;
  max: Vec3;
}
export interface StepPart {
  /** Ruta jerárquica de nombres, p. ej. "EnsambleGeneral/Chasis/Placa-1". */
  path: string;
  /** Nombre de la pieza (producto). */
  name: string;
  box: Box;
}
export interface StepModel {
  /** Metros por unidad del archivo. */
  unitScale: number;
  parts: StepPart[];
  /** Caja de todo el ensamble. */
  box: Box;
}

type Param = null | string | number | { ref: number } | { enum: string } | { typed: string; args: Param[] } | Param[];
interface Ent {
  id: number;
  /** Una entrada por tipo (las entidades complejas traen varias). */
  types: Map<string, Param[]>;
}

/* ---------- Lectura de texto ---------- */

/** Parte el DATA en entidades, respetando cadenas con ';' y comentarios. */
function splitStatements(data: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (data[i + 1] === "'") cur += data[++i];
        else inStr = false;
      }
    } else if (c === "'") {
      inStr = true;
      cur += c;
    } else if (c === '/' && data[i + 1] === '*') {
      const e = data.indexOf('*/', i + 2);
      i = e < 0 ? data.length : e + 1;
    } else if (c === ';') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  return out;
}

/** Decodifica \X2\..\X0\ y \X\hh de STEP a texto normal. */
function decodeStepString(s: string): string {
  return s
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_m, h: string) => {
      let r = '';
      for (let i = 0; i + 3 < h.length + 1; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
      return r;
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

class ParamReader {
  private i = 0;
  private s: string;
  constructor(s: string) {
    this.s = s;
  }
  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  /** Lee una lista de parámetros entre paréntesis ya abierto (consume el cierre). */
  list(): Param[] {
    const out: Param[] = [];
    this.ws();
    if (this.s[this.i] === ')') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s[this.i++];
      if (c === ')') return out;
      if (c !== ',') throw new Error('STEP: se esperaba , o )');
    }
  }
  /** Secuencia TIPO(args) TIPO(args)… de una entidad compleja. */
  typedSequence(): [string, Param[]][] {
    const out: [string, Param[]][] = [];
    for (;;) {
      this.ws();
      if (this.i >= this.s.length) return out;
      const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 80));
      if (!w) throw new Error('STEP: entidad compleja inválida');
      this.i += w[0].length;
      this.ws();
      if (this.s[this.i] !== '(') throw new Error('STEP: entidad compleja inválida');
      this.i++;
      out.push([w[0].toUpperCase(), this.list()]);
    }
  }
  value(): Param {
    this.ws();
    const c = this.s[this.i];
    if (c === "'") {
      let r = '';
      this.i++;
      for (;;) {
        const ch = this.s[this.i++];
        if (ch === undefined) throw new Error('STEP: cadena sin cerrar');
        if (ch === "'") {
          if (this.s[this.i] === "'") {
            r += "'";
            this.i++;
          } else break;
        } else r += ch;
      }
      return decodeStepString(r);
    }
    if (c === '(') {
      this.i++;
      return this.list();
    }
    if (c === '$' || c === '*') {
      this.i++;
      return null;
    }
    if (c === '#') {
      const m = /^#(\d+)/.exec(this.s.slice(this.i, this.i + 16));
      if (!m) throw new Error('STEP: referencia inválida');
      this.i += m[0].length;
      return { ref: Number(m[1]) };
    }
    if (c === '.') {
      const e = this.s.indexOf('.', this.i + 1);
      const name = this.s.slice(this.i + 1, e);
      this.i = e + 1;
      return { enum: name.toUpperCase() };
    }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.s.slice(this.i, this.i + 40));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 80));
    if (word) {
      this.i += word[0].length;
      this.ws();
      if (this.s[this.i] === '(') {
        this.i++;
        return { typed: word[0].toUpperCase(), args: this.list() };
      }
      return { enum: word[0].toUpperCase() };
    }
    throw new Error(`STEP: parámetro inesperado en "${this.s.slice(this.i, this.i + 20)}"`);
  }
}

function parseEntities(text: string): Map<number, Ent> {
  const m = /DATA\s*;([\s\S]*?)ENDSEC\s*;/i.exec(text);
  if (!m) throw new Error('STEP: no se encontró la sección DATA (¿es un archivo STEP?)');
  const ents = new Map<number, Ent>();
  for (const st of splitStatements(m[1])) {
    const h = /^#(\d+)\s*=\s*([\s\S]*)$/.exec(st);
    if (!h) continue;
    const id = Number(h[1]);
    const body = h[2].trim();
    const types = new Map<string, Param[]>();
    try {
      if (body.startsWith('(')) {
        // Entidad compleja: (TIPO1(args) TIPO2(args) ...)
        const rd = new ParamReader(body.slice(1, body.lastIndexOf(')')));
        for (const [t, args] of rd.typedSequence()) types.set(t, args);
      } else {
        const p = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(body);
        if (!p) continue;
        const rd = new ParamReader(body.slice(p[0].length));
        types.set(p[1].toUpperCase(), rd.list());
      }
    } catch {
      continue; // una entidad rara no debe tirar todo el archivo
    }
    ents.set(id, { id, types });
  }
  return ents;
}

/* ---------- Álgebra mínima ---------- */

/** Matriz 4×4 afín en columnas implícitas: [r00 r01 r02 tx; ...], guardada como 12 números por filas. */
type M = number[];
const IDENT: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function mul(a: M, b: M): M {
  const o: M = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
/** Inversa de una transformación rígida (rotación ortonormal + traslación). */
function inv(m: M): M {
  const o: M = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r];
  for (let r = 0; r < 3; r++) o[r * 4 + 3] = -(o[r * 4] * m[3] + o[r * 4 + 1] * m[7] + o[r * 4 + 2] * m[11]);
  return o;
}
function apply(m: M, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/* ---------- Acceso a entidades ---------- */

class Model {
  readonly ents: Map<number, Ent>;
  constructor(ents: Map<number, Ent>) {
    this.ents = ents;
  }
  get(p: Param | undefined): Ent | undefined {
    return p && typeof p === 'object' && !Array.isArray(p) && 'ref' in p ? this.ents.get(p.ref) : undefined;
  }
  args(e: Ent | undefined, type: string): Param[] | undefined {
    return e?.types.get(type);
  }
  vec(p: Param | undefined): Vec3 | undefined {
    const e = this.get(p);
    const a = this.args(e, 'CARTESIAN_POINT') ?? this.args(e, 'DIRECTION');
    const v = a?.[1];
    if (!Array.isArray(v) || v.length < 3) return undefined;
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  /** AXIS2_PLACEMENT_3D → matriz local→padre. */
  placement(p: Param | undefined): M {
    const a = this.args(this.get(p), 'AXIS2_PLACEMENT_3D');
    if (!a) return IDENT;
    const o = this.vec(a[1]) ?? [0, 0, 0];
    const z = norm(this.vec(a[2]) ?? [0, 0, 1]);
    let x = this.vec(a[3]);
    if (!x) x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    // Gram-Schmidt: x ⟂ z
    const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]);
    const y = cross(z, x);
    return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2]];
  }
  str(p: Param | undefined): string {
    return typeof p === 'string' ? p : '';
  }
}

function boxAdd(b: Box | null, p: Vec3): Box {
  if (!b) return { min: [...p], max: [...p] };
  for (let i = 0; i < 3; i++) {
    if (p[i] < b.min[i]) b.min[i] = p[i];
    if (p[i] > b.max[i]) b.max[i] = p[i];
  }
  return b;
}

/** Puntos (en el sistema local de la pieza) que acotan un sólido: vértices y extremos de círculos. */
function solidPoints(m: Model, brep: Ent, out: Vec3[]): void {
  const args = m.args(brep, 'MANIFOLD_SOLID_BREP') ?? m.args(brep, 'BREP_WITH_VOIDS');
  const shell = m.get(args?.[1]);
  const faces = (m.args(shell, 'CLOSED_SHELL') ?? m.args(shell, 'OPEN_SHELL'))?.[1];
  if (!Array.isArray(faces)) return;
  const seenEdges = new Set<number>();
  for (const fp of faces) {
    const f = m.get(fp);
    const fa = m.args(f, 'ADVANCED_FACE') ?? m.args(f, 'FACE_SURFACE');
    const bounds = fa?.[1];
    if (!Array.isArray(bounds)) continue;
    for (const bp of bounds) {
      const b = m.get(bp);
      const ba = m.args(b, 'FACE_OUTER_BOUND') ?? m.args(b, 'FACE_BOUND');
      const loop = m.get(ba?.[1]);
      const edges = m.args(loop, 'EDGE_LOOP')?.[1];
      if (!Array.isArray(edges)) continue;
      for (const ep of edges) {
        const oe = m.args(m.get(ep), 'ORIENTED_EDGE');
        const ecE = m.get(oe?.[3]);
        const ec = m.args(ecE, 'EDGE_CURVE');
        if (!ec || !ecE || seenEdges.has(ecE.id)) continue;
        seenEdges.add(ecE.id);
        for (const k of [1, 2]) {
          const v = m.args(m.get(ec[k]), 'VERTEX_POINT');
          const p = m.vec(v?.[1]);
          if (p) out.push(p);
        }
        // Círculos: el vértice no basta (una rueda tiene 1 solo en la costura)
        const circ = m.args(m.get(ec[3]), 'CIRCLE');
        if (circ) {
          const pl = m.placement(circ[1]);
          const r = Number(circ[2]);
          const n: Vec3 = [pl[2], pl[6], pl[10]];
          const c: Vec3 = [pl[3], pl[7], pl[11]];
          const h: Vec3 = [0, 0, 0];
          for (let i = 0; i < 3; i++) h[i] = r * Math.sqrt(Math.max(0, 1 - n[i] * n[i]));
          out.push([c[0] - h[0], c[1] - h[1], c[2] - h[2]], [c[0] + h[0], c[1] + h[1], c[2] + h[2]]);
        }
      }
    }
  }
}

/* ---------- Ensamble ---------- */

function unitScale(text: string): number {
  const conv = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/i.exec(text);
  if (conv && /LENGTH_UNIT/i.test(text) && /INCH/i.test(conv[1])) return 0.0254;
  const lu = /LENGTH_UNIT\s*\(\s*\)[\s\S]{0,120}?SI_UNIT\s*\(\s*(\.[A-Z]+\.|\$)\s*,\s*\.METRE\.\s*\)/i.exec(text);
  if (lu) {
    const p = lu[1].toUpperCase();
    return p === '.MILLI.' ? 1e-3 : p === '.CENTI.' ? 1e-2 : p === '.MICRO.' ? 1e-6 : 1;
  }
  // SolidWorks y casi todos exportan en mm; sin unidad explícita asumimos mm
  return 1e-3;
}

interface Instance {
  pd: number;
  name: string;
  xf: M;
}

/** Lee el STEP y devuelve las piezas con su caja en metros, en el sistema del ensamble raíz. */
export function parseStep(text: string): StepModel {
  const ents = parseEntities(text);
  const m = new Model(ents);
  const scale = unitScale(text);

  // product definition → nombre y representación (shape rep)
  const pdName = new Map<number, string>();
  const pdOfPds = new Map<number, number>(); // PRODUCT_DEFINITION_SHAPE → PRODUCT_DEFINITION
  const repOfPd = new Map<number, number>();
  for (const e of ents.values()) {
    const pd = e.types.get('PRODUCT_DEFINITION');
    if (pd) {
      const form = m.args(m.get(pd[2]), 'PRODUCT_DEFINITION_FORMATION') ?? m.args(m.get(pd[2]), 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE');
      const prod = m.args(m.get(form?.[2]), 'PRODUCT');
      pdName.set(e.id, m.str(prod?.[1]) || m.str(prod?.[0]) || `pieza-${e.id}`);
    }
    const pds = e.types.get('PRODUCT_DEFINITION_SHAPE');
    if (pds) {
      const r = pds[2];
      if (r && typeof r === 'object' && !Array.isArray(r) && 'ref' in r) pdOfPds.set(e.id, r.ref);
    }
  }
  for (const e of ents.values()) {
    const sdr = e.types.get('SHAPE_DEFINITION_REPRESENTATION');
    if (!sdr) continue;
    const pdsRef = sdr[0];
    const repRef = sdr[1];
    if (pdsRef && typeof pdsRef === 'object' && !Array.isArray(pdsRef) && 'ref' in pdsRef && repRef && typeof repRef === 'object' && !Array.isArray(repRef) && 'ref' in repRef) {
      const pd = pdOfPds.get(pdsRef.ref);
      if (pd !== undefined) repOfPd.set(pd, repRef.ref);
    }
  }
  const pdOfRep = new Map<number, number>();
  for (const [pd, rep] of repOfPd) pdOfRep.set(rep, pd);

  // SolidWorks pone la geometría en una ADVANCED_BREP_SHAPE_REPRESENTATION aparte, ligada a la
  // representación de la pieza por un SHAPE_REPRESENTATION_RELATIONSHIP simple (mismo origen)
  const linked = new Map<number, number[]>();
  for (const e of ents.values()) {
    const r = e.types.size === 1 ? e.types.get('SHAPE_REPRESENTATION_RELATIONSHIP') : undefined;
    const a = r?.[2] as { ref?: number } | undefined;
    const b = r?.[3] as { ref?: number } | undefined;
    if (a?.ref === undefined || b?.ref === undefined) continue;
    (linked.get(a.ref) ?? linked.set(a.ref, []).get(a.ref)!).push(b.ref);
    (linked.get(b.ref) ?? linked.set(b.ref, []).get(b.ref)!).push(a.ref);
  }

  // sólidos por representación (local, sin transformar)
  const localPts = new Map<number, Vec3[]>();
  const pointsOfRep = (rep: number): Vec3[] => {
    let v = localPts.get(rep);
    if (v) return v;
    v = [];
    for (const l of [rep, ...(linked.get(rep) ?? [])]) ownPoints(l, v);
    localPts.set(rep, v);
    return v;
  };
  const ownPoints = (rep: number, v: Vec3[]): void => {
    const e = ents.get(rep);
    const a = e && (e.types.get('SHAPE_REPRESENTATION') ?? e.types.get('ADVANCED_BREP_SHAPE_REPRESENTATION') ?? e.types.get('MANIFOLD_SURFACE_SHAPE_REPRESENTATION'));
    const items = a?.[1];
    if (Array.isArray(items)) {
      for (const it of items) {
        const s = m.get(it);
        if (s && (s.types.has('MANIFOLD_SOLID_BREP') || s.types.has('BREP_WITH_VOIDS'))) solidPoints(m, s, v);
        else if (s?.types.has('MAPPED_ITEM')) {
          /* instancias por MAPPED_ITEM: se resuelven abajo */
        }
      }
    }
  };

  // aristas del árbol: NAUO (padre → hijo) con su transformación
  const children = new Map<number, Instance[]>();
  const isChild = new Set<number>();
  const nauoPds = new Map<number, number>(); // PRODUCT_DEFINITION_SHAPE de un NAUO → NAUO id
  for (const e of ents.values()) {
    const pds = e.types.get('PRODUCT_DEFINITION_SHAPE');
    const r = pds?.[2];
    if (pds && r && typeof r === 'object' && !Array.isArray(r) && 'ref' in r && ents.get(r.ref)?.types.has('NEXT_ASSEMBLY_USAGE_OCCURRENCE')) nauoPds.set(e.id, r.ref);
  }
  const xfOfNauo = new Map<number, M>();
  for (const e of ents.values()) {
    const cd = e.types.get('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION');
    if (!cd) continue;
    const rel = m.get(cd[0]);
    const pdsE = m.get(cd[1]);
    const nauoId = pdsE ? nauoPds.get(pdsE.id) : undefined;
    const nauo = nauoId ? ents.get(nauoId)?.types.get('NEXT_ASSEMBLY_USAGE_OCCURRENCE') : undefined;
    if (!rel || !nauo || nauoId === undefined) continue;
    const rep = rel.types.get('REPRESENTATION_RELATIONSHIP');
    const tr = rel.types.get('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION');
    const rep1 = (rep?.[2] as { ref?: number } | undefined)?.ref;
    const itx = m.get(tr?.[0]);
    const idt = itx?.types.get('ITEM_DEFINED_TRANSFORMATION');
    if (!idt) continue;
    const A = m.placement(idt[2]);
    const B = m.placement(idt[3]);
    const childPd = (nauo[4] as { ref: number }).ref;
    const childRep = repOfPd.get(childPd);
    // si rep_1 es el hijo: p_padre = B·A⁻¹·p_hijo; si es el padre: p_padre = A·B⁻¹·p_hijo
    const rep1IsChild = rep1 !== undefined && childRep === rep1;
    xfOfNauo.set(nauoId, rep1IsChild ? mul(B, inv(A)) : mul(A, inv(B)));
  }
  for (const e of ents.values()) {
    const n = e.types.get('NEXT_ASSEMBLY_USAGE_OCCURRENCE');
    if (!n) continue;
    const parent = (n[3] as { ref: number }).ref;
    const child = (n[4] as { ref: number }).ref;
    const list = children.get(parent) ?? [];
    list.push({ pd: child, name: pdName.get(child) || m.str(n[1]) || `pieza-${child}`, xf: xfOfNauo.get(e.id) ?? IDENT });
    children.set(parent, list);
    isChild.add(child);
  }

  // raíz: producto con hijos que nadie usa; si no hay ensamble, todas las piezas sueltas
  const roots = [...pdName.keys()].filter((pd) => !isChild.has(pd) && (children.has(pd) || repOfPd.has(pd)));
  const rootPds = roots.filter((pd) => children.has(pd));
  const starts = rootPds.length ? [rootPds[0]] : roots;

  const parts: StepPart[] = [];
  let guard = 0;
  const walk = (pd: number, xf: M, path: string, depth: number): void => {
    if (++guard > 20000 || depth > 24) return;
    const rep = repOfPd.get(pd);
    const pts = rep !== undefined ? pointsOfRep(rep) : [];
    const kids = children.get(pd) ?? [];
    if (pts.length && !kids.length) {
      let b: Box | null = null;
      for (const p of pts) b = boxAdd(b, apply(xf, p));
      if (b) parts.push({ path, name: pdName.get(pd) ?? path, box: scaleBox(b, scale) });
    }
    for (const k of kids) walk(k.pd, mul(xf, k.xf), `${path}/${k.name}`, depth + 1);
  };
  for (const s of starts) walk(s, IDENT, pdName.get(s) ?? 'ensamble', 0);

  let all: Box | null = null;
  for (const p of parts) {
    all = boxAdd(all, p.box.min);
    all = boxAdd(all, p.box.max);
  }
  if (!all) throw new Error('STEP: no se encontró geometría sólida (MANIFOLD_SOLID_BREP) en el archivo');
  return { unitScale: scale, parts, box: all };
}

function scaleBox(b: Box, s: number): Box {
  return { min: [b.min[0] * s, b.min[1] * s, b.min[2] * s], max: [b.max[0] * s, b.max[1] * s, b.max[2] * s] };
}
