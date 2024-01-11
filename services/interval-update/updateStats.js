const METHODS = require('../../methods');

module.exports = async context => {
  await Promise.all(['transfersStats', 'transfersChart', 'transfersCumulativeVolume', 'transfersTotalVolume', 'transfersTotalFee', 'transfersTotalActiveUsers', 'transfersTopUsers', 'GMPStats', 'GMPStatsAVGTimes', 'GMPChart', 'GMPCumulativeVolume', 'GMPTotalVolume', 'GMPTotalFee', 'GMPTotalActiveUsers', 'GMPTopUsers'].map(d => new Promise(async resolve => {
    resolve(await METHODS[d]());
  })));
};