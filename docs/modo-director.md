# Modo Director (Reveal Studio)

Captura y edición de highlights para videos tipo *Robot Reveal*. Todo vive en `src/director/` (lógica)
y `src/ui/StudioPanel.ts` (interfaz).

## Grabación (siempre activa, sin costo medible de FPS)
- `Director` se cuelga de `GameSession.tap` y toma un cuadro a 30 Hz en un búfer circular de 15 s
  (`FrameRing`, un solo `Int16Array` preasignado: no crea objetos al simular). Los cuadros tienen el mismo
  formato que las repeticiones (`replay/format.ts`); un clip es una `Replay` corta y se reproduce con
  `ReplayPlayer` (robots CAD incluidos). Comparte la ranura `GameSession.tap` con la grabadora (`tee`).
- Marca manual: **H** o **F9** (control: R3). Guarda los últimos 10 s. Reasignable en *Controles*.
- Detección automática (`HighlightDetector`, umbrales en `RULES`; son SUPUESTOS de diseño, no del
  manual): anotaciones rápidas (2 en ≤ 6 s), tiro de precisión (N3), maniobra a alta velocidad cerca de
  un robot/pared sin contacto, anotación en los últimos 10 s, Plataforma o Crítica en la Repisa durante
  el ENDGAME y clutch (anotar ≤ 4 s después de un golpe). Cada highlight guarda 8 s antes + 2 s después;
  los que caen juntos se fusionan. Máximo 12 clips (se descarta primero el más viejo no manual).
- Los clips se borran al empezar otra sesión.

## Estudio
Se abre desde la **Pausa** o los **Resultados** → *Modo Director* (apagado si no hay clips). La física no corre mientras está abierto.
- Línea de tiempo: arrastrar para mover, manijas moradas o botones `[ Inicio aquí` / `Fin aquí ]` para
  recortar; Espacio = play/pausa, ←/→ = ±0.2 s. La marca amarilla es el momento del highlight.
- Cámaras: Chase dinámico (lag + FOV según la velocidad), Órbita hero, Contrapicado, Cámara libre
  (WASD + Q/E + arrastrar el mouse; **K** fija hasta 3 keyframes y *Travelling* los recorre con suavizado).
- Velocidad: 1× / 0.5× / 0.25× en el momento y 1× / 1.5× después (`speedRamp.ts`).
- Efectos (solo en el estudio; el juego normal no tiene post-proceso): motion blur ligero, bloom, viñeta.
  **Clean Feed** (U o doble clic para volver) oculta los paneles.
- Exportar: `MediaRecorder` sobre el canvas a 60 FPS en tiempo real, WebM (VP9/VP8) o MP4 si el
  navegador lo soporta; resolución Pantalla/1080p/1440p/4K (con el aspecto de la ventana). El video lleva
  solo el canvas 3D.

## Repeticiones con ★
En *Repeticiones*, las que tienen ★ muestran **Editar en Director**: abre todo el match guardado como un solo clip
(`clipFromReplay` en `director/clip.ts`) con las mismas herramientas: recortar, cámaras, cámara lenta y exportar.
Una repetición guardada ya trae poses de robots y piezas a 15 Hz y sus eventos, así que no se inventa nada; el foco es tu
robot (o el primero si fue solo IA) y la marca amarilla cae en la primera Muestra anotada. Al salir vuelves a *Repeticiones*.
Los cuadros son a 15 Hz (los clips en vivo, a 30 Hz), así que la cámara lenta se ve un poco menos fluida.

## Pruebas
`npm test` (tests/director.test.ts) y, en navegador real, `npm run build && npm run director-check`
(en la nube: `CHROMIUM_PATH=/opt/pw-browsers/chromium`).
