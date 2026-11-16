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
(0.95 m) la garra sale más de 40 cm del chasis en algunas posiciones (§7.2 pide ≤40 cm).

## Brazo de Psycho (pivote que da vuelta)
- Frente = lado contrario a la garra: `forward` es donde suelta (L1–L3); `pickBack` hace que recoja atrás (piso) y suelte
  adelante, girando el brazo por abajo. Pose de piso = pose del CAD (`stowAngle`, `floorHeight`).
- `holdsTwo`/`capacity 2` + `intake.rollers`: garra-caja con rodillos que jalan la Muestra por fricción (`ROLLERS` en `game/Mechanisms.ts`); lleva dos en fila sobre el eje de la boca (la segunda asoma 4.5 cm). Al subir el brazo la caja queda boca abajo y la fila se ve vertical, como en las fotos del robot real.
- `footprint`: el chasis es un compuesto de cajas (rieles + travesaño trasero) para que las Muestras entren al canal vacío.

## Lo que el STEP no dice (SUPUESTO)
Masa, velocidades, tracción, alturas de los niveles del elevador y velocidad angular salen del preset. Cada archivo
lista en `supuestos` lo que se dedujo; corrige con `--mass`/`--set`. El eje vertical y el frente se detectan o se
fijan con `--up`/`--forward` (el piso es la pieza más baja del ensamble).

Probado con el ensamble real del equipo (114 piezas, ~48 MB, 4 s). El STEP no se versiona; sí el `.robot.json`.

## Phoenix (robot lanzador, 16-nov)
Importado con `npm run robot:import -- EnsambleCoregido.STEP --name Phoenix --up z --forward +x --static`
(`--static` = GLB completo sin brazo que gira; el detector de eje vertical se equivocó con este CAD, hay que fijarlo con `--up z`).
**Del CAD:** chasis 0.668 × 0.64 × 0.73 m; 6 llantas HiGrip de 6 in (3 por lado); huella a ras de piso con el canal trasero abierto
(0.446 m); rampa de rodillos compliant de 3 in a **66.4°** y su boca de salida (x 0.0125 m, y 0.6175 m) → `intake.shooter` (`ShooterSpec`).
Los lanza por `game/shooter.ts`: la velocidad se acomoda a la distancia al pozo y cada tiro varía un poco; el rumbo es el del robot.
**SUPUESTOS (a revisar con Xhavi, 16-nov "déjalo como supuesto, lo arreglamos después"):** por dónde y cómo recoge (por el canal
trasero a ras de piso, con la garra del simulador: `arm.rearClaw`), cuántas Muestras lleva (1), sin Muestra Crítica, velocidad máxima de salida
(6.5 m/s), variación por tiro (4 % velocidad, 1.4° rumbo), masa y velocidades de manejo (preset), y qué placas toman el color de la alianza.
El modelo es estático: no se sabe qué piezas se mueven, así que las llantas no giran en pantalla.

## Axiom (16-nov, garra con pivote 180°)
Importado de `ensamble comp interna.STEP` (83 piezas, AP214) con
`npm run robot:import -- <STEP> --name Axiom --mechanism pivot180 --up y --forward +z --floor 0.1066 --arm-above 0.2 --arm-parts '^garra' --min-diag 0.01 --max-tris 6000`
y luego se ajustó a mano el JSON. Opciones nuevas del importador: `--floor` (piso del CAD: las cajas de las llantas se pasan), `--arm-above` (las piezas con el centro a esa altura o más son el brazo: este CAD no nombra el brazo),
`--min-diag` y `--max-tris` (detalle del modelo). Con varias flechas, el eje del brazo es la que dice "pivote". `model.staticWheels`: el modelo ya trae las llantas del CAD, el simulador no dibuja las suyas.
**Del CAD:** chasis 0.561 × 0.651 m (el largo son los 56 cm de Xhavi); 4 llantas HiGrip de 6 in; eje del brazo a 0.24 m del piso y 0.173 m detrás del centro; brazo de 0.6246 m; garra de pinza al frente de 0.12 m de fondo. La forma 3D es la del CAD tal cual (motores y engranes simplificados, tornillos de menos de 1 cm quitados).
**SUPUESTOS (a revisar con Xhavi):** el STEP es una sola pose y no dice cuánto gira el brazo: se toma "pivote 180°" de Xhavi; la garra es el frente, así que recoge y anota al frente (con `pickBack` la garra quedaría a 47 cm del chasis, > 40 cm, §7.2);
pose de inicio a 60° (el CAD está a 38° y ahí la garra sale 7 cm del perímetro, §4.1); alturas N1–N3 del preset de pivote; pinza de 0.23 m de apertura y capacidad 1; qué piezas giran con el brazo (las que están a 20 cm del piso o más); placas frontal/posterior con el color de la alianza; llantas estáticas; masa y velocidades del preset.
El ancho del CAD (0.651 m) pasa 65 cm (§7.2): el menú lo marca con ⚠.
