const transfers = require('./transfers');
const transfersStats = require('./transfersStats');
const transfersStatsChart = require('./transfersStatsChart');
const cumulativeVolume = require('./cumulativeVolume');
const totalVolume = require('./totalVolume');
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
  totalVolume,
  getTransfersStatus,
  saveDepositForWrap,
  saveWrap,
  saveDepositForUnwrap,
  saveUnwrap,
};