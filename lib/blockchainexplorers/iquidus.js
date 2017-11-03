'use strict';

var _ = require('lodash');
var $ = require('preconditions').singleton();
var log = require('npmlog');
log.debug = log.verbose;
var io = require('socket.io-client');
var requestList = require('./request-list');

function Iquidus(opts) {
  $.checkArgument(opts);
  //$.checkArgument(_.contains(['livenet', 'testnet'], opts.network));
  $.checkArgument(_.contains(['livenet'], opts.network));
  $.checkArgument(opts.url);

  this.apiPrefix = opts.apiPrefix || '/api';
  this.network = opts.network || 'livenet';
  this.hosts = opts.url;
  this.userAgent = opts.userAgent || 'bws';
};


var _parseErr = function(err, res) {
  if (err) {
    log.warn('Iquidus error: ', err);
    return "Iquidus Error";
  }
  log.warn("Iquidus " + res.request.href + " Returned Status: " + res.statusCode);
  return "Error querying the blockchain";
};

Iquidus.prototype._doRequest = function(args, cb) {
  var opts = {
    hosts: this.hosts,
    headers: {
      'User-Agent': this.userAgent,
    }
  };
  requestList(_.defaults(args, opts), cb);
};

Iquidus.prototype.getConnectionInfo = function() {
  return 'Iquidus (' + this.network + ') @ ' + this.hosts;
};

/**
 * Retrieve a list of unspent outputs associated with an address or set of addresses
 */
Iquidus.prototype.getUtxos = function(addresses, cb) {
  console.log("getUtxos(): addrs: " + [].concat(addresses).join(','));

  var url = this.url + this.apiPrefix + '/addrs/utxo';
  var args = {
    method: 'POST',
    path: this.apiPrefix + '/addrs/utxo',
    json: {
      addrs: [].concat(addresses).join(',')
    },
  };

  this._doRequest(args, function(err, res, unspent) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, unspent);
  });
};

/**
 * Broadcast a transaction to the bitcoin network
 */
Iquidus.prototype.broadcast = function(rawTx, cb) {
  console.log("broadcast(rawTx): " + rawTx);

  var args = {
    method: 'POST',
    path: this.apiPrefix + '/tx/send',
    json: {
      rawtx: rawTx
    },
  };

  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body ? body.txid : null);
  });
};

Iquidus.prototype.getTransaction = function(txid, cb) {
  console.log("getTransaction(): txid: " + txid);

  var args = {
    method: 'GET',
    path: this.apiPrefix + '/tx/' + txid,
    json: true,
  };

  this._doRequest(args, function(err, res, tx) {
    if (res && res.statusCode == 404) return cb();
    if (err || res.statusCode !== 200)
      return cb(_parseErr(err, res));

    return cb(null, tx);
  });
};

Iquidus.prototype.getTransactions = function(addresses, from, to, cb) {
  console.log("getTransactions): addresses, from, to: " + [].concat(addresses).join(',') + ", " + from + ", " + to);

  var qs = [];
  var total;
  if (_.isNumber(from)) qs.push('from=' + from);
  if (_.isNumber(to)) qs.push('to=' + to);

  // Trim output
  qs.push('noAsm=1');
  qs.push('noScriptSig=1');
  qs.push('noSpent=1');

  var args = {
    method: 'POST',
    path: this.apiPrefix + '/addrs/txs' + (qs.length > 0 ? '?' + qs.join('&') : ''),
    json: {
      addrs: [].concat(addresses).join(',')
    },
    timeout: 120000,
  };

  this._doRequest(args, function(err, res, txs) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));

    if (_.isObject(txs)) {
      if (txs.totalItems)
        total = txs.totalItems;

      if (txs.items)
        txs = txs.items;
    }

    // NOTE: Whenever Iquidus breaks communication with bitcoind, it returns invalid data but no error code.
    if (!_.isArray(txs) || (txs.length != _.compact(txs).length)) return cb(new Error('Could not retrieve transactions from blockchain. Request was:' + JSON.stringify(args)));

    return cb(null, txs, total);
  });
};

Iquidus.prototype.getAddressActivity = function(address, cb) {
  console.log("getAddressActivity(): address: " + address);

  var self = this;

  var args = {
    method: 'GET',
    path: self.apiPrefix + '/addr/' + address,
    json: true,
  };

  this._doRequest(args, function(err, res, result) {
    if (res && res.statusCode == 404) return cb();
    if (err || res.statusCode !== 200)
      return cb(_parseErr(err, res));

    var nbTxs = result.unconfirmedTxApperances + result.txApperances;
    return cb(null, nbTxs > 0);
  });
};

Iquidus.prototype.estimateFee = function(nbBlocks, cb) {
  console.log("estimateFee(): nbBlocks: " + [].concat(nbBlocks).join(','));

  var path = this.apiPrefix + '/utils/estimatefee';
  if (nbBlocks) {
    path += '?nbBlocks=' + [].concat(nbBlocks).join(',');
  }

  var args = {
    method: 'GET',
    path: path,
    json: true,
  };
  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body);
  });
};

Iquidus.prototype.getBlockchainHeight = function(cb) {
  console.log("getBlockchainHeight(): ");

  var path = this.apiPrefix + '/sync';

  var args = {
    method: 'GET',
    path: path,
    json: true,
  };
  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body.blockChainHeight);
  });
};

Iquidus.prototype.getTxidsInBlock = function(blockHash, cb) {
  console.log("getTxidsInBlock(): blockHash: " + blockHash);

  var self = this;

  var args = {
    method: 'GET',
    path: this.apiPrefix + '/block/' + blockHash,
    json: true,
  };

  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body.tx);
  });
};

Iquidus.prototype.initSocket = function() {
  console.log("initSocket(): _.first([].concat(this.hosts)): " + this.hosts);

  // sockets always use the first server on the pull
  var socket = io.connect(_.first([].concat(this.hosts)), {
    'reconnection': true,
  });
  return socket;
};

module.exports = Iquidus;
