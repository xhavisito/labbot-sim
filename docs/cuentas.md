# Cuentas reales — propuesta de diseño (sin implementar)

Estado: **borrador para aprobación de Xhavi**. No se construye nada hasta que se apruebe, porque
implica credenciales, hosting y costo.

## 1. Problema

Hoy todo el progreso vive en `localStorage` del navegador (≈15 claves `labbot.*`, cada una con su
`src/game/*Store.ts`): logros, tiempo jugado, historial de torneos, marcador semanal, entrenamiento,
tiros, ciclos, scouting, planes, rutas de AUTO, robots propios, ajustes y controles. Se pierde al
limpiar el navegador, no pasa de la computadora al celular y no se puede comparar entre personas.
Las repeticiones están en IndexedDB y **quedan fuera** de esta propuesta (pesan mucho; se siguen
exportando como `.lbreplay`).

## 2. Recomendación en una línea

**Supabase** (Postgres + Auth + Row Level Security) con **inicio de sesión con Google y enlace
mágico por correo**, guardando cada store como un documento JSON por usuario, con el navegador como
caché primaria (offline-first). Sin servidor propio: el sitio sigue siendo estático en GitHub Pages.

Por qué: `rebuilt-sim` ya contempla Supabase gratuito (`docs/ranking.sql`, `net/robotHub.ts`), así que
es el mismo stack que ya conocemos; el cliente web es una sola dependencia ligera
(`@supabase/supabase-js`); y RLS permite que el navegador hable directo con la base sin backend
intermedio.

### Alternativas consideradas
| Opción | Pro | Contra |
|---|---|---|
| **Supabase** (recomendada) | Auth + DB + RLS en uno; plan gratis suficiente; ya usado en rebuilt-sim | El proyecto gratis se pausa tras ~1 semana sin actividad |
| Firebase (Auth + Firestore) | Muy maduro, SDK táctil/offline | Dependencia más pesada, modelo NoSQL, otro proveedor nuevo |
| Backend propio (Node + Postgres) | Control total | Hosting, mantenimiento y seguridad a nuestro cargo; costo fijo |
| Solo exportar/importar JSON | Cero costo | No es una cuenta; ya existe parcialmente (historial) |

## 3. Autenticación

- **Google** (cuentas escolares incluidas) y **enlace mágico por correo**. Sin contraseñas propias.
- Opcional fase 2: **cuenta sin correo** (id + código para otro dispositivo), como en el ranking de
  rebuilt-sim, para estudiantes sin correo.
- Jugar **sin cuenta sigue funcionando igual** (modo local). La cuenta es opt-in.
- Credenciales necesarias de Xhavi: un proyecto Supabase, un cliente OAuth de Google (Google Cloud
  Console) y las URLs de redirección (`https://xhavisito.github.io/labbot-sim/` y `localhost:5173`).
  La `anon key` es pública por diseño (va en el build como `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY`, secretos de GitHub Actions); **nunca** se usa la `service_role` en el
  cliente.

## 4. Dónde se guardan los datos

Una tabla genérica, para no migrar el esquema cada vez que un store cambia de forma:

```sql
create table user_data (
  user_id    uuid references auth.users on delete cascade,
  key        text not null,            -- 'achievements', 'playtime', 'history', ...
  value      jsonb not null,           -- el mismo JSON que hoy va a localStorage
  version    int  not null default 1,  -- versión del formato del store (v1, v2…)
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table user_data enable row level security;
create policy "solo lo mío" on user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- Tamaño: límite por documento (p. ej. 256 KB, validado con un `check`) para que nadie llene la base.
- Perfil público mínimo (`profiles`: nombre visible, equipo) solo si luego se quiere ranking/torneos
  entre cuentas; **fuera del alcance de la primera entrega**.
- Todo dato personal = id de usuario + lo que el jugador genera. No se guardan IP ni analítica.

## 5. Costo aproximado

(Cifras del plan de Supabase al día de hoy; **verificar en supabase.com/pricing antes de aprobar**.)

| Concepto | Plan gratis | Pro |
|---|---|---|
| Usuarios activos/mes | 50 000 | 100 000 incluidos |
| Base de datos | 500 MB | 8 GB |
| Pausa por inactividad | Sí (~1 semana) | No |
| Precio | **$0** | **≈ $25 USD/mes** |

Estimación: un usuario ≈ 20–200 KB de JSON → 500 MB alcanza para miles de cuentas. Para un equipo y
su comunidad, el plan **gratis alcanza**. La pausa se mitiga con un ping programado (GitHub Action
semanal) o pasando a Pro si se vuelve crítico. Google OAuth, GitHub Pages y el dominio actual: $0.

## 6. Cómo cambia el código

Los stores ya tienen una costura limpia (`loadX()` / `saveX()` síncronos sobre `localStorage`), así
que **no se reescriben**:

1. `src/net/cloud.ts` (nuevo): cliente Supabase, sesión, `pull()`/`push(key)`; si faltan las
   variables `VITE_SUPABASE_*`, queda inactivo y todo sigue local (como la galería en rebuilt-sim).
2. `src/game/cloudSync.ts` (nuevo): lista de claves sincronizables (las `labbot.*` salvo `lang`,
   `settings` de dispositivo y `bindings`, que se quedan locales) y cola con *debounce* (~2 s) que
   sube lo que cambió. Cada `saveX` llama `markDirty(key)` (una línea por store).
3. `src/core/cloudMerge.ts` (nuevo, **puro y con pruebas Vitest**): reglas de mezcla por tipo.
4. `src/ui/AccountScreen.ts` (nuevo) + entrada en el menú: iniciar/cerrar sesión, estado de
   sincronización, "borrar mis datos de la nube", exportar JSON. Textos vía `t('clave')`.
5. `vite.config.ts` / CSP / `sw.js`: permitir el dominio de Supabase y no cachear sus respuestas.
6. `deploy.yml`: pasar las dos variables `VITE_*` desde los secretos del repo.
7. `docs/cuentas.sql` (nuevo): el SQL de arriba, versionado.

Offline: se lee y escribe siempre en `localStorage`; la nube es réplica. Sin red, se encola y se
sincroniza al volver.

## 7. Migración de lo que ya existe

Primer inicio de sesión en un dispositivo:

1. Se baja lo que haya en la nube (`pull`).
2. **Nube vacía** → se sube todo lo local tal cual (caso normal de quien ya jugaba).
3. **Nube con datos** → se mezcla por store (nunca se pierde nada sin avisar):
   - logros: unión (lo desbloqueado en cualquiera se conserva; el progreso numérico toma el mayor);
   - tiempo jugado y contadores: suma de los **incrementos desde la última sincronización** (se guarda
     una base por dispositivo para no contar doble);
   - historial, scouting, tiros, ciclos: unión por id con descarte de duplicados;
   - planes, rutas, robots propios, AUTO: unión por id; si el mismo id difiere, gana el más reciente
     y el otro se conserva como copia ("… (otro dispositivo)");
   - ajustes: se quedan por dispositivo.
4. Antes de mezclar se guarda una copia de respaldo local (`labbot.backup.<fecha>`) y se muestra un
   resumen ("Se combinaron 3 logros, +42 min jugados") con opción de deshacer.
5. Después: cada cambio sube solo, última escritura gana por documento salvo las reglas del punto 3.

## 8. Privacidad y menores

El equipo trabaja con estudiantes. Propongo: cuenta opcional, solo nombre visible + los datos del
juego, aviso de privacidad corto en la pantalla de cuenta, botón "borrar mi cuenta y mis datos"
(`on delete cascade`) y no publicar nada de la cuenta salvo que la persona lo active. **Decisión de
Xhavi/LamBot:** si se requiere permiso de padres o de la escuela para menores.

## 9. Plan de construcción (si se aprueba)

| Fase | Contenido | Pruebas |
|---|---|---|
| 1 | SQL + `cloud.ts` + login Google/enlace + pantalla de cuenta (sin sincronizar) | Vitest de sesión simulada |
| 2 | Sincronización de logros, tiempo jugado y historial + migración con respaldo | Vitest de `cloudMerge` (casos de conflicto, dos dispositivos, doble conteo) |
| 3 | Resto de los stores + cola offline | e2e con dos contextos de navegador |
| 4 | Opcional: perfil público / ranking, cuenta sin correo | — |

## 10. Preguntas abiertas para Xhavi

1. ¿Supabase gratis está bien, o prefieren pagar Pro para evitar la pausa por inactividad?
2. ¿Quién crea el proyecto Supabase y el cliente OAuth de Google (cuenta del equipo vs personal)?
3. ¿Google + correo bastan, o hace falta la cuenta sin correo desde el inicio?
4. ¿Requisito de permiso para menores (ver §8)?
5. ¿Las repeticiones también deben ir a la nube? (No recomendado: pesan MB cada una.)
