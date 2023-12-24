const { getTokensPrice } = require('./tokens');
const { getTotalSupply, getCirculatingSupply, getTokenInfo, getInflation } = require('./axelar');
const validator = require('./axelar/validator');
const { getTVL, getTVLAlert } = require('./tvl');
const GMP = require('./interchain/gmp');
const tokenTransfer = require('./interchain/token-transfer');
const { interchainChart, interchainTotalVolume, interchainTotalFee, interchainTotalActiveUsers } = require('./interchain');
const { getChainsList, getAssetsList, getContracts } = require('../utils/config');

module.exports = {
  getChains: getChainsList,
  getAssets: getAssetsList,
  getContracts,
  getTokensPrice,
  getTotalSupply,
  getCirculatingSupply,
  getTokenInfo,
  getInflation,
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