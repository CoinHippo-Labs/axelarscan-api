const blockSubscriber = require('./subscriber/block');
const txSubscriber = require('./subscriber/tx');
const reindex = require('./reindex');
const archive = require('./archive');
const updatePolls = require('./updatePolls');
const updateBatches = require('./updateBatches');
const updateTVL = require('./updateTVL');
const updateWraps = require('./updateWraps');
const updateUnwraps = require('./updateUnwraps');
const updateERC20Transfers = require('./updateERC20Transfers');
const updateFeeValues = require('./updateFeeValues');
const updateStats = require('./updateStats');
const { getReindex } = require('../utils/config');

const { enable } = { ...getReindex() };

module.exports = context => {
  blockSubscriber(context);
  txSubscriber(context);
  if (enable) {
    reindex(context);
  }
  if (context || !enable) {
    archive(context);
    // updatePolls(context);
    updateBatches(context);
    updateTVL(context);
    updateWraps(context);
    updateUnwraps(context);
    updateERC20Transfers(context);
    // updateFeeValues(context);
    updateStats(context);
  }
};