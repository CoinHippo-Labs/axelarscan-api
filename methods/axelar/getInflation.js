const _ = require('lodash');

const { getChainsList, getContracts, getLCD } = require('../../utils/config');
const { request } = require('../../utils/http');
const { removeDoubleQuote } = require('../../utils/string');
const { toNumber, toFixed } = require('../../utils/number');

module.exports = async params => {
  const { gateway_contracts } = { ...await getContracts() };
  const chainsData = getChainsList('evm').filter(d => !d.no_inflation && gateway_contracts?.[d.id]?.address);
  let { uptimeRate, heartbeatRate, numEVMChains, unsubmittedVoteRates } = { ...params };
  uptimeRate = uptimeRate || 1;
  heartbeatRate = heartbeatRate || 1;
  numEVMChains = numEVMChains || chainsData.length;
  unsubmittedVoteRates = unsubmittedVoteRates || Object.fromEntries(chainsData.map(d => [d.id, 0]));

  const [tendermintInflationRate, communityTax, keyMgmtRelativeInflationRate, externalChainVotingInflationRate] = await Promise.all(
    ['tendermintInflationRate', 'communityTax', 'keyMgmtRelativeInflationRate', 'externalChainVotingInflationRate'].map(param => new Promise(async resolve => {
      switch (param) {
        case 'tendermintInflationRate':
          resolve(toNumber((await request(getLCD(), { path: '/cosmos/mint/v1beta1/inflation' }))?.inflation));
          break;
        case 'communityTax':
          resolve(toNumber((await request(getLCD(), { path: '/cosmos/distribution/v1beta1/params' }))?.params?.community_tax));
          break;
        case 'keyMgmtRelativeInflationRate':
          resolve(toNumber(removeDoubleQuote((await request(getLCD(), { path: '/cosmos/params/v1beta1/params', params: { subspace: 'reward', key: 'KeyMgmtRelativeInflationRate' } }))?.param?.value)));
          break;
        case 'externalChainVotingInflationRate':
          resolve(toNumber(removeDoubleQuote((await request(getLCD(), { path: '/cosmos/params/v1beta1/params', params: { subspace: 'reward', key: 'ExternalChainVotingInflationRate' } }))?.param?.value)));
          break;
        default:
          resolve();
          break;
      }
    }))
  );

  return {
    equation: `inflation = (uptimeRate * tendermintInflationRate) + (heartbeatRate * keyMgmtRelativeInflationRate * tendermintInflationRate) + (externalChainVotingInflationRate * (${chainsData.map(d => `(1 - ${d.id}UnsubmittedVoteRate)`).join(' + ')}))`,
    tendermintInflationRate,
    communityTax,
    keyMgmtRelativeInflationRate,
    externalChainVotingInflationRate,
    uptimeRate,
    heartbeatRate,
    numEVMChains,
    unsubmittedVoteRates,
    inflation: parseFloat(toFixed((uptimeRate * tendermintInflationRate) + (heartbeatRate * keyMgmtRelativeInflationRate * tendermintInflationRate) + (externalChainVotingInflationRate * _.sum(Object.values(unsubmittedVoteRates).map(v => 1 - v))), 6)),
  };
};