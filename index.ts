import 'dotenv/config';

import crypto from 'node:crypto';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail } from './email.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const appUrl = process.env.APP_URL?.trim() || 'http://127.0.0.1:4000';
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY?.trim() || '';
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const adminEmails = (process.env.ADMIN_EMAILS ?? process.env.VITE_ADMIN_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;
const supabaseAuthClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    assertServerConfig();

    const signature = normalizeText(req.headers['x-paystack-signature']);
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');
    const expectedSignature = crypto
      .createHmac('sha512', paystackSecretKey)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    if (payload?.event === 'charge.success' && payload?.data?.reference) {
      await updateOrderPaymentState(normalizeText(payload.data.reference), payload.data);
    }

    res.json({ received: true });
  } catch (error) {
    const message = getErrorMessage(error, 'Webhook handling failed.');
    res.status(500).json({ error: message });
  }
});
app.use(express.json({ limit: '1mb' }));

function assertServerConfig() {
  if (!supabase) {
    throw new Error('Supabase server credentials are missing.');
  }

  if (!paystackSecretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is missing.');
  }
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const candidates = [
      'message' in error ? error.message : null,
      'details' in error ? error.details : null,
      'hint' in error ? error.hint : null,
    ];
    const parts = candidates.filter((value) => typeof value === 'string' && value.length > 0);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }

  return fallback;
}

function buildReference() {
  return `PFF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function formatOrderStatus(status: string) {
  if (status === 'payment_failed') {
    return 'payment_failed';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  if (status === 'shipped') {
    return 'shipped';
  }

  if (status === 'delivered') {
    return 'delivered';
  }

  return 'processing';
}

function mapOrderRecord(order: any) {
  return {
    id: order.id,
    reference: order.reference,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    date: new Date(order.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: '2-digit',
    }),
    status: formatOrderStatus(order.status),
    paymentStatus: order.payment_status,
    addressLine1: order.address_line1,
    addressLine2: order.address_line2,
    city: order.city,
    state: order.state,
    notes: order.notes,
    total: order.total_amount,
    items: (order.order_items ?? []).map((item: any) => ({
      productId: item.product_id,
      name: item.product_name,
      quantity: item.quantity,
      price: item.unit_price,
    })),
  };
}

function formatMetricChange(current: number, previous: number, suffix = '%') {
  if (previous === 0 && current === 0) {
    return '0%';
  }

  if (previous === 0) {
    return '+100%';
  }

  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.abs(percent).toFixed(1);

  return `${percent >= 0 ? '+' : '-'}${rounded}${suffix}`;
}

async function assertAdminRequest(req: express.Request) {
  const user = await assertAuthenticatedRequest(req);

  if (adminEmails.length > 0 && !adminEmails.includes(user.email?.toLowerCase() ?? '')) {
    throw new Error('This account is not on the admin allowlist.');
  }

  return user;
}

async function assertAuthenticatedRequest(req: express.Request) {
  if (!supabaseAuthClient) {
    throw new Error('Supabase auth verification is not configured.');
  }

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    throw new Error('Missing admin authorization token.');
  }

  const { data, error } = await supabaseAuthClient.auth.getUser(token);

  if (error || !data.user?.email) {
    throw error ?? new Error('Invalid admin session.');
  }

  return data.user;
}

async function updateOrderPaymentState(reference: string, paystackData: any) {
  const { data: existingOrder, error: existingOrderError } = await supabase!
    .from('orders')
    .select('id, reference, customer_name, customer_email, customer_phone, address_line1, address_line2, city, state, notes, created_at, subtotal_amount, shipping_amount, total_amount, payment_status')
    .eq('reference', reference)
    .single();

  if (existingOrderError || !existingOrder) {
    throw existingOrderError ?? new Error('Order record not found for payment update.');
  }

  const verifiedStatus = paystackData.status === 'success' ? 'paid' : 'failed';
  const orderStatus = paystackData.status === 'success' ? 'processing' : 'payment_failed';

  const { data: order, error } = await supabase!
    .from('orders')
    .update({
      payment_status: verifiedStatus,
      status: orderStatus,
      paid_at: paystackData.status === 'success' ? new Date().toISOString() : null,
      paystack_reference: paystackData.reference,
      paystack_access_code: paystackData.access_code ?? null,
      payment_channel: paystackData.channel ?? null,
    })
    .eq('reference', reference)
    .select('id, reference, payment_status, status')
    .single();

  if (error || !order) {
    throw error ?? new Error('Order update failed after verification.');
  }

  const shouldSendConfirmation = verifiedStatus === 'paid' && existingOrder.payment_status !== 'paid';

  if (shouldSendConfirmation) {
    try {
      const { data: orderItems, error: orderItemsError } = await supabase!
        .from('order_items')
        .select('product_name, quantity, unit_price, total_price')
        .eq('order_id', existingOrder.id)
        .order('created_at', { ascending: true });

      if (orderItemsError) {
        throw orderItemsError;
      }

      await sendOrderConfirmationEmail({
        reference: existingOrder.reference,
        customerName: existingOrder.customer_name,
        customerEmail: existingOrder.customer_email,
        customerPhone: existingOrder.customer_phone,
        addressLine1: existingOrder.address_line1,
        addressLine2: existingOrder.address_line2,
        city: existingOrder.city,
        state: existingOrder.state,
        notes: existingOrder.notes,
        createdAt: existingOrder.created_at,
        subtotalAmount: existingOrder.subtotal_amount,
        shippingAmount: existingOrder.shipping_amount,
        totalAmount: existingOrder.total_amount,
        items: (orderItems ?? []).map((item: any) => ({
          name: item.product_name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalPrice: item.total_price,
        })),
      });
    } catch (emailError) {
      console.error('Order confirmation email failed:', getErrorMessage(emailError, 'Unknown email error.'));
    }
  }

  return order;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/checkout/initialize', async (req, res) => {
  try {
    assertServerConfig();
    const authUser = await assertAuthenticatedRequest(req);
    const customerEmail = authUser.email?.toLowerCase();

    if (!customerEmail) {
      throw new Error('Authenticated user email is missing.');
    }

    const customer = req.body?.customer ?? {};
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (items.length === 0) {
      res.status(400).json({ error: 'Cart is empty.' });
      return;
    }

    const normalizedItems = items.map((item: any) => ({
      productId: String(item.id),
      name: normalizeText(item.name),
      image: normalizeText(item.image),
      category: normalizeText(item.category),
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Math.max(0, Number(item.price) || 0),
    }));

    const subtotal = normalizedItems.reduce(
      (sum: number, item: { quantity: number; price: number }) => sum + item.price * item.quantity,
      0,
    );
    const shippingAmount = subtotal > 50000 ? 0 : 5000;
    const totalAmount = subtotal + shippingAmount;
    const reference = buildReference();

    const { data: order, error: orderError } = await supabase!
      .from('orders')
      .insert({
        user_id: authUser.id,
        reference,
        customer_name: normalizeText(customer.customerName || authUser.user_metadata?.full_name),
        customer_email: customerEmail,
        customer_phone: normalizeText(customer.customerPhone),
        address_line1: normalizeText(customer.addressLine1),
        address_line2: normalizeText(customer.addressLine2),
        city: normalizeText(customer.city),
        state: normalizeText(customer.state),
        notes: normalizeText(customer.notes),
        subtotal_amount: subtotal,
        shipping_amount: shippingAmount,
        total_amount: totalAmount,
        currency: 'NGN',
        status: 'pending',
        payment_status: 'initialized',
      })
      .select('id')
      .single();

    if (orderError || !order) {
      throw orderError ?? new Error('Unable to create order.');
    }

    const orderItems = normalizedItems.map((item: any) => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      product_image: item.image,
      category: item.category,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.price * item.quantity,
    }));

    const { error: itemsError } = await supabase!.from('order_items').insert(orderItems);
    if (itemsError) {
      throw itemsError;
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: totalAmount * 100,
        currency: 'NGN',
        reference,
        callback_url: `${appUrl.replace(/\/$/, '')}/checkout/callback?reference=${encodeURIComponent(reference)}`,
        metadata: {
          order_id: order.id,
          customer_name: normalizeText(customer.customerName || authUser.user_metadata?.full_name),
          user_id: authUser.id,
        },
      }),
    });

    const paystack = await response.json();

    if (!response.ok || !paystack?.data?.authorization_url) {
      throw new Error(paystack?.message || 'Unable to initialize Paystack transaction.');
    }

    res.json({
      authorizationUrl: paystack.data.authorization_url,
      orderId: order.id,
      reference,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Checkout initialization failed.');
    res.status(500).json({ error: message });
  }
});

app.get('/api/checkout/verify', async (req, res) => {
  try {
    assertServerConfig();

    const reference = normalizeText(req.query.reference);
    if (!reference) {
      res.status(400).json({ error: 'Payment reference is required.' });
      return;
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
    });
    const paystack = await response.json();

    if (!response.ok || !paystack?.data) {
      throw new Error(paystack?.message || 'Unable to verify Paystack transaction.');
    }

    const order = await updateOrderPaymentState(reference, paystack.data);

    res.json({
      orderId: order.id,
      paymentStatus: order.payment_status,
      reference: order.reference,
      status: order.status,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Payment verification failed.');
    res.status(500).json({ error: message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    if (!supabase) {
      throw new Error('Supabase server credentials are missing.');
    }

    const authUser = await assertAuthenticatedRequest(req);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, reference, customer_name, customer_email, customer_phone, address_line1, address_line2, city, state, notes, created_at, status, payment_status, total_amount, order_items(product_id, product_name, quantity, unit_price)')
      .eq('user_id', authUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      orders: (orders ?? []).map((order: any) => mapOrderRecord(order)),
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unable to load orders.');
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  try {
    if (!supabase) {
      throw new Error('Supabase server credentials are missing.');
    }

    await assertAdminRequest(req);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, reference, customer_name, customer_email, customer_phone, address_line1, address_line2, city, state, notes, created_at, status, payment_status, total_amount, order_items(product_id, product_name, quantity, unit_price)')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      orders: (orders ?? []).map((order: any) => mapOrderRecord(order)),
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unable to load admin orders.');
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/dashboard', async (req, res) => {
  try {
    if (!supabase) {
      throw new Error('Supabase server credentials are missing.');
    }

    await assertAdminRequest(req);

    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setHours(0, 0, 0, 0);
    currentStart.setDate(currentStart.getDate() - 6);

    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);

    const [ordersResult, productsResult] = await Promise.all([
      supabase
        .from('orders')
        .select('id, reference, customer_name, customer_email, customer_phone, address_line1, address_line2, city, state, notes, created_at, status, payment_status, total_amount, order_items(product_id, product_name, quantity, unit_price)')
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('id, active, created_at'),
    ]);

    if (ordersResult.error) {
      throw ordersResult.error;
    }

    if (productsResult.error) {
      throw productsResult.error;
    }

    const allOrders = ordersResult.data ?? [];
    const allProducts = productsResult.data ?? [];
    const successfulOrders = allOrders.filter((order: any) => order.payment_status === 'paid');
    const currentAllOrders = allOrders.filter((order: any) => new Date(order.created_at) >= currentStart);
    const previousAllOrders = allOrders.filter((order: any) => {
      const createdAt = new Date(order.created_at);
      return createdAt >= previousStart && createdAt < currentStart;
    });

    const currentOrders = successfulOrders.filter((order: any) => new Date(order.created_at) >= currentStart);
    const previousOrders = successfulOrders.filter((order: any) => {
      const createdAt = new Date(order.created_at);
      return createdAt >= previousStart && createdAt < currentStart;
    });

    const currentRevenue = currentOrders.reduce((sum: number, order: any) => sum + order.total_amount, 0);
    const previousRevenue = previousOrders.reduce((sum: number, order: any) => sum + order.total_amount, 0);

    const currentCustomers = new Set(currentAllOrders.map((order: any) => order.customer_email.toLowerCase())).size;
    const previousCustomers = new Set(previousAllOrders.map((order: any) => order.customer_email.toLowerCase())).size;

    const currentProducts = allProducts.filter((product: any) => {
      const createdAt = new Date(product.created_at ?? 0);
      return createdAt >= currentStart;
    }).length;

    const previousProducts = allProducts.filter((product: any) => {
      const createdAt = new Date(product.created_at ?? 0);
      return createdAt >= previousStart && createdAt < currentStart;
    }).length;

    const trends = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(currentStart);
      day.setDate(currentStart.getDate() + index);
      const nextDay = new Date(day);
      nextDay.setDate(day.getDate() + 1);

      const dayOrders = allOrders.filter((order: any) => {
        const createdAt = new Date(order.created_at);
        return createdAt >= day && createdAt < nextDay;
      });
      const daySuccessfulOrders = successfulOrders.filter((order: any) => {
        const createdAt = new Date(order.created_at);
        return createdAt >= day && createdAt < nextDay;
      });

      return {
        name: day.toLocaleDateString('en-US', { weekday: 'short' }),
        orders: dayOrders.length,
        sales: daySuccessfulOrders.reduce((sum: number, order: any) => sum + order.total_amount, 0),
      };
    });

    res.json({
      metrics: {
        totalRevenue: {
          value: successfulOrders.reduce((sum: number, order: any) => sum + order.total_amount, 0),
          change: formatMetricChange(currentRevenue, previousRevenue),
        },
        totalOrders: {
          value: allOrders.length,
          change: formatMetricChange(currentAllOrders.length, previousAllOrders.length),
        },
        totalProducts: {
          value: allProducts.filter((product: any) => product.active !== false).length,
          change: `${currentProducts - previousProducts >= 0 ? '+' : ''}${currentProducts - previousProducts}`,
        },
        activeCustomers: {
          value: new Set(allOrders.map((order: any) => order.customer_email.toLowerCase())).size,
          change: formatMetricChange(currentCustomers, previousCustomers),
        },
      },
      recentOrders: allOrders.slice(0, 5).map((order: any) => mapOrderRecord(order)),
      trends,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unable to load dashboard.');
    res.status(500).json({ error: message });
  }
});

app.patch('/api/admin/orders/:orderId', async (req, res) => {
  try {
    if (!supabase) {
      throw new Error('Supabase server credentials are missing.');
    }

    await assertAdminRequest(req);

    const orderId = normalizeText(req.params.orderId);
    const nextStatus = normalizeText(req.body?.status);
    const notifyUser = req.body?.notifyUser !== false;
    const allowedStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];

    if (!orderId || !allowedStatuses.includes(nextStatus)) {
      res.status(400).json({ error: 'A valid order status is required.' });
      return;
    }

    const { data: existingOrder, error: existingOrderError } = await supabase
      .from('orders')
      .select('id, reference, customer_name, customer_email, status')
      .eq('id', orderId)
      .single();

    if (existingOrderError || !existingOrder) {
      throw existingOrderError ?? new Error('Unable to load order before status update.');
    }

    const { data: order, error } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId)
      .select('id, reference, customer_name, customer_email, customer_phone, address_line1, address_line2, city, state, notes, created_at, status, payment_status, total_amount, order_items(product_id, product_name, quantity, unit_price)')
      .single();

    if (error || !order) {
      throw error ?? new Error('Unable to update order status.');
    }

    let notification:
      | { status: 'disabled' }
      | { status: 'skipped' }
      | { status: 'sent' }
      | { status: 'failed'; message: string } = notifyUser ? { status: 'skipped' } : { status: 'disabled' };

    if (notifyUser && existingOrder.status !== nextStatus) {
      try {
        await sendOrderStatusUpdateEmail({
          customerEmail: existingOrder.customer_email,
          customerName: existingOrder.customer_name,
          reference: existingOrder.reference,
          status: nextStatus as 'processing' | 'shipped' | 'delivered' | 'cancelled',
        });
        notification = { status: 'sent' };
      } catch (emailError) {
        const message = getErrorMessage(emailError, 'Unknown email error.');
        console.error('Order status email failed:', message);
        notification = { status: 'failed', message };
      }
    }

    res.json({ notification, order: mapOrderRecord(order) });
  } catch (error) {
    const message = getErrorMessage(error, 'Order update failed.');
    res.status(500).json({ error: message });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Prestige API listening on http://127.0.0.1:${port}`);
  });
}

export default app;
