var assert = require('node:assert/strict');
var test = require('node:test');
var orders = require('../lib/orders');
var ledger = require('../lib/ledger');
var store = require('../lib/store');
var customers = require('../routes/customers');

var orderDb = { orders: [
  { id: 1, date: '28/12/2021' },
  { id: 2, date: '01/01/2022' },
  { id: 3, date: '31/01/2022' },
  { id: 4, date: '2022-03-15' }
] };

test('order history sorts newest first across month and year boundaries', function () {
  assert.deepEqual(orders.list(orderDb).map(function (order) {
    return order.id;
  }), [4, 3, 2, 1]);
});

test('order history uses inclusive date bounds in either supported format', function () {
  assert.deepEqual(orders.list(orderDb, { from: '2022-01-01', to: '31/01/2022' }).map(function (order) {
    return order.id;
  }), [3, 2]);
});

test('Khata settlement adds a form amount numerically and updates the balance', function () {
  var db = {
    customers: [{ id: 1, openingBalance: 450, totalBilled: 1982.01, totalSettled: 1200 }],
    nextSettlementId: 1
  };
  var result = ledger.recordSettlement(db, 1, '500', 'upi');
  assert.equal(result.ok, true);
  assert.equal(result.customer.totalSettled, 1700);
  assert.equal(result.customer.balance, 732.01);
  assert.equal(result.settlement.amount, 500);
});

test('Khata rejects nonnumeric amounts without modifying the ledger', function () {
  var db = { customers: [{ id: 1 }], nextSettlementId: 1 };
  assert.equal(ledger.recordSettlement(db, 1, 'invalid', 'upi').ok, false);
  assert.deepEqual(db, { customers: [{ id: 1 }], nextSettlementId: 1 });
});

test('Khata records the same rounded amount on the receipt and account', function () {
  var db = { customers: [{ id: 1 }], nextSettlementId: 1 };
  assert.equal(ledger.recordSettlement(db, 1, '0.004', 'upi').ok, false);
  var result = ledger.recordSettlement(db, 1, '0.015', 'upi');
  assert.equal(result.settlement.amount, 0.02);
  assert.equal(result.customer.totalSettled, 0.02);
});

test('the settlement audit records the credited amount', function (t) {
  var db = { customers: [{ id: 1, name: 'Test customer' }], nextSettlementId: 1 };
  t.mock.method(store, 'read', function () { return db; });
  t.mock.method(store, 'write', function () {});
  var route = customers.stack.find(function (layer) {
    return layer.route && layer.route.path === '/customers/:id/settle';
  });
  var response = {
    status: function (code) { assert.equal(code, 201); return this; },
    json: function () {}
  };
  route.route.stack[0].handle({ params: { id: 1 }, body: { amount: '0.015' } }, response);
  assert.match(db.auditLog[0].details, /settled ₹0\.02 via UPI/);
});
