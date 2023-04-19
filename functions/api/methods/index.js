const {
  crud,
} = require('../services/index');
const rpc = require('./rpc');
const lcd = require('./lcd');
const {
  getTokensPrice,
} = require('./tokens');
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
  crud,
  rpc,
  lcd,
  getTokensPrice,
  getCirculatingSupply,
  getTotalSupply,
  getInflation,
  getChainMaintainers,
  getEscrowAddresses,
};