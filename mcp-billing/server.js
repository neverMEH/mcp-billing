// server.js - Complete MCP Billing Server
// This handles everything automatically - just add your settings!

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// === PRICING CONFIGURATION ===
const PLANS = {
  starter: {
    name: 'Starter',
    basePrice: process.env.STRIPE_PRICE_STARTER_BASE,
    meterPrice: process.env.STRIPE_PRICE_STARTER_METER,
    includedExecutions: 0
  },
  pro: {
    name: 'Pro', 
    basePrice: process.env.STRIPE_PRICE_PRO_BASE,
    meterPrice: process.env.STRIPE_PRICE_PRO_METER,
    includedExecutions: 2000
  },
  scale: {
    name: 'Scale',
    basePrice: process.env.STRIPE_PRICE_SCALE_BASE,
    meterPrice: process.env.STRIPE_PRICE_SCALE_METER,
    includedExecutions: 10000
  }
};

// === SIMPLE HELPER FUNCTIONS ===
function generateApiToken() {
  return 'sk_live_' + crypto.randomBytes(32).toString('hex');
}

async function validateToken(token) {
  const { data, error } = await supabase
    .from('users')
    .select('*, usage_tracking(total_executions)')
    .eq('api_token', token)
    .single();
  
  if (error || !data) return null;
  
  // Get current month usage
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = data.usage_tracking?.find(u => u.month === currentMonth);
  
  return {
    ...data,
    currentUsage: usage?.total_executions || 0
  };
}

async function trackUsage(userId, subscriptionItemId, currentUsage, includedExecutions) {
  const month = new Date().toISOString().slice(0, 7);
  
  // Update usage count
  const { error } = await supabase
    .from('usage_tracking')
    .upsert({
      user_id: userId,
      month: month,
      total_executions: currentUsage + 1
    });
  
  // If over included amount, report to Stripe
  if (currentUsage >= includedExecutions) {
    try {
      await stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        { quantity: 1 }
      );
    } catch (err) {
      console.error('Stripe usage report error:', err);
    }
  }
}

// === API ENDPOINTS ===

// Home page
app.get('/', (req, res) => {
  res.redirect('/pricing.html');
});

// Pricing redirect
app.get('/pricing', (req, res) => {
  res.redirect('/pricing.html');
});

// Create checkout session
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { plan } = req.body;
    const selectedPlan = PLANS[plan];
    
    if (!selectedPlan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        { price: selectedPlan.basePrice, quantity: 1 },
        { price: selectedPlan.meterPrice }
      ],
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/pricing.html`,
      metadata: { plan }
    });
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// Success page
app.get('/success', async (req, res) => {
  try {
    const { session_id } = req.query;
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('api_token')
      .eq('stripe_customer_id', session.customer)
      .single();
    
    let apiToken;
    if (existingUser) {
      apiToken = existingUser.api_token;
    } else {
      // Create new user
      apiToken = generateApiToken();
      const plan = PLANS[session.metadata.plan];
      
      const { error } = await supabase
        .from('users')
        .insert({
          email: session.customer_email,
          api_token: apiToken,
          stripe_customer_id: session.customer,
          subscription_item_id: subscription.items.data[1].id, // Metered item
          tier: session.metadata.plan,
          included_executions: plan.includedExecutions
        });
      
      if (error) throw error;
    }
    
    // Beautiful success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Welcome to MCP API!</title>
        <style>
          body {
            font-family: -apple-system, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 800px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
          }
          h1 {
            color: #2d3748;
            margin-bottom: 10px;
          }
          .success-icon {
            font-size: 60px;
            margin-bottom: 20px;
          }
          .token-box {
            background: #f7fafc;
            border: 2px dashed #cbd5e0;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
          }
          .token {
            background: #2d3748;
            color: #48bb78;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            word-break: break-all;
            margin: 10px 0;
          }
          pre {
            background: #1a202c;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 10px;
            overflow-x: auto;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 8px;
            margin-top: 20px;
          }
          .button:hover {
            background: #5a67d8;
          }
          .steps {
            background: #ebf8ff;
            border-radius: 10px;
            padding: 20px;
            margin-top: 30px;
          }
          .steps h3 {
            color: #2b6cb0;
            margin-bottom: 15px;
          }
          .steps ol {
            color: #4a5568;
            line-height: 1.8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Welcome to MCP API!</h1>
          <p style="color: #718096; font-size: 18px;">Your subscription is now active!</p>
          
          <div class="token-box">
            <h3>🔑 Your API Token:</h3>
            <div class="token">${apiToken}</div>
            <button onclick="navigator.clipboard.writeText('${apiToken}').then(() => alert('Token copied!'));" 
                    style="background: #4a5568; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
              Copy Token
            </button>
          </div>
          
          <h3>📋 Add to Claude Desktop:</h3>
          <pre>{
  "mcpServers": {
    "${process.env.SERVICE_NAME || 'mcp-api'}": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sse",
        "${process.env.APP_URL}/mcp/sse"
      ],
      "env": {
        "SSE_HEADERS": "Authorization: Bearer ${apiToken}"
      }
    }
  }
}</pre>
          
          <div class="steps">
            <h3>🚀 Quick Setup Steps:</h3>
            <ol>
              <li>Copy the entire configuration above</li>
              <li>Open Claude Desktop</li>
              <li>Go to Settings → MCP Servers</li>
              <li>Paste the configuration</li>
              <li>Restart Claude Desktop</li>
              <li>Start using your MCP tools!</li>
            </ol>
          </div>
          
          <a href="https://billing.stripe.com/p/login/${process.env.STRIPE_CUSTOMER_PORTAL_ID || ''}" 
             class="button">Manage Subscription</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Success page error:', error);
    res.status(500).send('Error processing subscription. Please contact support.');
  }
});

// Stripe webhooks
app.post('/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'customer.subscription.deleted') {
    // Cancel subscription in database
    const subscription = event.data.object;
    await supabase
      .from('users')
      .update({ subscription_item_id: null })
      .eq('stripe_customer_id', subscription.customer);
  }
  
  res.json({ received: true });
});

// MCP Proxy - This forwards requests to your n8n
const mcpProxy = createProxyMiddleware({
  target: process.env.N8N_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/mcp': process.env.N8N_MCP_PATH
  },
  onProxyReq: async (proxyReq, req, res) => {
    // Get token from header
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    
    const token = auth.substring(7);
    const user = await validateToken(token);
    
    if (!user) {
      res.status(403).json({ error: 'Invalid token or subscription' });
      return;
    }
    
    // Track usage
    await trackUsage(
      user.id,
      user.subscription_item_id,
      user.currentUsage,
      user.included_executions
    );
    
    // Remove auth header before forwarding to n8n
    proxyReq.removeHeader('authorization');
    
    // Add user info for n8n (optional)
    proxyReq.setHeader('X-User-Email', user.email);
  },
  onProxyRes: (proxyRes, req, res) => {
    // Make sure SSE headers are correct
    if (req.path.includes('/sse')) {
      proxyRes.headers['content-type'] = 'text/event-stream';
      proxyRes.headers['cache-control'] = 'no-cache';
    }
  }
});

app.use('/mcp', mcpProxy);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
    🚀 MCP Billing Server is running!
    
    Local: http://localhost:${PORT}
    Pricing: ${process.env.APP_URL}/pricing.html
    
    Make sure all environment variables are set!
  `);
});
