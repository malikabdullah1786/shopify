const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const crypto =require('crypto');
const nonce = require('nonce')();
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.static('public'));
app.use('/webhooks', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());

const port = process.env.PORT || 3000;

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SCOPES,
  HOST
} = process.env;

const ACTIVE_SHOPIFY_SHOPS = {};

app.get('/', (req, res) => {
  res.send('Hello from the Shopify Customizer App!');
});

app.get('/shopify', (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    const state = nonce();
    const redirectUri = `${HOST}/shopify/callback`;
    const installUrl = `https://{shop}.myshopify.com/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}` +
      `&scope=${SHOPIFY_SCOPES}&state=${state}&redirect_uri=${redirectUri}`;

    res.cookie('state', state);
    res.redirect(installUrl.replace('{shop}', shop));
  } else {
    return res.status(400).send('Missing shop parameter. Please add ?shop=your-development-shop.myshopify.com to your request');
  }
});

app.get('/shopify/callback', (req, res) => {
  const { shop, hmac, code, state } = req.query;
  const stateCookie = req.cookies.state;

  if (state !== stateCookie) {
    return res.status(403).send('Request origin cannot be verified');
  }

  if (shop && hmac && code) {
    const map = Object.assign({}, req.query);
    delete map['hmac'];
    const message = new URLSearchParams(map).toString();
    const providedHmac = Buffer.from(hmac, 'utf-8');
    const generatedHash = Buffer.from(
      crypto
        .createHmac('sha256', SHOPIFY_API_SECRET)
        .update(message)
        .digest('hex'),
        'utf-8'
      );
    let hashEquals = false;
    try {
      hashEquals = crypto.timingSafeEqual(generatedHash, providedHmac)
    } catch (e) {
      hashEquals = false;
    };

    if (!hashEquals) {
      return res.status(400).send('HMAC validation failed');
    }

    const accessTokenRequestUrl = `https://{shop}/admin/oauth/access_token`.replace('{shop}',shop);
    const accessTokenPayload = {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    };

    axios.post(accessTokenRequestUrl, accessTokenPayload)
      .then((accessTokenResponse) => {
        const accessToken = accessTokenResponse.data.access_token;
        ACTIVE_SHOPIFY_SHOPS[shop] = accessToken;

        res.redirect(`/dashboard?shop=${shop}`);
      })
      .catch((error) => {
        res.status(500).send(error.message);
      });

  } else {
    res.status(400).send('Required parameters missing');
  }
});

app.get('/dashboard', (req, res) => {
    const shop = req.query.shop;
    if (ACTIVE_SHOPIFY_SHOPS[shop]) {
        registerScriptTag(shop);
        registerOrderCreateWebhook(shop);
        res.send('<h1>Welcome!</h1><p>The product customizer has been injected, and webhooks are registered.</p>');
    } else {
        res.redirect(`/shopify?shop=${shop}`);
    }
});

app.post('/webhooks/orders/create', (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body; // This is a raw buffer
    const shop = req.get('X-Shopify-Shop-Domain');

    const generatedHash = crypto
        .createHmac('sha256', SHOPIFY_API_SECRET)
        .update(body)
        .digest('base64');

    if (generatedHash === hmac) {
        console.log('Webhook verified successfully.');
        const order = JSON.parse(body.toString());

        processOrder(order, shop);

        res.sendStatus(200);
    } else {
        console.log('Webhook verification failed.');
        res.sendStatus(403);
    }
});

function processOrder(order, shop) {
    const itemsToFulfill = [];
    order.line_items.forEach(item => {
        const customDesignProp = item.properties.find(p => p.name === '_custom_design');
        if (customDesignProp) {
            itemsToFulfill.push({
                line_item: item,
                design_data_url: customDesignProp.value
            });
        }
    });

    if (itemsToFulfill.length > 0) {
        sendToPodService(order, itemsToFulfill);
    }
}

function sendToPodService(order, itemsToFulfill) {
    console.log('--- Sending to POD Service ---');
    console.log('Order ID:', order.id);
    console.log('Shipping Address:', order.shipping_address);

    itemsToFulfill.forEach(item => {
        console.log('  - Line Item:', item.line_item.name);
        console.log('    SKU:', item.line_item.sku);
        console.log('    Quantity:', item.line_item.quantity);
        // Log a snippet of the base64 data to avoid flooding the console
        console.log('    Design Data:', item.design_data_url.substring(0, 80) + '...');
    });

    console.log('-----------------------------');
    // Here you would make an API call to your POD service (e.g., Printify)
    // with the order details and the base64 design data for each item.
}

function registerScriptTag(shop) {
    // NOTE: This uses the legacy ScriptTag API.
    // For modern Shopify themes (Online Store 2.0), the recommended approach is to use a Theme App Extension
    // with an app block. This provides a better merchant experience and is the standard for new apps.
    // This implementation uses ScriptTag for simplicity in this environment, as Theme App Extensions
    // require the Shopify CLI and a more complex setup.
    const accessToken = ACTIVE_SHOPIFY_SHOPS[shop];
    const shopifyApiUrl = `https://{shop}/admin/api/2023-10/script_tags.json`.replace('{shop}', shop);

    const scriptTagPayload = {
        script_tag: {
            event: 'onload',
            src: `${HOST}/customizer.js`
        }
    };

    const headers = {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
    };

    axios.post(shopifyApiUrl, scriptTagPayload, { headers })
        .then(response => {
            console.log('Script tag created successfully for', shop);
        })
        .catch(error => {
            if (error.response && error.response.data.errors.src) {
                console.log('Script tag already exists for', shop);
            } else {
                console.error('Error creating script tag for', shop, error.response ? error.response.data : error.message);
            }
        });
}

function registerOrderCreateWebhook(shop) {
    const accessToken = ACTIVE_SHOPIFY_SHOPS[shop];
    const shopifyApiUrl = `https://{shop}/admin/api/2023-10/webhooks.json`.replace('{shop}', shop);

    const webhookPayload = {
        webhook: {
            topic: 'orders/create',
            address: `${HOST}/webhooks/orders/create`,
            format: 'json'
        }
    };

    const headers = {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
    };

    axios.post(shopifyApiUrl, webhookPayload, { headers })
        .then(response => {
            console.log('orders/create webhook registered successfully for', shop);
        })
        .catch(error => {
            if (error.response && error.response.data.errors.address) {
                console.log('Webhook already exists for', shop);
            } else {
                console.error('Error registering orders/create webhook for', shop, error.response ? error.response.data : error.message);
            }
        });
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});