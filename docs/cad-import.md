# Robots desde CAD

El simulador lee robots reales a partir de un **STEP** del ensamble. Nadie más tiene que convertir nada a mano:
el pipeline lo corre quien mantiene el repositorio.

## Flujo
1. En SolidWorks: *Guardar como → STEP AP214* del ensamble completo (`EnsambleGeneral.STEP`). Los `.SLDASM` no se pueden leer.
2. Deja el archivo en `robots/inbox/` (o pásalo por ruta) y corre:
   ```
   npm run robot:import -- ruta/EnsambleGeneral.STEP --name Psycho --mass 38
   ```
   Sin ruta procesa todo `robots/inbox/`. Opciones: `--up x|y|z|auto` (por defecto `y`), `--forward +x|-z|auto`,
   `--mechanism generic|elevator|pivot`, `--mass kg`, `--set arm.pivotY=0.45` (repetible), `--dry`.
3. Se escribe `robots/<nombre>.robot.json`. `src/cad/cadRobots.ts` lo registra solo (`CAD_ROBOT_SPECS`) y se valida contra §7.2.

## Qué extrae
- Lector propio de STEP (`src/cad/step.ts`): árbol de ensamble con transformaciones, unidades (mm/in/m), vértices y círculos del B-rep → caja envolvente por pieza.
- `src/cad/analyze.ts` clasifica las piezas por nombre (`Chasis-*`, `Garra*`, `Pivote-*`/`Brazo-*`, `Flecha*`/`Eje*`):
  - largo, ancho y alto del chasis; altura de la estructura fija (incluye torre del pivote);
  - extensión y ancho de la garra/intake;
  - mecanismo `pivot`: pivote = centro de la flecha, largo = del pivote al centro de la garra.

## Forma real (GLB)
El mismo comando triangula el STEP (occt-import-js, WASM de OpenCascade) y escribe `public/robots/<nombre>.glb`:
unidades en m, x al frente, y arriba desde el piso. Se quitan tornillos y piezas de menos de 3.5 cm y se simplifican
motores y engranes; las placas del chasis, torre, brazo y garra se dejan completas. Salen dos nodos: `estatico` y
`brazo` (con origen en el eje del pivote). El simulador dibuja ese modelo en vez del robot genérico: el brazo gira en
el pivote, parte de la pose del CAD (`stowAngle`) y las piezas `Chasis-Frontal/Trasero` toman el color de la alianza.
La garra va rígida al brazo, como en el CAD (se inclina con él). `--arm-parts REGEX` cambia qué piezas giran;
`--no-model` solo genera los números.

## Límites de §7.2
`robots/*.robot.json` se registra aunque pase un límite; el menú avisa con ⚠ cuál. Psycho: con el brazo real
(0.83 m) la garra sale ~46 cm del chasis en N3 (§7.2 pide ≤40 cm).

## Lo que el STEP no dice (SUPUESTO)
Masa, velocidades, tracción, alturas de los niveles del elevador y velocidad angular salen del preset. Cada archivo
lista en `supuestos` lo que se dedujo; corrige con `--mass`/`--set`. El eje vertical y el frente se detectan o se
fijan con `--up`/`--forward` (el piso es la pieza más baja del ensamble).

Probado con el ensamble real del equipo (114 piezas, ~48 MB, 4 s). El STEP no se versiona; sí el `.robot.json`.
