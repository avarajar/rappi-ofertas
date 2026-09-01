<div align="center">

# 🍔 rappi-ofertas

**Vigila Rappi Colombia y te avisa por Discord cuando hay restaurantes con 50% o más de descuento.**

Corre solo, varias veces al día, en tu propio navegador con tu sesión.

<br>

![Node](https://img.shields.io/badge/Node-22-5FA04E?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-1.62-2EAD33?logo=playwright&logoColor=white)
![Tests](https://img.shields.io/badge/tests-238%20passing-success)
![Discord](https://img.shields.io/badge/Discord-webhook-5865F2?logo=discord&logoColor=white)

</div>

---

## Qué recibes

```
Ofertas Rappi ≥50% — Chía (5)
- Muy — 74% OFF — ⚠️ alcance no confirmado
- Cali Mio - Pollo — 56% OFF — ⚠️ alcance no confirmado
- La Cuadra — Hasta 54% Off (tope, puede ser menos) — ⚠️ solo productos seleccionados
- Dunkin' — Hasta 50% Off (tope, puede ser menos) — ⚠️ alcance no confirmado
- Kokoriko - Pollo — Hasta 50% Off (tope, puede ser menos) — ⚠️ solo primer pedido
```

Y cuando no hay nada, exactamente esto — ni una palabra más:

```
Sin ofertas ≥50% hoy.
```

> **El mensaje vacío se envía siempre.** Así el silencio del canal significa una sola cosa:
> el job está muerto. Nunca "hoy no había ofertas".

---

## Cómo funciona

```
   ┌─────────────────┐
   │  launchd 11/17/20│   tres veces al día; si el Mac dormía, corre al despertar
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │ Chromium + sesión │   perfil propio en .browser-profile/, nunca tu Chrome diario
   └────────┬──────────┘
            ▼
   ┌──────────────────┐
   │  ¿sesión? ¿Chía?  │──✗──▶  para y avisa el fallo   (nunca sigue a medias)
   └────────┬──────────┘
            ▼
   ┌──────────────────┐
   │ scroll + tarjetas │   espera al DOM, no a un reloj
   └────────┬──────────┘
            ▼
   ┌──────────────────┐
   │ parseo + filtro   │   "56% OFF" ✓   "Hasta 50% Off" ✓   "$4.000 Off" ✗
   └────────┬──────────┘
            ▼
        📨 Discord
```

---

## Empezar

```bash
npm install                    # incluye la descarga de Chromium (~150 MB)
cp .env.example .env           # pon tu webhook de Discord
npm run login                  # inicia sesión y confirma tu dirección
npm run dry-run                # prueba todo sin enviar nada
```

<details>
<summary><b>Cómo sacar el webhook de Discord</b></summary>

<br>

En el canal donde quieras los avisos: **Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL**.

Pégalo en `.env` como `DISCORD_WEBHOOK_URL`. No hace falta para `npm run dry-run`.

</details>

<details>
<summary><b>Qué pasa en el login inicial</b></summary>

<br>

Se abre una ventana de Chromium. Inicias sesión con tu cuenta y confirmas que la dirección
de entrega sea la tuya. **No tienes que presionar nada**: el script detecta solo cuándo la
sesión quedó lista y se cierra.

La sesión queda guardada en `.browser-profile/` y se reusa en todas las corridas siguientes.
Solo vuelves a hacer login si expira — y cuando pase, te llega un aviso a Discord.

</details>

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run login` | Login manual la primera vez. Guarda la sesión y vuelca el DOM real a `logs/`. |
| `npm run dry-run` | Corre todo e imprime el mensaje. **No envía nada y no necesita webhook.** |
| `npm run check` | La corrida real. Es la que usa el agendador. |
| `npm test` | 238 tests. |
| `npm run typecheck` | `tsc` sobre `src` y `tests`. |

Códigos de salida: **`0`** éxito · **`1`** fallo. El agendador depende de eso.

---

## Configuración

Todo vive en `.env`. Copia `.env.example` y ajusta:

| Variable | Default | Para qué |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | — | A dónde llega el reporte. Solo se necesita para `check`. |
| `EXPECTED_ADDRESS` | `Chía` | Ciudad que debe estar activa. Se verifica ignorando tildes y **es lo que sale en el mensaje**. |
| `BROWSER_PROFILE_DIR` | `.browser-profile` | Dónde vive la sesión guardada. |
| `SCRAPE_TIMEOUT_MS` | `600000` | Tope de la corrida completa, con reintentos. |
| `MAX_SCROLL_STEPS` | `40` | Cuánto baja por el listado. |

---

## Corridas automáticas

En macOS se usa **`launchd`**, no `cron`, y la diferencia importa: si el Mac estaba dormido
a la hora programada, launchd ejecuta el trabajo al despertar. Cron pierde esa corrida sin decir nada.

```bash
./scripts/install-schedule.sh              # 11:00, 17:00 y 20:00
./scripts/install-schedule.sh 9 14 19 22   # o las horas que quieras
```

El script arma el plist con las rutas de tu máquina y avisa si falta `dist/` o la sesión,
que son los dos motivos por los que una corrida programada fallaría en silencio.

```bash
launchctl list | grep rappi                 # el 2º campo es el último exit code
launchctl kickstart -p gui/$(id -u)/com.rappi-ofertas.check
./scripts/uninstall-schedule.sh
```

No reintenta al fallar, a propósito: recargar rápido es justo lo que hace que Rappi deje de
servir el listado, y el fallo ya te llega por Discord.

---

## 🔒 Reglas duras

Este script tiene acceso a una cuenta con métodos de pago guardados. Las garantías no son
promesas en un comentario: están hechas cumplir en tres capas independientes.

| | Regla | Cómo se hace cumplir |
|---|---|---|
| **1** | Nunca compra | Deny-list de red: aborta toda petición a rutas de carrito, checkout, pedidos y pago. |
| **2** | Nunca toca tu cuenta | Toda escritura a dirección, ajustes, perfil o pagos se aborta. Las lecturas sí pasan. |
| **3** | Nunca inventa un descuento | Se imprime el texto literal de pantalla. Si no se puede leer, se omite el restaurante. |
| **4** | Nunca sigue en mal estado | Sesión caída o ciudad distinta ⇒ para y avisa. Jamás cambia la dirección. |
| **5** | Nunca falla en silencio | Selector roto, timeout o sesión muerta ⇒ fallo explícito, nunca un resultado vacío. |

Además, **cada clic pasa por `safeClick`**, que lee el texto y el `aria-label` del elemento y
se niega si parece un botón de compra. El scraper solo hace clic en pestañas y enlaces de tarjeta.

> **Por qué `percent` nunca se imprime.** El porcentaje existe solo para filtrar y ordenar.
> Lo que ves siempre es `literal`, el texto tal cual salió en pantalla. Por eso un `2x1` cuenta
> como 50% para el filtro pero jamás se anuncia como "50%": ese número Rappi nunca lo mostró.

---

## Cuando algo falle

Te va a llegar un mensaje que empieza con ⚠️ y dice qué pasó. Esta tabla es el manual:

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `SESSION` | La sesión de Rappi expiró | `npm run login` otra vez |
| `ADDRESS` | La ciudad activa no es la esperada | `npm run login` y cámbiala tú. El job nunca la cambia solo. |
| `SELECTOR` | No leyó ninguna tarjeta | **Primero sospecha del throttling**, no del HTML. Ver abajo. |
| `TIMEOUT` | Rappi tardó demasiado | Reintenta; si se repite, sube `SCRAPE_TIMEOUT_MS` |
| `NOTIFY` | Falló el envío a Discord | Revisa que el webhook siga vivo |
| `CONFIG` | Falta una variable | Compara tu `.env` contra `.env.example` |

<details>
<summary><b>⚠️ Sobre <code>SELECTOR</code>: casi nunca es lo que parece</b></summary>

<br>

Rappi devuelve **dos variantes distintas** de la misma URL: el listado personalizado con
tarjetas, y una página SEO de "Top Marcas y Cadenas" que no tiene ninguna. Es aleatorio por
petición, y empeora cuanto más rápido recargas.

Medido cargando el listado diez veces seguidas:

```
directo:              30 · 0 · 30 · 30 · 0     ~60% de éxito
pasando por la home:   0 · 30 ·  0 ·  0 · 0    peor: más peticiones, más throttling
```

Por eso cada corrida gasta **una sola navegación** y reintenta pocas veces bien espaciadas
(15s → 30s → 60s). Si depuras a mano, **espera entre intentos** o estarás depurando su
mitigación de bots en vez de tu código.

Solo si `SELECTOR` se repite durante todo un día es realmente un cambio de HTML.

</details>

---

## Cuando Rappi cambie su HTML

Va a pasar. Todo lo frágil está aislado en **un solo archivo**: [`src/selectors.ts`](src/selectors.ts).

1. `npm run login` — vuelca el DOM real a `logs/dom-<timestamp>.html`
2. Compara contra `fixtures/` y ajusta `src/selectors.ts`
3. Cada selector es una **lista de candidatos** que se prueban en orden: agrega el nuevo
   al principio en vez de reemplazar, así no pierdes compatibilidad si hacen rollback
4. Actualiza los fixtures y corre `npm test`

📄 **[`docs/calibration.md`](docs/calibration.md)** tiene los selectores reales confirmados
contra el sitio en vivo, y las zonas de riesgo en orden de prioridad.

---

## Arquitectura

```
src/
├── cli.ts                  login | check ; --dry-run --headful --verbose
├── config.ts               carga y valida .env, falla ruidosamente
├── errors.ts               jerarquía de errores tipados
├── selectors.ts            ⚠️  TODOS los selectores de Rappi, aislados aquí
├── browser/
│   ├── session.ts          launchPersistentContext, login visible, corrida headless
│   └── guards.ts           deny-list de red, safeClick, sesión y ciudad
├── scrape/restaurants.ts   navegación con reintentos, scroll infinito, cosecha
├── parse/discount.ts       🧪 PURO: texto → descuento | null
├── parse/scope.ts          🧪 PURO: texto → alcance + vigencia
├── report/format.ts        🧪 PURO: ofertas → mensaje
├── notify/discord.ts       POST al webhook con reintentos
└── log/runlog.ts           una línea JSONL por corrida
```

Los módulos **🧪 PURO** reciben strings y devuelven datos: sin navegador y sin red. Ahí vive
la lógica riesgosa y ahí se concentran los tests. Todo lo que toca el navegador es una capa
delgada alrededor.

La extracción del DOM se prueba contra **fixtures HTML guardados**, sin red, así los tests son
deterministas y además señalan cuál selector se rompió.

---

## Logs

Una línea JSON por corrida en `logs/runs.jsonl`:

```json
{"timestamp":"2026-09-01T16:00:10Z","outcome":"success","cardsSeen":30,
 "candidatesParsed":24,"offersMatched":5,"durationMs":5077,"dryRun":false}
```

`cardsSeen: 0` con `outcome: failure` es la firma de que Rappi no entregó el listado.
`candidatesParsed` alto con `offersMatched: 0` significa que sí leyó descuentos, pero
ninguno llegaba al 50%.

---

<div align="center">
<sub>Solo lectura y navegación. Nunca compra, nunca cambia tu cuenta, nunca inventa un descuento.</sub>
</div>
