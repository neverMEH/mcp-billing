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

// Connect to Supabase with service key for server operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key bypasses RLS
);

// Middleware
app.use(cors());
app.use(express.json());
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

// Home page AND pricing page - no more static files!
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>MCP API - Pricing</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                overflow: hidden;
                box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            }
            .header {
                background: linear-gradient(135deg, #2d3748 0%, #4a5568 100%);
                color: white;
                padding: 60px 40px;
                text-align: center;
            }
            .header h1 {
                font-size: 3rem;
                margin-bottom: 15px;
                font-weight: 700;
            }
            .header p {
                font-size: 1.2rem;
                opacity: 0.9;
            }
            .plans {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 30px;
                padding: 60px 40px;
            }
            .plan {
                border: 2px solid #e2e8f0;
                border-radius: 15px;
                padding: 40px 30px;
                text-align: center;
                transition: all 0.3s ease;
                position: relative;
            }
            .plan:hover {
                transform: translateY(-5px);
                box-shadow: 0 15px 30px rgba(0,0,0,0.1);
            }
            .plan.popular {
                border-color: #48bb78;
                background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%);
                transform: scale(1.05);
            }
            .plan.popular::before {
                content: "Most Popular";
                position: absolute;
                top: -15px;
                left: 50%;
                transform: translateX(-50%);
                background: #48bb78;
                color: white;
                padding: 8px 20px;
                border-radius: 20px;
                font-size: 0.9rem;
                font-weight: 600;
            }
            .plan h2 {
                color: #2d3748;
                font-size: 1.8rem;
                margin-bottom: 15px;
            }
            .price {
                font-size: 3rem;
                font-weight: 700;
                color: #4a5568;
                margin-bottom: 10px;
            }
            .price-period {
                color: #718096;
                margin-bottom: 30px;
            }
            .features {
                list-style: none;
                margin-bottom: 40px;
            }
            .features li {
                padding: 8px 0;
                color: #4a5568;
                border-bottom: 1px solid #e2e8f0;
            }
            .features li:last-child {
                border-bottom: none;
            }
            .btn {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 40px;
                border: none;
                border-radius: 10px;
                font-size: 1.1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                width: 100%;
            }
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
            }
            .btn:active {
                transform: translateY(0);
            }
            .footer {
                background: #f7fafc;
                padding: 40px;
                text-align: center;
                color: #718096;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>MCP API</h1>
                <p>Powerful AI tools for Claude Desktop with usage-based pricing</p>
            </div>
            
            <div class="plans">
                <div class="plan">
                    <h2>Starter</h2>
                    <div class="price">$19</div>
                    <div class="price-period">per month</div>
                    <ul class="features">
                        <li>✅ Access to all MCP tools</li>
                        <li>✅ $0.05 per execution</li>
                        <li>✅ Instant API token</li>
                        <li>✅ Email support</li>
                        <li>✅ Cancel anytime</li>
                    </ul>
                    <button class="btn" onclick="subscribe('starter')">Get Started</button>
                </div>

                <div class="plan popular">
                    <h2>Pro</h2>
                    <div class="price">$49</div>
                    <div class="price-period">per month</div>
                    <ul class="features">
                        <li>✅ 2,000 included executions</li>
                        <li>✅ $0.04 per additional execution</li>
                        <li>✅ Priority support</li>
                        <li>✅ Advanced features</li>
                        <li>✅ Usage dashboard</li>
                    </ul>
                    <button class="btn" onclick="subscribe('pro')">Get Started</button>
                </div>

                <div class="plan">
                    <h2>Scale</h2>
                    <div class="price">$199</div>
                    <div class="price-period">per month</div>
                    <ul class="features">
                        <li>✅ 10,000 included executions</li>
                        <li>✅ $0.03 per additional execution</li>
                        <li>✅ Premium support</li>
                        <li>✅ Custom integrations</li>
                        <li>✅ Team management</li>
                    </ul>
                    <button class="btn" onclick="subscribe('scale')">Get Started</button>
                </div>
            </div>
            
            <div class="footer">
                <p><strong>All plans include:</strong> Instant setup, secure API tokens, and access to manage your subscription anytime.</p>
                <p>Questions? Contact support at your-email@domain.com</p>
            </div>
        </div>

        <script>
            async function subscribe(plan) {
                try {
                    const response = await fetch('/api/create-checkout', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ plan: plan })
                    });
                    
                    const data = await response.json();
                    
                    if (data.url) {
                        window.location.href = data.url;
                    } else {
                        alert('Error creating checkout. Please try again.');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    alert('Error processing request. Please try again.');
                }
            }
        </script>
    </body>
    </html>
  `);
});

// Also handle /pricing and /pricing.html for backwards compatibility
app.get('/pricing', (req, res) => {
  res.redirect('/');
});

app.get('/pricing.html', (req, res) => {
  res.redirect('/');
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
      cancel_url: `${process.env.APP_URL}/`,
      metadata: { plan },
      customer_email: req.body.email, // Optional: if you want to pre-fill email
      billing_address_collection: 'required', // This ensures we get customer info
      customer_creation: 'always' // Always create a customer
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
    
    // Get customer details to ensure we have the email
    const customer = await stripe.customers.retrieve(session.customer);
    const customerEmail = customer.email || session.customer_details?.email || session.customer_email;
    
    if (!customerEmail) {
      console.error('No email found for customer:', {
        customer_id: session.customer,
        session_customer_email: session.customer_email,
        customer_details_email: session.customer_details?.email,
        customer_object_email: customer.email
      });
      throw new Error('Customer email not found');
    }
    
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
      
      // Find the metered subscription item
      console.log('Subscription items:', subscription.items.data);
      const meteredItem = subscription.items.data.find(item => 
        item.price.id === plan.meterPrice
      );
      
      if (!meteredItem) {
        console.error('Metered item not found:', {
          plan: session.metadata.plan,
          expected_meter_price: plan.meterPrice,
          actual_items: subscription.items.data.map(item => item.price.id)
        });
        throw new Error('Subscription setup error - metered item not found');
      }
      
      const { error } = await supabase
        .from('users')
        .insert({
          email: customerEmail,
          api_token: apiToken,
          stripe_customer_id: session.customer,
          subscription_item_id: meteredItem.id, // Use the found metered item
          tier: session.metadata.plan,
          included_executions: plan.includedExecutions
        });
      
      if (error) {
        console.error('Database insert error:', error);
        throw error;
      }
    }
    
    // Beautiful success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Welcome to MCP API!</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
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
            margin: 10px 10px 10px 0;
            border: none;
            cursor: pointer;
            font-size: 14px;
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
            <button class="button" onclick="copyToClipboard('${apiToken}')">
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
          
          <a href="/" class="button">← Back to Pricing</a>
          <a href="https://billing.stripe.com/p/login/${process.env.STRIPE_CUSTOMER_PORTAL_ID || ''}" 
             class="button">Manage Subscription</a>
        </div>
        
        <script>
          function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
              alert('Token copied to clipboard!');
            }).catch(() => {
              // Fallback for older browsers
              const textArea = document.createElement('textarea');
              textArea.value = text;
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              alert('Token copied to clipboard!');
            });
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Success page error:', error);
    console.error('Error details:', {
      session_id: req.query.session_id,
      error_message: error.message,
      error_code: error.code,
      timestamp: new Date().toISOString()
    });
    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h2>⚠️ Processing Error</h2>
        <p>There was an issue processing your subscription. Don't worry - your payment was successful!</p>
        <p><strong>What happened:</strong> ${error.message}</p>
        <p><strong>Next steps:</strong></p>
        <ul>
          <li>Contact support with your session ID: <code>${req.query.session_id}</code></li>
          <li>We'll manually provision your API token within 24 hours</li>
          <li>Your subscription is active in Stripe</li>
        </ul>
        <p><strong>Support:</strong> your-email@domain.com</p>
        <a href="/" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">← Back to Home</a>
      </div>
    `);
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
    Pricing: ${process.env.APP_URL}/
    
    Make sure all environment variables are set!
  `);
});
