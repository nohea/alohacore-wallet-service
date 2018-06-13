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
  $.checkArgument(_.contains(['livenet'], opts.network) || _.contains(['testnet'], opts.network));
  $.checkArgument(opts.url);

  //console.log("opts.url: " + opts.url);
  this.url = opts.url || '';
  this.apiPrefix = opts.apiPrefix || '/insight-api';
  this.network = opts.network || 'livenet';
  this.hosts = opts.url;
  this.userAgent = opts.userAgent || 'bws';
  this.feePerKb = opts.feePerKb;
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
    //console.log("Iquidus.getUtxos(): addrs: " + [].concat(addresses).join(','));
    var args = {
	method: 'POST',
	path: this.apiPrefix + '/addrs/utxo',
	json: {
	    addrs: [].concat(addresses).join(',')
	},
    };

    //console.log("args: " + JSON.stringify(args));

    this._doRequest(args, function(err, res, unspent) {
      if (err || res.statusCode !== 200) {
	//console.log("  _doRequest() err ", err);
	return cb(_parseErr(err, res));
      }
      //console.log("  res: ", res);
      //console.log("unspent: ", unspent);
      return cb(null, unspent);
    });
};

/**
 * Retrieve a list of unspent outputs associated with an address or set of addresses
 */
Iquidus.prototype.getUtxosSingleAddr = function(address, cb) {
  var address = addresses[0];
  //console.log("Iquidus.getUtxosSingleAddr(): addr: " + address);

  var url = '/ext/listunspent' + '/' + address;
  //console.log("GET " + url);
  var args = {
    method: 'GET',
    path: url,
    json: true,
  };
  
  this._doRequest(args, function(err, res, unspent) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
      
      // grab block height 
      var height = -1;
      //console.log(" checking height: " + height);
      this.getBlockchainHeight(function(err, res, height) {
	  //console.log(" get height: " + height);
    	  var unspentInsight = utxosListunspentToInsight(unspent, address, height);
	  //console.log("Iquidus.getUtxos(): unspentInsight: " + JSON.stringify(unspentInsight));
	  return cb(null, unspentInsight);
      });
  });

    var utxosListunspentToInsight = function(utxoList, address, height) {
      //console.log("Iquidus.getUtxos(): utxosListunspentToInsight(): " + JSON.stringify(utxoList));
      //console.log("    height: " + height);
      var utxos = [];
      _.forEach(utxoList.unspent_outputs, function(utxo) {
	  // caller will expect this:
	  var u = _.pick(utxo, ['txid', 'vout', 'address', 'scriptPubKey', 'amount', 'satoshis', 'confirmations'])

	  u.txid = utxo.tx_hash;
	  u.vout = utxo.tx_pos;
	  u.address = address;
	  u.scriptPubKey = utxo.script;
	  u.satoshis = utxo.value;
	  u.confirmations = height - utxo.height + 1;

	  utxos.push(u);
      });

      return utxos;
  };
    
};

/**
 * Broadcast a transaction to the bitcoin network
 */
Iquidus.prototype.broadcast = function(rawTx, cb) {
  //console.log("broadcast(rawTx): ");

  var args = {
    method: 'POST',
    path: this.apiPrefix + '/tx/send',
    json: {
      rawtx: rawTx
    },
  };
  //console.log(args.method + " " + args.path);
  //console.log(rawTx);

  this._doRequest(args, function(err, res, body) {
    //console.log("response: \n" + JSON.stringify(res));
    
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body ? body.txid : null);
  });
};

Iquidus.prototype.getTransaction = function(txid, cb) {
  //console.log("getTransaction(): txid: " + txid);

  var args = {
    method: 'GET',
    path: this.apiPrefix + '/tx/' + txid,
    json: true,
  };
  //console.log(args.method + " " + args.path);

  this._doRequest(args, function(err, res, tx) {
    if (res && res.statusCode == 404) return cb();
    if (err || res.statusCode !== 200)
      return cb(_parseErr(err, res));

    return cb(null, tx);
  });
};


// refer to: /insight-api/addrs/txs at https://github.com/bitpay/insight-api

Iquidus.prototype.getTransactions = function(addresses, from, to, cb) {
  //console.log("getTransactions(): addresses, from, to: " + [].concat(addresses).join(',') + ", " + from + ", " + to);

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
    }
    //console.log("getTransactions(): POST " + this.apiPrefix + '/addrs/txs' + (qs.length > 0 ? '?' + qs.join('&') : ''));
    //console.log(JSON.stringify({
    //    addrs: [].concat(addresses).join(',')
    //}));
    
    this._doRequest(args, function(err, res, txs) {
	if (err || res.statusCode !== 200) return cb(_parseErr(err, res));

        //console.log("getTransactions(): res: " + res);
	if (_.isObject(txs)) {
	    //console.log("getTransactions(): txs: " + JSON.stringify(txs));
	    if (txs.totalItems)
		total = txs.totalItems;

	    if (txs.items)
		txs = txs.items;
	}

	// NOTE: Whenever Insight breaks communication with bitcoind, it returns invalid data but no error code.
	if (!_.isArray(txs) || (txs.length != _.compact(txs).length)) return cb(new Error('Could not retrieve transactions from blockchain. Request was:' + JSON.stringify(args)));

	return cb(null, txs, total);
    });
};

Iquidus.prototype.getAddressActivity = function(address, cb) {
  //console.log("getAddressActivity(): address: " + address);

  var self = this;

  var args = {
    method: 'GET',
    path: self.apiPrefix + '/addr/' + address,
    json: true,
  };
  //console.log(args.method + " " + args.path);

  this._doRequest(args, function(err, res, result) {
    if (res && res.statusCode == 404) return cb();
    if (err || res.statusCode !== 200)
      return cb(_parseErr(err, res));

    var nbTxs = result.unconfirmedTxApperances + result.txApperances;
    return cb(null, nbTxs > 0);
  });
};

Iquidus.prototype.estimateFee = function(nbBlocks, cb) {
  //console.log("estimateFee(): nbBlocks: " + [].concat(nbBlocks).join(','));

  // https://github.com/bitcoin/bitcoin/pull/3959
  // https://github.com/bitcoin/bitcoin/pull/3959/commits/171ca7745e77c9f78f26556457fe64e5b2004a75
  // estimatefee nblocks
  // Estimates the approximate fee per kilobyte needed for a transaction to get confirmed
  // within nblocks blocks.
    
  var feePerKb = parseFloat(this.feePerKb);
  //console.log("feePerKb: " + feePerKb);
  if( ! isNaN(feePerKb) ) {
    // this is a fixed fee per kb - a la Peercoin 0.01
    //console.log("  fixed feePerKb: " + feePerKb);
    var pFees = {};
    _.forEach(nbBlocks, function(p) {
      pFees[p] = feePerKb;
    });
    //console.log("pFees: " + JSON.stringify(pFees));
    return cb(null, pFees);
  }
  else {
    //console.log("proceeding with insight api fee estimate...");
  }
    
  var path = this.apiPrefix + '/utils/estimatefee';
  if (nbBlocks) {
    path += '?nbBlocks=' + [].concat(nbBlocks).join(',');
  }

  var args = {
    method: 'GET',
    path: path,
    json: true,
  };
  //console.log(args.method + " " + args.path);
  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body);
  });
};

Iquidus.prototype.getBlockchainHeight = function(cb) {
  //console.log("getBlockchainHeight(): ");

  // use Iquidus /api
  var path = '/api/getblockcount';

  var args = {
    method: 'GET',
    path: path,
    json: false,
  };
  //console.log(args.method + " " + args.path);
  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body);
  });
};

Iquidus.prototype.getTxidsInBlock = function(blockHash, cb) {
  //console.log("getTxidsInBlock(): blockHash: " + blockHash);

  var self = this;

  var args = {
    method: 'GET',
    path: this.apiPrefix + '/block/' + blockHash,
    json: true,
  };
  //console.log(args.method + " " + args.path);
  this._doRequest(args, function(err, res, body) {
    if (err || res.statusCode !== 200) return cb(_parseErr(err, res));
    return cb(null, body.tx);
  });
};

Iquidus.prototype.initSocket = function() {
  //console.log("initSocket(): _.first([].concat(this.hosts)): " + this.hosts);

  // sockets always use the first server on the pull
  var socket = io.connect(_.first([].concat(this.hosts)), {
    'reconnection': true,
  });
  return socket;
};

module.exports = Iquidus;
