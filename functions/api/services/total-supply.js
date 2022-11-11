const {
  BigNumber,
  utils: { formatUnits },
} = require('ethers');
const config = require('config-yml');
const lcd = require('./lcd');
const {
  equals_ignore_case,
} = require('../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const cosmos_chains_data =
  require('../data')?.chains?.[environment]?.cosmos ||
  [];
const axelarnet =
  cosmos_chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );
const assets_data =
  require('../data')?.assets?.[environment] ||
  [];

module.exports = async (
  params = {},
) => {
  let {
    asset,
  } = { ...params };

  asset =
    asset ||
    'uaxl';

  const asset_data = assets_data
    .find(a =>
      equals_ignore_case(
        a?.id,
        asset,
      )
    );

  const {
    id,
    ibc,
  } = { ...asset_data };

  let {
    decimals,
  } = {
    ...(
      (ibc || [])
        .find(i =>
          i?.chain_id === axelarnet.id
        )
    ),
  };

  decimals =
    decimals ||
    asset_data?.decimals ||
    6;

  const response =
    await lcd(
      `/cosmos/bank/v1beta1/supply/${id || ''}`,
    );

  const {
    amount,
  } = { ...response?.amount };

  return (
    !isNaN(amount) ?
      Number(
        formatUnits(
          BigNumber.from(
            amount
          ),
          decimals,
        )
      ) :
      response
  );
};