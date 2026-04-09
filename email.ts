const resendApiKey = process.env.RESEND_API_KEY?.trim() || '';
const orderEmailFrom = process.env.ORDER_EMAIL_FROM?.trim() || '';
const orderEmailReplyTo = process.env.ORDER_EMAIL_REPLY_TO?.trim() || '';
const appUrl = process.env.APP_URL?.trim() || 'http://127.0.0.1:4000';
const brandLogoUrl =
  'https://cdn-za.icons8.com/4hyiqpS8-EWdItocwbO_Pg/zS5vWaNP50OiiTIB6TaBwA/WhatsApp_Image_2026-04-04_at_09.01.52.png';

interface ReceiptOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface ReceiptOrder {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  notes: string;
  subtotalAmount: number;
  shippingAmount: number;
  totalAmount: number;
  createdAt: string;
  items: ReceiptOrderItem[];
}

interface OrderStatusEmail {
  customerEmail: string;
  customerName: string;
  reference: string;
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCurrency(amount: number) {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildAddress(order: ReceiptOrder) {
  return [order.addressLine1, order.addressLine2, order.city, order.state].filter(Boolean).join(', ');
}

function buildReceiptHtml(order: ReceiptOrder) {
  const lineItemsMarkup = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px dashed #d7d2c7; color: #1a2e1a; font-size: 14px; line-height: 1.5;">
            <div style="font-weight: 700;">${escapeHtml(item.name)}</div>
            <div style="color: rgba(26, 46, 26, 0.6); font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em;">Qty ${item.quantity} x ${escapeHtml(
              formatCurrency(item.unitPrice),
            )}</div>
          </td>
          <td style="padding: 10px 0; border-bottom: 1px dashed #d7d2c7; color: #1a2e1a; font-size: 14px; font-weight: 700; text-align: right; vertical-align: top;">
            ${escapeHtml(formatCurrency(item.totalPrice))}
          </td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin: 0; padding: 24px; background: #f5f2ed; color: #1a2e1a; font-family: Inter, Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 680px; margin: 0 auto;">
      <tr>
        <td align="center" style="padding-bottom: 18px;">
          <img src="${escapeHtml(brandLogoUrl)}" alt="Prestige Farm Foods" style="display: block; width: 168px; max-width: 100%; height: auto; margin: 0 auto 14px;" />
          <div style="font-size: 12px; letter-spacing: 0.34em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Prestige Farm Foods</div>
        </td>
      </tr>
      <tr>
        <td>
          <div style="background: #ffffff; border: 1px solid rgba(26, 46, 26, 0.08); border-radius: 32px; overflow: hidden; box-shadow: 0 18px 60px rgba(26, 46, 26, 0.08);">
            <div style="padding: 28px 32px; background: linear-gradient(135deg, #1a2e1a 0%, #28462a 58%, #c5a059 100%); color: #f5f2ed;">
              <div style="font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; opacity: 0.8; font-weight: 700;">Order Confirmed</div>
              <h1 style="margin: 14px 0 10px; font-size: 34px; line-height: 1.1; font-family: 'Playfair Display', Georgia, serif; font-weight: 700;">Your receipt just dropped.</h1>
              <p style="margin: 0; max-width: 460px; font-size: 14px; line-height: 1.7; color: rgba(245, 242, 237, 0.86);">
                ${escapeHtml(order.customerName)}, your Prestige order is paid and queued for preparation. Here is your crisp little farm-fresh receipt.
              </p>
            </div>

            <div style="padding: 32px; background: #fffdf8;">
              <div style="border: 2px dashed rgba(26, 46, 26, 0.14); border-radius: 28px; background: #fffaf1; padding: 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding-bottom: 14px;">
                      <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26, 46, 26, 0.45); font-weight: 700;">Receipt No.</div>
                      <div style="margin-top: 6px; font-size: 20px; color: #1a2e1a; font-family: 'Courier New', monospace; font-weight: 700;">${escapeHtml(order.reference)}</div>
                    </td>
                    <td style="padding-bottom: 14px; text-align: right;">
                      <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26, 46, 26, 0.45); font-weight: 700;">Paid On</div>
                      <div style="margin-top: 6px; font-size: 14px; color: #1a2e1a; font-weight: 700;">${escapeHtml(formatDate(order.createdAt))}</div>
                    </td>
                  </tr>
                </table>

                <div style="height: 1px; margin: 8px 0 18px; background: repeating-linear-gradient(to right, rgba(26, 46, 26, 0.18), rgba(26, 46, 26, 0.18) 8px, transparent 8px, transparent 16px);"></div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 18px;">
                  ${lineItemsMarkup}
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 13px; color: rgba(26, 46, 26, 0.8);">
                  <tr>
                    <td style="padding: 5px 0;">Subtotal</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 700;">${escapeHtml(formatCurrency(order.subtotalAmount))}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;">Delivery</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 700;">${escapeHtml(formatCurrency(order.shippingAmount))}</td>
                  </tr>
                  <tr>
                    <td style="padding-top: 10px; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Total</td>
                    <td style="padding-top: 10px; text-align: right; font-size: 22px; color: #1a2e1a; font-family: 'Courier New', monospace; font-weight: 700;">${escapeHtml(
                      formatCurrency(order.totalAmount),
                    )}</td>
                  </tr>
                </table>
              </div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 26px;">
                <tr>
                  <td style="width: 50%; padding-right: 12px; vertical-align: top;">
                    <div style="border-radius: 24px; background: #ffffff; border: 1px solid rgba(26, 46, 26, 0.08); padding: 20px;">
                      <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Delivery Address</div>
                      <div style="margin-top: 10px; font-size: 14px; line-height: 1.7; color: #1a2e1a;">
                        ${escapeHtml(buildAddress(order))}
                      </div>
                    </div>
                  </td>
                  <td style="width: 50%; padding-left: 12px; vertical-align: top;">
                    <div style="border-radius: 24px; background: #ffffff; border: 1px solid rgba(26, 46, 26, 0.08); padding: 20px;">
                      <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Contact</div>
                      <div style="margin-top: 10px; font-size: 14px; line-height: 1.8; color: #1a2e1a;">
                        <div>${escapeHtml(order.customerEmail)}</div>
                        <div>${escapeHtml(order.customerPhone)}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>

              ${
                order.notes
                  ? `<div style="margin-top: 18px; border-radius: 22px; background: rgba(197, 160, 89, 0.08); padding: 18px 20px;">
                      <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Delivery Notes</div>
                      <div style="margin-top: 8px; font-size: 14px; line-height: 1.7; color: #1a2e1a; white-space: pre-wrap;">${escapeHtml(order.notes)}</div>
                    </div>`
                  : ''
              }

              <div style="margin-top: 24px; border-radius: 24px; background: #1a2e1a; padding: 22px 24px; color: #f5f2ed;">
                <div style="font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: #c5a059; font-weight: 700;">What happens next</div>
                <p style="margin: 10px 0 0; font-size: 14px; line-height: 1.75; color: rgba(245, 242, 237, 0.82);">
                  We are packing your order now. You can review your live order history anytime from your account.
                </p>
                <a href="${escapeHtml(`${appUrl.replace(/\/$/, '')}/orders`)}" style="display: inline-block; margin-top: 16px; padding: 12px 18px; border-radius: 999px; background: #c5a059; color: #1a2e1a; text-decoration: none; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">
                  View My Orders
                </a>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildReceiptText(order: ReceiptOrder) {
  const items = order.items
    .map((item) => `- ${item.name} x${item.quantity} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.totalPrice)}`)
    .join('\n');

  return [
    'Prestige Farm Foods',
    'Order Confirmed',
    '',
    `Receipt: ${order.reference}`,
    `Paid on: ${formatDate(order.createdAt)}`,
    '',
    'Items',
    items,
    '',
    `Subtotal: ${formatCurrency(order.subtotalAmount)}`,
    `Delivery: ${formatCurrency(order.shippingAmount)}`,
    `Total: ${formatCurrency(order.totalAmount)}`,
    '',
    'Delivery Address',
    buildAddress(order),
    '',
    'Contact',
    order.customerEmail,
    order.customerPhone,
    '',
    order.notes ? `Notes: ${order.notes}\n` : '',
    `View your orders: ${appUrl.replace(/\/$/, '')}/orders`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function canSendOrderConfirmationEmail() {
  return Boolean(resendApiKey && orderEmailFrom);
}

async function sendEmail({
  html,
  idempotencyKey,
  subject,
  text,
  to,
}: {
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
}) {
  if (!canSendOrderConfirmationEmail()) {
    return { skipped: true as const };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: orderEmailFrom,
      to: [to],
      reply_to: orderEmailReplyTo || undefined,
      subject,
      html,
      text,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload?.message === 'string' && payload.message
        ? payload.message
        : 'Order confirmation email failed.';
    throw new Error(message);
  }

  return payload;
}

export async function sendOrderConfirmationEmail(order: ReceiptOrder) {
  return sendEmail({
    to: order.customerEmail,
    subject: `Prestige receipt ${order.reference}`,
    html: buildReceiptHtml(order),
    text: buildReceiptText(order),
    idempotencyKey: `order-confirmation-${order.reference}`,
  });
}

function getStatusEmailMeta(status: OrderStatusEmail['status']) {
  switch (status) {
    case 'shipped':
      return {
        eyebrow: 'Order Update',
        title: 'Your order is on the move.',
        description: 'Your Prestige order has been shipped and is now in transit.',
      };
    case 'delivered':
      return {
        eyebrow: 'Delivered',
        title: 'Your order has arrived.',
        description: 'Your Prestige order has been marked as delivered.',
      };
    case 'cancelled':
      return {
        eyebrow: 'Order Update',
        title: 'Your order was cancelled.',
        description: 'Your Prestige order status has been updated to cancelled.',
      };
    default:
      return {
        eyebrow: 'Order Update',
        title: 'Your order is now processing.',
        description: 'Your Prestige order is being prepared by our team.',
      };
  }
}

function buildStatusUpdateHtml(order: OrderStatusEmail) {
  const meta = getStatusEmailMeta(order.status);

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin: 0; padding: 24px; background: #f5f2ed; color: #1a2e1a; font-family: Inter, Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto;">
      <tr>
        <td>
          <div style="overflow: hidden; border-radius: 32px; border: 1px solid rgba(26, 46, 26, 0.08); background: #ffffff; box-shadow: 0 18px 60px rgba(26, 46, 26, 0.08);">
            <div style="padding: 28px 32px; background: linear-gradient(135deg, #1a2e1a 0%, #28462a 58%, #c5a059 100%); color: #f5f2ed;">
              <img src="${escapeHtml(brandLogoUrl)}" alt="Prestige Farm Foods" style="display: block; width: 152px; max-width: 100%; height: auto; margin: 0 0 16px;" />
              <div style="font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; opacity: 0.85; font-weight: 700;">${escapeHtml(meta.eyebrow)}</div>
              <h1 style="margin: 14px 0 10px; font-size: 32px; line-height: 1.1; font-family: 'Playfair Display', Georgia, serif; font-weight: 700;">${escapeHtml(meta.title)}</h1>
              <p style="margin: 0; font-size: 14px; line-height: 1.75; color: rgba(245, 242, 237, 0.86);">
                ${escapeHtml(order.customerName)}, ${escapeHtml(meta.description)}
              </p>
            </div>
            <div style="padding: 32px; background: #fffdf8;">
              <div style="border-radius: 28px; border: 2px dashed rgba(26, 46, 26, 0.14); background: #fffaf1; padding: 24px;">
                <div style="font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26, 46, 26, 0.45); font-weight: 700;">Order Reference</div>
                <div style="margin-top: 8px; font-size: 22px; color: #1a2e1a; font-family: 'Courier New', monospace; font-weight: 700;">${escapeHtml(order.reference)}</div>
                <div style="margin-top: 20px; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Current Status</div>
                <div style="margin-top: 8px; display: inline-block; border-radius: 999px; background: #1a2e1a; padding: 12px 18px; color: #f5f2ed; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">
                  ${escapeHtml(order.status)}
                </div>
              </div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 22px;">
                <tr>
                  ${['processing', 'shipped', 'delivered'].map((step, index) => {
                    const complete =
                      order.status === 'delivered'
                        ? true
                        : order.status === 'shipped'
                          ? index <= 1
                          : index === 0;
                    const cancelled = order.status === 'cancelled';

                    return `<td style="vertical-align: top; width: 33.33%;">
                        <div style="display: flex; align-items: center;">
                          <div style="width: 26px; height: 26px; border-radius: 999px; border: 1px solid ${
                            cancelled ? 'rgba(220, 38, 38, 0.24)' : complete ? '#1a2e1a' : 'rgba(26, 46, 26, 0.18)'
                          }; background: ${
                            cancelled ? '#fee2e2' : complete ? '#1a2e1a' : '#ffffff'
                          }; color: ${
                            cancelled ? '#b91c1c' : complete ? '#f5f2ed' : 'rgba(26, 46, 26, 0.4)'
                          }; font-size: 11px; font-weight: 700; line-height: 26px; text-align: center;">${index + 1}</div>
                          ${index < 2 ? `<div style="height: 2px; flex: 1; margin: 0 8px; background: ${
                            cancelled ? '#fecaca' : complete && order.status !== 'processing' ? '#1a2e1a' : 'rgba(26, 46, 26, 0.12)'
                          };"></div>` : ''}
                        </div>
                        <div style="margin-top: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${
                          cancelled ? '#b91c1c' : complete ? '#1a2e1a' : 'rgba(26, 46, 26, 0.4)'
                        };">${escapeHtml(step)}</div>
                      </td>`;
                  }).join('')}
                </tr>
              </table>

              <div style="margin-top: 24px; border-radius: 24px; background: #1a2e1a; padding: 22px 24px; color: #f5f2ed;">
                <div style="font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: #c5a059; font-weight: 700;">Track your order</div>
                <p style="margin: 10px 0 0; font-size: 14px; line-height: 1.75; color: rgba(245, 242, 237, 0.82);">
                  You can review the latest order progress anytime from your account.
                </p>
                <a href="${escapeHtml(`${appUrl.replace(/\/$/, '')}/orders`)}" style="display: inline-block; margin-top: 16px; padding: 12px 18px; border-radius: 999px; background: #c5a059; color: #1a2e1a; text-decoration: none; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">
                  View My Orders
                </a>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildStatusUpdateText(order: OrderStatusEmail) {
  const meta = getStatusEmailMeta(order.status);

  return [
    'Prestige Farm Foods',
    meta.title,
    '',
    `${order.customerName}, ${meta.description}`,
    '',
    `Order Reference: ${order.reference}`,
    `Current Status: ${order.status}`,
    '',
    `View your orders: ${appUrl.replace(/\/$/, '')}/orders`,
  ].join('\n');
}

export async function sendOrderStatusUpdateEmail(order: OrderStatusEmail) {
  return sendEmail({
    to: order.customerEmail,
    subject: `Prestige order update ${order.reference}`,
    html: buildStatusUpdateHtml(order),
    text: buildStatusUpdateText(order),
    idempotencyKey: `order-status-${order.reference}-${order.status}-${Date.now()}`,
  });
}

export type { OrderStatusEmail, ReceiptOrder };
