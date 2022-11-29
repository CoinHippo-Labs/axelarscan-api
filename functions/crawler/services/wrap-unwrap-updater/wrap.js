const moment = require('moment');
const {
  API,
  getWraps,
} = require('./api');
const {
  getTransaction,
  getBlockTime,
  getProvider,
} = require('../utils');
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
      await getWraps(
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
          tx_hash,
          tx_hash_wrap,
          source_chain,
        } = { ...d };

        if (
          tx_hash &&
          tx_hash_wrap &&
          source_chain
        ) {
          const provider = getProvider(source_chain);

          if (provider) {
            const _data =
              await getTransaction(
                provider,
                tx_hash,
                source_chain,
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

              const wrap = {
                ...d,
                txhash: tx_hash,
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

              const _id = `${tx_hash_wrap}_${source_chain}`.toLowerCase();

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
                    type: 'wrap',
                    wrap,
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
    else {
      await sleep(3 * 1000);
    }
  }
};