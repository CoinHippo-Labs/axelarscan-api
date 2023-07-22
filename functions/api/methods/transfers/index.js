const searchDepositAddresses = require('./searchDepositAddresses');
const transfersStats = require('./stats/transfersStats');
const transfersChart = require('./stats/transfersChart');
const transfersCumulativeVolume = require('./stats/transfersCumulativeVolume');
const transfersTotalVolume = require('./stats/transfersTotalVolume');
const transfersTotalFee = require('./stats/transfersTotalFee');
const transfersTopUsers = require('./stats/transfersTopUsers');
const searchTransfers = require('./searchTransfers');
const resolveTransfer = require('./resolveTransfer');

module.exports = {
  searchDepositAddresses,
  transfersStats,
  transfersChart,
  transfersCumulativeVolume,
  transfersTotalVolume,
  transfersTotalFee,
  transfersTopUsers,
  searchTransfers,
  resolveTransfer,
};