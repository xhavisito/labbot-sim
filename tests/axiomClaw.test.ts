/** La pinza de Axiom se anima moviendo las piezas `garra` del GLB (RobotView.findFingers): dos por lado, en z. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GLB de Axiom: dedos de la pinza', () => {
  it('trae 4 piezas `garra` (dos a cada lado) dentro del brazo', () => {
    const b = readFileSync(new URL('../public/robots/axiom.glb', import.meta.url));
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    const garra = j.nodes.filter((n: { name?: string }) => n.name === 'garra');
    expect(garra).toHaveLength(4);
    const lado = garra.map((n: { mesh: number }) => {
      const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION];
      return Math.sign((a.min[2] + a.max[2]) / 2);
    });
    expect(lado.filter((s: number) => s > 0)).toHaveLength(2);
    expect(lado.filter((s: number) => s < 0)).toHaveLength(2);
  });
});

describe('GLB de Axiom: flechas y separadores de la pinza', () => {
  const b = readFileSync(new URL('../public/robots/axiom.glb', import.meta.url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  const named = (re: RegExp) => j.nodes.filter((n: { name?: string }) => re.test(n.name ?? ''));
  it('cada costado trae un separador SPACERS GARRA por rama que debe girar con los dedos', () => {
    expect(named(/^spacers garra$/i).length).toBe(4);
  });
  it('trae las flechas verticales donde giran los dedos (una por costado a más de 7 cm del centro)', () => {
    const z = named(/^flecha posterior chasis$/i)
      .filter((n: { mesh?: number }) => n.mesh !== undefined)
      .map((n: { mesh: number }) => {
        const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION];
        return (a.min[2] + a.max[2]) / 2;
      });
    expect(z.filter((v: number) => v > 0.07).length).toBeGreaterThanOrEqual(1);
    expect(z.filter((v: number) => v < -0.07).length).toBeGreaterThanOrEqual(1);
  });
});
