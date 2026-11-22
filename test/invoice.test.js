var assert = require('node:assert/strict');
var test = require('node:test');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function billedOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  return {
    id: 1,
    date: '22/11/2026',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('invoice shows the billed total and GST for a mixed-rate order with a capped coupon', function () {
  var order = billedOrder([
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 1000, qty: 1 }
  ], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual([figures.discount, figures.tax, figures.total], [150, 157.25, 2007.25]);
  assert.deepEqual([figures.cgst, figures.sgst], [78.63, 78.62]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 46.25], [12, 111]]);
});

test('checkout allocates the capped coupon before calculating GST by HSN', function () {
  var items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 1000, qty: 1 }
  ];
  var totals = pricing.computeTotals(items, 'SAVE10');

  assert.equal(totals.subtotal, 2000);
  assert.equal(totals.discount, 150);
  assert.deepEqual(totals.lines.map(function (line) {
    return [line.discount, line.taxable, line.gstPercent, line.tax];
  }), [[75, 925, 5, 46.25], [75, 925, 12, 111]]);
  assert.deepEqual([totals.tax, totals.cgst, totals.sgst, totals.total],
    [157.25, 78.63, 78.62, 2007.25]);
});

test('invoice uses the checkout HSN rate when gstRate is absent', function () {
  // New checkout lines carry the HSN without an explicit GST rate.
  var order = billedOrder([{ id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 2 }]);
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual([order.tax, order.total], [10, 210]);
  assert.deepEqual([figures.rows[0].gstPercent, figures.rows[0].lineTax], [5, 10]);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [10, 5, 5, 210]);

  var html = invoice.render(order);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹10\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹210\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice honors the checkout coupon cap and post-discount GST', function () {
  var order = billedOrder([{ name: 'Tea', hsn: '0902', price: 2000, qty: 1 }], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual([order.discount, order.tax, order.total], [150, 333, 2183]);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [150, 333, 2183]);
});

test('invoice handles percentage, decimal, and zero GST rates like checkout', function () {
  var items = [
    { name: 'Percentage rate', price: 100, qty: 1, gstRate: 5 },
    { name: 'Decimal rate', price: 100, qty: 1, gstRate: 0.05 },
    { name: 'Zero rate', price: 100, qty: 1, gstRate: 0 }
  ];
  var order = billedOrder(items);
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 10);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 5], [5, 5], [0, 0]]);
  assert.equal(figures.tax, 10);
});

test('invoice uses checkout line rounding for displayed and aggregate GST', function () {
  var order = billedOrder([
    { name: 'Small line A', price: 0.03, qty: 1 },
    { name: 'Small line B', price: 0.03, qty: 1 }
  ]);
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual([order.tax, order.total], [0.02, 0.08]);
  assert.deepEqual(figures.rows.map(function (row) {
    return row.lineTax;
  }), [0.01, 0.01]);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [0.02, 0.01, 0.01, 0.08]);
});

test('invoice and reconciliation honor saved billed amounts for older orders', function () {
  var order = billedOrder([{ name: 'Tea', price: 100, qty: 1 }]);
  order.tax = 17;
  order.total = 117;
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [17, 8.5, 8.5, 117]);
  assert.deepEqual([figures.rows[0].gstPercent, figures.rows[0].lineTax], [null, null]);
  assert.match(invoice.render(order), /Unavailable<\/td><td class="r">Unavailable/);
  var cancelledOrder = Object.assign({}, order, { id: 2, status: 'cancelled' });
  var reconciliation = reports.getGstReconciliation({ orders: [order, cancelledOrder] });

  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.equal(reconciliation.rows[0].matched, true);
  assert.equal(reconciliation.rows[0].ledgerTax, 17);
  assert.equal(reconciliation.rows[0].invoiceTax, 17);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});
