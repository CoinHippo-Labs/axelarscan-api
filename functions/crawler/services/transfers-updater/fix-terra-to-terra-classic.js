const _ = require('lodash');
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
          status: 'to_fix_terra_to_terra_classic',
          size: 10,
          sort: [{ 'send.created_at.ms': 'desc' }],
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
                created_at,
              } = { ...send };
              let {
                height,
              } = { ...send };
              const {
                ms,
              } = { ...created_at };

              if (
                f === 'send' &&
                height &&
                typeof height !== 'number'
              ) {
                height = Number(height);
                _d[f].height = height;
              }

              if (
                height > 1000000 &&
                ms < 1659712921000
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
              else if (
                height < 5000000 &&
                ms >= 1634884994000
              ) {
                const sub_fields =
                  [
                    'original_source_chain',
                    'source_chain',
                  ];

                for (const _f of sub_fields) {
                  if (
                    [
                      'terra',
                    ].includes(_d[f][_f])
                  ) {
                    _d[f][_f] = 'terra-2';
                  }
                }
              }
            }
          }

          let _id = `${_d.send.txhash}_${_d.send.source_chain}`.toLowerCase();

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
                ignore_fix_terra:
                  send.source_chain === _d.send.source_chain ?
                    true :
                    undefined,
              },
            )
            .catch(error => {
              return {
                data: {
                  error,
                },
              };
            });

          if (_d.send.source_chain.includes('-')) {
            _id =
              `${_d.send.txhash}_${
                _.head(
                  _d.send.source_chain
                    .split('-')
                )
              }`.toLowerCase();
          }
          else {
            _id = `${_id}-2`;
          }

          await api
            .post(
              '',
              {
                module: 'index',
                method: 'remove',
                collection,
                id: _id,
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