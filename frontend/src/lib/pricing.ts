/**
 * NetKeep Café — Integer Paise Pricing Utilities
 * Prevents IEEE 754 floating point inaccuracies in financial calculations.
 * 1 Rupee = 100 Paise
 */

import { OrderTotals } from './types';

/**
 * Formats an integer amount of paise into a clean Indian Rupee display string.
 * Example: 24550 -> "₹245.50", 18000 -> "₹180.00"
 */
export function formatPaise(paise: number): string {
  if (isNaN(paise) || !isFinite(paise)) return "₹0.00";
  const absPaise = Math.abs(Math.round(paise));
  const rupees = Math.floor(absPaise / 100);
  const remainder = absPaise % 100;
  const sign = paise < 0 ? "-" : "";
  return `${sign}₹${rupees.toLocaleString('en-IN')}.${remainder.toString().padStart(2, '0')}`;
}

/**
 * Converts float Rupee input to integer paise.
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Converts integer paise to float Rupees for input displays.
 */
export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Calculates order totals using strict integer paise arithmetic.
 * Default tax rate is 5% (Standard Cafe GST/VAT).
 */
export function calculateOrderTotals(
  items: Array<{ price_paise: number; quantity: number }>,
  discountPaise: number = 0,
  taxRatePercent: number = 5
): OrderTotals {
  // 1. Calculate Subtotal
  const subtotalPaise = items.reduce((sum, item) => {
    const qty = Math.max(0, Math.floor(item.quantity));
    const price = Math.max(0, Math.floor(item.price_paise));
    return sum + (price * qty);
  }, 0);

  // 2. Validate Discount (cannot exceed subtotal)
  const safeDiscountPaise = Math.min(Math.max(0, Math.floor(discountPaise)), subtotalPaise);

  // 3. Calculate Tax on (Subtotal - Discount)
  const taxableAmount = Math.max(0, subtotalPaise - safeDiscountPaise);
  const taxPaise = Math.round((taxableAmount * taxRatePercent) / 100);

  // 4. Calculate Final Total
  const totalPaise = taxableAmount + taxPaise;

  return {
    subtotalPaise,
    taxPaise,
    discountPaise: safeDiscountPaise,
    totalPaise
  };
}
