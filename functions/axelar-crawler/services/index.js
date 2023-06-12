const blockSubscriber = require('./subscriber/block');
const txSubscriber = require('./subscriber/tx');
const reindex = require('./reindex');
const archive = require('./archive');
const updatePolls = require('./updatePolls');
const updateTVL = require('./updateTVL');
const updateWraps = require('./updateWraps');
const updateUnwraps = require('./updateUnwraps');
const updateERC20Transfers = require('./updateERC20Transfers');
const { getReindex } = require('../utils/config');

const { enable } = { ...getReindex() };

module.exports = context => {
  if (enable) {
    blockSubscriber(context);
    txSubscriber(context);
    reindex(context);
  }
  if (context || !enable) {
    archive(context);
    updatePolls(context);
    // updateTVL(context);
    updateWraps(context);
    updateUnwraps(context);
    updateERC20Transfers(context);
  }
};