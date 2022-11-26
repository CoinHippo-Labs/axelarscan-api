const _ = require('lodash');
const moment = require('moment');
const {
  API,
  getUnwraps,
} = require('./api');
const {
  getTransaction,
  getBlockTime,
  getProvider,
} = require('./utils');
const {
  get_granularity,
  sleep,
} = require('../../utils');

module.exports = async (
  collection = 'cross_chain_transfers',
) => {
  const api = API();

  while (true) {
    const response =
      await getUnwraps(
        {
          status: 'to_update',
        },
      );

    const {
      data,
    } = { ...response };

    if (
      Array.isArray(data) &&
      data.length > 0
    ) {
      for (const d of data) {
        const {
          deposit_address_link,
          tx_hash_unwrap,
          source_chain,
          destination_chain,
        } = { ...d };

        if (
          deposit_address_link &&
          tx_hash_unwrap &&
          source_chain &&
          destination_chain
        ) {
          const provider = getProvider(destination_chain);

          if (provider) {
            const _response =
              await api
                .post(
                  '',
                  {
                    module: 'index',
                    method: 'query',
                    collection,
                    query: {
                      bool: {
                        must: [
                          { exists: { field: 'send.txhash' } },
                          { match: { 'send.recipient_address': deposit_address_link } },
                          { match: { 'send.source_chain': source_chain } },
                        ],
                        must_not: [
                          { exists: { field: 'unwrap' } },
                        ],
                      },
                    },
                    use_raw_data: true,
                    size: 1,
                    sort: [{ 'send.created_at.ms': 'desc' }],
                  },
                )
                .catch(error => {
                  return {
                    data: {
                      error,
                    },
                  };
                });

            const _d =
              _.head(
                _response?.data?.data
              );

            if (_d) {
              const {
                txhash,
              } = { ..._d.send };

              const _data =
                await getTransaction(
                  provider,
                  tx_hash_unwrap,
                  destination_chain,
                );

              const {
                blockNumber,
              } = { ..._data?.transaction };

              if (blockNumber) {
                const block_timestamp =
                  await getBlockTime(
                    provider,
                    blockNumber,
                  );

                const unwrap = {
                  ...d,
                  txhash: tx_hash_unwrap,
                  height: blockNumber,
                  type: 'evm',
                  created_at:
                    get_granularity(
                      moment(
                        block_timestamp * 1000
                      )
                      .utc()
                    ),
                };

                const _id = `${txhash}_${source_chain}`.toLowerCase();

                await api
                  .post(
                    '',
                    {
                      module: 'index',
                      method: 'set',
                      collection,
                      id: _id,
                      path: `/${collection}/_update/${_id}`,
                      update_only: true,
                      type: 'unwrap',
                      unwrap,
                    },
                  )
                  .catch(error => {
                    return {
                      data: {
                        error,
                      },
                    };
                  });
              }
            }
          }
        }
      }
    }
    else {
      await sleep(3 * 1000);
    }
  }
};