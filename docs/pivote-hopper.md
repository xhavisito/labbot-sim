# Pivote con hopper — sugerencia de diseño en MDF

Idea del equipo (dibujo del 26-oct-2026): un hopper con **dos paredes altas** a los lados y el
**brazo pivotante en medio**. El brazo tiene que llegar a todos los niveles y llevar la Muestra
Crítica. En el simulador es el tipo **Pivote con hopper** (`PIVOT_HOPPER_ROBOT` en
`src/config/robot.ts`). Todo lo que no dice el manual es **SUPUESTO** de diseño.

> §7.2: todo diseño lo revisa y aprueba un mentor de CAD, y el CAD va en la carpeta de Drive del
> equipo. Esto es un punto de partida para ese CAD, no un plano final.

## Reglas que fijan las medidas
| Regla | Qué pide | Cómo se cumple |
|---|---|---|
| §7.1 | MDF de 5.5 mm; 150 g de PLA (§7.1.1) | Placas de MDF; piezas dobles (11 mm) donde carga el brazo. PLA solo para bujes y separadores. |
| §7.2 | Chasis ≤ 65 × 65 cm, mecanismos ≤ 40 cm fuera del perímetro, altura ≤ 100 cm, tanque, sin bumpers | Chasis 60 × 60 cm. La garra sale como máximo 39.6 cm (con la Crítica en la posición 4). Altura máxima: ver "brazo". |
| §7.3 | Una batería FRC; máximo 6 CIM, 1 Kraken X44, 3 Kraken X60, 1 NEO | 4 CIM tracción · 2 X60 brazo · 1 X44 garra · 1 NEO indexador del hopper. Quedan 2 CIM y 1 X60. |
| §7.4 | Neumática libre a petición | Opción: garra con pistón en lugar del X44. |
| §4.1 | Al inicio todo dentro del perímetro; 1 Muestra de precarga | Arranca con el brazo hacia atrás (180°) y la precarga en la garra, dentro del chasis. |
| D24 (SUPUESTO del sim) | Los 100 cm valen todo el match | El brazo pasa por arriba con una Muestra cada vez que la guarda, así que eje + brazo + Muestra = 100 cm. |

## Medidas (las mismas del simulador)
**Chasis**: base común tanque de 60 × 60 cm, 6 ruedas de 6 in (la central baja), 4 CIM a ~12.75:1
(≈ 2.7 m/s). Batería y main breaker abajo, al frente del hopper (§7.1: breaker visible y accesible).

**Brazo** (vista lateral, frente a la derecha; alturas desde el piso):
- Eje a **400 mm** de alto y **290 mm adelante del centro** (1 cm detrás del frente). Lo cargan dos
  torres de MDF doble a los lados del canal.
- Largo **450 mm** del eje al fondo de la garra. Dos largueros de MDF laminado (3 capas, 16.5 mm)
  separados 180 mm, con separadores; cabe en el canal de 220 mm.
- Así, vertical, la punta queda a 850 mm y la Muestra arriba a **1000 mm justos**. En el CAD dejen
  5–10 mm de margen (eje a 390–395 mm o un tope en el software para no pasar vertical con pieza).
- 2 Kraken X60 con reducción ~100:1 (caja + cadena) y un sensor de ángulo (pedirlo a los
  mentores, §7.3: no CANcoder).

| Posición | Ángulo | Punta (alto) | Dónde queda la pieza |
|---|---|---|---|
| Piso (tomar) | −63° | 0 mm | Muestra 12–27 cm delante del chasis |
| N1 y N2 | 49° | 740 mm | Cae al pozo desde arriba (más bajo, la garra saldría más de 40 cm) |
| N3 | 69° | 820 mm | 8–23 cm delante del chasis, 2 cm sobre la apertura de 800 mm (§3.2.3) |
| Crítica / Repisa | 47° | 730 mm | Rendija de la Campana (610 mm) y Repisa; la Crítica sale 39.6 cm |
| Boca del hopper | 180° | 400 mm | Atrás, dentro del chasis: pasa Muestras al hopper y las saca |

**Garra**: dedos a los lados que abren a más de 200 mm (la Crítica mide 200 mm) y cierran a
150 mm. X44 con polea o pistón. Placas de MDF con hule o antiderrapante en los dedos. Que solo
abra al soltar, sin empujar: en el simulador, con empujón la Crítica rebotaba y se pasaba de la Repisa.

**Hopper** (las paredes verdes del dibujo):
- Canal central de **220 mm** por donde pasa el brazo, abierto arriba y al frente.
- Dos compartimentos de **179 mm** de ancho interior (600 − 2 × 5.5 − 220 − 2 × 5.5 = 358) por
  480 mm de largo: caben **2 Muestras por lado** (4 en total, 5 con la de la garra).
- Paredes exteriores altas de **600 mm** del piso (37 cm sobre el chasis): bastan para una capa de
  Muestras y no estorban al acomodarse frente a la Cámara (en el simulador, con 950 mm el robot se
  atoraba al girar pegado a ella). Paredes junto al canal más bajas (~550 mm) para que no choque
  el brazo.
- Piso de cada compartimento a ~330 mm, inclinado 5–10° hacia la boca (atrás, al centro).
- **Boca con indexador**: dos ruedas compliant (NEO) a los lados de la garra cuando está a 180°.
  Hacia un lado meten la Muestra de la garra a un compartimento; al revés, regresan la siguiente a
  la garra. Es la parte más riesgosa: **prototípenla primero en cartón o MDF de pruebas**.

**Masa estimada** (editor del sim, MDF ≈ 750 kg/m³): ~31 kg (≈ 2.3 m² de MDF, 9.5 kg).

## Cómo se maneja (simulador)
1. Garra encendida y brazo abajo: cada Muestra que agarra la lleva a la boca y regresa al piso.
2. Apaga la garra, sube a N3 y suelta: el brazo saca sola la siguiente del hopper y regresa.
3. ENDGAME: posición 4 con la garra vacía (las del hopper no estorban) para tomar la Crítica y
   dejarla en la Repisa (§4.3.1).

## Variante: brazo de 180°
Pedido de Xhavi (27-oct): una variación donde el brazo "pueda girar 180 grados". En el simulador es
**Pivote con hopper 180°** (`PIVOT_HOPPER_180_ROBOT`). Mismo chasis, mismo eje (290 mm adelante,
400 mm de alto) y mismo brazo de 450 mm; lo único que cambia es el recorrido:

- El brazo va del **piso (−63°) a 117°**: 180° justos. La boca del hopper queda **arriba del centro
  del robot, a 117°** (la garra a ~800 mm de alto y ~8 cm delante del centro), en vez de atrás a 180°.
- Guarda y saca cada Muestra con menos vuelta (~180° contra 243°), así que cada paso al hopper es
  ~25% más rápido. Alturas de N1–N3 y de la Crítica, y alcance al frente: iguales.
- **Por qué no "anota por atrás"**: con el eje al frente, girar 180° desde el frente deja la garra
  apenas 16 cm detrás del centro, lejos de una Cámara a la espalda; y con el eje al centro no llega
  al N3 sin pasar de 100 cm (D24). Por eso se tomó como "brazo limitado a 180°" (SUPUESTO; si lo
  querían de otra forma, p. ej. con torreta, se cambia).
- Para el CAD: la boca arriba obliga a que el indexador del hopper reciba la Muestra desde arriba
  (caída al compartimento), más sencillo que la boca trasera, pero la Muestra cae ~45 cm.

## Qué dice el simulador
`npm run batch -- --set mech --vs phopn3+p180n3 --seeds 3` (IA difícil, 27-oct; 6 matches por
alianza, 132 la de referencia). Es un techo para comparar, no un pronóstico: la velocidad del brazo
(4.5 rad/s) y el paso al hopper (0.25 s) son SUPUESTOS.

| Alianza | Puntos | Muestras | Crítica | RP |
|---|---|---|---|---|
| Dos pivotes con hopper (uno lleva la Crítica) | 269 | 15.7 | 83% | 4.50 |
| Dos pivotes 180° (uno lleva la Crítica) | 258 | 15.2 | 100% | 4.33 |
| Pivote con hopper + pivote 180° | 245 | 14.2 | 100% | 4.12 |
| Pivote con hopper Laboratorio + pivote con hopper HP | 236 | 13.8 | 100% | 4.00 |
| Pivote N3 + pivote que solo sube a la Plataforma | 208–215 | 11 | 100% | 2.7–2.8 |
| Dos pivotes sin ENDGAME | 213–228 | 15.5 | 0% | 2.3–3.0 |

- Los dos tipos quedan parejos: el de 180° guarda más rápido, pero en el match pesa más el manejo y
  la fila frente a la Cámara que la vuelta del brazo. Su AUTO anota un poco más (49 contra 44 pts).
- Lo que más cuenta sigue siendo subir a la Plataforma (20) y dejar la Crítica (15 + 1 RP): sin
  ENDGAME se pierden ~1.5 RP por match.
- Un pivote que solo cruza la línea y sube a la Plataforma deja a su compañero solo y baja ~1.5 RP.

## Historial
Tabla anterior (26-oct, con los demás robots del simulador, ya quitados): dos torres 340 pts / 4.45 RP,
torre + pivote con hopper 306 / 4.40, dos pivotes con hopper 241 / 3.30.
