const transfers = require('./transfers');
const transfersStats = require('./transfersStats');
const transfersStatsChart = require('./transfersStatsChart');
const cumulativeVolume = require('./cumulativeVolume');
const searchTransfers = require('./searchTransfers');
const searchTransfersStats = require('./searchTransfersStats');
const searchTransfersStatsChart = require('./searchTransfersStatsChart');
const getCumulativeVolume = require('./getCumulativeVolume');
const getTransfersStatus = require('./getTransfersStatus');
const saveDepositForWrap = require('./wrap/saveDepositForWrap');
const saveWrap = require('./wrap/saveWrap');
const saveDepositForUnwrap = require('./unwrap/saveDepositForUnwrap');
const saveUnwrap = require('./unwrap/saveUnwrap');

module.exports = {
  transfers,
  transfersStats,
  transfersStatsChart,
  cumulativeVolume,
  searchTransfers,
  searchTransfersStats,
  searchTransfersStatsChart,
  getCumulativeVolume,
  getTransfersStatus,
  saveDepositForWrap,
  saveWrap,
  saveDepositForUnwrap,
  saveUnwrap,
};