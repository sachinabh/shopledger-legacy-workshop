var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var vm = require('node:vm');

function billingDesk() {
  var elements = new Map();
  var requests = [];
  var context = {
    window: {},
    document: {
      getElementById: function (id) {
        if (!elements.has(id)) elements.set(id, { value: '' });
        return elements.get(id);
      },
      querySelectorAll: function () { return []; }
    },
    XMLHttpRequest: function () {
      this.open = function (method, url) { this.url = url; };
      this.setRequestHeader = function () {};
      this.send = function () { requests.push(this); };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), context);
  context.allProducts = [{ id: 1, name: 'Rice', price: 100 }];
  context.cartQuantities[1] = 1;
  return { app: context, elements: context.document, requests: requests };
}

function respond(request, total) {
  request.status = 200;
  request.responseText = JSON.stringify({ totals: { subtotal: total, discount: 0, tax: 0, total: total } });
  request.onload();
}

test('checkout ignores a second click while the order request is pending', function () {
  var desk = billingDesk();
  var button = desk.elements.getElementById('place');
  button.onclick();
  button.onclick();
  assert.equal(desk.requests.filter(function (req) { return req.url === '/api/orders'; }).length, 1);
});

test('cart ignores an older preview reply after the newer price or a clear', function () {
  var desk = billingDesk();
  desk.app.updateCartPreview();
  desk.app.cartQuantities[1] = 2;
  desk.app.updateCartPreview();
  var previews = desk.requests.filter(function (req) { return req.url === '/api/pricing/preview'; });
  respond(previews[1], 200);
  respond(previews[0], 100);
  assert.equal(desk.elements.getElementById('preview-total').textContent, '₹200.00');

  desk.app.updateCartPreview();
  var pending = desk.requests.at(-1);
  assert.equal(desk.elements.getElementById('preview-total').textContent, '—');
  desk.app.cartQuantities = {};
  desk.app.updateCartPreview();
  respond(pending, 200);
  assert.equal(desk.elements.getElementById('preview-total').textContent, '₹0.00');
});

test('settlement blocks a repeat click and reports a network error', function () {
  var desk = billingDesk();
  var button = desk.elements.getElementById('btn-record-settlement');
  button.onclick();
  button.onclick();
  var requests = desk.requests.filter(function (req) { return req.url.includes('/settle'); });
  assert.equal(requests.length, 1);
  requests[0].onerror();
  assert.equal(button.disabled, false);
  assert.match(desk.elements.getElementById('khata-msg').textContent, /request failed/i);
});
