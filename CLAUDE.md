# rappi-ofertas — Project Instructions

## Overview

Un job automatizado que abre Rappi Colombia (rappi.com.co) en un navegador real
con la sesion del usuario ya iniciada, lee los badges de descuento de las
tarjetas de restaurantes, se queda solo con las promociones de 50% o mas, y
publica un resumen corto en Discord. Corre a mano para pruebas y por cron varias
veces al dia.

La direccion de entrega de la cuenta esta en Chia, Cundinamarca, y el contenido
de Rappi depende de ella: si la direccion activa no es Chia, el resultado seria
de otra ciudad, asi que el script se detiene en vez de continuar.

## Reglas duras (no negociables)

Estas reglas vienen del usuario y estan por encima de cualquier conveniencia de
implementacion. Si una tarea futura parece requerir romperlas, para y pregunta.

1. **Nunca comprar.** Ni "agregar al carrito", ni "pedir", ni checkout, ni ningun
   boton de compra.
2. **Nunca mutar la cuenta.** Ni direccion, ni idioma, ni metodo de pago, ni
   notificaciones, ni ningun ajuste. Solo lectura y navegacion.
3. **Nunca inventar un descuento.** Se reporta solo lo que la pantalla dice
   literalmente. Si el dato no se puede leer con confianza, se omite ese
   restaurante en lugar de adivinar.
4. **Nunca continuar en mal estado.** Sesion caida o direccion distinta a Chia =
   parar y avisar.
5. **Nunca fallar en silencio.** Un selector roto, un timeout o una sesion muerta
   se reportan como fallo, jamas como un resultado vacio.

### Como se hacen cumplir 1 y 2

Tres capas independientes, en `src/browser/guards.ts`:

- **Deny-list de red.** `installReadOnlyGuard` aborta cualquier request cuya URL
  matchee `BLOCKED_URL_PATTERNS` (cart, checkout, orders, payment, address,
  account, settings, profile). Agregar al carrito o cambiar direccion es una
  llamada HTTP; si la llamada no sale, el efecto no ocurre.
  Ojo: NO se bloquean todos los POST — Rappi carga contenido normal por POST y
  bloquearlos romperia la pagina. Solo importa la deny-list de URLs.
- **`safeClick`.** Todo clic del codebase pasa por aqui. Lee el texto y el
  aria-label del elemento y lanza `ForbiddenActionError` si matchea
  `FORBIDDEN_CLICK_TEXT`.
- **Allowlist de clics.** El scraper solo hace clic en pestanas y links de
  tarjeta. Nada mas.

## Architecture

Node 22 + TypeScript ESM, compilado con `tsc` a `dist/`. Playwright Chromium con
`launchPersistentContext` sobre un `user-data-dir` propio (`.browser-profile/`),
nunca el Chrome diario del usuario. Vitest para tests. Discord incoming webhook
para la entrega. Sin servidor y sin base de datos: el estado es el perfil del
navegador mas los logs JSONL.

```
src/
  cli.ts              comandos login | check ; flags --dry-run --headful --verbose
  config.ts           carga y valida .env, falla ruidosamente
  errors.ts           jerarquia de errores tipados
  types.ts            modelo de datos compartido
  selectors.ts        TODOS los selectores de Rappi, aislados
  browser/session.ts  launchPersistentContext, login visible, corrida headless
  browser/guards.ts   assertLoggedIn, assertAddressMatches, read-only guard, safeClick
  scrape/restaurants.ts  navegacion, pestana Ofertas, scroll infinito, cosecha de tarjetas
  parse/discount.ts   PURO: texto -> ParsedDiscount | null
  parse/scope.ts      PURO: texto -> PromoScope + deadline
  report/format.ts    PURO: Offer[] -> mensaje de Discord
  notify/discord.ts   POST al webhook con reintentos
  log/runlog.ts       una linea JSONL por corrida
tests/                units de vitest y tests con fixtures HTML
fixtures/             HTML guardado de tarjetas, para tests de DOM offline
```

Los modulos marcados PURO reciben strings y devuelven datos: sin navegador y sin
red. Ahi vive la logica riesgosa y ahi se concentran los tests. Todo lo que toca
el navegador es una capa delgada alrededor.

## Decisiones clave

- **`percent` nunca se imprime.** Existe solo para filtrar (>=50) y ordenar. Lo
  que ve el usuario es siempre `literal`, el texto tal cual salio en pantalla.
  Esa separacion es lo que hace cumplir la regla 3.
- **`2x1` cuenta como 50%** para el filtro, pero se reporta como `2x1`, nunca
  reescrito como un porcentaje que Rappi no mostro. Igual `hasta 60%`: se usa el
  60 para ordenar y se muestra como techo.
- **`unknown` es una respuesta honesta** para el alcance de una promo. Nunca se
  asume `full-menu`: eso seria inventar una afirmacion.
- **Cero tarjetas != sin ofertas.** Si el DOM no devuelve ninguna tarjeta donde
  se esperaban, eso es `SelectorError` (Rappi cambio su HTML) y se reporta como
  fallo. Confundir esto con "no hay ofertas hoy" es el peor bug posible aqui.
- **El mensaje vacio se envia en cada corrida** (decision del usuario), asi el
  silencio del canal siempre significa que el job esta muerto, no que no habia
  ofertas.
- **Texto exacto obligatorio** cuando no hay nada: `Sin ofertas ≥50% hoy.` — con
  ese caracter `≥` y ese punto final. Hay un test que lo fija.

## Development

```
npm install        # incluye la descarga de Chromium
npm run login      # login manual la primera vez, guarda la sesion
npm run dry-run    # corre todo e imprime, sin enviar nada y sin webhook
npm run check      # la corrida real, la que usa el cron
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Exit codes: 0 exito, 1 fallo. El cron depende de eso.

## Cuando Rappi cambie su HTML

Va a pasar. La senal es un `SelectorError` en Discord y en `logs/runs.jsonl`.

1. Corre `npm run login` — vuelca el DOM real a `logs/dom-<timestamp>.html`.
2. Compara contra `fixtures/` y ajusta `src/selectors.ts`. Es el unico archivo
   que deberia hacer falta tocar.
3. Cada selector es una LISTA de candidatos que se prueban en orden; agrega el
   nuevo al principio en vez de reemplazar, para no perder compatibilidad.
4. Actualiza los fixtures y corre `npm test`.

## Conventions

- Conventional commits.
- Tests para toda logica de parseo nueva; los modulos puros no tienen excusa para
  quedarse sin test.
- Los comentarios explican el porque, no el que.
- Codigo y mensajes al usuario en espanol; identificadores en ingles.
- Sin acentos en los comentarios de codigo, para evitar lios de encoding.
- Self-review del diff antes de pedir revision.

## Integrations

When I ask you to create an issue, use Linear.
When I ask you to document something, use Notion.
When I reference a conversation, check Slack.
