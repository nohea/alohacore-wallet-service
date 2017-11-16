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
    console.log("WARN EXPERIMENTAL: ");
    console.log("Iquidus.getUtxos(): addrs: " + [].concat(addresses).join(','));
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
 * Retrieve a list of unspent outputs associated with an address or set of addresses
 */
Iquidus.prototype.getUtxosSingleAddr = function(address, cb) {
  var address = addresses[0];
    
  console.log("WARN EXPERIMENTAL: ");
  console.log("Iquidus.getUtxosSingleAddr(): addr: " + address);

  var url = '/ext/listunspent' + '/' + address;
  console.log("GET " + url);
  var args = {
    method: 'GET',
    path: url,
    json: true,
  };
    
  this._doRequest(args, function(err, res, unspent) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
      
    var unspentInsight = utxosListunspentToInsight(unspent, address);

    console.log("Iquidus.getUtxos(): unspentInsight: " + JSON.stringify(unspentInsight));

    return cb(null, unspentInsight);
  });

    var utxosListunspentToInsight = function(utxoList, address) {
      console.log("Iquidus.getUtxos(): utxosListunspentToInsight(): " + JSON.stringify(utxoList));
      var utxos = [];
      _.forEach(utxoList.unspent_outputs, function(utxo) {
	  // caller will expect this:
	  var u = _.pick(utxo, ['txid', 'vout', 'address', 'scriptPubKey', 'amount', 'satoshis', 'confirmations'])

	  u.txid = utxo.tx_hash;
	  u.vout = utxo.tx_ouput_n;
	  u.address = address;
	  u.scriptPubKey = utxo.script;
	  u.satoshis = utxo.value;

	  u.confirmations = null;

	  //if (tx.blockheight >= 0) {
	  //    u.confirmations = height - tx.blockheight + 1;
	  //}
	  
	  utxos.push(u);
      });

      return utxos;
  };
    
};

/**
 * Broadcast a transaction to the bitcoin network
 */
Iquidus.prototype.broadcast = function(rawTx, cb) {
  console.log("WARN EXPERIMENTAL: ");
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
  console.log("WARN EXPERIMENTAL: ");
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


// refer to: /insight-api/addrs/txs at https://github.com/bitpay/insight-api

Iquidus.prototype.getTransactions = function(addresses, from, to, cb) {
  console.log("WARN EXPERIMENTAL: ");
  console.log("getTransactions(): addresses, from, to: " + [].concat(addresses).join(',') + ", " + from + ", " + to);

  // TODO: support multiple addresses
  var address = addresses[0];
    
  var qs = [];
  var total;

  var addrs = [].concat(addresses).join(',');
  //qs.push('addrs=' + addrs);
    
  if (_.isNumber(from)) qs.push('from=' + from);
  if (_.isNumber(to)) qs.push('to=' + to);

  // Trim output
  qs.push('noAsm=1');
  qs.push('noScriptSig=1');
  qs.push('noSpent=1');

  var args = {
    method: 'GET',
    path: '/ext/getaddress/' + addrs + (qs.length > 0 ? '?' + qs.join('&') : ''),
    timeout: 120000,
    json: true,
  };

  this._doRequest(args, function(err, res, adtxs) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));

    var txs = [];
    console.log("adtxs: " + JSON.stringify(adtxs));
    if (adtxs && adtxs.last_txs ) {
      // map to other object array
      // TODO: need lookup?
      txs = _.map(adtxs.last_txs, function(tx) {
	  return {
	      txid: tx.addresses,
	      version: 1,
	      locktime: 0,
	      vin: tx.inputs,
	      vout: tx.outputs,
	      blockhash: '',
	      blockindex: tx.blockindex,
	      confirmations: 99999,
	      time: tx.timestamp,
	      blocktime: tx.timestamp,
	      valueOut: tx.total,
	      size: null,
	      firstSeenTs: undefined,
	      valueIn: null,
	      fees: 0.0001
	  };
      });
      total = txs.length;
      console.log("txs total: " + total);
    }
    else {
      console.log("adtxs: not an object");
    }

    console.log("txs: " + JSON.stringify(txs));
    // NOTE: Whenever Insight breaks communication with bitcoind, it returns invalid data but no error code.
    if (!_.isArray(txs) || (txs.length != _.compact(txs).length)) return cb(new Error('Could not retrieve transactions from blockchain. Request was:' + JSON.stringify(args)));

    return cb(null, txs, total);
  });
};

Iquidus.prototype.getAddressActivity = function(address, cb) {
  console.log("WARN EXPERIMENTAL: ");
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
  console.log("WARN EXPERIMENTAL: ");
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
  console.log("WARN EXPERIMENTAL: ");
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
  console.log("WARN EXPERIMENTAL: ");
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
