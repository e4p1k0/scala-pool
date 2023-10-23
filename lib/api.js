/* Stellite Nodejs Pool
 * Contributors:
 * StelliteCoin <https://github.com/stellitecoin/cryptonote-stellite-pool>
 * Ahmyi            <https://github.com/ahmyi/cryptonote-stellite-pool>
 * Dvandal      <https://github.com/dvandal/cryptonote-nodejs-pool>
 * Fancoder     <https://github.com/fancoder/cryptonote-universal-pool>
 * zone117x     <https://github.com/zone117x/node-cryptonote-pool>
 * jagerman     <https://github.com/jagerman/node-cryptonote-pool>
 
 *   This program is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require("url");
const async = require('async');

const apiInterfaces = require('./apiInterfaces.js');
const authSid = Math.round(Math.random() * 10000000000) + '' + Math.round(Math.random() * 10000000000);

const charts = require('./charts.js');

const utils = require('./utils.js');
const os = require('os');

const rpcDaemon = require("./rpc/daemon");
// Initialize log system
const logSystem = 'api';
require('./exceptionWriter.js')(logSystem);
const BlockModel  = require('./model/Blocks');
// Data storage variables used for live statistics
var currentStats = {};
var minerStats = {};
var minersHashrate = {};
var pendingBlockRewards = {};
var liveConnections = {};
var addressConnections = {};
const handlers = {
    blocks:require('./apiHandlers/blocks'),
    payouts:require('./apiHandlers/payouts'),
    scoresheets:require('./apiHandlers/scoresheets'),
    topminers:require('./apiHandlers/topminers'),
    payments:require('./apiHandlers/payments'),
    market:require('./apiHandlers/market')
};


const getPoolConfigs = {
    supportedPayments : global.config.payments.supported,
    ports: getPublicPorts(config.poolServer.ports),
    hashrateWindow: config.api.hashrateWindow,
    fees : global.config.payments.poolFees,
    donations:global.config.poolServer.donations,
    devFee: global.config.blockUnlocker.devFee || 0,
    networkFee: global.config.blockUnlocker.networkFee || 0,
    coin: global.config.coin,
    coinUnits: global.config.coinUnits,
    coinDecimalPlaces: global.config.coinDecimalPlaces || 2, // config.coinUnits.toString().length - 1,
    coinDifficultyTarget: global.config.coinDifficultyTarget,
    symbol: global.config.symbol,
    depth: global.config.blockUnlocker.depth,
    version: global.config.version,
    paymentsInterval: global.config.payments.interval,
    minPaymentThreshold: global.config.payments.minPayment,
    minPaymentExchangedAddressThreshold: global.config.payments.minPaymentExchangeAddress || global.config.payments.minPaymentIntegratedAddress || config.payments.minPayment,
    minPaymentSubAddressThreshold: global.config.payments.minPaymentSubAddress || config.payments.minPayment,
    maxPaymentThreshold: global.config.payments.maxPayment || config.payments.maxTransactionAmount,
    transferFee: global.config.payments.dynamicTransferFee?0:config.payments.transferFee,
    dynamicTransferFee:global.config.payments.dynamicTransferFee,
    denominationUnit  :global.config.payments.denomination,
    priceSource:global. config.prices ? global.config.prices.source : 'tradeorge',
    priceCurrency: global.config.prices ? global.config.prices.currency : 'USD',
    paymentIdSeparator: global.config.poolServer.paymentId,
    fixedDiffEnabled: global.config.poolServer.fixedDiff.enabled,
    fixedDiffSeparator: global.config.poolServer.fixedDiff.addressSeparator,
    blocksChartEnabled: (global.config.charts.blocks && global.config.charts.blocks.enabled),
    blocksChartDays: global.config.charts.blocks && global.config.charts.blocks.days ? global.config.charts.blocks.days : null,
    unlockBlockReward: global.config.blockUnlocker.reward || 0
};

/**
 * Handle server requests
 **/
function handleServerRequest(request, response) {
    var urlParts = url.parse(request.url, true);

    switch(urlParts.pathname){
        // Pool statistics
        case '/stats':
            handleStats(urlParts, response);
            break;
        case '/live_stats':
            response.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            });

            var address = urlParts.query.address ? urlParts.query.address : 'undefined';

            var uid = Math.random().toString();
            var key = address + ':' + uid;

            response.on("finish", function() {
                delete liveConnections[key];
            });
            response.on("close", function() {
                delete liveConnections[key];
            });

            liveConnections[key] = response;
            break;

        // Worker statistics
        case '/stats_address':
            handleMinerStats(urlParts, response);
            break;

        // Payments
        case '/get_payments':
            handlers.payments(urlParts, function(data){
                sendData(response,data);
            });
            break;
        // Blocks
        case '/get_block':
            handlers.blocks.getBlock(urlParts, function (data) {
                sendData(response,data);
            });
            break;
        // Blocks
        case '/get_blocks':
            handlers.blocks.getBlocks(urlParts, function (data) {
                sendData(response,data);
            });
            break;

        // Get market prices
        case '/get_market':
            handlers.market(urlParts,function (data) {
                sendData(response,data);
            });
        break;

        // Top 10 miners
        case '/get_top10':
            handlers.topminers.getHandler(function(data){
                sendData(response,data);
            });
            break;
        
        // Miner settings
        case '/reset_donation_level':
            var address = urlParts.query.address;
            if(!utils.validateMinerAddress(address)){
                return sendData(response,{status:'error',message:'Invalid address'})
            }
            redisClient.hset(config.coin + ':workers:' + address,'donation_level',0,function(err){
                return sendData(response,(err)?{status:'error',message:"Unable to reset donation level"}:{status:"success"});
            });
            break;
        case '/get_miner_payout_level':
            handlers.payouts.getMinerPayoutLevel(urlParts,  function(data){
                sendData(response,data);
            });
            break;
        case '/set_miner_payout_level':
            handlers.payouts.setMinerPayoutLevel(urlParts, function(data){
                sendData(response,data);
            });
            break;
        case '/miners_hashrate':
            if (!authorize(request, response)) {
                return;
            }
            handleGetMinersHashrate(response);
            break;
        case '/workers_hashrate':
            if (!authorize(request, response)) {
                return;
            }
            handleGetWorkersHashrate(response);
            break;
        case '/miners_scoresheet':
            handlers.scoresheets.miner(urlParts, function(data){
                sendData(response,data);
            });
            break;
        case '/pool_scoresheet':
            handlers.scoresheets.pool(urlParts, function(data){
                sendData(response,data);
            });
            break;
        // Pool Administration
        case '/admin_stats':
            if (!authorize(request, response)) {
                return;
            }
            handleAdminStats(response);
            break;
        case '/admin_monitoring':
            if (!authorize(request, response)) {
                return;
            }
            handleAdminMonitoring(response);
            break;
        case '/admin_log':
            if (!authorize(request, response)) {
                return;
            }
            handleAdminLog(urlParts, response);
            break;
        case '/admin_users':
            if (!authorize(request, response)) {
                return;
            }
            handleAdminUsers(response);
            break;
        case '/admin_ports':
            if (!authorize(request, response)) {
                return;
            }
            handleAdminPorts(response);
            break;

        // Default response
        default:
            response.writeHead(404, {
                'Access-Control-Allow-Origin': '*'
            });
            response.end('Invalid API call');
            break;
    }
}


function sendData(response,data){
    

    var reply = JSON.stringify(data);

    response.writeHead("200", {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reply, 'utf8')
    });
    return response.end(reply); 
    
};

let lastBlockStats = null;
/**
 * Collect statistics data
 **/
function collectStats(){
    const startTime = Date.now();
    let redisFinished;
    let daemonFinished;
    const windowTime = (((Date.now() / 1000) - global.config.api.hashrateWindow) | 0).toString();

    const redisCommands = [
        ['zremrangebyscore', global.config.coin + ':hashrate', '-inf', '(' + windowTime],
        ['zrange', global.config.coin + ':hashrate', 0, -1],
        ['hgetall', global.config.coin + ':stats'],
        ['zrange', global.config.coin + ':blocks:candidates', 0, -1],
        ['zrevrange', global.config.coin + ':blocks:matured', 0, global.config.api.blocks - 1],
        ['zcard', global.config.coin + ':blocks:matured'],
        ['zrevrange', global.config.coin + ':payments:all', 0, global.config.api.payments - 1, 'WITHSCORES'],
        ['zcard', global.config.coin + ':payments:all'],
        ['keys', global.config.coin + ':payments:*'],
        ['hgetall', global.config.coin + ':props:shares_actual:roundCurrent'],
        ['hgetall', global.config.coin + ':solo:shares_actual:roundCurrent'],
    ];
    
    let haveDonations = false;
    if (getPoolConfigs.donations && getPoolConfigs.donations.enabled && getPoolConfigs.donations.address) {
        haveDonations = true;
        redisCommands.push(['hmget', config.coin + ':workers:' + getPoolConfigs.donations.address, 'balance', 'paid']);
    }

    async.parallel({
        config: function(callback){
            callback(null,getPoolConfigs);
        },
        system: function(callback){
          var os_load = os.loadavg();
          var num_cores = os.cpus().length;
          callback(null, {
            load: os_load,
            number_cores: num_cores
          });
        },
        pool: function(callback){
            redisClient.multi(redisCommands).exec(function(error, replies){
                redisFinished = Date.now();
                var dateNowSeconds = Date.now() / 1000 | 0;

                if (error){
                    log('error', logSystem, 'Error getting redis data %j', [error]);
                    callback(true);
                    return;
                }
        
                const blockStats = [];
               //Block Candidates 
                for(let ubs in replies[3].reverse()){
                    const unblockStat = replies[3][ubs];
                    const block = new BlockModel(unblockStat);
        		    if(block.poolType === 'ppbs') {
        			     continue;
        		    }
                    block.miner = utils.truncateAddress(block.miner);
                    blockStats.push(block.toRedis());
                }
		//Block Matured
                for(let bsi in replies[4]){
                    const blockStat = replies[4][bsi];
                    const block = new BlockModel(blockStat);
        		    if(block.poolType === 'ppbs') {
        			     continue;
        		    }
                    block.miner = utils.truncateAddress(block.miner);
                    blockStats.push(block.toRedis());

                }
		//Statistics
        	let stats = replies[2];
            	lastBlockStats = Object.assign({}, stats);
        	if(stats && 'blockTemplate' in stats) {
             	    delete stats['blockTemplate'];
        	}

                let data = {
                    stats: stats,
                    blocks: blockStats,
                    payments: replies[6],
                    totalPayments: parseInt(replies[7])||0,
                    totalDonations: lastBlockStats.totalDonations || 0,
                    totalMinersPaid: replies[8] && replies[8].length > 0 ? replies[8].length - 1 : 0,
                    miners: 0,
                    workers: 0,
                    hashrate: 0,
		    current: {
			donations:0,
			hashes: {
				props:0,
				solo:0
			}
		    }
                };

		//Worker's hashrate info
                minerStats = {};
                minersHashrate = {};
                var hashrates = replies[1];
                for (var i = 0; i < hashrates.length; i++){
                    var hashParts = hashrates[i].split(':');
                    minersHashrate[hashParts[1]] = (minersHashrate[hashParts[1]] || 0) + parseInt(hashParts[0]);
                }
	       		//calculate workers 
                var totalShares = 0;	
                for (var miner in minersHashrate){
                    if (miner.indexOf('~') !== -1) {
                        data.workers++;
                    } else {
                        totalShares += minersHashrate[miner];
                        data.miners ++;
                    }
            
                    minersHashrate[miner] = Math.round(minersHashrate[miner] / config.api.hashrateWindow);

                    if (!minerStats[miner]) { 
			    minerStats[miner] = {}; 
		    }
                    minerStats[miner]['hashrate'] = minersHashrate[miner];
                    
                }

                data.hashrate = Math.round(totalShares / config.api.hashrateWindow);
		const prop_current = replies[9] || {};
		const solo_current = replies[10] || [];
		for(let [miner, mTotal] of Object.entries(prop_current)) {
			//const miner = prop_current[i+1];
			//const mTotal= prop_current[i];
			if(miner == 'donations') {
			    data.current.donations = parseInt(mTotal);
			} else if (miner == 'total'){
		 	    data.current.hashes.props += parseInt(mTotal);
			} else {

		            if (!minerStats[miner]) { 
                            	minerStats[miner] = { hashes: { props: 0, solo:0}, shares: { props: 0, solo:0}};
                    	    }
			    if (!minerStats[miner].hashes) { 
                            	minerStats[miner].hashes = { props: 0, solo:0};
                    	    }
			    if (!minerStats[miner].shares) { 
                            	minerStats[miner].shares = { props: 0, solo:0};
                    	    }
			    minerStats[miner].hashes.props = parseInt(mTotal);
			}
		}

		for(let [miner, mTotal] of Object.entries(solo_current)) {
                        //const miner = solo_current[i+1];
                        //const mTotal= solo_current[i];
                        if(miner.endsWith('donations')) {
				miner = miner.replace("_donations","");
	                        data.current.donations += parseInt(mTotal);
                        } else if (miner.endsWith("shares")){

			    miner = miner.replace("_shares","");
                            data.current.hashes.solo += parseInt(mTotal);

		            if (!minerStats[miner]) { 
                            	minerStats[miner] = { hashes: { props: 0, solo:0}, shares: { props: 0, solo:0}};
                    	    }
			    if (!minerStats[miner].hashes) { 
                            	minerStats[miner].hashes = { props: 0, solo:0};
                    	    }
			    if (!minerStats[miner].shares) { 
                            	minerStats[miner].shares = { props: 0, solo:0};
                    	    }
       
                            minerStats[miner].hashes.solo = parseInt(mTotal);
                        }
                }
	


                var currentRoundMiners = [];
		
                for(var miner in minerStats){
                    if (miner.indexOf('~') > -1) {
                        continue;
                    }
                    var minerStat = minerStats[miner];
	 	    if(!('hashes' in minerStat)) {
			minerStat.hashes = {
				props : 0,
				solo : 0
			};
		    }
                    currentRoundMiners.push({
                        miner:utils.truncateAddress(miner),
                        roundHashes:minerStat.hashes || {props:0,solo:0},
                        roundShares:{
				props:Number(((minerStat.hashes.props || 0) / data.current.hashes.props) * 100).toFixed(9),
				solo:Number(((minerStat.hashes.solo || 0)/lastBlockStats.lastblock_difficulty) * 100).toFixed(9)
			},
                        roundHashes:minerStat.hashes,
			totalRoundHashes:minerStat.hashes.props + minerStat.hashes.solo,
                        hashrate:minerStat.hashrate || 0
                    });
                }
                
                handlers.scoresheets.setCurrentRound(currentRoundMiners.sort(function(a,b){
                    var v1 = a.roundHashes ? parseInt(a.totalRoundHashes) : 0;
                    var v2 = b.roundHashes ? parseInt(b.totalRoundHashes) : 0;
                    if (v1 > v2) return -1;
                    if (v1 < v2) return 1;
                    return 0;   
                }));

//                if (replies[6]) {
//	#                    data.lastBlockFound = replies[6].lastBlockFound;
  //              }
                handlers.topminers.setMinersHashrate(minersHashrate);
                callback(null, data);
            });
        },
         lastblock: function(callback){
//            /* rpcDaemon.getLastBlockData(function(error, reply) {
//                    if (error){
//                        log('error', logSystem, 'Error getting last block data %j', [error]);
//                        callback(true);
//                        return;
//                    }
//              */      
//             //       var blockHeader = reply.block_header;
                  
                     daemonFinished = Date.now();
                     callback(null, {
 			    difficulty: lastBlockStats ? lastBlockStats.lastblock_difficulty : 0,
                         height: lastBlockStats  ? lastBlockStats.lastblock_height : 0,
                         timestamp: lastBlockStats ? lastBlockStats.lastblock_timestamp : 0,
                         reward: lastBlockStats ? lastBlockStats.lastblock_lastreward : 0,
                         hash:  lastBlockStats ? lastBlockStats.lastblock_hash : 0
                     });
             //});
         },
         network: function(callback){
// //            rpcDaemon.getNetworkData(function(error, reply) {
//   //              if (error) {
//     //                log('error', logSystem, 'Error getting network data %j', [error]);
//       //              return;
//         //        } 
                 daemonFinished = Date.now();
                 callback(null, {
 			difficulty: lastBlockStats ? lastBlockStats.difficulty : 0,
                     height: lastBlockStats ? lastBlockStats.height : 0
                 });
           //  });
         },
        charts: function (callback) {
            // Get enabled charts data
            charts.getPoolChartsData(function(error, data) {
                if (error) {
                    callback(error, data);
                    return;
                }

                // Blocks chart
                if (!global.config.charts.blocks || !global.config.charts.blocks.enabled || !global.config.charts.blocks.days) {
                    callback(error, data);
                    return;
                }

                let chartDays = global.config.charts.blocks.days;

                let beginAtTimestamp = (Date.now() / 1000) - (chartDays * 86400);
                let beginAtDate = new Date(beginAtTimestamp * 1000);
                if (chartDays > 1) {
                    beginAtDate = new Date(beginAtDate.getFullYear(), beginAtDate.getMonth(), beginAtDate.getDate(), 0, 0, 0, 0);
                    beginAtTimestamp = beginAtDate / 1000 | 0;
                }

                let blocksCount = {};
                if (chartDays === 1) {
                    for (var h = 0; h <= 24; h++) {
                        var date = utils.dateFormat(new Date((beginAtTimestamp + (h * 60 * 60)) * 1000), 'yyyy-mm-dd HH:00');
                        blocksCount[date] = 0;
                    }
                } else {
                    for (var d = 0; d <= chartDays; d++) {
                        var date = utils.dateFormat(new Date((beginAtTimestamp + (d * 86400)) * 1000), 'yyyy-mm-dd');
                        blocksCount[date] = 0;
                    }
                }

                redisClient.zrevrange(config.coin + ':blocks:matured', 0, -1, function(err, result) {
                    for (let i = 0; i < result.length; i++){
                        const block = new BlockModel(result[i]);
                        var blockTimestamp = block.timestamp;
                        if (blockTimestamp < beginAtTimestamp) {
                            continue;
                        }
                        var date = utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd');
                        if (chartDays === 1) utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd HH:00');
                        if (!blocksCount[date]) blocksCount[date] = 0;
                        blocksCount[date] ++;
                    }
                    data.blocks = blocksCount;
                    callback(error, data);
                });
            });
        }
    }, function(error, results){
        // log('info', logSystem, 'Stat collection finished: %d ms redis, %d ms daemon', [redisFinished - startTime, daemonFinished - startTime]);

        if (error){
            log('error', logSystem, 'Error collecting all stats');
        }
        else{
            currentStats = results;
            broadcastLiveStats();
        }

        setTimeout(collectStats, config.api.updateInterval * 1000);
    });

}



/**
 * Broadcast live statistics
 **/
function broadcastLiveStats(){
    // log('info', logSystem, 'Broadcasting to %d visitors and %d address lookups', [Object.keys(liveConnections).length, Object.keys(addressConnections).length]);

    // Live statistics
    var processAddresses = {};
    for (var key in liveConnections){
        var addrOffset = key.indexOf(':');
        var address = key.substr(0, addrOffset);
        if (!processAddresses[address]) processAddresses[address] = [];
        processAddresses[address].push(liveConnections[key]);
    }
    
    for (var address in processAddresses) {
        var data = currentStats;

        data.miner = {};
        if (address && minerStats[address]){
            data.miner = minerStats[address];
        }

        var destinations = processAddresses[address];
        sendLiveStats(data, destinations);
    }

    // Workers Statistics
    var processAddresses = {};
    for (var key in addressConnections){
        var addrOffset = key.indexOf(':');
        var address = key.substr(0, addrOffset);
        if (!processAddresses[address]) processAddresses[address] = [];
        processAddresses[address].push(addressConnections[key]);
    }
    
    for (var address in processAddresses) {
        broadcastWorkerStats(address, processAddresses[address]);
    }
}

/**
 * Takes a chart data JSON string and uses it to compute the average over the past hour, 6 hours,
 * and 24 hours.  Returns [AVG1, AVG6, AVG24].
 **/
function extractAverageHashrates(chartdata) {
    var now = new Date() / 1000 | 0;

    var sums = [0, 0, 0]; // 1h, 6h, 24h
    var counts = [0, 0, 0];

    var sets = JSON.parse(chartdata); // [time, avgValue, updateCount]
    for (var j in sets) {
        var hr = sets[j][1];
        if (now - sets[j][0] <=  1*60*60) { sums[0] += hr; counts[0]++; }
        if (now - sets[j][0] <=  6*60*60) { sums[1] += hr; counts[1]++; }
        if (now - sets[j][0] <= 24*60*60) { sums[2] += hr; counts[2]++; }
    }

    return [sums[0] * 1.0 / (counts[0] || 1), sums[1] * 1.0 / (counts[1] || 1), sums[2] * 1.0 / (counts[2] || 1)];
}

/**
 * Obtains worker stats and invokes the given callback with them.
 */
function collectWorkerStats(address, statsCallback) {
    async.waterfall([

        // Get all pending blocks (to find unconfirmed rewards)
        function(callback){
            redisClient.zrevrange(config.coin + ':blocks:candidates', 0, -1, 'WITHSCORES', function(error, results){
                if (error) {
                    statsCallback({error: 'Not found'});
                    return;
                }
                var blocks = [];

                for (var i = 0; i < results.length; i += 2){
                    const block = new BlockModel(results[i]);
                    blocks.push(block);
                }

                callback(null, blocks);
            });
        },

        function(blocks, callback) {
                    var redisCommands = [];
                    for (let i = 0;i< blocks.length;i++) {
		                 const height = blocks[i].height
                        redisCommands.push(['hget', config.coin + ':shares_actual:round' + height, address]);
                    }
                    redisClient.multi(redisCommands).exec(function(error, replies) {
                        if (error) {
                            log('error', logSystem, 'Error retrieving worker shares/score: %j', [error]);
                            callback(null, null); // Ignore the error and carry on
                            return;
                        }
                        var feePercent = 0.0;
                        var removeFees = 1 - feePercent;

                        var pending_scores = [];
                        for (var i = 0; i < replies.length; i++) {
//                            var block = pending[i >> 1];
				            let block = blocks[i]
                                var myScore = parseFloat(replies[i]);
                            if (!myScore) {
                                continue;
                            }
                            var totalScore = parseFloat(block.shares);

                            var reward = Math.floor(block.reward * removeFees * myScore / totalScore);
                            pending_scores.push({
                                height: block.height,
                                hash: block.hash,
                                time: block.timestamp,
                                difficulty: block.difficulty,
                                totalShares: parseFloat(myScore),
                                shares: parseFloat(replies[i]),
                                totalScore: totalScore,
                                reward: reward,
                                blockReward: block.reward
                            });
                        }

                        callback(null, pending_scores);
                    });

        },

        function(pending, callback) {
            var redisCommands = [
                ['hgetall', config.coin + ':workers:' + address],
                ['zrevrange', config.coin + ':payments:' + address, 0, config.api.payments - 1, 'WITHSCORES'],
                ['keys', config.coin + ':unique_workers:' + address + '~*'],
                ['get', config.coin + ':charts:hashrate:' + address],
                ['zrevrange', config.coin + ':worker_unlocked:' + address, 0, -1, 'WITHSCORES']
            ];
            redisClient.multi(redisCommands).exec(function(error, replies){
                if (error || !replies || !replies[0]){
                    statsCallback({
                        error: 'Not found'
                    });
                    return;
                }

                var stats = replies[0];
                stats.hashrate = minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0;
                stats.roundScore = minerStats[address] && minerStats[address]['roundScore'] ? minerStats[address]['roundScore'] : 0;
                stats.roundHashes = minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0;
                stats.poolRoundScore = currentStats.pool.roundScore;
                stats.poolRoundHashes = currentStats.pool.roundHashes;
                stats.networkHeight = currentStats.network.height;
                if (replies[3]) {
                    var hr_avg = extractAverageHashrates(replies[3]);
                    stats.hashrate_1h  = hr_avg[0];
                    stats.hashrate_6h  = hr_avg[1];
                    stats.hashrate_24h = hr_avg[2];
                }

                var paymentsData = replies[1];

                var payments_24h = 0, payments_7d = 0;
                var now = Math.floor(Date.now() / 1000);
                var then_24h = now - 86400, then_7d = now - 7*86400;
                var need_payments_to;
                for (var p=0; p<paymentsData.length; p += 2) {
                    if (paymentsData[p + 1] < then_7d) {
                        need_payments_to = null;
                        break;
                    }
                    var paid = parseInt(paymentsData[p].split(':')[1]);
                    if (paymentsData[p + 1] >= then_24h){
                        payments_24h += paid;
                    }
                    payments_7d += paid;
                }
                if (need_payments_to === undefined && paymentsData.length == 2*config.api.payments) {
                    // Ran off the end before getting to a week; we need to fetch more payment info
                    need_payments_to = paymentsData[paymentsData.length-1] - 1;
                }

                var unlockedData = replies[4];

                var workersData = [];
                for (var j=0; j<replies[2].length; j++) {
                    var key = replies[2][j];
                    var keyParts = key.split(':');
                    var miner = keyParts[2];
                    if (miner.indexOf('~') !== -1) {
                        var workerName = miner.substr(miner.indexOf('~')+1, miner.length);
                        var workerData = {
                            name: workerName,
                            hashrate: minerStats[miner] && minerStats[miner]['hashrate'] ? minerStats[miner]['hashrate'] : 0
                        };
                        workersData.push(workerData);
                    }
                }

                charts.getUserChartsData(address, paymentsData, function(error, chartsData) {
                    var redisCommands = [];
                    for (var i in workersData){
                        redisCommands.push(['hgetall', config.coin + ':unique_workers:' + address + '~' + workersData[i].name]);
                        redisCommands.push(['get', config.coin + ':charts:worker_hashrate:' + address + '~' + workersData[i].name]);
                    }
                    if (need_payments_to) {
                        redisCommands.push(['zrangebyscore', config.coin + ':payments:' + address, then_7d, need_payments_to, 'WITHSCORES']);
                    }

                    redisClient.multi(redisCommands).exec(function(error, replies){
                        for (var i in workersData) {
                            var wi = 2*i;
                            var hi = wi + 1
                            if (replies[wi]) {
                                workersData[i].lastShare = replies[wi]['lastShare'] ? parseInt(replies[wi]['lastShare']) : 0;
                                workersData[i].hashes = replies[wi]['hashes'] ? parseInt(replies[wi]['hashes']) : 0;
                                workersData[i].error_count = replies[wi]['error'] ? parseInt(replies[wi]['error']) : 0;
                                workersData[i].block_count = replies[wi]['blocksFound'] ? parseInt(replies[wi]['blocksFound']) : 0;
                                workersData[i].donations = replies[wi]['donations'] ? parseInt(replies[wi]['donations']) : 0;
                                workersData[i].pool_type = replies[wi]['poolType'] ? replies[wi]['poolType'] : 'props';
                            }
                            if (replies[hi]) {
                                var avgs = extractAverageHashrates(replies[hi]);
                                workersData[i]['hashrate_1h']  = avgs[0];
                                workersData[i]['hashrate_6h']  = avgs[1];
                                workersData[i]['hashrate_24h']  = avgs[2];
                            }
                        }

                        if (need_payments_to) {
                            var extra_payments = replies[replies.length-1];
                            for (var p=0; p<extra_payments.length; p += 2) {
                                var paid = parseInt(extra_payments[p].split(':')[1]);
                                if (extra_payments[p + 1] >= then_24h)
                                    payments_24h += paid;
                                payments_7d += paid;
                            }
                        }
                        stats['payments_24h'] = payments_24h;
                        stats['payments_7d'] = payments_7d;


                        var minPayoutLevel = stats.minPayoutLevel || 0;

                        var minLevel = config.payments.minPayment || 0;

                        if(utils.isIntegratedAddress(address)){
                            minLevel = config.payments.minPaymentIntegratedAddress || config.payments.minPayment || 0;
                        }else{
                            const addr = address.split(config.poolServer.paymentId.addressSeparator);
                            if(config.poolServer.paymentId.enabled && addr.length >= 2 && utils.hasValidPaymentId(addr[1])){
                                minLevel = config.payments.minPaymentIntegratedAddress || config.payments.minPayment || 0;
                            }
                        }
                        if(minLevel > minPayoutLevel){
                            minPayoutLevel = minLevel;
                        }
                        stats.minPayoutLevel = minPayoutLevel;
                        statsCallback({
                            stats: stats,
                            payments: paymentsData,
                            charts: chartsData,
                            workers: workersData,
                            unlocked: unlockedData,
                            unconfirmed: pending
                        });
                    });
                });
            });
        }
    ]);
}

/**
 * Broadcast worker statistics
 **/
function broadcastWorkerStats(address, destinations) {
    collectWorkerStats(address, function(data) { sendLiveStats(data, destinations); });
}
/**
 * Send live statistics to specified destinations
 **/
function sendLiveStats(data, destinations){
    if (!destinations) return ;

    var dataJSON = JSON.stringify(data);
    for (var i in destinations) {
        destinations[i].end(dataJSON);
    }
}

/**
 * Return pool statistics
 **/
function handleStats(urlParts, response){
    var data = currentStats;

    data.miner = {};
    var address = urlParts.query.address;
    if (address && minerStats[address]) {
        data.miner = minerStats[address];
    }

    sendData(response,data);
}

/**
 * Return miner (worker) statistics
 **/
function handleMinerStats(urlParts, response){
    var address = urlParts.query.address;
    
    var longpoll = (urlParts.query.longpoll === 'true');
    
    if(!utils.validateMinerAddress(address)){
        return sendData(response,{message:"Invalid miner address",status:'error'});
    }
    if (longpoll){
        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            'Connection': 'keep-alive'
        });
        
        redisClient.exists(config.coin + ':workers:' + address, function(error, result){
            if (!result){
                response.end(JSON.stringify({error: 'Not found'}));
                return;
            }
        
            var uid = Math.random().toString();
            var key = address + ':' + uid;
        
            response.on("finish", function() {
                delete addressConnections[key];
            });
            response.on("close", function() {
                delete addressConnections[key];
            });

            addressConnections[key] = response;
        });
    } else{
        redisClient.multi([
            ['hgetall', config.coin + ':workers:' + address],
            ['zrevrange', config.coin + ':payments:' + address, 0, config.api.payments - 1, 'WITHSCORES'],
            ['keys', config.coin + ':unique_workers:' + address + '~*'],
            ['get', config.coin + ':charts:hashrate:' + address]
        ]).exec(function(error, replies){
            if (error || !replies[0]){
               return  sendData(response,{error: 'Not found'});
            }
        
            var stats = replies[0];
            stats.hashrate = minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0;
            stats.roundScore = 0;
            stats.roundHashes = minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0;
            if (replies[3]) {
                var hr_avg = extractAverageHashrates(replies[3]);
                stats.hashrate_1h  = hr_avg[0];
                stats.hashrate_6h  = hr_avg[1];
                stats.hashrate_24h = hr_avg[2];
            }

            var paymentsData = replies[1];

            var workersData = [];
            for (var i=0; i<replies[2].length; i++) {
                var key = replies[2][i];
                var keyParts = key.split(':');
                var miner = keyParts[2];
                if (miner.indexOf('~') !== -1) {
                    var workerName = miner.substr(miner.indexOf('~')+1, miner.length);
                    var workerData = {
                        name: workerName,
                        hashrate: minerStats[miner] && minerStats[miner]['hashrate'] ? minerStats[miner]['hashrate'] : 0
                    };
                    workersData.push(workerData);
                }
            }

            charts.getUserChartsData(address, paymentsData, function(error, chartsData) {
                var redisCommands = [];
                for (var i in workersData){
                    redisCommands.push(['hgetall', config.coin + ':unique_workers:' + address + '~' + workersData[i].name]);
                    redisCommands.push(['get', config.coin + ':charts:worker_hashrate:' + address + '~' + workersData[i].name]);
                }
                redisClient.multi(redisCommands).exec(function(error, replies){
                    for (var i in workersData){
                        var wi = 2*i;
                        var hi = wi + 1
                        if (replies[wi]) {
                            workersData[i].lastShare = replies[wi]['lastShare'] ? parseInt(replies[wi]['lastShare']) : 0;
                            workersData[i].hashes = replies[wi]['hashes'] ? parseInt(replies[wi]['hashes']) : 0;
                            workersData[i].error_count = replies[wi]['error'] ? parseInt(replies[wi]['error']) : 0;
                            workersData[i].block_count = replies[wi]['blocksFound'] ? parseInt(replies[wi]['blocksFound']) : 0;
                            workersData[i].donations = replies[wi]['donations'] ? parseInt(replies[wi]['donations']) : 0;
                            workersData[i].pool_type = replies[wi]['poolType'] ? replies[wi]['poolType'] : "props";
                        }
                        if (replies[hi]) {
                            var avgs = extractAverageHashrates(replies[hi]);
                            workersData[i]['hashrate_1h']  = avgs[0];
                            workersData[i]['hashrate_6h']  = avgs[1];
                            workersData[i]['hashrate_24h']  = avgs[2];
                        }
                    }

                    var minPayoutLevel = stats.minPayoutLevel || 0;

                    var minLevel = config.payments.minPayment || 0;

                    if(utils.isIntegratedAddress(address)){
                        minLevel = config.payments.minPaymentIntegratedAddress || config.payments.minPayment || 0;
                    }else{
                        const addr = address.split(config.poolServer.paymentId.addressSeparator);
                        if(config.poolServer.paymentId.enabled && addr.length >= 2 && utils.hasValidPaymentId(addr[1])){
                            minLevel = config.payments.minPaymentIntegratedAddress || config.payments.minPayment || 0;
                        }
                    }
                    if(minLevel > minPayoutLevel){
                        minPayoutLevel = minLevel;
                    }
                    stats.minPayoutLevel = minPayoutLevel;
                    var data = {
                        stats: stats,
                        payments: paymentsData,
                        charts: chartsData,
                        workers: workersData
                    }

                    sendData(response,data);
                    
                });
            });
        });
    }
}


/**
 * Return miners hashrate
 **/
function handleGetMinersHashrate(response) {
    var data = {};
    for (var miner in minersHashrate){
        if (miner.indexOf('~') !== -1) continue;
        data[miner] = minersHashrate[miner];
    }

    sendData(response, {
        minersHashrate: data
    });
}

/**
 * Return workers hashrate
 **/
function handleGetWorkersHashrate(response) {
    var data = {};
    for (var miner in minersHashrate){
        if (miner.indexOf('~') === -1) continue;
        data[miner] = minersHashrate[miner];
    }

    sendData(response,{
        workersHashrate: data
    });
}


/**
 * Authorize access to a secured API call
 **/
function authorize(request, response){
    var sentPass = url.parse(request.url, true).query.password;

    var remoteAddress = request.connection.remoteAddress;
    if(config.api.trustProxyIP && request.headers['x-forwarded-for']){
      remoteAddress = request.headers['x-forwarded-for'];
    }
    
    var bindIp = config.api.bindIp ? config.api.bindIp : "0.0.0.0";
    if (typeof sentPass == "undefined" && (remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1' || (bindIp != "0.0.0.0" && remoteAddress === bindIp))) {
        return true;
    }
    
    response.setHeader('Access-Control-Allow-Origin', '*');

    var cookies = parseCookies(request);
    if (typeof sentPass == "undefined" && cookies.sid && cookies.sid === authSid) {
        return true;
    }

    if (sentPass !== config.api.password){
        response.statusCode = 401;
        response.end('Invalid password');
        return;
    }

    log('warn', logSystem, 'Admin authorized from %s', [remoteAddress]);
    response.statusCode = 200;

    var cookieExpire = new Date( new Date().getTime() + 60*60*24*1000);
    response.setHeader('Set-Cookie', 'sid=' + authSid + '; path=/; expires=' + cookieExpire.toUTCString());
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Type', 'application/json');

    return true;
}

/**
 * Administration: return pool statistics
 **/
function handleAdminStats(response){
    async.waterfall([

        //Get worker keys & unlocked blocks
        function(callback){
            redisClient.multi([
                ['keys', config.coin + ':workers:*'],
                ['zrange', config.coin + ':blocks:matured', 0, -1]
            ]).exec(function(error, replies) {
                if (error) {
                    log('error', logSystem, 'Error trying to get admin data from redis %j', [error]);
                    callback(true);
                    return;
                }
                callback(null, replies[0], replies[1]);
            });
        },

        //Get worker balances
        function(workerKeys, blocks, callback){
            var redisCommands = workerKeys.map(function(k){
                return ['hmget', k, 'balance', 'paid'];
            });
            redisClient.multi(redisCommands).exec(function(error, replies){
                if (error){
                    log('error', logSystem, 'Error with getting balances from redis %j', [error]);
                    callback(true);
                    return;
                }

                callback(null, replies, blocks);
            });
        },
        function(workerData, blocks, callback){
            var stats = {
                totalOwed: 0,
                totalPaid: 0,
                totalRevenue: 0,
                totalDiff: 0,
                totalShares: 0,
                blocksOrphaned: 0,
                blocksUnlocked: 0,
                totalWorkers: 0
            };

            for (var i = 0; i < workerData.length; i++){
                stats.totalOwed += parseInt(workerData[i][0]) || 0;
                stats.totalPaid += parseInt(workerData[i][1]) || 0;
                stats.totalWorkers++;
            }

            for (var i = 0; i < blocks.length; i++){
                var block = blocks[i].split(':');
                if (block[5]) {
                    stats.blocksUnlocked++;
                    stats.totalDiff += parseInt(block[2]);
                    stats.totalShares += parseInt(block[3]);
                    stats.totalRevenue += parseInt(block[5]);
                }
                else{
                    stats.blocksOrphaned++;
                }
            }
            callback(null, stats);
        }
    ], function(error, stats){
            if (error){
                response.end(JSON.stringify({error: 'Error collecting stats'}));
                return;
            }
            response.end(JSON.stringify(stats));
        }
    );

}

/**
 * Administration: users list
 **/
function handleAdminUsers(response){
    async.waterfall([
        // get workers Redis keys
        function(callback) {
            redisClient.keys(config.coin + ':workers:*', callback);
        },
        // get workers data
        function(workerKeys, callback) {
            var redisCommands = workerKeys.map(function(k) {
                return ['hmget', k, 'balance', 'paid', 'lastShare', 'hashes'];
            });
            redisClient.multi(redisCommands).exec(function(error, redisData) {
                var workersData = {};
                for(var i in redisData) {
                    var keyParts = workerKeys[i].split(':');
                    var address = keyParts[keyParts.length-1];
                    var data = redisData[i];
                    workersData[address] = {
                        pending: data[0],
                        paid: data[1],
                        lastShare: data[2],
                        hashes: data[3],
                        hashrate: minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0,
                        roundScore: minerStats[address] && minerStats[address]['roundScore'] ? minerStats[address]['roundScore'] : 0,
                        roundHashes: minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0
                    };
                }
                callback(null, workersData);
            });
        }
        ], function(error, workersData) {
            if(error) {
                response.end(JSON.stringify({error: 'Error collecting users stats'}));
                return;
            }
            response.end(JSON.stringify(workersData));
        }
    );
}

/**
 * Administration: pool monitoring
 **/
function handleAdminMonitoring(response) {

    async.parallel({
        monitoring: getMonitoringData,
        logs: getLogFiles
    }, function(error, result) {
        sendData(response,result);
    });
}

/**
 * Administration: log file data
 **/
function handleAdminLog(urlParts, response){
    var file = urlParts.query.file;
    var filePath = config.logging.files.directory + '/' + file;
    if(!file.match(/^\w+\.log$/)) {
        response.end('wrong log file');
    }
    response.writeHead(200, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Content-Length': fs.statSync(filePath).size
    });
    fs.createReadStream(filePath).pipe(response);
}

/**
 * Administration: pool ports usage
 **/
function handleAdminPorts(response){
    async.waterfall([
        function(callback) {
            redisClient.keys(config.coin + ':ports:*', callback);
        },
        function(portsKeys, callback) {
            var redisCommands = portsKeys.map(function(k) {
                return ['hmget', k, 'port', 'users'];
            });
            redisClient.multi(redisCommands).exec(function(error, redisData) {
                var portsData = {};
                for (var i in redisData) {
                    var port = portsKeys[i];

                    var data = redisData[i];
                    portsData[port] = {
                        port: data[0],
                        users: data[1]
                    };
                }
                callback(null, portsData);
            });
        }
    ], function(error, portsData) {
        if(error) {
            response.end(JSON.stringify({error: 'Error collecting Ports stats'}));
            return;
        }
        response.end(JSON.stringify(portsData));
    });
}

/**
 * RPC monitoring of daemon and wallet
 **/

// Start RPC monitoring
function startRpcMonitoring(rpc, module, method, interval) {
    setInterval(function() {
        rpc(method, {}, function(error, response) {
            var stat = {
                lastCheck: new Date() / 1000 | 0,
                lastStatus: error ? 'fail' : 'ok',
                lastResponse: JSON.stringify(error ? error : response)
            };
            if(error) {
                stat.lastFail = stat.lastCheck;
                stat.lastFailResponse = stat.lastResponse;
            }
            var key = getMonitoringDataKey(module);
            var redisCommands = [];
            for(var property in stat) {
                redisCommands.push(['hset', key, property, stat[property]]);
            }
            redisClient.multi(redisCommands).exec();
        });

    }, interval * 1000);
}

// Return monitoring data key
function getMonitoringDataKey(module) {
    return config.coin + ':status:' + module;
}

// Initialize monitoring
function initMonitoring() {
    var modulesRpc = {
        daemon: apiInterfaces.rpcDaemon,
        wallet: apiInterfaces.rpcWallet
    };
    for(var module in config.monitoring) {
        var settings = config.monitoring[module];
        
        if(settings.checkInterval) {
            startRpcMonitoring(modulesRpc[module], module, settings.rpcMethod, settings.checkInterval);
        }
    }
}

// Get monitoring data
function getMonitoringData(callback) {
    var modules = Object.keys(config.monitoring);
    var redisCommands = [];
    for(var i in modules) {
        redisCommands.push(['hgetall', getMonitoringDataKey(modules[i])])
    }
    redisClient.multi(redisCommands).exec(function(error, results) {
        var stats = {};
        for(var i in modules) {
            if(results[i]) {
                stats[modules[i]] = results[i];
            }
        }
        callback(error, stats);
    });
}

/**
 * Return pool public ports
 **/
function getPublicPorts(ports){
    return ports.filter(function(port) {
        return !port.hidden;
    });
}

/**
 * Return list of pool logs file
 **/
function getLogFiles(callback) {
    var dir = config.logging.files.directory;
    fs.readdir(dir, function(error, files) {
        var logs = {};
        for(var i in files) {
            var file = files[i];
            var stats = fs.statSync(dir + '/' + file);
            logs[file] = {
                size: stats.size,
                changed: Date.parse(stats.mtime) / 1000 | 0
            }
        }
        callback(error, logs);
    });
}


/**
 * Parse cookies data
 **/
function parseCookies(request) {
    var list = {},
        rc = request.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = unescape(parts.join('='));
    });
    return list;
}

/**
 * Start pool API
 **/

// Collect statistics for the first time
collectStats();

// Initialize RPC monitoring
//initMonitoring();

// Enable to be bind to a certain ip or all by default
var bindIp = config.api.bindIp || "0.0.0.0";

// Start API on HTTP port
var server = http.createServer(function(request, response){
    if (request.method.toUpperCase() === "OPTIONS"){
        response.writeHead("204", "No Content", {
            "access-control-allow-origin": '*',
            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": "content-type, accept",
            "access-control-max-age": 10, // Seconds.
            "content-length": 0
        });
        return(response.end());
    }

    handleServerRequest(request, response);
});

server.listen(config.api.port, bindIp, function(){
    log('info', logSystem, 'API started & listening on %s port %d', [bindIp, config.api.port]);
});

if(config.api.ssl && config.api.ssl.enabled){
    var bindIpSsl = config.api.ssl.bindIp || "0.0.0.0";
    var sslPort = config.api.ssl.port;
    if (!config.api.ssl.cert) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate not configured', [bindIpSsl, sslPort]);
    } else if (!config.api.ssl.key) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL key not configured', [bindIpSsl, sslPort]);
       
    } else if (!config.api.ssl.ca) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate authority not configured', [bindIpSsl, sslPort]);
        
    } else if (!fs.existsSync(config.api.ssl.cert)) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate file not found (configuration error)', [bindIpSsl, sslPort]);
        
    } else if (!fs.existsSync(config.api.ssl.key)) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL key file not found (configuration error)', [bindIpSsl, sslPort]);
        
    } else if (!fs.existsSync(config.api.ssl.ca)) {
        log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate authority file not found (configuration error)', [bindIpSsl, sslPort]);
    }else{
        
        var sslOptions = {
            key: fs.readFileSync(config.api.ssl.key),
            cert: fs.readFileSync(config.api.ssl.cert),
            ca: fs.readFileSync(config.api.ssl.ca),
            honorCipherOrder: true
        };
        
        var ssl_server = https.createServer(sslOptions, function(request, response){
            if (request.method.toUpperCase() === "OPTIONS"){
                response.writeHead("204", "No Content", {
                    "access-control-allow-origin": '*',
                    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "access-control-allow-headers": "content-type, accept",
                    "access-control-max-age": 10, // Seconds.
                    "content-length": 0,
                    "strict-transport-security": "max-age=604800"
                });
                return(response.end());
            }
    
            handleServerRequest(request, response);
        });
        
        ssl_server.listen(sslPort, bindIpSsl, function(){
            log('info', logSystem, 'API started & listening on %s port %d (SSL)', [bindIpSsl, sslPort]);
        });
    }
}
