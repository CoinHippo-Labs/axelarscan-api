const { crud } = require('../services/index');
const rpc = require('./rpc');
const lcd = require('./lcd');
const { getTokensPrice } = require('./tokens');
const { getCirculatingSupply, getTotalSupply, getInflation, getChainMaintainers, getEscrowAddresses, searchBlocks, searchTransactions } = require('./axelar');
const { getBalances, getDelegations, getRedelegations, getUnbondings } = require('./account');
const { searchPolls } = require('./polls');
const { searchUptimes, searchHeartbeats, getValidators, getValidatorsVotes } = require('./validators');
const { getProposals, getProposal } = require('./proposals');
const { searchBatches } = require('./batches');
const { searchDepositAddresses, transfersStats, transfersChart, transfersCumulativeVolume, transfersTotalVolume, transfersTopUsers, searchTransfers, resolveTransfer } = require('./transfers');
const { getTVL, getTVLAlert } = require('./tvl');
const { saveEvent } = require('./events');
const { saveDepositForWrap, saveWrap } = require('./transfers/wrap');
const { saveDepositForUnwrap, saveUnwrap } = require('./transfers/unwrap');
const { saveDepositForERC20Transfer, saveERC20Transfer } = require('./transfers/erc20-transfer');
const { getLatestEventBlock } = require('./crawler');
const { archive, updatePolls, updateTVL, updateWraps, updateUnwraps, updateERC20Transfers } = require('./auto-update');

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
  getBalances,
  getDelegations,
  getRedelegations,
  getUnbondings,
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
  transfersTopUsers,
  searchTransfers,
  resolveTransfer,
  getTVL,
  getTVLAlert,
  saveEvent,
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