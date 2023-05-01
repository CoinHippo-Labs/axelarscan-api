const blockSubscriber = require('./subscriber/block');
const txSubscriber = require('./subscriber/tx');
const reindex = require('./reindex');
const archive = require('./archive');
const updatePolls = require('./updatePolls');
const updateTVL = require('./updateTVL');
const updateWraps = require('./updateWraps');
const updateUnwraps = require('./updateUnwraps');
const updateERC20Transfers = require('./updateERC20Transfers');

module.exports = context => {
  blockSubscriber();
  txSubscriber();
  reindex();
  archive();
  updatePolls(context);
  updateTVL();
  updateWraps(context);
  updateUnwraps(context);
  updateERC20Transfers(context);
};