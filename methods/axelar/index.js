const getTotalSupply = require('./getTotalSupply');
const getCirculatingSupply = require('./getCirculatingSupply');
const getTokenInfo = require('./getTokenInfo');
const getInflation = require('./getInflation');
const { getBalances, getDelegations, getRedelegations, getUnbondings, getRewards, getCommissions, getAccountAmounts } = require('./account');
const { getProposals, getProposal } = require('./proposal');

module.exports = {
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
};