/**
 * TODOS los selectores y patrones de texto de Rappi viven aqui.
 *
 * Rappi va a cambiar su HTML. Cuando eso pase, el arreglo es una edicion en
 * este archivo, y los fixtures de tests/ dicen cual selector se rompio.
 *
 * Cada entrada es una LISTA de candidatos que se prueban en orden, para que un
 * cambio menor de markup no tumbe la corrida entera.
 */

export const URLS = {
  home: 'https://www.rappi.com.co/',
  restaurants: 'https://www.rappi.com.co/restaurantes',
} as const;

/** Contenedor de una tarjeta de restaurante en el listado. */
export const RESTAURANT_CARD = [
  // Confirmados contra el DOM real de Rappi (2026-08-31).
  '[data-testid="store-item"]',
  '[data-qa^="store-item-restaurant"]',
  // Candidatos historicos: se dejan por si Rappi hace rollback.
  '[data-qa="store-card"]',
  '[data-testid="store-card"]',
  'a[href*="/restaurantes/"][data-qa]',
  'div[class*="store-card"]',
  'a[href*="/restaurantes/"]',
] as const;

/** Nombre del restaurante dentro de una tarjeta. */
export const CARD_NAME = [
  // El nombre real vive en el aria-label del <a> de la tarjeta; eso lo resuelve
  // el extractor antes de llegar a esta lista. Esto es el respaldo.
  '[data-qa="store-name"]',
  '[data-testid="store-name"]',
  'h3',
  'h2',
  '[class*="name"]',
] as const;

/**
 * Badge de descuento dentro de una tarjeta ("50% OFF", "2x1").
 *
 * El scraper concatena TODOS los matches de esta lista dentro de la tarjeta,
 * asi que un candidato demasiado amplio contamina badgeText y ese texto es el
 * que alimenta al parser. Por eso no esta '[class*="tag"]': matchea cualquier
 * clase que contenga "tag" en cualquier parte. Ante la duda, es preferible que
 * no matchee nada (fallo ruidoso) a que matchee de mas (dato equivocado).
 */
export const CARD_BADGE = [
  // Confirmado contra el DOM real: "56% OFF", "Hasta 50% Off".
  '[data-testid="percentage_tag"]',
  '[data-qa="discount-badge"]',
  '[data-testid="discount"]',
  '[class*="discount"]',
  '[class*="badge"]',
] as const;

/** Texto secundario de la tarjeta (alcance, vigencia). */
export const CARD_SUBTITLE = [
  '[data-testid="store-item-detail"]',
  '[data-qa="store-item-detail"]',
  '[data-qa="store-subtitle"]',
  '[class*="subtitle"]',
  '[class*="description"]',
  'p',
] as const;

/** Pestana o carrusel de ofertas/descuentos. Se hace clic (navegacion segura). */
export const OFFERS_TAB = [
  '[data-qa="offers-tab"]',
  'a[href*="ofertas"]',
  'a[href*="descuentos"]',
] as const;

/** Texto que identifica la seccion de ofertas cuando no hay selector estable. */
export const OFFERS_TAB_TEXT = /^(ofertas|descuentos|promociones)$/i;

/**
 * Rappi es una app Next.js y publica su propio estado en este <script>.
 *
 * Leer de ahi es mucho mas estable que adivinar clases CSS hasheadas: trae la
 * ciudad y el estado de sesion como datos, no como pixeles. Es la fuente
 * primaria; los selectores de DOM quedan como respaldo.
 *
 *   props.pageProps.location.city      -> "Chía"
 *   props.pageProps.commonData.isLoggedIn -> true
 *   props.pageProps.isAuthUser
 */
export const NEXT_DATA_ID = '__NEXT_DATA__';

/**
 * Elemento que muestra la direccion de entrega activa en el header.
 *
 * Ojo: en vivo el header muestra SOLO la calle ("Cl. 00 #0-00"), sin la
 * ciudad. Por eso la verificacion de Chia no puede depender de este texto y
 * usa la ciudad de __NEXT_DATA__.
 */
export const ADDRESS_INDICATOR = [
  '[data-qa="address-label"]',
  '[data-testid="address"]',
  'header [class*="address"]',
  '[class*="AddressLabel"]',
  'header button[class*="location"]',
] as const;

/** Presencia de cualquiera de estos = sesion iniciada. */
export const LOGGED_IN_INDICATOR = [
  // Confirmado: el avatar con la inicial del usuario.
  '[data-qa="user-icon"]',
  '[data-qa="user-menu"]',
  '[data-testid="user-menu"]',
  'header [class*="avatar"]',
  'button[class*="account"]',
] as const;

/** Presencia de cualquiera de estos = sesion caida. */
export const LOGGED_OUT_INDICATOR = [
  '[data-qa="login-button"]',
  'button[class*="signin"]',
  'a[href*="/login"]',
] as const;

/** Texto que delata un boton de compra. safeClick se niega a tocarlos. */
export const FORBIDDEN_CLICK_TEXT =
  /agregar|añadir|anadir|al carrito|pedir|ordenar|comprar|checkout|pagar|finalizar|guardar|cambiar dirección|cambiar direccion|editar/i;

/**
 * URLs que se abortan SIEMPRE, con cualquier metodo.
 *
 * Son rutas de compra: no las necesitamos ni para leer. Abortarlas de plano
 * significa que ni siquiera podemos cargar accidentalmente un carrito.
 */
export const BLOCKED_URL_PATTERNS: RegExp[] = [
  /\/cart/i,
  /\/checkout/i,
  /\/payment/i,
];

/**
 * URLs donde LEER esta permitido pero ESCRIBIR no.
 *
 * Ojo, esta distincion importa: Rappi renderiza la direccion activa del header
 * con un GET a algo tipo /api/address/current. Si abortaramos ese GET, el header
 * quedaria vacio y assertAddressMatches fallaria en cada corrida — el guard se
 * romperia a si mismo. Lo que hay que impedir es la ESCRITURA: cambiar la
 * direccion o un ajuste de la cuenta es un POST/PUT/PATCH/DELETE, y esos se
 * abortan aqui.
 */
export const READ_ONLY_URL_PATTERNS: RegExp[] = [
  // Visto en vivo: la home autenticada se alimenta de un GET a
  // /api/user-order-home/v3/orders. Bloquearlo dejaba la pagina a medio
  // renderizar. Leer pedidos no compra nada; comprar es un POST.
  /\/orders?\b/i,
  /\/address/i,
  /\/account/i,
  /\/settings/i,
  /\/profile/i,
  /\/user\/preferences/i,
];

/**
 * Archivos estaticos: bundles, hojas de estilo, fuentes, imagenes.
 *
 * Next.js sirve chunks con la ruta de su pagina dentro de la URL, asi que un
 * bundle legitimo puede llamarse .../chunks/pages/checkout/[storeType]-abc.js y
 * matchear la deny-list sin ser una llamada de compra. Un archivo estatico no
 * puede mutar nada: lo que compra es la peticion al API. Bloquearlos no suma
 * seguridad y sí puede romper el render de la SPA, que es justo lo que
 * necesitamos que funcione para poder leer las tarjetas.
 *
 * Solo aplica a metodos de lectura: un POST a un .js seguiria evaluandose.
 */
export const STATIC_ASSET_PATTERN =
  /\/_next\/static\/|\.(?:js|mjs|css|map|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)(?:\?|#|$)/i;

/** Metodos que no mutan estado. Todo lo demas se considera escritura. */
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/**
 * Metodos que mutan estado.
 *
 * Residual conocido: una mutacion GraphQL viaja como POST a /api/graphql y no
 * matchea ninguna ruta de arriba. Esa via queda cubierta por las otras dos capas
 * (safeClick y la allowlist de clics), no por la deny-list de red.
 */
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
