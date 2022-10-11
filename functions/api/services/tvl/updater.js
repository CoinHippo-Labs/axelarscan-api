const config = require('config-yml');
const tvl = require('./index');
const {
  sleep,
} = require('../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const assets_data = require('../../data')?.assets?.[environment] ||
  [];

module.exports = async context => {
  for (const asset_data of assets_data) {
    const {
      id,
    } = { ...asset_data };

    tvl(
      {
        asset: id,
      },
      true,
    );
  }

  while (context.getRemainingTimeInMillis() > 2 * 1000) {
    await sleep(1 * 1000);
  }

  return;
};