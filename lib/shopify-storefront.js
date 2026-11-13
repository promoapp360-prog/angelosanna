'use strict';

const API_VERSION = '2026-04';
const CONFIG_CACHE_MS = 60_000;
const COURSE_QUERY = `query CourseForCheckout($handle: String!) {
  product(handle: $handle) {
    id
    title
    availableForSale
    variants(first: 10) {
      nodes {
        id
        availableForSale
        price { amount currencyCode }
      }
    }
  }
}`;

let cachedConfig = null;
const courseCache = new Map();

function getConnectorCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : '';
  if (!hostname || !token) throw new Error('Connessione Shopify non disponibile.');
  return { hostname, token };
}

async function getStorefrontConfig(forceRefresh = false) {
  if (cachedConfig && !forceRefresh && Date.now() < cachedConfig.expiresAt) {
    return cachedConfig.value;
  }

  const { hostname, token } = getConnectorCredentials();
  const protocol = hostname.startsWith('localhost') ? 'http' : 'https';
  const url = new URL(`${protocol}://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'shopify-store');
  url.searchParams.set('refresh_policy', 'none');

  const response = await fetch(url, {
    headers: { Accept: 'application/json', X_REPLIT_TOKEN: token },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Impossibile leggere la connessione Shopify.');

  const data = await response.json().catch(() => ({}));
  const settings = data.items?.[0]?.settings;
  if (
    !settings?.shop_domain ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(settings.shop_domain) ||
    !settings.storefront_access_token
  ) {
    throw new Error('Shopify non ha ancora configurato il checkout.');
  }

  cachedConfig = {
    value: {
      shopDomain: settings.shop_domain,
      storefrontAccessToken: settings.storefront_access_token,
    },
    expiresAt: Date.now() + CONFIG_CACHE_MS,
  };
  return cachedConfig.value;
}

async function storefrontRequest(query, variables = {}, retry = true) {
  const config = await getStorefrontConfig();
  const response = await fetch(
    `https://${config.shopDomain}/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': config.storefrontAccessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if ((response.status === 401 || response.status === 403) && retry) {
    cachedConfig = null;
    await getStorefrontConfig(true);
    return storefrontRequest(query, variables, false);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors?.length) {
    throw new Error('Il checkout Shopify non è raggiungibile.');
  }
  return json.data;
}

async function getShopifyCourse(handle) {
  const cached = courseCache.get(handle);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const data = await storefrontRequest(COURSE_QUERY, { handle });
  const product = data?.product;
  if (!product?.availableForSale) {
    courseCache.set(handle, { value: null, expiresAt: Date.now() + 30_000 });
    return null;
  }
  const variant = product.variants?.nodes?.find((item) => item.availableForSale);
  if (!variant || variant.price?.currencyCode !== 'EUR') return null;
  const amount = Number(variant.price.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const value = {
    handle,
    title: product.title,
    variantId: variant.id,
    price: Math.round(amount * 100),
  };
  courseCache.set(handle, { value, expiresAt: Date.now() + 30_000 });
  return value;
}

async function createShopifyCheckout(variantId, quantity, email) {
  const mutation = `mutation CreateCourseCart($variantId: ID!, $quantity: Int!, $email: String!) {
    cartCreate(input: {
      lines: [{ merchandiseId: $variantId, quantity: $quantity }],
      buyerIdentity: { email: $email }
    }) {
      cart { checkoutUrl }
      userErrors { field message }
    }
  }`;
  const data = await storefrontRequest(mutation, { variantId, quantity, email });
  const result = data?.cartCreate;
  if (result?.userErrors?.length) {
    console.error('Shopify cartCreate rifiutato:', result.userErrors.map((error) => error.message).join('; '));
    throw new Error('Shopify non ha potuto creare il checkout. Riprova o scrivici su WhatsApp.');
  }
  if (!result?.cart?.checkoutUrl) {
    throw new Error('Shopify non ha restituito il link di pagamento.');
  }
  const checkoutUrl = new URL(result.cart.checkoutUrl);
  if (checkoutUrl.protocol !== 'https:') {
    throw new Error('Shopify ha restituito un link di checkout non valido.');
  }
  if (process.env.SHOPIFY_DEV_STORE_PREVIEW === 'true') {
    checkoutUrl.searchParams.set('channel', 'online_store');
  }
  return checkoutUrl.toString();
}

async function adminRequest(query, variables = {}) {
  const { hostname, token } = getConnectorCredentials();
  const protocol = hostname.startsWith('localhost') ? 'http' : 'https';
  const response = await fetch(
    `${protocol}://${hostname}/api/v2/proxy/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Replit-Token': token,
        'Connector-Name': 'shopify-store',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors?.length) {
    throw new Error('Impossibile aggiornare il corso su Shopify.');
  }
  return json.data;
}

async function syncShopifyCourse(product, handle) {
  const found = await adminRequest(
    'query FindCourse($handle: String!) { shop { currencyCode } productByHandle(handle: $handle) { id variants(first: 10) { nodes { id } } } }',
    { handle },
  );
  if (found?.shop?.currencyCode !== 'EUR') {
    throw new Error('Imposta la valuta dello store Shopify su EUR prima di aggiornare o pubblicare il corso.');
  }
  const shopProduct = found?.productByHandle;
  const variant = shopProduct?.variants?.nodes?.[0];
  if (!shopProduct || !variant) {
    throw new Error('Il prodotto del corso non è stato trovato nello store Shopify.');
  }

  const update = await adminRequest(
    'mutation UpdateCourse($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }',
    {
      product: {
        id: shopProduct.id,
        title: product.titolo,
        descriptionHtml: product.descrizione || '',
        status: product.pubblicato && product.prezzo > 0 ? 'ACTIVE' : 'DRAFT',
      },
    },
  );
  const updateErrors = update?.productUpdate?.userErrors || [];
  if (updateErrors.length) throw new Error('Shopify ha rifiutato l’aggiornamento del corso.');

  if (product.prezzo > 0) {
    const priceUpdate = await adminRequest(
      'mutation UpdateCoursePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }',
      {
        productId: shopProduct.id,
        variants: [{ id: variant.id, price: (product.prezzo / 100).toFixed(2) }],
      },
    );
    const priceErrors = priceUpdate?.productVariantsBulkUpdate?.userErrors || [];
    if (priceErrors.length) throw new Error('Shopify ha rifiutato l’aggiornamento del prezzo.');
  }

  const publications = await adminRequest(
    'query CoursePublications { publications(first: 20) { nodes { id name } } }',
  );
  const replitPublication = publications?.publications?.nodes?.find((item) => item.name === 'Replit');
  if (!replitPublication) throw new Error('Il canale Shopify di Replit non è disponibile.');
  const mutation = product.pubblicato && product.prezzo > 0
    ? 'mutation PublishCourse($id: ID!, $publicationId: ID!) { publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) { userErrors { field message } } }'
    : 'mutation UnpublishCourse($id: ID!, $publicationId: ID!) { publishableUnpublish(id: $id, input: [{ publicationId: $publicationId }]) { userErrors { field message } } }';
  const publicationUpdate = await adminRequest(mutation, {
    id: shopProduct.id,
    publicationId: replitPublication.id,
  });
  const publicationResult = product.pubblicato && product.prezzo > 0
    ? publicationUpdate?.publishablePublish
    : publicationUpdate?.publishableUnpublish;
  if (publicationResult?.userErrors?.length) {
    throw new Error('Shopify ha rifiutato l’aggiornamento della pubblicazione.');
  }

  cachedConfig = null;
  courseCache.clear();
}

module.exports = {
  getShopifyCourse,
  createShopifyCheckout,
  syncShopifyCourse,
};
