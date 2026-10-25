import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPaise,
  rupeesToPaise,
  paiseToRupees,
  calculateOrderTotals
} from '../pricing';

test('formatPaise: converts integer paise to Indian Rupee currency format', () => {
  assert.equal(formatPaise(0), '₹0.00');
  assert.equal(formatPaise(18000), '₹180.00'); // ₹180.00 Espresso
  assert.equal(formatPaise(24050), '₹240.50'); // ₹240.50 Cappuccino with extra
  assert.equal(formatPaise(17500), '₹175.00'); // ₹175.00 Muffin
  assert.equal(formatPaise(100000), '₹1,000.00');
});

test('rupeesToPaise & paiseToRupees: reversible integer conversion', () => {
  assert.equal(rupeesToPaise(180), 18000);
  assert.equal(rupeesToPaise(240.50), 24050);
  assert.equal(paiseToRupees(18000), 180);
  assert.equal(paiseToRupees(24050), 240.5);
});

test('calculateOrderTotals: basic item calculation without discount', () => {
  const items = [
    { price_paise: 18000, quantity: 2 }, // 2x Artisan Espresso = 36000
    { price_paise: 24000, quantity: 1 }  // 1x Velvet Cappuccino = 24000
  ];

  const totals = calculateOrderTotals(items, 0, 5); // 5% GST

  // Subtotal = 36000 + 24000 = 60000 paise (₹600.00)
  assert.equal(totals.subtotalPaise, 60000);
  // Tax = 5% of 60000 = 3000 paise (₹30.00)
  assert.equal(totals.taxPaise, 3000);
  assert.equal(totals.discountPaise, 0);
  // Total = 60000 + 3000 = 63000 paise (₹630.00)
  assert.equal(totals.totalPaise, 63000);
});

test('calculateOrderTotals: applies discount correctly before tax calculation', () => {
  const items = [
    { price_paise: 40000, quantity: 1 } // 1x ₹400.00 item = 40000 paise
  ];
  const discountPaise = 10000; // ₹100.00 discount

  const totals = calculateOrderTotals(items, discountPaise, 5); // 5% GST

  assert.equal(totals.subtotalPaise, 40000);
  assert.equal(totals.discountPaise, 10000);
  // Taxable amount = 40000 - 10000 = 30000 paise
  // Tax = 5% of 30000 = 1500 paise (₹15.00)
  assert.equal(totals.taxPaise, 1500);
  // Total = 30000 + 1500 = 31500 paise (₹315.00)
  assert.equal(totals.totalPaise, 31500);
});

test('calculateOrderTotals: discount cannot exceed subtotal (safe bounds)', () => {
  const items = [{ price_paise: 20000, quantity: 1 }];
  const excessiveDiscount = 50000; // ₹500 discount on ₹200 item

  const totals = calculateOrderTotals(items, excessiveDiscount, 5);

  assert.equal(totals.subtotalPaise, 20000);
  assert.equal(totals.discountPaise, 20000); // Clamped to subtotal
  assert.equal(totals.taxPaise, 0);
  assert.equal(totals.totalPaise, 0);
});
