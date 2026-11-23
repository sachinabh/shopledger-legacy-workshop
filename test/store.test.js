var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var store = require('../lib/store');

test('an interrupted database write leaves the live database untouched', function (t) {
  t.mock.method(fs, 'statSync', function () { return { mode: 0o600 }; });
  var write = t.mock.method(fs, 'writeFileSync', function () { throw new Error('interrupted'); });
  var rename = t.mock.method(fs, 'renameSync', function () {});
  var unlink = t.mock.method(fs, 'unlinkSync', function () {});

  assert.throws(function () { store.write({}); }, /interrupted/);
  var temporaryFile = write.mock.calls[0].arguments[0];
  assert.notEqual(path.basename(temporaryFile), 'db.json');
  assert.equal(rename.mock.callCount(), 0);
  assert.equal(unlink.mock.calls[0].arguments[0], temporaryFile);
});

test('a successful database write replaces the live file only after writing the temporary file', function (t) {
  var calls = [];
  t.mock.method(fs, 'statSync', function () { return { mode: 0o600 }; });
  t.mock.method(fs, 'writeFileSync', function (file, data, options) {
    calls.push(['write', file]);
    assert.deepEqual(JSON.parse(data).orders, []);
    assert.equal(options.mode, 0o600);
    assert.equal(options.flag, 'wx');
  });
  t.mock.method(fs, 'renameSync', function (from, to) { calls.push(['rename', from, to]); });

  store.write({});
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'rename');
  assert.equal(calls[1][1], calls[0][1]);
  assert.equal(path.basename(calls[1][2]), 'db.json');
  assert.equal(path.dirname(calls[1][1]), path.dirname(calls[1][2]));
});
