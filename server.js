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
  HOST,
  SHOPIFY_API_VERSION
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
    // --- THIS IS A PLACEHOLDER FOR REAL POD INTEGRATION ---
    // In a production app, you would make an API call to your Print-on-Demand (POD) service here.
    // This example simulates sending the order to Printify.

    console.log('--- Simulating: Sending to POD Service (e.g., Printify) ---');

    // 1. You would need the merchant's Printify API token.
    //    This should be securely stored, likely retrieved when they configure the app.
    const PRINTIFY_API_TOKEN = 'your_printify_api_token_here';

    // 2. You need to map the Shopify variant SKU to the Printify product and variant IDs.
    //    This mapping is crucial and is usually configured by the merchant in your app's dashboard.
    //    For example, `SKU-TSHIRT-BLK-M` might map to Printify's provider_id: 39, blueprint_id: 45, variant_id: 12345.

    const line_items = itemsToFulfill.map(item => {
        return {
            // "sku": "YOUR-PRINTIFY-VARIANT-SKU-HERE", // Or use printify variant ID
            "quantity": item.line_item.quantity,
            "print_files": [
                {
                    "url": item.design_data_url, // The base64 data URL from the canvas
                    "position": { "x": 0.5, "y": 0.5, "scale": 1, "angle": 0 }
                }
            ]
        };
    });

    const podPayload = {
        "external_id": order.id.toString(), // Use Shopify order ID as an external reference
        "line_items": line_items,
        "shipping_method": 1, // Standard shipping
        "send_shipping_notification": true,
        "address_to": {
            "first_name": order.shipping_address.first_name,
            "last_name": order.shipping_address.last_name,
            "address1": order.shipping_address.address1,
            "address2": order.shipping_address.address2 || "",
            "city": order.shipping_address.city,
            "region": order.shipping_address.province_code || "",
            "zip": order.shipping_address.zip,
            "country": order.shipping_address.country_code,
            "email": order.email,
            "phone": order.shipping_address.phone || ""
        }
    };

    console.log('Constructed POD Payload:', JSON.stringify(podPayload, null, 2));

    // 3. Make the API call to the POD service.
    //    See Printify API docs for creating an order: https://developers.printify.com/
    /*
    axios.post(`https://api.printify.com/v1/shops/{shop_id}/orders.json`, podPayload, {
        headers: {
            'Authorization': `Bearer ${PRINTIFY_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('Successfully sent order to POD service:', response.data);
    })
    .catch(error => {
        console.error('Error sending order to POD service:', error.response ? error.response.data : error.message);
    });
    */
    console.log('-----------------------------------------------------------------');
}

function registerScriptTag(shop) {
    // NOTE: This uses the legacy ScriptTag API.
    // For modern Shopify themes (Online Store 2.0), the recommended approach is to use a Theme App Extension
    // with an app block. This provides a better merchant experience and is the standard for new apps.
    // This implementation uses ScriptTag for simplicity in this environment, as Theme App Extensions
    // require the Shopify CLI and a more complex setup.
    const accessToken = ACTIVE_SHOPIFY_SHOPS[shop];
    const shopifyApiUrl = `https://{shop}/admin/api/${SHOPIFY_API_VERSION}/script_tags.json`.replace('{shop}', shop);

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
    const shopifyApiUrl = `https://{shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`.replace('{shop}', shop);

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