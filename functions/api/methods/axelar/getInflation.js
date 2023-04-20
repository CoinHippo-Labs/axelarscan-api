const _ = require('lodash');

const lcd = require('../lcd');
const {
  getChainsList,
} = require('../../utils/config');
const {
  fixDecimals,
  normalizeQuote,
} = require('../../utils');

const evm_chains_data = getChainsList('evm').filter(c => !c.no_inflation);

module.exports = async (
  params = {},
) => {
  let {
    uptimeRate,
    heartbeatRate,
    numEVMChains,
    unsubmittedVoteRates,
  } = { ...params };

  uptimeRate = uptimeRate || 1;
  heartbeatRate = heartbeatRate || 1;
  numEVMChains = numEVMChains || evm_chains_data.length;
  unsubmittedVoteRates = unsubmittedVoteRates || Object.fromEntries(evm_chains_data.map(c => [c.id, 0]));

  let response = await lcd('/cosmos/mint/v1beta1/inflation');
  const tendermintInflationRate = response ? Number(response.inflation) : 0;

  response = await lcd('/cosmos/distribution/v1beta1/params');
  const communityTax = response?.params ? Number(response.params.community_tax) : 0;

  response = await lcd('/cosmos/params/v1beta1/params', { subspace: 'reward', key: 'KeyMgmtRelativeInflationRate' });
  const keyMgmtRelativeInflationRate = response?.params ? Number(normalizeQuote(response.param.value)) : 0;

  response = await lcd('/cosmos/params/v1beta1/params', { subspace: 'reward', key: 'ExternalChainVotingInflationRate' });
  const externalChainVotingInflationRate = response?.params ? Number(normalizeQuote(response.param.value)) : 0;

  return {
    equation: `inflation = (uptimeRate * tendermintInflationRate) + (heartbeatRate * keyMgmtRelativeInflationRate * tendermintInflationRate) + (externalChainVotingInflationRate * (${evm_chains_data.map(c => `(1 - ${c.id}UnsubmittedVoteRate)`).join(' + ')}))`,
    tendermintInflationRate,
    communityTax,
    keyMgmtRelativeInflationRate,
    externalChainVotingInflationRate,
    uptimeRate,
    heartbeatRate,
    numEVMChains,
    unsubmittedVoteRates,
    numEVMChains,
    inflation: fixDecimals((uptimeRate * tendermintInflationRate) + (heartbeatRate * keyMgmtRelativeInflationRate * tendermintInflationRate) + (externalChainVotingInflationRate * _.sum(Object.values({ ...unsubmittedVoteRates }).map(v => 1 - v))), 6),
  };
};