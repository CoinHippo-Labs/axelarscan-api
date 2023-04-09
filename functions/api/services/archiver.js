const moment = require('moment');
const config = require('config-yml');

const rpc = require('./rpc');
const {
  delete_by_query,
} = require('./index');
const {
  log,
} = require('../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const service_name = 'archiver';

const {
  store_blocks,
  cache_timeout_seconds,
} = { ...config?.[environment] };

module.exports = async () => {
  const collections = ['blocks'];

  if (collections.length > 0) {
    const response = await rpc('/status');

    const {
      latest_block_height,
    } = { ...response?.result?.sync_info };

    const latest_block = Number(latest_block_height);

    if (latest_block > store_blocks) {
      for (const collection of collections) {
        log(
          'info',
          service_name,
          'archive',
          {
            collection,
            store_blocks,
          },
        );

        const output = await delete_by_query(collection, { range: { height: { lt: latest_block - store_blocks } } });

        log(
          'debug',
          service_name,
          'archive output',
          output,
        );
      }
    }
  }

  const cache_collections = ['axelard', 'cosmos', 'rpc'];

  for (const collection of cache_collections) {
    log(
      'info',
      service_name,
      'archive',
      {
        collection,
        cache_timeout_seconds,
      },
    );

    const output =
      await delete_by_query(
        collection,
        {
          bool: {
            must: [
              { range: { updated_at: { lt: moment().subtract(cache_timeout_seconds, 'seconds').unix() } } },
            ],
            must_not:
              collection === 'axelard' ?
                [
                  {
                    bool: {
                      should: [
                        { exists: { field: 'type' } },
                        { match: { type: 'proxy' } },
                      ],
                      minimum_should_match: 1, 
                    },
                  },
                ] :
                [],
          },
        },
      );

    log(
      'debug',
      service_name,
      'archive output',
      output,
    );
  }

  return;
};