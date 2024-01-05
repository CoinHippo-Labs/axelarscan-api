const { getTokensPrice } = require('./tokens');
const { getTotalSupply, getCirculatingSupply, getTokenInfo, getInflation, getBalances, getDelegations, getRedelegations, getUnbondings, getRewards, getCommissions, getAccountAmounts, getProposals, getProposal } = require('./axelar');
const validator = require('./axelar/validator');
const { getTVL, getTVLAlert } = require('./tvl');
const GMP = require('./interchain/gmp');
const tokenTransfer = require('./interchain/token-transfer');
const { interchainChart, interchainTotalVolume, interchainTotalFee, interchainTotalActiveUsers } = require('./interchain');
const { getMethods, getChainsList, getAssetsList, getContracts } = require('../utils/config');

module.exports = {
  getMethods,
  getChains: () => getChainsList(),
  getAssets: () => getAssetsList(),
  getContracts: () => getContracts(),
  getTokensPrice,
  getTotalSupply,
  getCirculatingSupply,
  getTokenInfo,
  getInflation,
  getBalances,
  getDelegations,
  getRedelegations,
  getUnbondings,
  getRewards,
  getCommissions,
  getAccountAmounts,
  getProposals,
  getProposal,
  getTVL,
  getTVLAlert,
  interchainChart,
  interchainTotalVolume,
  interchainTotalFee,
  interchainTotalActiveUsers,
  ...GMP,
  ...tokenTransfer,
  ...validator,
};