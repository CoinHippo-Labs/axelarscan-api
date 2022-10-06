const config = require('config-yml');
const _ = require('lodash');
const lcd = require('./lcd');
const cli = require('./cli');
const {
  to_json,
} = require('../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../data')?.chains?.[environment]?.evm || [];

module.exports = async (
  params = {},
) => {
  let response;

  const _evm_chains_data = evm_chains_data
    .filter(c => !c?.no_inflation);

  let {
    uptimeRate,
    heartbeatRate,
    numEVMChains,
    unsubmittedVoteRates,
  } = { ...params };

  uptimeRate = uptimeRate ||
    1;
  heartbeatRate = heartbeatRate ||
    1;
  numEVMChains = numEVMChains ||
    _evm_chains_data.length;
  unsubmittedVoteRates = unsubmittedVoteRates ||
    Object.fromEntries(
      _evm_chains_data
        .map(c =>
          [
            c?.id,
            0,
          ]
        )
    );

  response = await lcd(
    '/cosmos/mint/v1beta1/inflation',
  );

  const tendermintInflationRate = response ?
    Number(response.inflation) :
    null;

  response = await lcd(
    '/cosmos/distribution/v1beta1/params',
  );

  const communityTax = response ?
    Number(response.params?.community_tax) :
    null;

  response = await cli(
    undefined,
    {
      cmd: 'axelard q params subspace reward KeyMgmtRelativeInflationRate -oj',
    },
  );

  const keyMgmtRelativeInflationRate = Number(
    (
      {
        ...to_json(response?.stdout),
      }.value ||
      ''
    )
    .split('"')
    .join('')
  );

  response = await cli(
    undefined,
    {
      cmd: 'axelard q params subspace reward ExternalChainVotingInflationRate -oj',
    },
  );

  const externalChainVotingInflationRate = Number(
    (
      {
        ...to_json(response?.stdout),
      }.value ||
      ''
    )
    .split('"')
    .join('')
  );

  const inflation = parseFloat(
    (
      (uptimeRate * (tendermintInflationRate || 0)) +
      (heartbeatRate * (keyMgmtRelativeInflationRate || 0) * (tendermintInflationRate || 0)) +
      (
        externalChainVotingInflationRate *
        _.sum(
          Object.values({ ...unsubmittedVoteRates })
            .map(v => 1 - v)
        )
      )
    )
    .toFixed(6)
  );

  return {
    equation: `inflation = (uptimeRate * tendermintInflationRate) + (heartbeatRate * keyMgmtRelativeInflationRate * tendermintInflationRate) + (externalChainVotingInflationRate * (${_evm_chains_data
      .map(c => `(1 - ${c?.id}UnsubmittedVoteRate)`)
      .join(' + ')
    }))`,
    tendermintInflationRate,
    communityTax,
    keyMgmtRelativeInflationRate,
    externalChainVotingInflationRate,
    uptimeRate,
    heartbeatRate,
    numEVMChains,
    unsubmittedVoteRates,
    numEVMChains,
    inflation,
  };
};