const {
  getTokensPrice,
} = require('./tokens');
const {
  getCirculatingSupply,
  getTotalSupply,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
} = require('./axelar');

module.exports = {
  getTokensPrice,
  getCirculatingSupply,
  getTotalSupply,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
};