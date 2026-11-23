var fs = require('fs');
var path = require('path');
var randomUUID = require('crypto').randomUUID;

var DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function ensureStructure(db) {
  if (!db.products) db.products = [];
  if (!db.orders) db.orders = [];
  if (!db.customers) db.customers = [];
  if (!db.settlements) db.settlements = [];
  if (!db.auditLog) db.auditLog = [];
  if (!db.nextOrderId) db.nextOrderId = 1001;
  if (!db.nextSettlementId) db.nextSettlementId = 501;
  return db;
}

exports.read = function () {
  var raw = fs.readFileSync(DB_FILE, 'utf8');
  var parsed = JSON.parse(raw);
  return ensureStructure(parsed);
};

exports.write = function (db) {
  ensureStructure(db);
  var temporaryFile = DB_FILE + '.' + randomUUID() + '.tmp';
  var current = fs.statSync(DB_FILE, { throwIfNoEntry: false });
  var mode = current ? current.mode & 0o777 : 0o600;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(db, null, 2), { flag: 'wx', mode: mode, flush: true });
    fs.renameSync(temporaryFile, DB_FILE);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      try {
        fs.unlinkSync(temporaryFile);
      } catch (cleanupError) {
        // Preserve the write error even if cleanup fails.
      }
    }
    throw error;
  }
};

exports.appendAudit = function (db, action, details) {
  if (!db.auditLog) db.auditLog = [];
  db.auditLog.unshift({
    ts: new Date().toISOString(),
    action: action,
    details: details || ''
  });
  if (db.auditLog.length > 100) {
    db.auditLog = db.auditLog.slice(0, 100);
  }
};
