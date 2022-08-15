const axios = require('axios');
const config = require('config-yml');
const { log } = require('../../utils');

const service_name = 'reindexer';
const environment = process.env.ENVIRONMENT || config?.environment;

const {
  endpoints,
  num_reindex_processes,
  start_reindex_block,
  end_reindex_block,
} = { ...config?.[environment] };

module.exports = () => {
  if (endpoints?.api) {
    // initial api
    const api = axios.create({ baseURL: endpoints.api });

    // initial function to index block & tx
    const index = async (
      from_block,
      to_block,
      process_no = 0,
    ) => {
      for (let height = from_block; height < to_block; height++) {
        if (height % num_reindex_processes === process_no) {
          log(
            'info',
            service_name,
            'get block',
            {
              height,
              from_block,
              to_block,
              process_no,
            },
          );

          api.get('', {
            params: {
              module: 'lcd',
              path: `/cosmos/base/tendermint/v1beta1/blocks/${height}`,
            },
          }).catch(error => { return { data: { error } }; });

          // get transactions of each block
          let next_page_key = true;
          while (next_page_key) {
            const response = await api.get('', {
              params: {
                module: 'lcd',
                path: '/cosmos/tx/v1beta1/txs',
                events: `tx.height=${height}`,
                'pagination.key': typeof next_page_key === 'string' && next_page_key ?
                  next_page_key :
                  undefined,
                no_index: true,
              },
            }).catch(error => { return { data: { error } }; });

            const {
              tx_responses,
              pagination,
            } = { ...response?.data };
            const {
              next_key,
            } = { ...pagination };
            next_page_key = next_key;

            if (tx_responses) {
              for (const tx_response of tx_responses) {
                const {
                  txhash,
                } = { ...tx };

                if (txhash) {
                  log(
                    'info',
                    service_name,
                    'get tx',
                    {
                      txhash,
                      height,
                    },
                  );

                  const params = {
                    module: 'lcd',
                    path: `/cosmos/tx/v1beta1/txs/${txhash}`,
                  };

                  if (tx_responses.length < 25) {
                    api.get('', {
                      params,
                    }).catch(error => { return { data: { error } }; });
                  }
                  else {
                    await api.get('', {
                      params,
                    }).catch(error => { return { data: { error } }; });
                  }
                }
              }
            }
          }
        }
      }
    };

    // start index n processes
    [...Array(num_reindex_processes).keys()]
      .forEach(i => index(
        start_reindex_block,
        end_reindex_block,
        i,
      ));
  }
};