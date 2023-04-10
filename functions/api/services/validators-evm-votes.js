const _ = require('lodash');
const config = require('config-yml');

const rpc = require('./rpc');
const lcd = require('./lcd');
const evm_polls = require('./evm-polls');
const {
  equals_ignore_case,
} = require('../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(evm_chains_data, cosmos_chains_data);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');

const get_broadcaster_lookup = async () => {
  let data = {};

  const limit = 50;
  let page_key = true;
  let transactions_data = [];

  while (page_key) {
    const has_page_key = page_key && typeof page_key !== 'boolean';

    const _response =
      await lcd(
        '/cosmos/tx/v1beta1/txs',
        {
          events: `message.action='RegisterProxy'`,
          'pagination.key': has_page_key ? page_key : undefined,
          'pagination.limit': limit,
          'pagination.offset': has_page_key ? undefined : transactions_data.length,
        },
      );

    const {
      tx_responses,
      txs,
      pagination,
    } = { ..._response };

    const {
      next_key,
    } = { ...pagination };

    const _data =
      Object.fromEntries(
        (tx_responses || [])
          .flatMap((t, i) =>
            !t?.code &&
            (txs?.[i]?.body?.messages || [])
              .map(m => m?.['@type']?.includes('RegisterProxy') && m.sender && m.proxy_addr && [m.sender.toLowerCase(), m.proxy_addr.toLowerCase()])
              .filter(d => Array.isArray(d))
          )
          .filter(d => Array.isArray(d))
      );

    data = {
      ...data,
      ..._data,
    };

    transactions_data = _.concat(transactions_data, tx_responses || []);

    page_key = next_key || tx_responses?.length === limit;
  }

  return data;
};

module.exports = async (
  params = {},
  size = 100,
  max_page = 100,
) => {
  let {
    fromBlock,
    toBlock,
  } = { ...params };

  if (!(fromBlock || toBlock)) {
    const status = await rpc('/status');

    const {
      latest_block_height,
    } = { ...status };

    toBlock = toBlock || (Number(latest_block_height) - 10);
    fromBlock = fromBlock || (toBlock - 10000);
  }

  let polls;
  let voters;

  if (fromBlock <= toBlock) {
    const _params = {
      status: 'not_pending',
      fromBlock,
      toBlock,
      from: 0,
      size,
    };

    const _response = await evm_polls(_params);

    const {
      total,
    } = { ..._response };

    if (total > 0) {
      const offsets = [];

      if (total > size) {
        for (let i = 1; i <= max_page; i++) {
          const offset = i * size;

          if (offset <= total) {
            offsets.push(offset);
          }
          else {
            break;
          }
        }
      }

      const _data =
        _.concat(
          _response.data,
          (await Promise.all(
            offsets.map(o =>
              new Promise(
                async resolve => {
                  const _response = await evm_polls({ ..._params, from: o });

                  const {
                    data,
                  } = { ..._response };

                  resolve(data);
                }
              )
            )
          ))
          .flatMap(d => d),
        )
        .filter(d => d);

      polls = _.orderBy(_.uniqBy(_data, 'id'), ['created_at.ms'], ['desc']);

      const broadcaster_lookup = polls.length > 0 ? await get_broadcaster_lookup() : [];

      voters =
        Object.fromEntries(
          Object.entries(
            _.groupBy(
              polls.flatMap(p => {
                const {
                  sender_chain,
                } = { ...p };
                let {
                  participants,
                } = { ...p };

                participants = (participants || []).map(a => broadcaster_lookup[a?.toLowerCase()] || a);

                const addresses = Object.keys({ ...p }).filter(k => k?.startsWith(`${axelarnet.prefix_address}1`));

                return (
                  _.concat(
                    Object.entries({ ...p })
                      .filter(([k, v]) => addresses.includes(k))
                      .map(([k, v]) => {
                        const {
                          vote,
                        } = { ...v };

                        return {
                          address: k,
                          chain: sender_chain,
                          vote,
                        };
                      }),
                    participants
                      .filter(a => addresses.findIndex(_a => equals_ignore_case(a, _a)) < 0)
                      .map(a => {
                        return {
                          address: a,
                          chain: sender_chain,
                          vote: 'unsubmitted',
                        };
                      }),
                  )
                );
              }),
              'address',
            )
          )
          .map(([k, v]) => {
            const chains =
              Object.fromEntries(
                Object.entries(_.groupBy(v, 'chain'))
                  .map(([_k, _v]) => {
                    return [
                      _k,
                      {
                        total: _v.filter(d => typeof d.vote === 'boolean').length,
                        total_polls: _v.length,
                        votes: _.countBy(_v, 'vote'),
                      },
                    ];
                  })
              );

            return [
              k,
              {
                chains,
                total: _.sumBy(Object.values(chains), 'total'),
              },
            ];
          })
        );
    }
    else {
      polls = [];
    }
  }

  return {
    total: polls?.length || 0,
    data: voters,
  };
};