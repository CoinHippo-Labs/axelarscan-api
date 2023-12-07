const getCirculatingSupply = require('./getCirculatingSupply');
const getTotalSupply = require('./getTotalSupply');
const getTokenInfo = require('./getTokenInfo');
const getInflation = require('./getInflation');
const getChainMaintainers = require('./getChainMaintainers');
const getEscrowAddresses = require('./getEscrowAddresses');
const searchBlocks = require('./searchBlocks');
const searchTransactions = require('./searchTransactions');

module.exports = {
  getCirculatingSupply,
  getTotalSupply,
  getTokenInfo,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
  searchBlocks,
  searchTransactions,
};