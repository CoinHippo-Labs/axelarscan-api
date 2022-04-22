// import module for http request
const axios = require('axios');
// import module for generate diff time
const moment = require('moment');
// import config
const config = require('config-yml');
// import db service
const { crud } = require('./index');
// import utils
const { log } = require('../utils');

// service name
const service_name = 'archiver';

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

module.exports = async () => {
  // initial threshold
  const store_blocks = config?.[environment]?.store_blocks || 100000;
  const cache_timeout_minutes = config?.[environment]?.cache_timeout_minutes || 15;

  // initial collections
  const db_collections = ['blocks'];
  if (db_collections.length > 0 && config?.[environment]?.endpoints?.rpc) {
    // get latest block
    const rpc = axios.create({ baseURL: config[environment].endpoints.rpc });
    // request rpc
    const response = await rpc.get('/status')
      .catch(error => { return { data: { results: null, error } }; });
    const latest_block = Number(response?.data?.result?.sync_info?.latest_block_height);
    if (latest_block > store_blocks) {
      // iterate collections
      for (let i = 0; i < db_collections.length; i++) {
        // initial collection
        const collection = db_collections[i];
        // initial params
        const params = {
          index: collection,
          method: 'search',
          query: {
            range: {
              height: {
                lt: latest_block - store_blocks,
              },
            },
          },
          path: `/${collection}/_delete_by_query`,
        };

        log('info', service_name, 'archive', { collection, store_blocks });
        const output = await crud(params);
        log('debug', service_name, 'archive output', output);
      }
    }
  }

  // initial cache collections
  const cache_collections = ['axelard', 'cosmos'];
  // iterate collections
  for (let i = 0; i < cache_collections.length; i++) {
    // initial collection
    const collection = cache_collections[i];
    // initial params
    const params = {
      index: collection,
      method: 'search',
      query: {
        range: {
          updated_at: {
            lt: moment().subtract(cache_timeout_minutes, 'minutes').unix(),
          },
        },
      },
      path: `/${collection}/_delete_by_query`,
    };

    log('info', service_name, 'archive', { collection, cache_timeout_minutes });
    const output = await crud(params);
    log('debug', service_name, 'archive output', output);
  }
  return;
};