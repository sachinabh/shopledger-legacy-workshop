var assert = require('node:assert/strict');
var test = require('node:test');
var inventory = require('../lib/inventory');
var orders = require('../lib/orders');

test('checkout accepts the last sellable unit and protects reserved stock', function () {
  var products = [{ id: 1, name: 'Ghee', stock: 4, reserved: 3 }];
  assert.equal(inventory.check(products, [{ id: 1, qty: 1 }]).ok, true);
  assert.equal(inventory.check(products, [{ id: 1, qty: 2 }]).ok, false);
  assert.equal(inventory.check(products, [{ id: 1, qty: 1 }, { id: '1', qty: 1 }]).ok, false);
});

test('cancellation restores physical stock once and preserves reserved units', function () {
  var items = [{ id: 1, qty: 2 }];
  var db = {
    products: [{ id: 1, stock: 4, reserved: 1 }],
    orders: [{ id: 1, status: 'pending', items: items }]
  };
  inventory.reserve(db.products, items);
  assert.equal(db.products[0].stock, 2);
  assert.equal(orders.cancel(db, 1).ok, true);
  assert.deepEqual(db.products[0], { id: 1, stock: 4, reserved: 1 });
  assert.equal(orders.cancel(db, 1).ok, false);
  assert.equal(db.products[0].stock, 4);
});
