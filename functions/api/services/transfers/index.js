const transfers = require('./transfers');
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