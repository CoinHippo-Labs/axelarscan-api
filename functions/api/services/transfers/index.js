const searchTransfers = require('./searchTransfers');
const searchTransfersStats = require('./searchTransfersStats');
const searchTransfersStatsChart = require('./searchTransfersStatsChart');
const getCumulativeVolume = require('./getCumulativeVolume');
const getTransfersStatus = require('./getTransfersStatus');

module.exports = {
  searchTransfers,
  searchTransfersStats,
  searchTransfersStatsChart,
  getCumulativeVolume,
  getTransfersStatus,
};