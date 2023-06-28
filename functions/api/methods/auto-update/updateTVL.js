const { getTVL } = require('../tvl');
const { getAssetsList } = require('../../utils/config');
const { log } = require('../../utils');

const service_name = 'updateTVL';

module.exports = async (params = {}) => {
  const { id } = { ...params };
  return Object.fromEntries(
    await Promise.all(
      getAssetsList()
        .filter(a => !id || a.id === id)
        .map(a =>
          new Promise(
            async resolve => {
              const { id } = { ...a };
              // log('info', service_name, 'start update', { id });
              const response = await getTVL({ asset: id, force_update: true });
              // log('info', service_name, 'end update', { id, response });
              resolve([id, response]);
            }
          )
        )
    )
  );
};