const getTokensPrice = require('./getTokensPrice');
const getCirculatingSupply = require('./getCirculatingSupply');
const getTotalSupply = require('./getTotalSupply');
const getInflation = require('./getInflation');
const getChainMaintainers = require('./getChainMaintainers');
const getEscrowAddresses = require('./getEscrowAddresses');
const searchBatches = require('./searchBatches');

const test = async () => {
  await getTokensPrice();
  await getCirculatingSupply();
  await getTotalSupply();
  await getInflation();
  await getChainMaintainers();
  await getEscrowAddresses();
  await searchBatches();
};

test();