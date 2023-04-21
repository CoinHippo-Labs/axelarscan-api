const getTokensPrice = require('./getTokensPrice');
const getCirculatingSupply = require('./getCirculatingSupply');
const getTotalSupply = require('./getTotalSupply');
const getInflation = require('./getInflation');
const getChainMaintainers = require('./getChainMaintainers');
const getEscrowAddresses = require('./getEscrowAddresses');
const searchBlocks = require('./searchBlocks');
const searchTransactions = require('./searchTransactions');
const searchPolls = require('./searchPolls');
const searchUptimes = require('./searchUptimes');
const searchHeartbeats = require('./searchHeartbeats');
const getValidatorsVotes = require('./getValidatorsVotes');
const searchBatches = require('./searchBatches');
const searchDepositAddresses = require('./searchDepositAddresses');

const test = async () => {
  await getTokensPrice();
  await getCirculatingSupply();
  await getTotalSupply();
  await getInflation();
  await getChainMaintainers();
  await getEscrowAddresses();
  await searchBlocks();
  await searchTransactions();
  await searchPolls();
  await searchUptimes();
  await searchHeartbeats();
  await getValidatorsVotes();
  await searchBatches();
  await searchDepositAddresses();
};

test();