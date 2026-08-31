# Calibracion de selectores

Los selectores de `src/selectors.ts` se escribieron SIN acceso al DOM
autenticado de Rappi. Los tests con fixtures prueban que la logica de
extraccion es correcta; NO prueban que los selectores le peguen al HTML real.
La primera corrida contra Rappi probablemente falle, y eso es el diseno
funcionando: preferimos un fallo ruidoso a una oferta inventada.

## Como hacer la pasada de calibracion

1. `npm run login` — abre el navegador, entras con tu cuenta, confirmas la
   direccion de Chia, presionas ENTER. El comando vuelca el DOM real a
   `logs/dom-<timestamp>.html` y un screenshot a `logs/shot-<timestamp>.png`.
2. Abre ese HTML y busca una tarjeta de restaurante con descuento.
3. Ajusta `src/selectors.ts`. Cada constante es una LISTA de candidatos que se
   prueban en orden: agrega el selector real AL PRINCIPIO en vez de reemplazar
   la lista, para no perder compatibilidad si Rappi hace rollback.
4. Actualiza los fixtures de `fixtures/` con markup real y corre `npm test`.

## Calibracion hecha el 2026-08-31 (sesion real, cuenta en Chia)

Los selectores dejaron de ser conjetura. Esto es lo que se confirmo en vivo:

| Que | Selector real | Nota |
|---|---|---|
| Tarjeta | `[data-testid="store-item"]` | es un `<a>`; tambien `data-qa="store-item-restaurant-<id>"` |
| Nombre | atributo `aria-label` de la tarjeta | mas limpio que el texto visible |
| Badge | `[data-testid="percentage_tag"]` | textos reales: `56% OFF`, `Hasta 50% Off` |
| Detalle | `[data-testid="store-item-detail"]` | tiempo de entrega y costo |
| Avatar | `[data-qa="user-icon"]` | aparece ~4s DESPUES del domcontentloaded |

**El hallazgo mas util: Rappi publica su propio estado** en el `<script
id="__NEXT_DATA__">` de Next.js.

```
props.pageProps.location.city          -> "Chía"
props.pageProps.commonData.isLoggedIn  -> true
```

Leer de ahi es mucho mas estable que adivinar clases CSS hasheadas, y es ahora
la fuente primaria de `assertLoggedIn` y `assertAddressMatches`. Los selectores
de DOM quedaron como respaldo.

Esto ademas resolvio el riesgo 2 de la lista de abajo, que resulto ser real: el
header muestra SOLO la calle (`Cl. 00 #0-00`), sin la palabra "Chia". Comparar
contra ese texto habria dado `AddressError` con la direccion correcta.

### El parser no necesito ni un cambio

Los 15 badges reales de la pagina parsearon bien a la primera, incluido el
rechazo de `$4,000 Off en Envío: Ver TyC` (es plata, no un porcentaje). El
riesgo 7 de abajo (badges sin palabra clave tipo `50% en pizzas`) no se
materializo: Rappi siempre escribe `OFF` u `Off`.

### Lo dificil no fueron los selectores: fue Rappi sirviendo dos paginas

La misma URL `/restaurantes` devuelve a veces el listado personalizado (30
tarjetas) y a veces una pagina SEO de "Top Marcas y Cadenas" con CERO enlaces de
restaurante. Se confirmo que no es un problema de selectores: en la variante
mala, hasta el candidato generico `a[href*="/restaurantes/"]` cuenta cero.

Peor: la variante mala se vuelve MAS frecuente cuanto mas rapido se recarga.
Tras unas 15 cargas seguidas durante la calibracion, empezo a salir siempre.
Parece mitigacion de bots.

Por eso `gotoListing` reintenta con backoff exponencial (4s, 8s, 16s, 20s) en vez
de recargar de inmediato. Si vas a depurar a mano, no martilles la pagina:
espera unos minutos entre corridas o vas a estar depurando el throttling en vez
de tu codigo.

## Riesgos conocidos, en orden de prioridad

Esto sale de la revision de los modulos de navegador y de scraping.

### 1. `CARD_BADGE` — contaminacion de texto

El scraper concatena todos los matches dentro de una tarjeta. Un candidato
amplio como `[class*="badge"]` sobre clases hasheadas de CSS-in-JS puede
arrastrar tiempos de entrega o calificaciones al `badgeText`, que es justo el
texto que lee el parser. Ya se quito `[class*="tag"]` por ser demasiado amplio.

Mitigacion parcial que ya existe: `parseDiscount` rechaza explicitamente
`30 min`, `50 minutos`, `4.5` y `$50.000`, asi que la basura tipica degrada a
`null` (tarjeta omitida) en vez de a un porcentaje falso.

Al calibrar: confirma si `data-qa="discount-badge"` o `data-testid="discount"`
existen de verdad. Si existen, recorta los candidatos por clase sin piedad.

### 2. `ADDRESS_INDICATOR` — el selector mas debil

`header [class*="address"]` y `[class*="AddressLabel"]` asumen nombres de clase
legibles, y Rappi probablemente usa clases hasheadas. Ademas el header podria
mostrar solo la calle ("Calle 5 #10-20") sin la palabra "Chia", lo que dispararia
`AddressError` aun con la direccion correcta.

Si pasa eso, la solucion NO es relajar la verificacion: es apuntar el selector al
elemento que si contiene la ciudad, o ajustar `EXPECTED_ADDRESS` en `.env` a algo
que si aparezca en pantalla. La regla 4 (parar si la direccion no es Chia) no se
negocia.

### 3. `LOGGED_IN_INDICATOR` — bloquea toda corrida

Por la regla 4 el estado ambiguo aborta. Si ninguno de esos selectores matchea
una pagina realmente logueada, TODA corrida de `check` falla con `SessionError`.
Es el comportamiento buscado, pero vuelve al volcado del DOM un prerrequisito
duro antes de programar el cron.

### 4. `RESTAURANT_CARD` — tarjetas basura

El ultimo candidato, `a[href*="/restaurantes/"]`, va a matchear links de
navegacion, breadcrumbs y footer. El scraper ya filtra matches anidados y
descarta tarjetas sin nombre, pero un link suelto podria colarse. El dano es
acotado: sin badge, `parseDiscount` devuelve `null` y la tarjeta se descarta.

### 5. `OFFERS_TAB_TEXT` — probablemente no matchea

Esta anclado a `^(ofertas|descuentos|promociones)$`, y las pestanas reales suelen
traer un contador o texto de icono ("Ofertas 24"). Radio de dano bajo: la pasada
de ofertas no es fatal y el listado principal igual se recorre. Pero
probablemente no haga nada en el primer contacto.

### 6. Deny-list de red vs. lecturas necesarias

Ya corregido, pero conviene verificarlo en vivo: `READ_ONLY_URL_PATTERNS`
permite GET a `/address` y `/account` justamente porque el header lee la
direccion con un GET. Al correr `login`, revisa en la consola si alguna peticion
abortada (`[guard] peticion bloqueada: ...`) era una lectura que la pagina
necesitaba. Si aparece alguna, hay que afinar el patron, no quitar el guard.

### 7. Como redacta Rappi los badges de descuento

`parseDiscount` exige que un porcentaje venga acompanado de contexto de
descuento para aceptarlo: una palabra clave (`OFF`, `dcto`, `desc`,
`descuento`), un guion delante (`-50%`), o que el badge sea SOLO el porcentaje
(`50%`). Es deliberadamente estricto, y es lo que hace que `100% natural` se
descarte en vez de reportarse como una oferta falsa.

El costo de esa estrictez: un badge tipo `50% en pizzas` (porcentaje, sin
palabra clave, no aislado) tambien se descarta. Si al calibrar resulta que
Rappi escribe asi sus badges reales, hay que relajar la verificacion
`hasContext` en `findDiscountCandidates` (`src/parse/discount.ts`) — pero
relajala con un test que siga descartando `100% natural`, porque ese es el caso
que la regla existe para atrapar.

Sintoma de que esto esta pasando: corridas que terminan en "Sin ofertas >=50%"
mientras en pantalla si se ven promociones grandes. Es el unico modo de fallo
silencioso que queda en el sistema, y por eso vale la pena revisarlo en la
primera corrida real.
