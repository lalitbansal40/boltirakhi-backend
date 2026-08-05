import { env } from '../../../config/env';

/**
 * The order receipt.
 *
 * ⚠️ This is deliberately old-fashioned HTML: tables for layout, inline
 * styles, no flexbox and no grid. Gmail strips <style> blocks and does not
 * support modern layout, so anything written the way a web page is written
 * looks correct in a browser and arrives broken in an inbox — which is the
 * worst kind of bug, because it is invisible during development.
 *
 * No images either. Gmail blocks remote images by default, and a layout that
 * depends on one looks broken to most recipients on first open.
 */

export interface OrderEmailInput {
  orderNumber: string;
  /** `packLabel` is absent on singles, and on every order placed before packs. */
  items: { title: string; qty: number; packLabel?: string; pricePaise: number }[];
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  address: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  /** Present when the order carries a message the sister still has to record. */
  boltiToken?: string;
  supportPhone: string;
}

/**
 * Paise to rupees, for a person to read.
 *
 * Same rounding as the confirmation SMS: totals are whole rupees in practice,
 * and a stray paisa in a receipt reads as a mistake.
 */
function rs(paise: number): string {
  return `Rs ${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

/** Anything that reaches HTML comes from our own database, but escape anyway. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function orderConfirmationEmail(input: OrderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Order ${input.orderNumber} confirmed — Bolti Rakhi`;

  const boltiUrl = input.boltiToken
    ? // Built from PUBLIC_SITE_URL. If that is left pointing at localhost in
      // production, this link goes out dead — see the launch checklist.
      `${env.PUBLIC_SITE_URL}/bolti/${input.boltiToken}`
    : null;

  const itemRows = input.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#333;">${esc(item.title)}<br>
            <span style="color:#777;">${item.packLabel ? `${item.packLabel} &middot; ` : ''}Qty ${item.qty}</span>
          </td>
          <td style="padding:8px 0;font-size:14px;color:#333;text-align:right;white-space:nowrap;">
            ${rs(item.pricePaise * item.qty)}
          </td>
        </tr>`,
    )
    .join('');

  const totalRow = (label: string, value: string, bold = false) => `
    <tr>
      <td style="padding:4px 0;font-size:14px;color:${bold ? '#333' : '#777'};${bold ? 'font-weight:bold;' : ''}">${label}</td>
      <td style="padding:4px 0;font-size:14px;color:${bold ? '#333' : '#777'};text-align:right;${bold ? 'font-weight:bold;' : ''}">${value}</td>
    </tr>`;

  // 600px because that is how wide an inbox column is; wider gets cut off.
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#faf7f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;padding:24px;font-family:Arial,Helvetica,sans-serif;">

        <tr><td style="font-size:20px;font-weight:bold;color:#b4322e;padding-bottom:4px;">Bolti Rakhi</td></tr>
        <tr><td style="font-size:16px;color:#333;padding-bottom:16px;">Your order is confirmed.</td></tr>

        <tr><td style="font-size:14px;color:#777;padding-bottom:16px;">
          Order number <strong style="color:#333;">${esc(input.orderNumber)}</strong>
        </td></tr>

        <tr><td style="border-top:1px solid #eee;padding-top:12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
        </td></tr>

        <tr><td style="border-top:1px solid #eee;padding-top:12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${totalRow('Subtotal', rs(input.subtotalPaise))}
            ${totalRow('Delivery', input.shippingPaise === 0 ? 'FREE' : rs(input.shippingPaise))}
            ${input.discountPaise > 0 ? totalRow('Discount', `- ${rs(input.discountPaise)}`) : ''}
            ${totalRow('Total paid', rs(input.totalPaise), true)}
          </table>
        </td></tr>

        <tr><td style="border-top:1px solid #eee;padding-top:12px;font-size:14px;color:#777;">
          <strong style="color:#333;">Delivering to</strong><br>
          ${esc(input.address.name)}<br>
          ${esc(input.address.line1)}${input.address.line2 ? `, ${esc(input.address.line2)}` : ''}<br>
          ${esc(input.address.city)}, ${esc(input.address.state)} ${esc(input.address.pincode)}
        </td></tr>

        ${
          boltiUrl
            ? `<tr><td style="padding-top:16px;">
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf3f0;border-radius:6px;">
                   <tr><td style="padding:16px;font-size:14px;color:#333;">
                     <strong>Your rakhi carries a message.</strong><br>
                     Record it before we pack the parcel — it is optional, and the
                     rakhi ships either way.<br><br>
                     <a href="${boltiUrl}" style="color:#b4322e;font-weight:bold;">Record your message</a>
                   </td></tr>
                 </table>
               </td></tr>`
            : ''
        }

        <tr><td style="border-top:1px solid #eee;padding-top:16px;margin-top:16px;font-size:13px;color:#777;">
          We will send you an SMS when it ships.<br>
          Questions? Call us on <strong style="color:#333;">${esc(input.supportPhone)}</strong>.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  /**
   * The plain-text version, sent alongside.
   *
   * An HTML-only email scores worse with spam filters, and this one has to
   * land in an inbox first time or the customer never sees their receipt.
   */
  const text = [
    `Bolti Rakhi — order ${input.orderNumber} confirmed`,
    '',
    ...input.items.map(
      (item) =>
        `${item.title}${item.packLabel ? ` (${item.packLabel})` : ''} x${item.qty}   ${rs(
          item.pricePaise * item.qty,
        )}`,
    ),
    '',
    `Subtotal:  ${rs(input.subtotalPaise)}`,
    `Delivery:  ${input.shippingPaise === 0 ? 'FREE' : rs(input.shippingPaise)}`,
    ...(input.discountPaise > 0 ? [`Discount: -${rs(input.discountPaise)}`] : []),
    `Total:     ${rs(input.totalPaise)}`,
    '',
    'Delivering to:',
    input.address.name,
    `${input.address.line1}${input.address.line2 ? ', ' + input.address.line2 : ''}`,
    `${input.address.city}, ${input.address.state} ${input.address.pincode}`,
    ...(boltiUrl
      ? ['', 'Record your message (optional):', boltiUrl]
      : []),
    '',
    'We will send an SMS when it ships.',
    `Questions? Call ${input.supportPhone}.`,
  ].join('\n');

  return { subject, html, text };
}
