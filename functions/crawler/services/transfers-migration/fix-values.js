const {
  API,
  getTransfers,
} = require('./api');
const {
  sleep,
} = require('../../utils');

module.exports = async (
  collection = 'cross_chain_transfers',
) => {
  const api = API();

  while (true) {
    const response =
      await getTransfers(
        {
          status: 'to_fix_value',
          size: 10,
          sort: [{ 'send.created_at.ms': 'asc' }],
        },
        '/cross-chain/transfers',
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
          send,
          link,
        } = { ...d };

        if (
          send?.txhash &&
          send.source_chain
        ) {
          let {
            value,
          } = { ...send };

          value =
            value ||
            (
              typeof send.amount === 'number' &&
              typeof link?.price === 'number' ?
                send.amount * link.price :
                undefined
            );

          const _d = {
            send: {
              ...send,
              value,
            },
          };

          const _id = `${send.txhash}_${send.source_chain}`.toLowerCase();

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
                ..._d,
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
    else {
      await sleep(3 * 1000);
    }
  }
};