# Reglas del reto — LabBot Rescue 2026 (Robotics WinterFest, LamBot 3478)

Resumen del **manual de juego** (`game manual copy 2026.pdf`, 46 págs.), que es la **única fuente
de verdad**. Cada dato cita su sección (§x.y). Lo que el manual no dice y el simulador necesita
se marca **SUPUESTO** y se lista en [Dudas](#7-dudas-y-ambigüedades). Las posiciones que solo
aparecen en las figuras se marcan **[fig.]**: medidas sobre la vista superior de §3.2 (pág. 7),
que está a escala (622 px = 9000 mm → ≈14.5 mm/px, error ≈ ±30 mm).

> El manual advierte que puede cambiar (§11.2) y que "las puntuaciones pueden variar un poco
> durante la temporada" (§4.4). Por eso todos los números van en `src/config/` del simulador.

---

## 1. Cancha, zonas y elementos

### 1.1 Cancha (§3.1)
- **700 cm × 900 cm**, alfombra. (El manual dice "275.591 in × 352 in": 900 cm son 354.3 in,
  así que el 352 está mal; usamos los cm.)
- Driver Stations en los **lados cortos** (superior e inferior), una mesa por alianza (§3.2.6).
  [fig.] ≈ 1.6 m de ancho, centradas.

### 1.2 Sistema de coordenadas del simulador (SUPUESTO de convención, no regla)
Origen en el centro de la cancha, Y hacia arriba, metros.
**+X = hacia la Driver Station roja** (lado "superior" de la figura), eje largo de 9 m
(X ∈ [−4.5, 4.5]). **+Z = a la derecha** de la figura vista con rojo arriba, eje de 7 m
(Z ∈ [−3.5, 3.5]). Todo lo azul es la **rotación de 180°** de lo rojo: (x, z) → (−x, −z)
(la figura de pág. 7 es simétrica así).

### 1.3 Zonas y estructuras (posiciones de la alianza ROJA; azul = rotación 180°)

| Elemento | Manual | Posición en el sim [fig.] |
|---|---|---|
| **Zona de Inicio** ×2 por alianza (§3.2.1) | Cinta del color de la alianza "en forma de L", una por robot. Sin medidas. | La cinta roja es un escalón: tramo en X≈3.92 (Z −0.99→0), tramo en Z≈0 (X 3.92→2.91), tramo en X≈2.91 (Z 0→0.99). **SUPUESTO**: dos zonas de ≈1.0 × 1.0 m: A = X[2.91,3.92]×Z[−0.99,0], B = igual con Z[0,0.99]. |
| **Línea central** (§4.2) | Los robots no pueden cruzarla en AUTO. | X = 0. En la figura es roja de Z −3.5 a −0.75 y azul de 0.75 a 3.5 (interrumpida por la Plataforma). |
| **Línea de autónomo** (§4.4) | Da puntos "cruzarla". El manual no la ubica. | **Resuelto (Xhavi, 24-oct)**: es la misma cinta en L de la Zona de Inicio; se cruza al salir por completo de la zona (D1). |
| **Laboratorio** (§3.2.2) | Zona central; 16 Muestras distribuidas simétricamente sobre marcas en el suelo; ambas alianzas acceden libremente en TeleOp. | Rejilla 4×4: X ∈ {±0.46, ±1.46}, Z ∈ {±1.40, ±2.40} (separación 1.0 m). 8 de cada lado de la línea central. |
| **Cámara de Seguridad** (§3.2.3) | 3 contenedores abiertos ("botes sin fondo") escalonados sobre MDF, en el área lateral de la mitad propia. Total 2150 × 600 mm, altura máx. 800 mm. | Pegada a la pared lateral +Z: Z[2.90,3.50], X[1.56,3.70]. Nivel 1 junto a la pared de la alianza, Nivel 3 hacia el centro. |
| ─ Nivel 1 | 789 × 600 mm, apertura a **200 mm** | X ≈ [2.91, 3.70] |
| ─ Nivel 2 | 689 × 600 mm, apertura a **500 mm** | X ≈ [2.23, 2.91] |
| ─ Nivel 3 | 639 × 600 mm, apertura a **800 mm** | X ≈ [1.56, 2.23] |
| **Campana** (§3.2.4) — también llamada "Zona de Alimentación" (§4.1, §4.3.1) | En la pared lateral, una por alianza. Pared 2000 × 610 mm. Ranura inferior 1850.80 × 160 mm a 200 mm del suelo (Muestras, todo el TeleOp). Rendija deslizable superior (Muestra Crítica). | Pared lateral −Z (lado opuesto a la Cámara), por fuera del límite: X[2.47,4.50]. |
| ─ Barra lateral de obstáculo | 1250 × 50.80 mm; "obliga a los robots a dar la vuelta" para llegar a las muestras del HP. | Perpendicular a la pared, en X ≈ 2.47, de Z −3.50 a −2.26. Altura no dada (SUPUESTO: igual que la pared, 610 mm). |
| **Plataforma de Contención** (§3.2.5) | En el centro; 2 Rampas simétricas que convergen en la Repisa de Seguridad compartida. | Eje largo a lo largo de X (cada rampa mira a su Driver Station). [fig.] ≈ 4.0 m × 1.49 m, X[−2.0,2.0], Z[−0.745,0.745]. Ancho **no dado en el texto**. |
| ─ cada Rampa | Longitud horizontal 1800 mm = tramo inclinado de 1035.28 mm a **15°** (1000 mm horizontales, sube 268 mm) + plataforma horizontal superior de 800 mm. | Rampa roja: X 2.0→1.0 inclinada, 1.0→0.2 plana a 0.268 m. |
| ─ Repisa de Seguridad | Escalón **300 mm** sobre la plataforma superior (≈568 mm del suelo). "Ancho accesible total ~689 mm (344.50 mm de sobresaliente por cada lado)". Accesible desde ambas alianzas. | [fig.] bloque central X[−0.2,0.2] (≈0.39 m). Choca con los 689 mm: ver D6. |
| **Driver Station** (§3.2.6) | Lados cortos, fuera de la cancha. | Detrás de X = ±4.5. |

Cuadre de medidas: 1035.28·cos15° = 1000.0 mm y 1000 + 800 = 1800 mm ✔. Los niveles de la Cámara
suman 789 + 689 + 639 = 2117 mm ≠ 2150 mm (los 33 mm restantes serían paredes; SUPUESTO).

### 1.4 Elementos de juego (§4.1.1)
| Pieza | Material | Medida | Cantidad |
|---|---|---|---|
| **Muestra de Laboratorio** | Cubo de espuma | 150 × 150 × 150 mm ±5 mm | 16 en el Laboratorio al inicio + **10 por alianza para el HP** por match + 1 precarga opcional por robot (§4.1; ver D3) |
| **Muestra Crítica** | Cubo de espuma más grande, color distinto (rojo/azul por alianza, pág. 15) | 200 × 200 × 200 mm ±5 mm | **1 por alianza** por match |

- Peso de las piezas: no se da (SUPUESTO para la física: espuma ≈ 30 kg/m³ → ~0.1 kg y ~0.24 kg).

---

## 2. Fases del match y duraciones

| Fase | Duración | Notas |
|---|---|---|
| Acomodo previo | ≤ 3 min (§4.1.2) | No se simula (solo colocar robots). |
| **AUTO** | **15 s** (§2, §4.2) | Solo instrucciones preprogramadas. Solo pueden manipular Muestras **de su propia área**; **no pueden cruzar la línea central**. |
| Cambio AUTO→TELEOP | sin pausa indicada | "la señal de sonido dará el aviso" (§4.2). SUPUESTO: 0 s de pausa (D9). |
| **TELEOP** | **135 s** (§2, §4.3) | "2 minutos y 15 segundos restantes". Match total = 150 s. |
| **ENDGAME** | **últimos 30 s del TELEOP** (§4.3.1) | Se habilita la Plataforma; se puede tomar la Muestra Crítica y depositarla en la Repisa. |
| Fin | bocina final | Plataforma y Muestra Crítica se evalúan "al sonar la bocina final" (§4.3.1). |

Timer sugerido (SUPUESTO de UI): AUTO 0:15→0:00, TELEOP 2:15→0:00, ENDGAME desde 0:30.

---

## 3. Puntuación (§4.4)

| Acción | AUTO | TELEOP | ENDGAME | RP | Condición |
|---|---|---|---|---|---|
| **Línea de Autónomo** | 5 c/u | – | – | **1** | "Ambos robots de la alianza cruzan la línea de autónomo" (ver D1, D2) |
| Muestra **Nivel 1** | 5 | 2 | 2 | – | El robot deposita una Muestra en el Nivel 1 |
| Muestra **Nivel 2** | 10 | 6 | 6 | – | … Nivel 2 |
| Muestra **Nivel 3** | 18 | 15 | 15 | – | … Nivel 3 |
| **Robot en Plataforma** | – | – | 10 | – | 1 robot de la alianza sobre la Plataforma **al sonar la bocina** |
| **Alianza en Plataforma** | – | – | 20 | – | 2 robots sobre la Plataforma al sonar la bocina. **No acumulable**: 2 robots = 20 total, no 10 + 20 (nota de §4.4) |
| **Muestra Crítica** | – | – | 15 | **1** | 1 robot deposita la Muestra Crítica en la Repisa durante el endgame (se evalúa al sonar la bocina, §4.3.1) |
| **Dominio de Cámara** | – | – | – | **1** | La alianza tiene **≥ 10 muestras** en su Cámara al final del match |
| **Empate** | – | – | – | **1** | Misma cantidad de puntos |
| **Victoria** | – | – | – | **2** | Mayor cantidad de puntos |

- Máximo de RP por match: 2 (victoria) + 1 + 1 + 1 = **5**.
- Las Muestras se depositan "introduciéndolas por la apertura superior de cada contenedor" (§3.2.3).
- Los puntos de faltas del rival se suman a la alianza (§4.5, §4.6).
- PlayOffs: mismo puntaje sin RP (§8.2.2); "cada puntaje de robot individualmente se suma al
  final del match, así como las penalizaciones de fouls y tech fouls de cada equipo".

---

## 4. Penalizaciones y restricciones

### 4.1 Foul — **4 puntos al equipo contrario** (§4.5)
"En caso especial no se otorgarán los puntos, queda a consideración de los referees" (el sim
siempre los otorga; SUPUESTO).
1. Pinning contra el equipo contrario (también §6.1: aplica aunque no sea intencional).
2. Entrar en contacto con los robots de la alianza contraria.
3. El HP introduce Muestras fuera de la zona especificada.
4. El HP sale de su zona especificada.
5. Dejar caer partes del robot en la cancha.

### 4.2 Tech Foul — **8 puntos al equipo contrario** (§4.6)
1. Violar normas de seguridad en la cancha.
2. Tocar a un robot en una de las zonas del color de la alianza contraria.
3. Dañar críticamente la cancha, el robot contrario o las game pieces.
4. El HP sale de su zona de manera intencional.
5. Romper valores de convivencia / Gracious Professionalism.
6. Miembros del drive team salen de sus zonas.
7. El robot sale de los límites de la cancha (aparece dos veces en el manual).
8. Bloquear u obstruir deliberadamente las zonas del equipo contrario.
9. **Subir a la Plataforma antes del endgame.**
10. **Tomar la Muestra Crítica antes del endgame.**
11. Tirar intencionalmente la Muestra Crítica del rival de la Repisa.
12. El HP coloca la Muestra Crítica en la rendija **después del inicio del AUTO**.

### 4.3 Tarjetas (§4.3.2–§4.3.4, §8.1)
- **Yellow Card**: conducta (valores, safety, dejar caer partes a propósito, entrar a la cancha
  durante el match).
- **Red Card**: **pierde todos los puntos del match** el equipo que la recibe. Por: **2 Yellow
  Cards**, deshabilitar completamente un robot a propósito, faltar al respeto. Jugar sin sello de
  inspección = Red Card + Tech Foul directo (§8.1).
- Descalificación del torneo (§4.3.4): fuera del alcance del simulador.

### 4.4 Otras restricciones de juego
- AUTO: no cruzar la línea central; solo muestras del área propia (§4.2). **El manual no dice qué
  falta corresponde** (D7).
- TELEOP: "las únicas zonas restringidas son las de la alianza contraria y están marcadas como
  tales" (§4.3). **No se dice cuáles** (D8).
- "No hay defensa durante el juego del match" (§6.1); no es un juego de combate.
- No traspasar el perímetro de otros robots; mantenerse dentro de la cancha (§6.1).
- HP: desliza Muestras por la ranura inferior **durante todo el TeleOp** (§3.2.4) — no en AUTO;
  coloca la Muestra Crítica en la rendija antes del AUTO (§4.1). "Puede tomar los cubos insertados
  en la campana siempre y cuando un referee se lo indique" (§3.2.4).
- Límite de posesión de Muestras: **el manual no pone ninguno** (SUPUESTO: lo limita solo el
  diseño del robot).

---

## 5. Restricciones del robot que afectan la simulación (§7.2, §7.3)
- Perímetro máximo del chasis **65 × 65 cm**; mecanismos pueden extenderse **hasta 40 cm** más
  en cualquier dirección desde el perímetro (§7.2). Al inicio, nada fuera del perímetro (§4.1).
- Altura máxima **100 cm**. Sin límite de peso.
- **Chasis tipo tanque obligatorio** (swerve u otro prohibido). **Sin bumpers.**
- Motores máx.: 6 CIM, 1 Kraken X44, 3 Kraken X60, 1 NEO; una batería FRC 12 V (§7.3).
- 2 robots por alianza, 4 en cancha (§8.2). Precarga: 1 Muestra por robot (§4.1).
- Velocidad, aceleración y masa: no dados (SUPUESTO configurable; p. ej. 2.5 m/s, 45 kg).

## 6. Torneo (contexto, fuera del alcance inicial)
8 equipos, alianzas de 2 que rotan en qualifications; selección por ranking (Rank 1 no puede
elegir a Rank 2); PlayOffs todos contra todos entre alianzas y final al 2 de 3 (§8.2).

---

## 7. Dudas y ambigüedades

| # | Tema | Qué dice el manual | Supuesto provisional del sim |
|---|---|---|---|
| **D1** | **¿Dónde está la línea de autónomo?** | Da 5 pts y 1 RP por "cruzarla", pero no la ubica; además prohíbe cruzar la línea central en AUTO. | **RESUELTO (Xhavi, 24-oct)**: la línea es la cinta de la Zona de Inicio; cruzarla (salir por completo de la zona) da los puntos. |
| **D2** | Puntos de la línea con un solo robot | La condición dice "ambos robots" pero el valor es "5 c/u". | 5 pts por cada robot que cruza; el RP solo si cruzan los dos. La presentación del kickoff dice "5 pts por robot", lo que apoya este supuesto. |
| **D3** | Precarga | 1 Muestra por robot; "si no se usa, se coloca en la zona designada de cada equipo". ¿Sale de las 16 del Laboratorio, de las 10 del HP o es extra? ¿Cuál es la "zona designada"? | Extra (hasta 4 más); si no se precarga, va al HP. |
| **D4** | ¿Cuándo cuenta una Muestra en la Cámara? | "Botes sin fondo"; valor según periodo. ¿Al entrar o al final? ¿Se pueden sacar? ¿Hay capacidad por nivel? | **RESUELTO (Xhavi, 24-oct)**: las Muestras cuentan en todo momento del match, con el valor del periodo en que se depositan. Solo la Muestra Crítica tiene restricción (se toma de la Campana hasta el endgame). Supuesto restante: no se pueden sacar y no hay capacidad máxima. |
| **D5** | ¿Qué es estar "sobre la Plataforma"? | Solo "sobre la Plataforma de Contención al sonar la bocina". ¿Vale estar en la rampa? ¿Tocando la alfombra? | **RESUELTO (Xhavi):** "nada más subirse a la rampa". Cuenta el robot apoyado en la estructura (rampa, plataforma o repisa) sin tocar la alfombra, evaluado al sonar la bocina; no necesita llegar arriba. |
| **D6** | Medidas de la Repisa y ancho de la Plataforma | "~689 mm (344.50 de sobresaliente por cada lado)" no cuadra con la figura (≈0.39 m de fondo y ≈1.49 m de ancho). El ancho de las rampas no está en el texto. | Medidas de la figura; idealmente las tomamos del CAD de §3.3. |
| **D7** | Cruzar la línea central en AUTO | Prohibido, pero sin falta asignada. | La IA y las rutinas no cruzan (pared virtual); si un jugador cruza, Foul (4). |
| **D8** | Zonas "de la alianza contraria" | "Marcadas como tales" (§4.3) y Tech Foul por tocar a un robot en ellas; no se dice cuáles son. | Zonas de Inicio rivales + área frente a la Campana rival + huella de la Cámara rival. |
| **D9** | Pausa AUTO→TELEOP | Solo "la señal de sonido". | Sin pausa. |
| **D10** | Red Card en alianza | "Pierde todos los puntos el equipo que la reciba", y en PlayOffs se suman puntajes por robot. ¿Pierde la alianza entera o solo lo aportado por ese robot? ¿Y sus RP? | La alianza queda en 0 y sin RP (como pérdida de todo el match). |
| **D11** | Frecuencia de faltas por contacto/pinning | Cualquier contacto con un rival es Foul, pero no hay duración de pinning ni regla de "una por contacto". | Una falta por contacto nuevo (con 1 s de enfriamiento); pinning > 3 s = Foul y otra cada 3 s más. |
| **D12** | Muestras que entran justo después de la bocina / entre AUTO y TELEOP | No se menciona gracia. | Sin gracia: cuenta el instante en que cruza la apertura. |
| D13 | Errata menor | Encabezado "Manual_Reto LamBot 2024"; 352 in ≠ 900 cm. | Se ignora. |
| D14 | Muestra en la Cámara de la alianza contraria | "Depositar en **su** Cámara"; no dice qué pasa si cae en la otra. | Cuenta para la alianza dueña de la Cámara. |
| D15 | ¿Quién "entra en contacto"? | Foul por "entrar en contacto con los robots de la alianza contraria" (§4.5). | Lo comete el robot que se acerca más rápido al otro (mín. 0.15 m/s); dos robots quietos que se tocan no cometen falta. |
| D16 | Muestra Crítica "durante el endgame" | Se evalúa "al sonar la bocina" (§4.3.1). | Cuenta si la Crítica propia está sobre la Repisa al sonar la bocina. |
| D17 | "Bloquear u obstruir deliberadamente las zonas del equipo contrario" (§4.6) y "no hay defensa" (§6.1) | No dice cuánto tiempo ni dónde. | Tech Foul si un robot pasa más de 3 s seguidos en el TELEOP frente a la Cámara rival (su largo y 1 m hacia la cancha); otra cada 5 s más. |

**Presentación del kickoff** (`2026 Robotics WinterFest.pdf`, Canva, 38 págs.): repite el manual
con las mismas figuras y valores; no trae medidas nuevas ni ubica la línea de autónomo. Solo
difiere en que dice "Un robot sobre la Plataforma **durante el endgame**", mientras el manual
(§4.4, §4.3.1) dice "al sonar la bocina"; manda el manual.

**Pedido opcional:** el CAD de la cancha (§3.3, enlace de Google Drive) daría las posiciones
exactas de la Zona de Inicio, Laboratorio, Plataforma y Repisa. Si se exporta a STEP/GLB y se
sube al proyecto, reemplazo las medidas [fig.].
