const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const lcd = require('./lcd');
const {
  read,
  write,
} = require('./index');
const {
  equals_ignore_case,
  get_granularity,
} = require('../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );

module.exports = async (
  params = {},
) => {
  const {
    pollId,
    event,
    chain,
    status,
    transactionId,
    transferId,
    depositAddress,
    voter,
    vote,
    fromBlock,
    toBlock,
    from,
    size,
    sort,
  } = { ...params };
  let {
    query,
    fromTime,
    toTime,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (pollId) {
    must.push({ match: { _id: pollId } });
  }

  if (event) {
    must.push({ match: { event } });
  }

  if (chain) {
    must.push({ match: { sender_chain: chain } });
  }

  if (status) {
    switch (status) {
      case 'success':
      case 'completed':
        must.push({ match: { success: true } });
        break;
      case 'failed':
        must.push({ match: { failed: true } });
        must_not.push({ match: { success: true } });
        break;
      case 'confirmed':
        must.push({ match: { confirmation: true } });
        must_not.push({ match: { success: true } });
        must_not.push({ match: { failed: true } });
        break;
      case 'pending':
        must_not.push({ match: { confirmation: true } });
        must_not.push({ match: { success: true } });
        must_not.push({ match: { failed: true } });
        break;
      case 'not_pending':
        must.push({
          bool: {
            should: [
              { match: { success: true } },
              { match: { failed: true } },
              { match: { confirmation: true } },
            ],
            minimum_should_match: 1,
          },
        });
        break;
      case 'to_recover':
        must.push({ exists: { field: 'height' } });
        must.push({
          bool: {
            should: [
              {
                bool: {
                  must_not: [
                    { exists: { field: 'num_recover_time' } },
                  ],
                },
              },
              {
                range: {
                  num_recover_time: {
                    lt: 7,
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        });
        must.push({
          bool: {
            should: [
              {
                bool: {
                  must_not: [
                    { match: { confirmation: true } },
                    { match: { success: true } },
                    { match: { failed: true } },
                  ],
                },
              },
              {
                bool: {
                  must_not: [
                    { exists: { field: 'participants' } },
                  ],
                },
              },
              {
                bool: {
                  must_not: [
                    { exists: { field: 'event' } },
                  ],
                },
              },
            ],
            minimum_should_match: 1,
          },
        });
        break;
      default:
        break;
    }
  }

  if (transactionId) {
    must.push({ match: { transaction_id: transactionId } });
  }

  if (transferId) {
    must.push({ match: { transfer_id: transferId } });
  }

  if (depositAddress) {
    must.push({ match: { deposit_address: depositAddress } });
  }

  if (voter) {
    const _voter = voter.toLowerCase();

    const _response =
      await read(
        'axelard',
        {
          bool: {
            must: [
              { match: { type: 'proxy' } },
              { match: { stdout: _voter } },
            ],
          },
        },
        {
          size: 1,
        },
      );

    const operator_address =
      _.last(
        (_.head(_response?.data)?.id || '')
          .split(' ')
      );

    let start_proxy_height;

    if (
      [
        'unsubmitted',
      ].includes(vote)
    ) {
      const limit = 50;
      let page_key = true;
      let transactions_data = [];

      while (page_key) {
        const has_page_key =
          page_key &&
          typeof page_key !== 'boolean';

        const _response =
          await lcd(
            '/cosmos/tx/v1beta1/txs',
            {
              events: `message.action='RegisterProxy'`,
              'pagination.key':
                has_page_key ?
                  page_key :
                  undefined,
              'pagination.limit': limit,
              'pagination.offset':
                has_page_key ?
                  undefined :
                  transactions_data.length,
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

        const transaction_data = (tx_responses || [])
          .find((t, i) =>
            !t?.code &&
            (txs?.[i]?.body?.messages || [])
              .findIndex(m =>
                m?.['@type']?.includes('RegisterProxy') &&
                (
                  equals_ignore_case(
                    m.sender,
                    operator_address,
                  ) ||
                  equals_ignore_case(
                    m.proxy_addr,
                    voter,
                  )
                )
              ) > -1
          );

        const {
          height,
        } = { ...transaction_data };

        if (height) {
          start_proxy_height = Number(height);

          page_key = false;
        }
        else {
          transactions_data =
            _.concat(
              transactions_data,
              tx_responses ||
              [],
            );

          page_key =
            next_key ||
            tx_responses?.length === limit;
        }
      }
    }

    must.push({
      bool: {
        must: [
          start_proxy_height &&
          { range: { height: { gte: start_proxy_height } } },
        ]
        .filter(m => m),
        should: [
          { exists: { field: _voter } },
          operator_address &&
          { match: { participants: operator_address } },
          [
            'unsubmitted',
          ].includes(vote) &&
          {
            bool: {
              should: [
                { match: { success: true } },
                { match: { failed: true } },
              ],
              minimum_should_match: 1,
              must_not: [
                { exists: { field: 'participants' } },
              ],
            },
          },
        ]
        .filter(s => s),
        minimum_should_match: 1,
      },
    });
  
    if (vote) {
      switch (vote) {
        case 'yes':
          must.push({ match: { [`${_voter}.vote`]: true } });
          break;
        case 'no':
          must.push({ match: { [`${_voter}.vote`]: false } });
          break;
        case 'unsubmitted':
          must.push({
            bool: {
              must: [
                {
                  bool: {
                    should: [
                      { match: { success: true } },
                      { match: { failed: true } },
                      { match: { confirmation: true } },
                    ],
                  },
                },
              ],
              should: [
                { match: { participants: operator_address } },
                {
                  bool: {
                    must_not: [
                      { exists: { field: 'participants' } },
                    ],
                  },
                },
              ],
              minimum_should_match: 1,
              must_not: [
                { exists: { field: voter } },
              ],
            },
          });
          break;
        default:
          break;
      }
    }
  }

  if (
    fromBlock ||
    toBlock
  ) {
    const range = {};

    if (fromBlock) {
      range.gte = fromBlock;
    }

    if (toBlock) {
      range.lte = toBlock;
    }

    must.push({ range: { height: range } });
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime =
      toTime ?
        Number(toTime) * 1000 :
        moment()
          .valueOf();

    must.push({ range: { 'created_at.ms': { gte: fromTime, lte: toTime } } });
  }

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match:
          should.length > 0 ?
            1 :
            0,
      },
    };
  }

  const response =
    await read(
      'evm_polls',
      query,
      {
        from:
          typeof from === 'number' ?
            from :
            0,
        size:
          typeof size === 'number' ?
            size :
            25,
        sort:
          sort ||
          [{ 'created_at.ms': 'desc' }],
        track_total_hits: true,
      },
    );

  const {
    data,
  } = { ...response };

  if (Array.isArray(data)) {
    const _data =
      data
        .filter(d =>
          !(
            d?.success ||
            d?.confirmation
          ) &&
          Object.entries({ ...d })
            .filter(([k, v]) =>
              k?.startsWith(axelarnet.prefix_address) &&
              !v?.vote
            ).length > 20
        );

    for (const d of _data) {
      const {
        id,
      } = { ...d };

      const _d = {
        ...d,
        failed: true,
      };

      await write(
        'evm_polls',
        id,
        _d,
        true,
      );

      const index = data
        .findIndex(_d =>
          equals_ignore_case(
            _d?.id,
            id,
          )
        );

      if (index > -1) {
        data[index] = _d;
      }
    }

    if (status === 'to_recover') {
      for (const d of data) {
        const {
          id,
          failed,
        } = { ...d };
        let {
          num_recover_time,
        } = { ...d };

        num_recover_time =
          (typeof num_recover_time === 'number' ?
            num_recover_time :
            -1
          ) +
          1;

        const _d = {
          ...d,
          num_recover_time,
        }

        if (!failed) {
          await write(
            'evm_polls',
            id,
            _d,
            true,
          );

          const index = data
            .findIndex(_d =>
              equals_ignore_case(
                _d?.id,
                id,
              )
            );

          if (index > -1) {
            data[index] = _d;
          }
        }
      }
    }

    response.data =
      data
        .map(d => {
          let {
            created_at,
            updated_at,
          } = { ...d };

          const votes =
            Object.entries({ ...d })
              .filter(([k, v]) =>
                k?.startsWith(axelarnet.prefix_address)
              )
              .map(([k, v]) => v);

          updated_at =
            get_granularity(
              _.maxBy(
                votes,
                'created_at',
              )?.created_at
            ) ||
            updated_at ||
            created_at;

          created_at =
            get_granularity(
              _.minBy(
                votes,
                'created_at',
              )?.created_at
            ) ||
            created_at;

          return {
            ...d,
            created_at,
            updated_at,
          };
        });
  }

  return response;
};