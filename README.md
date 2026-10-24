# LabBot Rescue Sim

Simulador 3D web del reto interno **LabBot Rescue 2026** (Robotics WinterFest, LamBot 3478).
Cancha, piezas, robots tanque, reloj, puntuación, faltas y Ranking Points según el manual del reto.

- **Reglas:** [`docs/reglas-reto.md`](docs/reglas-reto.md) resume el manual con la sección de cada
  regla (§x.y), las medidas tomadas de las figuras y la lista de dudas y supuestos (D1–D16).
- **Plan y arquitectura:** [`docs/PLAN.md`](docs/PLAN.md).

## Instalar y correr

Requiere Node 22 o más nuevo.

```bash
npm install          # el .npmrc usa legacy-peer-deps (evita un error de npm 10 con vitest)
npm run dev          # servidor de desarrollo en http://localhost:5173
npm test             # pruebas unitarias y de física (Vitest)
npm run build        # revisa tipos y genera el sitio estático en dist/
npm run preview      # sirve dist/
npm run shots        # capturas con Playwright en shots/ (requiere build; en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
```

El build es estático (`base: './'`), así que funciona en cualquier hosting, por ejemplo GitHub Pages.

## Cómo se juega

En el menú eliges tu robot (Rojo 1–2, Azul 1–2) y el modo:

- **Jugar match:** 150 s con reloj. En el AUTO (15 s) los robots corren su rutina preprogramada
  (por defecto, salen de su Zona de Inicio). En el TELEOP (135 s) manejas tu robot, y en el ENDGAME
  (últimos 30 s) se habilitan la Plataforma y la Muestra Crítica. Al final verás el desglose de
  puntos, RP y faltas.
- **Práctica libre:** sin reloj ni faltas; el marcador cuenta las Muestras anotadas.
  Backspace reacomoda la cancha.

### Controles

| Acción | Teclado | Gamepad |
|---|---|---|
| Avanzar / retroceder | W / S (o flechas) | Stick izquierdo ↕ |
| Girar | A / D (o flechas) | Stick izquierdo ↔ (o derecho) |
| Modo lento | Shift | — |
| Intake (encender/apagar) | Espacio | A |
| Elevador: abajo, N1, N2, N3, Repisa | 0, 1, 2, 3, 4 | LB / RB (o cruceta ↕) |
| Soltar Muestra | E | B |
| Tomar Muestra Crítica | F | X |
| Soltar Muestra Crítica | R | Y |
| Cambiar cámara | C | Back |
| Pausa | Esc | Start |

**Para anotar:** acércate de frente a la pared de tu Cámara de Seguridad, sube el elevador al nivel y
suelta la Muestra; cuenta cuando cae dentro del nivel. **Para la Muestra Crítica**, en el ENDGAME
ponte de frente a la rendija de tu Campana con el elevador en "Repisa" y presiona F; luego sube a la
Plataforma y suéltala sobre la Repisa (R).

## Estructura

```
src/
  config/     field.ts (medidas de la cancha, §3), fieldLayout.ts (sólidos para física y render),
              game.ts (tiempos, puntos, faltas y RP, §4.4–§4.6), robot.ts (límites §7.2)
  core/       lógica pura y probada: clock.ts, match.ts (puntuación y RP), fouls.ts, types.ts
  physics/    Rapier: PhysicsWorld, FieldColliders, Pieces (pool de Muestras), RobotPhysics (tanque)
  game/       GameSession (une todo), Robot, Mechanisms, Sensors (anotación), HumanPlayer
  referee/    Referee.ts: faltas automáticas
  auto/       rutinas de AUTO
  render/     Three.js: Renderer, FieldView, PieceView, RobotView, CameraRig
  input/      teclado y gamepad
  ui/         i18n (es-MX / en), HUD, menús y resultados
tests/        field, physics, robot, match (reglas y casos borde), session (match completo)
```

Todos los parámetros del juego viven en `src/config/`; si el manual cambia, se ajustan ahí.
Cada regla en el código cita su sección del manual.

## Limitaciones conocidas

- Varias posiciones (Zonas de Inicio, Laboratorio, Plataforma, Repisa) se midieron sobre la figura de
  §3.2 (error ≈ ±30 mm). El CAD oficial de la cancha (§3.3) daría las medidas exactas.
- Supuestos marcados en `docs/reglas-reto.md`: qué cuenta como "sobre la Plataforma" (D5), zonas de
  color de cada alianza (D8), frecuencia de faltas por contacto (D11, D15), entre otros.
- Los otros 3 robots no tienen IA: corren su rutina de AUTO y luego se quedan quietos.
- El Human Player es automático (una Muestra cada 3 s si la ranura está libre).
- No se simulan las faltas de conducta, seguridad o del Human Player humano (no se pueden detectar).
- La intake no choca con la cancha (solo captura Muestras); el robot es genérico (sin editor).
