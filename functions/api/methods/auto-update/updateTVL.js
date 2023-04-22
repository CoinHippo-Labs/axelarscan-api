const {
  getTVL,
} = require('../tvl');
const {
  getAssetsList,
} = require('../../utils/config');

module.exports = async () =>
  Object.fromEntries(
    await Promise.all(
      getAssetsList().map(a =>
        new Promise(
          async resolve => {
            const {
              id,
            } = { ...a };

            resolve([id, await getTVL({ asset: id, force_update: true })]);
          }
        )
      )
    )
  );