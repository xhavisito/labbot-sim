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
