var assert = require('node:assert/strict');
var test = require('node:test');
var orderRoutes = require('../routes/orders');
var reportRoutes = require('../routes/reports');
var store = require('../lib/store');
var ledger = require('../lib/ledger');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var config = require('../config');
var reports = require('../lib/reports');

function request(router, path, body, params) {
  var endpoint = router.stack.find(function (entry) {
    return entry.route && entry.route.path === path && entry.route.methods.post;
  });
  var response = {
    statusCode: 200,
    status: function (code) { this.statusCode = code; return this; },
    json: function (value) { this.body = value; }
  };
  assert.ok(endpoint, 'Expected POST ' + path);
  endpoint.route.stack[0].handle({ body: body, params: params || {} }, response);
  return response;
}

function checkoutDb(t) {
  var db = {
    products: [{ id: 1, name: 'Rice', stock: 10, hsn: '1006', price: 100, gstRate: 12 }],
    orders: [],
    nextOrderId: 1
  };
  t.mock.method(store, 'read', function () { return db; });
  t.mock.method(store, 'write', function () {});
  return db;
}

test('preview and checkout both reject zero quantities', function (t) {
  var db = checkoutDb(t);
  var payload = { items: [{ id: 1, qty: 0 }] };
  assert.equal(request(orderRoutes, '/orders', payload).statusCode, 400);
  assert.equal(request(reportRoutes, '/pricing/preview', payload).statusCode, 400);
  assert.equal(db.products[0].stock, 10);
  assert.equal(db.orders.length, 0);
});

test('checkout rejects cancelled as an initial status without deducting stock', function (t) {
  var db = checkoutDb(t);
  var response = request(orderRoutes, '/orders', { items: [{ id: 1, qty: 1 }], status: 'cancelled' });
  assert.equal(response.statusCode, 400);
  assert.equal(db.products[0].stock, 10);
  assert.equal(db.orders.length, 0);
});

test('preview and checkout both use the product GST rate override', function (t) {
  checkoutDb(t);
  var payload = { items: [{ id: 1, qty: 1 }] };
  assert.equal(request(reportRoutes, '/pricing/preview', payload).body.totals.tax, 12);
  var billed = request(orderRoutes, '/orders', payload);
  assert.equal(billed.statusCode, 201);
  assert.equal(billed.body.tax, 12);
});

test('a zero Khata limit is displayed and enforced', function () {
  var db = { customers: [{ id: 1, creditLimit: 0 }] };
  assert.equal(ledger.listCustomers(db)[0].creditLimit, 0);
  assert.equal(ledger.chargeOrderToKhata(db, 1, 1).ok, false);
});

test('line discounts add up to the rounded order discount', function () {
  var totals = pricing.computeTotals([{ price: 50.05, qty: 1 }, { price: 50.05, qty: 1 }], 'WELCOME');
  assert.equal(totals.discount, 5.01);
  assert.deepEqual(totals.lines.map(function (line) { return line.discount; }), [2.51, 2.50]);
});

test('dispatch completes a pending order without charging or deducting its stock again', function (t) {
  var db = checkoutDb(t);
  var order = request(orderRoutes, '/orders', { items: [{ id: 1, qty: 1 }], status: 'pending' }).body;
  var response = request(orderRoutes, '/orders/:id/dispatch', {}, { id: order.id });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'completed');
  assert.equal(db.products[0].stock, 9);
  assert.equal(db.orders.length, 1);
  assert.equal(request(orderRoutes, '/orders/:id/dispatch', {}, { id: order.id }).statusCode, 409);
});

test('a printed invoice keeps the per-line GST captured at checkout', function (t) {
  var db = checkoutDb(t);
  delete db.products[0].gstRate;
  var order = request(orderRoutes, '/orders', { items: [{ id: 1, qty: 1 }], coupon: 'WELCOME' }).body;
  var savedOrder = JSON.parse(JSON.stringify(order));
  var originalRate = config.tax.hsnSlabs['1006'];
  t.after(function () { config.tax.hsnSlabs['1006'] = originalRate; });
  config.tax.hsnSlabs['1006'] = 18;
  var figures = invoice.computeInvoiceFigures(savedOrder);
  assert.deepEqual([figures.rows[0].gstPercent, figures.rows[0].lineTax, figures.tax, figures.total],
    [5, 4.75, 4.75, 99.75]);
  assert.equal(savedOrder.items[0].billedGstPercent, 5);
  assert.equal(savedOrder.items[0].billedLineTax, 4.75);
  savedOrder.tax = 5;
  assert.equal(reports.getGstReconciliation({ orders: [savedOrder] }).mismatchCount, 1);
});
