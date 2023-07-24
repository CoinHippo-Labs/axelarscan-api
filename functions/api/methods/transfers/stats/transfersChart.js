const _ = require('lodash');

const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  let output;

  const { status } = { ...params };
  let { granularity } = { ...params };
  granularity = granularity || 'day';
  if (params) {
    delete params.granularity;
  }

  const response = await searchTransfers({
    ...params,
    status: status || 'confirmed',
    aggs: {
      stats: {
        terms: { field: `send.created_at.${granularity}`, size: 1000 },
        aggs: {
          volume: { sum: { field: 'send.value' } },
          fee: { sum: { field: 'send.fee_value' } },
          users: { cardinality: { field: 'send.sender_address.keyword' } },
        },
      },
    },
    size: 0,
  });
  const { aggs, total } = { ...response };
  const { stats } = { ...aggs };
  const { buckets } = { ...stats };

  if (buckets) {
    output = {
      data: _.orderBy(
        buckets.map(b => {
          const { key, volume, fee, users, doc_count } = { ...b };
          return {
            timestamp: key,
            volume: volume?.value || 0,
            fee: fee?.value || 0,
            users: users?.value || 0,
            num_txs: doc_count,
          };
        }),
        ['timestamp'], ['asc'],
      ),
      total,
    };
  }
  else {
    output = response;
  }

  return output;
};