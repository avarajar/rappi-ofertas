# rappi-ofertas

Abre Rappi Colombia en un navegador con tu sesion, lee los restaurantes con
descuento y avisa por Discord los que estan en 50% o mas.

Corre a mano para probar, y por cron varias veces al dia.

---

## Instalacion

```bash
npm install
```

Esto tambien descarga Chromium (unos 150 MB) para Playwright. La primera vez se
demora.

---

## Login inicial

Solo se hace una vez.

**1. Configura el webhook de Discord**

```bash
cp .env.example .env
```

Abre `.env` y pon tu webhook en `DISCORD_WEBHOOK_URL`. Para sacarlo: en Discord,
sobre el canal donde quieres los avisos, **Editar canal > Integraciones >
Webhooks > Nuevo webhook > Copiar URL**.

**2. Inicia sesion en Rappi**

```bash
npm run login
```

Se abre una ventana de Chromium. Ahi:

1. Inicia sesion en Rappi con tu cuenta.
2. Cambia la direccion de entrega a **Chia**.
3. Espera a que carguen los restaurantes.
4. Vuelve a la terminal y presiona **ENTER**.

El script verifica que la sesion este activa y que la direccion sea Chia, y te
dice exactamente que fallo si algo no cuadra.

La sesion queda guardada en `.browser-profile/` (un perfil de Chromium aparte,
nunca tu Chrome del dia a dia). No hay que volver a hacer login salvo que Rappi
expire la sesion; cuando eso pase, la corrida falla con un error `SESSION` y solo
hay que repetir `npm run login`.

`login` tambien guarda el DOM real en `logs/dom-*.html` y una captura en
`logs/shot-*.png`. Sirven para calibrar los selectores (ver la ultima seccion).

---

## Uso

```bash
npm run dry-run   # imprime el mensaje en pantalla, NO envia nada
npm run check     # revisa y envia el reporte a Discord
```

`dry-run` funciona sin webhook configurado, asi que puedes probar todo el
pipeline antes de tocar Discord.

Otras banderas:

```bash
node dist/cli.js check --headful   # con navegador visible, para depurar
node dist/cli.js check --verbose   # log paso a paso
```

Codigos de salida: `0` si todo bien, `1` si algo fallo. El cron depende de eso.

---

## Cron

Para correr tres veces al dia (11:00, 17:00 y 20:00):

```bash
crontab -e
```

Y agrega:

```cron
0 11,17,20 * * * cd /Users/joselito/workspace/personal/rappi-ofertas && /opt/homebrew/opt/node@22/bin/node dist/cli.js check >> logs/cron.log 2>&1
```

Detalles que importan:

- **Ruta absoluta a `node`.** Cron corre con un `PATH` minimo y casi nunca
  encuentra `node` solo. Averigua la tuya con `which node`.
- **`cd` primero.** El script busca `.env`, `.browser-profile/` y `logs/` a
  partir del directorio actual.
- **Compila antes.** Cron ejecuta `dist/cli.js`, no el TypeScript. Corre
  `npm run build` despues de cada cambio (o `npm run check` a mano, que compila
  solo).
- **macOS:** puede que tengas que darle a `cron` **Acceso total al disco** en
  Ajustes del sistema > Privacidad y seguridad > Acceso total al disco
  (agregando `/usr/sbin/cron`), o el job falla sin explicacion.

---

## Logs

Cada corrida agrega una linea JSON a `logs/runs.jsonl`:

```json
{"timestamp":"2026-08-28T16:00:00.000Z","durationMs":18452,"outcome":"success","cardsSeen":86,"candidatesParsed":19,"offersMatched":3,"dryRun":false}
```

Cuando algo se rompa, mira en este orden:

| Campo | Que te dice |
|---|---|
| `outcome` | `success` o `failure`. |
| `errorCode` | `SESSION` (hay que volver a hacer login), `ADDRESS` (la direccion no es Chia), `SELECTOR` (Rappi cambio su HTML), `TIMEOUT`, `NOTIFY` (fallo Discord), `CONFIG`. |
| `cardsSeen` | Si es 0, el scraper quedo ciego. Eso es un fallo, nunca "no hay ofertas". |
| `candidatesParsed` | Tarjetas con descuento legible. Si `cardsSeen` es alto y esto es 0, se rompio el parseo del badge. |
| `failedSelector` | El selector exacto que fallo, cuando se sabe. |

El mensaje "Sin ofertas ≥50% hoy." se envia **en toda corrida exitosa**. Asi, un
canal en silencio significa siempre que el job murio, no que no hubo ofertas.

---

## Reglas de seguridad

El script **solo lee**. Nunca:

- compra ni agrega nada al carrito,
- hace un pedido ni pasa por checkout,
- cambia la direccion de entrega,
- toca ninguna configuracion de la cuenta.

Esto no depende de buena voluntad, esta forzado en el codigo por dos capas
independientes:

1. **Lista negra de red** (`installReadOnlyGuard`): aborta cualquier peticion a
   URLs de `cart`, `checkout`, `order`, `payment`, `address`, `account`,
   `settings` o `profile`, y cualquier peticion que no sea GET hacia ellas.
   Agregar al carrito o cambiar una direccion es una llamada HTTP: si la llamada
   no sale, el efecto no ocurre aunque se escape un clic.
2. **`safeClick`**: todo clic pasa por ahi, y se niega si el texto o el
   `aria-label` del elemento dice "agregar", "pedir", "comprar", "pagar",
   "guardar" o "cambiar".

Ademas **se detiene en vez de continuar** si la sesion se cayo o si la direccion
activa no es Chia. No hay modo degradado: prefiere fallar y avisar antes que
reportar datos de otra ciudad o de una cuenta deslogueada.

Y nunca inventa un descuento: si el texto de la tarjeta no se puede leer con
certeza, ese restaurante se omite. Lo que se imprime es siempre el texto literal
de la pantalla (`50% OFF`, `hasta 60%`, `2x1`), nunca un porcentaje calculado.

---

## Cuando Rappi cambie su HTML

Va a pasar. Cuando pase, el sintoma es un mensaje de fallo en Discord con codigo
`SELECTOR` y `cardsSeen: 0` en el log.

**El arreglo es editar un solo archivo: `src/selectors.ts`.** Ahi viven todos los
selectores CSS y patrones de texto. Cada entrada es una lista de candidatos que
se prueban en orden, asi que muchas veces basta con agregar el nuevo selector al
principio de la lista.

Para saber cual se rompio:

1. Corre `npm test`. Los tests de fixtures (`tests/*.test.ts` contra los HTML de
   `fixtures/`) prueban la extraccion del DOM sin red, y el que falle te dice si
   se rompio el nombre, el badge o el subtitulo.
2. Corre `npm run login` de nuevo para volcar el DOM autenticado real a
   `logs/dom-*.html`, y busca ahi como se llama ahora el elemento.
3. Actualiza `src/selectors.ts`, actualiza el fixture correspondiente en
   `fixtures/` y vuelve a correr `npm test`.
