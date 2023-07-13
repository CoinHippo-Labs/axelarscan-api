const archive = require('./archive');
const updatePolls = require('./updatePolls');
const updateBatches = require('./updateBatches');
const updateTVL = require('./updateTVL');
const updateWraps = require('./updateWraps');
const updateUnwraps = require('./updateUnwraps');
const updateERC20Transfers = require('./updateERC20Transfers');

module.exports = {
  archive,
  updatePolls,
  updateBatches,
  updateTVL,
  updateWraps,
  updateUnwraps,
  updateERC20Transfers,
};