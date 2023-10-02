const searchDepositAddresses = require('./searchDepositAddresses');
const transfersStats = require('./stats/transfersStats');
const transfersChart = require('./stats/transfersChart');
const transfersCumulativeVolume = require('./stats/transfersCumulativeVolume');
const transfersTotalVolume = require('./stats/transfersTotalVolume');
const transfersTotalFee = require('./stats/transfersTotalFee');
const transfersTotalActiveUsers = require('./stats/transfersTotalActiveUsers');
const transfersTopUsers = require('./stats/transfersTopUsers');
const searchTransfers = require('./searchTransfers');
const resolveTransfer = require('./resolveTransfer');
const getTransferDataMapping = require('./getTransferDataMapping');

module.exports = {
  searchDepositAddresses,
  transfersStats,
  transfersChart,
  transfersCumulativeVolume,
  transfersTotalVolume,
  transfersTotalFee,
  transfersTotalActiveUsers,
  transfersTopUsers,
  searchTransfers,
  resolveTransfer,
  getTransferDataMapping,
};