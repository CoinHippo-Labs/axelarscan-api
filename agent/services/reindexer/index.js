// import module for http request
const axios = require('axios');
// import config
const config = require('config-yml');
// import utils
const { log } = require('../../utils');

// initial service name
const service_name = 'reindexer';

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

module.exports = () => {
  if (config?.[environment]?.endpoints?.api) {
    // initial endpoints
    const api = config[environment].endpoints.api;

    // initial api requester
    const requester = axios.create({ baseURL: api });

    // initial num reindex processes
    const num_reindex_processes = config[environment].num_reindex_processes || 2;

    // initial function to index block & tx
    const index = async (from_block, to_block, process_index = 0) => {
      for (let height = from_block; height < to_block; height++) {
        if (height % num_reindex_processes === process_index) {
          log('info', service_name, 'get block', { height, from_block, to_block, process_index });
          // request api
          requester.get('', {
            params: {
              module: 'lcd',
              path: `/cosmos/base/tendermint/v1beta1/blocks/${height}`,
            },
          }).catch(error => { return { data: { error } }; });

          // get transactions in block
          let pageKey = true;
          while (pageKey) {
            // request api
            const response = await requester.get('', {
              params: {
                module: 'lcd',
                path: '/cosmos/tx/v1beta1/txs',
                events: `tx.height=${height}`,
                'pagination.key': pageKey && typeof pageKey === 'string' ? pageKey : undefined,
                no_index: true,
              },
            }).catch(error => { return { data: { error } }; });

            // transactions data
            const txs = response?.data?.tx_responses || [];
            for (let i = 0; i < txs.length; i++) {
              const tx = txs[i];
              if (tx?.txhash) {
                const hash = tx.txhash;
                log('info', service_name, 'get tx', { hash, height });
                // request api
                const params = {
                  params: {
                    module: 'lcd',
                    path: `/cosmos/tx/v1beta1/txs/${hash}`,
                  },
                };
                if (txs.length < 25) {
                  requester.get('', params)
                    .catch(error => { return { data: { error } }; });
                }
                else {
                  await requester.get('', params)
                    .catch(error => { return { data: { error } }; });
                }
              }
            }
            pageKey = response?.data?.pagination?.next_key;
          }
        }
      }
    };

    // start index
    [...Array(num_reindex_processes).keys()].forEach(i => index(config[environment].start_reindex_block || 1, config[environment].end_reindex_block, i));
  }
};