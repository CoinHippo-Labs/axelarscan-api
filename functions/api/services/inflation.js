const config = require('config-yml');
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

  const numEVMChains = evm_chains_data.length;

  response = await lcd(
    '/cosmos/mint/v1beta1/inflation',
  );

  const tendermintInflationRate = response ?
    Number(response.inflation) :
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
      (
        tendermintInflationRate *
        (1 + keyMgmtRelativeInflationRate)
      ) +
      (
        externalChainVotingInflationRate *
        numEVMChains
      )
    )
    .toFixed(6)
  );

  return {
    equation: 'inflation = (tendermintInflationRate * (1 + keyMgmtRelativeInflationRate)) + (externalChainVotingInflationRate * numEVMChains)',
    tendermintInflationRate,
    keyMgmtRelativeInflationRate,
    externalChainVotingInflationRate,
    numEVMChains,
    inflation,
  };
};