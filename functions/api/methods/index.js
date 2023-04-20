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
} = require('./axelar');
const {
  searchBatches,
} = require('./batches');
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
  searchBatches,
  saveDepositForWrap,
  saveWrap,
  saveDepositForUnwrap,
  saveUnwrap,
  saveDepositForERC20Transfer,
  saveERC20Transfer,
};