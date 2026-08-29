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
  '[data-qa="store-card"]',
  '[data-testid="store-card"]',
  'a[href*="/restaurantes/"][data-qa]',
  'div[class*="store-card"]',
  'a[href*="/restaurantes/"]',
] as const;

/** Nombre del restaurante dentro de una tarjeta. */
export const CARD_NAME = [
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
  '[data-qa="discount-badge"]',
  '[data-testid="discount"]',
  '[class*="discount"]',
  '[class*="badge"]',
] as const;

/** Texto secundario de la tarjeta (alcance, vigencia). */
export const CARD_SUBTITLE = [
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

/** Elemento que muestra la direccion de entrega activa en el header. */
export const ADDRESS_INDICATOR = [
  '[data-qa="address-label"]',
  '[data-testid="address"]',
  'header [class*="address"]',
  '[class*="AddressLabel"]',
  'header button[class*="location"]',
] as const;

/** Presencia de cualquiera de estos = sesion iniciada. */
export const LOGGED_IN_INDICATOR = [
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
  /\/orders?\b/i,
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
  /\/address/i,
  /\/account/i,
  /\/settings/i,
  /\/profile/i,
  /\/user\/preferences/i,
];

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
