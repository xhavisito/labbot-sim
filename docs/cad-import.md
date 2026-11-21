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
   `--mechanism generic|elevator|pivot`, `--skip REGEX` (piezas que no van al GLB: las llantas que el simulador dibuja y gira), `--mass kg`, `--set arm.pivotY=0.45` (repetible), `--dry`.
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
(5 m/s), variación por tiro (4 % velocidad, 1.4° rumbo), masa y velocidades de manejo (preset), y qué placas toman el color de la alianza.
El modelo es estático: no se sabe qué piezas se mueven, así que las llantas no giran en pantalla.

## Hitbox por pieza (16-nov)
`node scripts/cad/hitboxes.mjs phoenix psycho axiom` lee el GLB y escribe `spec.hitboxes` en `robots/<nombre>.robot.json`: un casco convexo
(≤26 puntos) por cada pieza física fija del nodo `estatico`, con grosor mínimo de 1 cm para las placas (una Muestra rápida no las
atraviesa; el CCD del cuerpo y de las Muestras hace el resto). `RobotPhysics` los crea sin masa (no mueven el centro de masa) y,
con ellos, ya no crea la torre genérica inventada. Se saltan las llantas de tracción (cilindros de `spec.wheel`) y lo que ya cubre el chasis bajo (Axiom: todo su chasis ya está en la huella, sin hitboxes extra; un hitbox de más en su lado +z dejaba a la IA sin anotar).
Las piezas del brazo de Psycho siguen con los colisionadores del brazo. **SUPUESTO:** qué piezas cuentan como "físicas".
Volver a correrlo después de `robot:import`. Axiom (PR #137) también.
**Phoenix:** el intake va fijo al piso: ya no hereda del preset de elevador la pose "guardada" a 0.5 m (`specFromRobotFile`).

## Axiom (16-nov, garra con pivote 180°)
Importado de `ensamble comp interna.STEP` (83 piezas, AP214) con
`npm run robot:import -- <STEP> --name Axiom --mechanism pivot180 --up y --forward +z --floor 0.1066 --arm-above 0.2 --arm-parts '^garra' --min-diag 0.01 --max-tris 6000`
y luego se ajustó a mano el JSON. Opciones nuevas del importador: `--floor` (piso del CAD: las cajas de las llantas se pasan), `--arm-above` (las piezas con el centro a esa altura o más son el brazo: este CAD no nombra el brazo),
`--min-diag` y `--max-tris` (detalle del modelo). Con varias flechas, el eje del brazo es la que dice "pivote". `model.staticWheels`: el modelo ya trae las llantas del CAD, el simulador no dibuja las suyas.
**Del CAD:** chasis 0.561 × 0.651 m (el largo son los 56 cm de Xhavi); 4 llantas HiGrip de 6 in; eje del brazo a 0.24 m del piso y 0.173 m detrás del centro; brazo de 0.6246 m; garra de pinza al frente de 0.12 m de fondo. La forma 3D es la del CAD tal cual (motores y engranes simplificados, tornillos de menos de 1 cm quitados).
**SUPUESTOS (a revisar con Xhavi):** el STEP es una sola pose y no dice cuánto gira el brazo: se toma "pivote 180°" de Xhavi; la garra es el frente, así que recoge y anota al frente (con `pickBack` la garra quedaría a 47 cm del chasis, > 40 cm, §7.2);
pose de inicio a 60° (el CAD está a 38° y ahí la garra sale 7 cm del perímetro, §4.1); alturas N1–N3 del preset de pivote; pinza de 0.23 m de apertura y capacidad 1; qué piezas giran con el brazo (las que están a 20 cm del piso o más); placas frontal/posterior con el color de la alianza; llantas estáticas; masa y velocidades del preset.
El ancho del CAD (0.651 m) pasa 65 cm (§7.2): el menú lo marca con ⚠.

## Axiom: pinza sin rodillos (16-nov)
Los cilindros verdes (rodillos de Psycho) ya no se dibujan en robots con `intake.kind: "pinza"`. La garra del CAD (las 4 piezas `garra`, dos por lado) se
separa y se junta en z: abierta = `intake.gap`, cerrada = Muestra (0.15 m) o Crítica (0.20 m). SUPUESTO: el STEP trae una sola pose, así que apertura, rango y velocidad
(`closeTime`) no son del CAD.

**Phoenix, varias Muestras (16-nov):** la capacidad ya no es 1: `shooterCapacity` (`config/robot.ts`) cuenta cuántas Muestras de 15 cm (§4.1.1) caben en fila
por la rampa, del pie (x −0.2 m) a la boca (4 hoy), y `specFromRobotFile` la pone en `capacity` con `holdsTwo`. SUPUESTO (el manual no habla de lanzar):
cada Muestra de más le quita 10 % a la velocidad máxima del tiro (`ShooterSpec.loadPenalty`, `maxSpeedFor` en `game/shooter.ts`); la velocidad que pide la distancia
se respeta mientras alcance, así que cargado hay que tirar más cerca.

**Phoenix, tiro flojo y pase de la Crítica (16-nov):** `maxSpeed` baja de 6.5 a 5 m/s (SUPUESTO de Xhavi: "no dispara tanto"). La velocidad sigue acomodándose a la
distancia (`solveSpeed`), pero con 5 m/s ya no alcanza a N3 más allá de ~1.6 m (con 4 Muestras, 3.5 m/s: solo de muy cerca), así que solo anota de cerca y no hay regla de zona.
`ShooterSpec.passSpeed` (20-nov, sustituye al pase de la Crítica, que Phoenix ya no toma): sin nivel elegido (N0), soltar una Muestra normal la lanza en arco (hasta 12 m/s, SUPUESTO de Xhavi) hacia la plataforma junto a la Repisa de su alianza (`PASS_TARGET` 0.7 m del centro) desde cualquier punto de la cancha; lo que no alcanza cae más cerca. No la anota; la IA no lo usa.

**Phoenix, giro al disparar (16-nov):** `ShooterSpec.spin` (30 rad/s hacia atrás, ±25 %) es SUPUESTO de Xhavi («en las pruebas reales gira mucho»); `Mechanisms.release` se lo pone a la pieza al salir (antes salía sin giro, «tiesa»).

## Psycho: garra de la Crítica (16-nov)
Nuevo STEP (`EnsambleGeneral 2.STEP`): el robot es el mismo con una garra más para la Muestra Crítica, la **Garrita**, y costillas nuevas en el brazo
(`Brazo-SoporteIn`, `Brazo-Tras`, `CosadelSprocket`); el brazo giró 0.3° (`stowAngle` −1.9687 → −1.9636) y las llantas HiGrip ya vienen en el CAD (no van al GLB: el simulador dibuja las suyas).
Importado con `--name Psycho --up y --forward +x --mechanism pivot --mass 40 --floor -0.09525 --skip '^(6 wheel|Llanta)' --arm-parts '^(Brazo|Garra|Soporte-BrazoGarra|Sprocket|Flecha 25|CosadelSprocket)'`
(`--floor` = la base del chasis, para no mover el marco ahora que hay llantas; `--arm-parts` deja las flechas de los dedos fuera del brazo) y luego se fusionó a mano en el JSON
(el analizador ya no confunde las flechas de 10 cm de los dedos con el eje del brazo) y se corrió `hitboxes.mjs psycho` (18 hitboxes, con placa, soportes, flechas y dedos de la Garrita).
**Del CAD:** placa `Garrita-Suelo` (11 × 23 cm, a ras del frente del chasis, cara de arriba a 69.8 cm de la base), dos soportes bajo ella, dos dedos `Garrita-Garrita` de 28.5 cm sobre sus flechas verticales (x 26.4 cm, z ±5.1 cm).
**SUPUESTOS (a revisar con Xhavi):** `IntakeSpec.critClaw` (`robots/psycho.robot.json`): el cubo queda con su cara de atrás en el borde de los dedos (centro a x 38 cm, y 79.8 cm; sobresale 16 cm del frente); cada dedo gira 40° sobre su flecha hacia el frente al cerrar (el CAD es una sola pose: la abierta; solo es dibujo, el hitbox queda en la pose abierta);
toma la Crítica al llegar de frente (centro entre 32 y 44 cm del robot, ±10 cm de lado, hasta 14 cm abajo del asiento: la rendija queda 12 cm más abajo y la sube), cierra al instante y la suelta en el mismo lugar. Va aparte de la caja del brazo: lleva Muestras y la Crítica a la vez.
El Human Player desliza la Crítica hacia el robot que va de frente a la rendija (como con la garra a su altura de los demás). La IA la toma y la deja en la Repisa subiendo de frente a la Plataforma (`posDir/posTip(…, 4)` apuntan al asiento).

**Phoenix y el agarre «Preciso» (16-nov):** con el ajuste Agarre = Preciso (cubo centrado a ±4.5 cm, derecho y casi parado, `GRIP`) Phoenix no agarraba nada manejando con control; como sus compliants jalan el cubo al canal rodando, ahí cuenta como Compliants (`Mechanisms.runClaw`, SUPUESTO). «Fácil» y «Compliants» no cambian.

**Phoenix, sin ruedas verdes ni falla de garra (17-nov):** se quitó el dibujo de los rodillos verdes que giraban (`RobotView.buildShooterRollers`, ruedas `am-3945`/`am-3949`): las ruedas vuelven a los colores del CAD y quietas; las flechas siguen negras. Phoenix no tiene garra ni brazo que se mueva, así que no sufre «garra atascada» ni «brazo lento» (`NO_CLAW_BLOCKED` en `core/damage.ts`); solo puede quedar con la transmisión débil.

- Phoenix, intake (17-nov, Xhavi): con el intake prendido solo giran las ruedas de abajo (las dos flechas más bajas, entre las que entra la Muestra); al disparar giran todas. La Muestra tomada ya no aparece de golpe: entra desde el piso por detrás de la boca, inclinada, y se acomoda en su lugar de la rampa en ~0.4 s (solo dibujo, SUPUESTO; la física no cambia).

- Phoenix, disparo continuo (17-nov, Xhavi): es un lanzador, así que manteniendo presionado el botón de soltar (K / B del control / el botón táctil con el dedo encima) van saliendo todas las Muestras solas, una cada 0.35 s (`EJECT_COOLDOWN`, SUPUESTO); al soltar el botón se detiene y las que quedan se quedan guardadas. La Crítica solo sale con un toque (no sigue con las Muestras). Los demás robots siguen con un toque = una pieza.

- Phoenix, almacén (17-nov, Xhavi): las Muestras guardadas se dibujan juntas hacia la boca (la más vieja arriba); al tirar sale la de arriba y las demás suben un lugar, y la que entra se forma abajo de la fila. Solo dibujo: las Muestras guardadas siguen siendo un contador lógico (sin cuerpo físico), así que el gameplay no cambia.

## Hazmat 704 (17-nov, elevador con intake de compliants)
Equipo Hazmat 704 (Instagram hazmat_704; logo en `public/logos/hazmat-704.png`, recortado de la captura de Xhavi). Importado de `Ensamble del robot.STEP` (94 piezas, AP214) con
`npm run robot:import -- <STEP> --name "Hazmat 704" --mechanism elevator --up y --forward -x --floor -0.138 --mass 40 --arm-parts '^(Intake|WCP-0764|Iman Magnetic)' --arm-max-h 0.2 --set arm.pivotX=0.202 --set arm.pivotY=0.4 --set arm.length=0.4 --set arm.speed=3.8 --set arm.stowAngle=-1.5708 --set floorHeight=0.02`
y luego a mano: huella, llantas, intake y alturas del JSON, y `node scripts/cad/hitboxes.mjs hazmat-704`.
Opción nueva `--arm-max-h m`: con `--arm-parts`, solo cuentan como brazo las piezas con el centro a m del piso o menos (el carro de abajo, no las piezas del mismo nombre arriba). Ojo: los nombres que usa `--arm-parts` son los de los **subensambles** del STEP (`Intake`, `Elevador`, `Rueda`…), no los de cada pieza.
Elevador con modelo: el nodo `brazo` (el carro del intake) sube recto con la punta (`RobotView`, rama `arm.linear`).
**Del CAD:** chasis 0.654 × 0.65 m contando los compliants; 4 llantas de 6 in (2 por lado); torre de 0.9 m con el carro por su cara de enfrente; 1.013 m de alto; 4 compliants de 3 in de eje vertical (claro de 0.127 m entre ruedas); recorrido del carro ≈ 0.8 m (sensores de límite inferior y superior). El CAD pasa de 65 cm de largo y de 100 cm de alto (§7.2): el menú lo marca con ⚠.
**SUPUESTOS:** capacidad 1, sin Muestra Crítica, alturas N1/N2 (preset de elevador), N3 = 0.8 m (tope del recorrido), velocidad del carro, apertura 0.16 m y fondo 0.21 m de la garra, masa 40 kg, qué placas toman el color de la alianza y qué es "físico" para los hitboxes. Cada uno está en `supuestos` del JSON.

## Axiom: componentes internos y colores (18-nov, solo visual)
`ensamble comp interna.STEP` nuevo (534 sólidos): además del chasis y el brazo trae los componentes internos (cajas `Transmición CIM` con motores CIM, `MAXPlanetary 2-Stage`, `versa 90`, `REV-21-2120`, `flecha versa`, espaciadores de la garra).
Solo se regeneró `public/robots/axiom.glb`: el envolvente (x −0.281…0.551, y −0.064…0.443, z ±0.326), el chasis, el brazo y la garra quedan en las mismas coordenadas, y `robots/axiom.robot.json` (huella, hitboxes, brazo, supuestos) **no cambia**: gameplay y física igual.
```
node scripts/cad/import.mjs "<STEP>" --name Axiom --mechanism pivot180 --up y --forward +z --floor 0.1066 --arm-above 0.2 --arm-parts '^garra' --min-diag 0.01 --max-tris 6000 --rules scripts/cad/rules/axiom.json
```
(y no se conserva el JSON nuevo: se restaura el de git; el importador reescribe el `.robot.json`.)
**Colores:** el STEP solo exporta el gris por defecto de SolidWorks (no hay colores por pieza), así que `--rules` (`scripts/cad/rules/axiom.json`) pinta por nombre de pieza según las capturas del CAD: engranes `WCP-0783/0172` dorados, motores y cajas negros, poleas `HTD` azul oscuro, llantas y catarina negras. SUPUESTO: el color de cada familia; también fija un tope de triángulos para los internos (192 mil en total, 4.6 MB).

## Hazmat 704: ensamble nuevo y colores (18-nov, solo visual)
`Ensamble del robot 2.STEP` (164 piezas): mismo robot, con los componentes internos (motores CIM y cajas `Toughbox` de la transmisión, poleas, llantas con su `tread`, motor del carro). Solo se regeneró `public/robots/hazmat-704.glb`; `robots/hazmat-704.robot.json` **no cambia** (gameplay, física, reglas e hitboxes igual; el modelo es ~1.2 cm más ancho por lado que la huella).
```
node scripts/cad/import.mjs "<STEP>" --name "Hazmat 704" --mechanism elevator --up y --forward -x --floor -0.138 --mass 40 --arm-parts '^(Intake|WCP-0764|Iman Magnetic)' --arm-max-h 0.2 --set arm.pivotX=0.202 --set arm.pivotY=0.4 --set arm.length=0.4 --set arm.speed=3.8 --set arm.stowAngle=-1.5708 --set floorHeight=0.02 --min-diag 0.01 --max-tris 2500 --rules scripts/cad/rules/hazmat-704.json
git checkout robots/hazmat-704.robot.json   # el importador reescribe el JSON: se restaura el de git
```
**Colores:** el STEP no trae colores por pieza, así que `--rules` pinta por nombre (ahora también por el nombre del sólido, `meshNames` en `glb.mjs`): motores CIM, cajas `Toughbox`, `TM Housing`, banda de las llantas, poleas y motor del carro en negro (como en las capturas del CAD de Xhavi). Los 4 compliants (rodillos) son piezas sin nombre dentro de `Intake`: los pinta `RobotView.buildCadRollers` en negro y los anima. SUPUESTO: el tono de cada familia. No se pudo colorear el motor del elevador (arriba de la torre): va dentro de la pieza `Lateral del elevador con motor`.

## Psycho: componentes internos y colores (18-nov, solo visual)
`EnsambleGeneral 3.STEP` nuevo (149 piezas): trae lo mismo de antes más los componentes internos (motores `Kraken X60`, cajas `Versa5-1`/`VersaInput`/`VersaOuput`). El envolvente (x −0.491…0.32, y hasta 0.975, z ±0.33), el chasis, el brazo y la garra quedan en las mismas coordenadas: solo se regeneró `public/robots/psycho.glb`; `robots/psycho.robot.json` (huella, hitboxes, brazo, supuestos) **no cambia** (el importador lo reescribe: se restaura el de git). Los rodillos verdes los dibuja el simulador (no están en el GLB) y siguen igual.
```
node scripts/cad/import.mjs "<STEP>" --name Psycho --up y --forward +x --mechanism pivot --mass 40 --floor -0.09525 --skip '^(6 wheel|Llanta)' --arm-parts '^(Brazo|Garra|Soporte-BrazoGarra|Sprocket|Flecha 25|CosadelSprocket)' --rules scripts/cad/rules/psycho.json
```
**Colores:** el STEP solo trae el gris por defecto de SolidWorks; `scripts/cad/rules/psycho.json` pinta por nombre según las capturas del CAD: motores Kraken y cajas CIM negros, cajas Versa gris oscuro; las placas quedan grises. SUPUESTO: el tono de cada familia.
**Motor del elevador (18-nov):** las reglas aceptan `box` ([x0,y0,z0,x1,y1,z1] en m, sistema del robot): la regla solo aplica si el centro de la pieza cae ahí (sirve para piezas sin nombre del CAD). `hazmat-704.json` pinta así el motor de arriba de la torre (negro) y su engrane (dorado, SUPUESTO por la captura del CAD).

**Hazmat 704, más colores (19-nov, solo visual):** según las capturas de Xhavi, engranes `16t/48t` de la transmisión y `WCP-0578` en crema, y el motor del intake (pieza sin nombre, por caja) en negro; los CIM, cajas, poleas, llantas y el motor del elevador ya iban en negro. SUPUESTO: el tono crema; el logo azul y la raya verde del Kraken no se dibujan.

## Mentores 3478 (RBRI Alonso, 20-nov, brazo con pivote y garra de rodillos)
Importado de `RBRI_Alonso.STEP` (SolidWorks 2026, 163 piezas, AP214) con
`npm run robot:import -- <STEP> --name "Mentores 3478" --mechanism pivot --up z --forward +x --floor -0.115 --center 0,0 --mass 40 --skip '^(GamePiece|MC|Battery12V)$' --arm-parts '^Brazo$' --min-diag 0.015 --max-tris 500 --set arm.pivotX=-0.2075 --set arm.pivotY=0.335 --set arm.length=0.7003 --set length=0.58 --set width=0.58 --set baseHeight=0.38`
y luego a mano en el JSON (huella, llantas, garra, alturas, supuestos; ver `supuestos`) y `node scripts/cad/hitboxes.mjs mentores-3478`.
Opción nueva `--center cf,cl`: centro del robot en el CAD (eje de frente y de lado, m). Hace falta cuando el chasis que deduce el importador incluye el brazo (aquí todas las piezas se llaman `Lateral`, `Sup`, `LatB`…, sin "Chasis"/"Brazo") y correría el origen.
**Del CAD:** chasis 0.58 × 0.58 m; 4 llantas de 6 in; eje del brazo a 0.335 m del piso y 0.2075 m detrás del centro; brazo de 0.70 m hasta la Muestra; garra de rodillos de 4 in. La pose del CAD es la de piso.
**Xhavi (20-nov):** anota en los tres niveles y toma la Muestra Crítica. **SUPUESTOS:** capacidad 1, garra de compliants de 0.23 m, alturas N1–N3 del preset, y la pose de inicio a 50° (con el brazo de 0.70 m ninguna cabe del todo en el perímetro: el robot real pliega la muñeca, que el simulador no tiene; el menú lo marca con ⚠).

**Mentores 3478, colores (21-nov, solo visual):** `scripts/cad/rules/mentores-3478.json` (`--rules`) pinta según las capturas del CAD de Xhavi: motores Kraken X60 y los del brazo (sólidos sin nombre) y CIM en negro, cajas Toughbox negras, poleas `42TPulley` azul marino, baleros azules, rodillos del brazo en negro (ya venían así) y los cilindros pequeños de la garra en verde; engranes taupe, placas grises. Reglas nuevas en `glb.mjs`: `diag` [min,max) m (por tamaño) y `unnamed` (sólido sin nombre). SUPUESTO: el tono de cada familia y que los cilindros verdes de la garra son los de la captura de arriba; los baleros verdes/morados pequeños de las capturas no se distinguen aparte. Se regeneró el GLB sin tocar el JSON del robot.

**Mentores 3478, corrección (21-nov):** sin rodillos verdes: el modelo lleva `cadRollers: true` (el simulador ya no dibuja rodillos genéricos encima; los negros son los compliants reales del CAD) y se quitó la regla verde de los cilindros pequeños (ahora gris metal). Motores del chasis (CIM y Kraken) en negro.

**Mentores 3478, intake y rodillos (21-nov):** el intake no agarraba nada: la punta del brazo en el piso del CAD queda a 0.082 m (el centro de la Muestra) y la garra solo trabajaba por debajo de `FLOOR_POSE` (0.06 m). `floorPoseOf(spec)` (RobotPhysics) sube el umbral con `elevatorHeights[0] + 1 cm` (solo cambia Mentores; los demás tienen 0–0.044 m). Los rodillos del CAD van animados con el intake (`cadRollersZ`, ejes a lo ancho): 5 ruedas negras de 4 in (con su cubo) y 5 rodillos verdes de 1 in debajo, que se pintan de verde en el visor (el espaciador de 2 cm queda gris); las filas de arriba y abajo giran al revés y jalan hacia el brazo. SUPUESTO: el sentido del giro (el STEP es una sola pose). N3 (0.85 m) sale a 47° al frente, 68° sobre el piso; no se encontró un giro de más de 90° en la simulación.

**Mentores 3478, corrección (21-nov, 2):** los cilindros de 1 in bajo la garra (`1in wheel` del STEP: 5 ejes a z = 0, ±0.051, ±0.102 m, 0.145 m abajo y atrás de las ruedas negras) ya no se pintan de verde (Xhavi: son espaciadores que flotan, no los rodillos verdes); siguen girando con el intake. En el STEP no hay ninguna otra pieza en esa zona (se revisaron todas las piezas con el centro a 0.12 m): los rodillos verdes reales no vienen en este ensamble. Falta una captura del CAD donde se vean para colocarlos.

**Mentores 3478, garra como la de Axiom (21-nov, pedido de Xhavi):** la garra de Mentores es una pinza igual a la de Axiom (`intake`: `pinza`, 0.29 m de apertura, dedos de 0.113 m y la misma `claw`): un toque cierra sobre la Muestra y otro abre y la suelta; no se mantiene el botón. Los rodillos del CAD giran mientras la pinza está cerrada. Piso a 0.082 m del CAD con `floorPoseOf`. SUPUESTO: el CAD no trae dedos que cierren (a diferencia de Axiom), así que la pinza no se ve cerrar; solo cambia la lógica.
