const {
  crud,
} = require('../services/index');
const rpc = require('./rpc');
const lcd = require('./lcd');
const {
  getTokensPrice,
} = require('./tokens');
const {
  getCirculatingSupply,
  getTotalSupply,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
  searchBlocks,
  searchTransactions,
} = require('./axelar');
const {
  searchPolls,
} = require('./polls');
const {
  searchUptimes,
  searchHeartbeats,
  getValidatorsVotes,
} = require('./validators');
const {
  searchBatches,
} = require('./batches');
const {
  searchDepositAddresses,
} = require('./transfers');
const {
  getTVL,
  getTVLAlert,
} = require('./tvl');
const {
  saveDepositForWrap,
  saveWrap,
} = require('./transfers/wrap');
const {
  saveDepositForUnwrap,
  saveUnwrap,
} = require('./transfers/unwrap');
const {
  saveDepositForERC20Transfer,
  saveERC20Transfer,
} = require('./transfers/erc20-transfer');
const {
  archive,
  updatePolls,
  updateTVL,
  updateWraps,
  updateUnwraps,
  updateERC20Transfers,
} = require('./auto-update');

module.exports = {
  crud,
  rpc,
  lcd,
  getTokensPrice,
  getCirculatingSupply,
  getTotalSupply,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
  searchBlocks,
  searchTransactions,
  searchPolls,
  searchUptimes,
  searchHeartbeats,
  getValidatorsVotes,
  searchBatches,
  searchDepositAddresses,
  getTVL,
  getTVLAlert,
  saveDepositForWrap,
  saveWrap,
  saveDepositForUnwrap,
  saveUnwrap,
  saveDepositForERC20Transfer,
  saveERC20Transfer,
  archive,
  updatePolls,
  updateTVL,
  updateWraps,
  updateUnwraps,
  updateERC20Transfers,
};