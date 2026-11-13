/** Genera un STEP de ensamble sintético (cajas y un cilindro) para probar el importador sin CAD real. */
export interface FixturePart {
  name: string;
  /** Cajas en coordenadas locales (mm): [x0,y0,z0,x1,y1,z1]. */
  boxes: [number, number, number, number, number, number][];
  /** Posición de la pieza en el ensamble (mm). */
  at: [number, number, number];
  /** Ruedas: cilindros de eje Z, centro local (mm) y radio. */
  wheels?: { c: [number, number, number]; r: number }[];
}

export function buildStep(root: string, parts: FixturePart[], unit: 'MM' | 'IN' = 'MM'): string {
  const lines: string[] = [];
  let n = 0;
  const add = (body: string): number => {
    lines.push(`#${++n}=${body};`);
    return n;
  };
  const num = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));
  const pt = (p: number[]): number => add(`CARTESIAN_POINT('',(${p.map(num).join(',')}))`);
  const dir = (p: number[]): number => add(`DIRECTION('',(${p.map(num).join(',')}))`);
  const axis = (o: number[]): number => add(`AXIS2_PLACEMENT_3D('',#${pt(o)},#${dir([0, 0, 1])},#${dir([1, 0, 0])})`);
  const ctx = add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#0)) REPRESENTATION_CONTEXT('','') )`);
  add(unit === 'MM' ? `( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )` : `( CONVERSION_BASED_UNIT('INCH',#0) LENGTH_UNIT() NAMED_UNIT(*) )`);
  const appCtx = add(`APPLICATION_CONTEXT('')`);
  const pdCtx = add(`PRODUCT_DEFINITION_CONTEXT('',#${appCtx},'design')`);

  const product = (name: string): { pd: number; pds: number } => {
    const p = add(`PRODUCT('${name}','${name}','',(#${appCtx}))`);
    const form = add(`PRODUCT_DEFINITION_FORMATION('','',#${p})`);
    const pd = add(`PRODUCT_DEFINITION('design','',#${form},#${pdCtx})`);
    const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
    return { pd, pds };
  };
  const rep = (items: number[], pds: number): number => {
    const r = add(`SHAPE_REPRESENTATION('',(${items.map((i) => `#${i}`).join(',')}),#${ctx})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${r})`);
    return r;
  };

  const boxSolid = (b: number[]): number => {
    const [x0, y0, z0, x1, y1, z1] = b;
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ].map((p) => add(`VERTEX_POINT('',#${pt(p)})`));
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const e = E.map(([a, c]) => add(`EDGE_CURVE('',#${v[a]},#${v[c]},$,.T.)`));
    const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 9, 4, 8], [1, 10, 5, 9], [2, 11, 6, 10], [3, 8, 7, 11]];
    const faces = F.map((es) => {
      const oes = es.map((i) => add(`ORIENTED_EDGE('',*,*,#${e[i]},.T.)`));
      const loop = add(`EDGE_LOOP('',(${oes.map((o) => `#${o}`).join(',')}))`);
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      return add(`ADVANCED_FACE('',(#${bound}),$,.T.)`);
    });
    const shell = add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}))`);
    return add(`MANIFOLD_SOLID_BREP('',#${shell})`);
  };
  /** Cilindro de eje Z: una cara lateral con un solo vértice por círculo (como en un CAD real). */
  const wheelSolid = (c: number[], r: number): number => {
    const mk = (z: number): number => {
      const vp = add(`VERTEX_POINT('',#${pt([c[0] + r, c[1], z])})`);
      const circle = add(`CIRCLE('',#${axis([c[0], c[1], z])},${num(r)})`);
      const ec = add(`EDGE_CURVE('',#${vp},#${vp},#${circle},.T.)`);
      const oe = add(`ORIENTED_EDGE('',*,*,#${ec},.T.)`);
      const loop = add(`EDGE_LOOP('',(#${oe}))`);
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      return add(`ADVANCED_FACE('',(#${bound}),$,.T.)`);
    };
    const shell = add(`CLOSED_SHELL('',(#${mk(c[2] - 20)},#${mk(c[2] + 20)}))`);
    return add(`MANIFOLD_SOLID_BREP('',#${shell})`);
  };

  const rootP = product(root);
  const rootRep = rep([axis([0, 0, 0])], rootP.pds);
  for (const part of parts) {
    const p = product(part.name);
    const solids = [...part.boxes.map(boxSolid), ...(part.wheels ?? []).map((w) => wheelSolid(w.c, w.r))];
    const partOrigin = axis([0, 0, 0]);
    const partRep = rep([partOrigin, ...solids], p.pds);
    const nauo = add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${part.name}-1','${part.name}-1','',#${rootP.pd},#${p.pd},$)`);
    const nauoPds = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
    const dst = axis(part.at);
    const itx = add(`ITEM_DEFINED_TRANSFORMATION('','',#${partOrigin},#${dst})`);
    const rel = add(`( REPRESENTATION_RELATIONSHIP('','',#${partRep},#${rootRep}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${itx}) SHAPE_REPRESENTATION_RELATIONSHIP() )`);
    add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${nauoPds})`);
  }
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('prueba'),'2;1');\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/**
 * Robot de ejemplo (mm, Y arriba, frente +X): chasis 600×600×100 sobre ruedas de r=50 (piso en y=0,
 * ruedas centradas en el eje Z a ±250), un brazo pivote y una garra al frente.
 * Eje del archivo: x = adelante, y = arriba, z = lateral. La caja del chasis va de z=-300 a 300.
 */
export function sampleRobotStep(unit: 'MM' | 'IN' = 'MM'): string {
  return buildStep(
    'EnsambleGeneral',
    [
      { name: 'Chasis', boxes: [[-300, 50, -300, 300, 150, 300]], at: [0, 0, 0], wheels: [{ c: [-200, 50, 280], r: 50 }, { c: [200, 50, 280], r: 50 }] },
      { name: 'Pivote-Brazo', boxes: [[0, 0, -20, 600, 40, 20]], at: [-50, 450, 0] },
      { name: 'Garra', boxes: [[0, 0, -75, 100, 60, 75]], at: [550, 410, 0] },
    ],
    unit,
  );
}
