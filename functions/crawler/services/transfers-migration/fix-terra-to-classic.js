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
          status: 'to_fix_terra_to_classic',
          size: 10,
          sort: [{ 'send.created_at.ms': 'asc' }],
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
          send,
        } = { ...d };

        if (
          send?.txhash &&
          send.source_chain
        ) {
          const _d = {
            ...d,
          };

          const fields =
            [
              'send',
              'link',
            ];

          for (const f of fields) {
            if (_d[f]) {
              const {
                send,
              } = { ..._d };
              const {
                height,
                created_at,
              } = { ...send };
              const {
                year,
              } = { ...created_at };

              if (
                height > 5500000 &&
                year === 1640995200000
              ) {
                const sub_fields =
                [
                  'original_source_chain',
                  'source_chain',
                ];

                for (const _f of sub_fields) {
                  if (
                    [
                      'terra-2',
                    ].includes(_d[f][_f])
                  ) {
                    _d[f][_f] = 'terra';
                  }
                }
              }
            }
          }

          const _id = `${_d.send.txhash}_${_d.send.source_chain}`.toLowerCase();

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

          await api
            .post(
              '',
              {
                module: 'index',
                method: 'remove',
                collection,
                id: `${_id}-2`,
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