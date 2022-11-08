const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('./index');
const {
  equals_ignore_case,
} = require('../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  params = {},
) => {
  const {
    pollId,
    chain,
    status,
    transactionId,
    transferId,
    depositAddress,
    voter,
    vote,
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
      case 'comfirmed':
        must.push({ match: { confirmation: true } });
        must_not.push({ match: { success: true } });
        must_not.push({ match: { failed: true } });
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
      ].includes(vote) &&
      endpoints?.lcd
    ) {
      const lcd = axios.create(
        {
          baseURL: endpoints.lcd,
          timeout: 3000,
        },
      );

      const limit = 50;
      let page_key = true;
      let transactions_data = [];

      while (page_key) {
        const has_page_key =
          page_key &&
          typeof page_key !== 'boolean';

        const _response = await lcd.get(
          '/cosmos/tx/v1beta1/txs',
          {
            params: {
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
          },
        ).catch(error => { return { data: { error } }; });

        const {
          tx_responses,
          txs,
          pagination,
        } = { ..._response?.data };
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

  return await read(
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
};