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
  getValidators,
  getValidatorsVotes,
} = require('./validators');
const {
  getProposals,
  getProposal,
} = require('./proposals');
const {
  searchBatches,
} = require('./batches');
const {
  searchDepositAddresses,
  transfersStats,
  transfersChart,
  transfersCumulativeVolume,
  transfersTotalVolume,
  searchTransfers,
  resolveTransfer,
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
  getLatestEventBlock,
} = require('./crawler');
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
  getValidators,
  getValidatorsVotes,
  getProposals,
  getProposal,
  searchBatches,
  searchDepositAddresses,
  transfersStats,
  transfersChart,
  transfersCumulativeVolume,
  transfersTotalVolume,
  searchTransfers,
  resolveTransfer,
  getTVL,
  getTVLAlert,
  saveDepositForWrap,
  saveWrap,
  saveDepositForUnwrap,
  saveUnwrap,
  saveDepositForERC20Transfer,
  saveERC20Transfer,
  getLatestEventBlock,
  archive,
  updatePolls,
  updateTVL,
  updateWraps,
  updateUnwraps,
  updateERC20Transfers,
};