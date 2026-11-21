# Sonidos del campo (public/sounds/)

Grabaciones de los cues de audio del campo de FRC (FMS), los mismos que usa `rebuilt-sim`.
El simulador los toca en `src/audio/FieldAudio.ts`; si un archivo no carga, usa una versión
sintetizada parecida.

| Archivo | Cue de FRC | Momento en LabBot Rescue |
|---|---|---|
| start.wav | Cavalry Charge | inicio del match (AUTO) |
| resume.wav | 3 Bells | inicio del TELEOP (§4.2: "la señal de sonido dará el aviso") |
| warning.wav | Steam Whistle | inicio del ENDGAME (últimos 30 s, §4.3.1) |
| end.wav | Buzzer | fin del match |

El manual del reto no dice qué sonidos usar: tomar los de FRC es SUPUESTO.

**Fuente:** https://github.com/Team254/cheesy-arena/tree/main/static/audio (Cheesy Arena, Team 254).

**Licencia:** los sonidos son de *FIRST*® y no se publicaron con una licencia abierta; la licencia
de Cheesy Arena tampoco cubre su redistribución. Se incluyen sin permiso explícito en este proyecto
no oficial, interno y sin fines de lucro. Si *FIRST* o el equipo 254 piden quitarlos, se borra esta
carpeta y el simulador vuelve solo a los sonidos sintetizados.
