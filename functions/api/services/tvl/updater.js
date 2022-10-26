const config = require('config-yml');
const tvl = require('./');
const {
  sleep,
} = require('../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const assets_data = require('../../data')?.assets?.[environment] ||
  [];

module.exports = async context => {
  /*for (const asset_data of assets_data) {
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

  while (context.getRemainingTimeInMillis() > 5 * 1000) {
    await sleep(1 * 1000);
  }

  return;*/

  const assets_tvl = await Promise.all(
    assets_data
      .map(a =>
        new Promise(
          async (resolve, reject) => {
            const {
              id,
            } = { ...a };

            const result = await tvl(
              {
                asset: id,
              },
              true,
            );

            resolve(
              [
                id,
                result,
              ]
            );
          }
        )
      )
  );

  return Object.fromEntries(
    assets_tvl
  );
};