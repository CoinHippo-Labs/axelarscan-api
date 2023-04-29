const _ = require('lodash');

const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  let output;

  const {
    status,
  } = { ...params };
  let {
    granularity,
  } = { ...params };

  granularity = granularity || 'month';

  if (params) {
    delete params.granularity;
  }

  const response =
    await searchTransfers(
      {
        ...params,
        status: status || 'confirmed',
        aggs: {
          cumulative_volume: {
            date_histogram: {
              field: `send.created_at.${granularity}`,
              calendar_interval: granularity,
            },
            aggs: {
              volume: { sum: { field: 'send.value' } },
              cumulative_volume: { cumulative_sum: { buckets_path: 'volume' } },
            },
          },
        },
        size: 0,
      },
    );

  const {
    aggs,
    total,
  } = { ...response };

  const {
    cumulative_volume,
  } = { ...aggs };

  const {
    buckets,
  } = { ...cumulative_volume };

  if (buckets) {
    output = {
      data:
        _.orderBy(
          buckets.map(b => {
            const {
              key,
              volume,
              cumulative_volume,
              doc_count,
            } = { ...b };

            return {
              timestamp: key,
              volume: volume?.value || 0,
              cumulative_volume: cumulative_volume?.value || 0,
              num_txs: doc_count,
            };
          }),
          ['timestamp'],
          ['asc'],
        ),
      total,
    };
  }
  else {
    output = response;
  }

  return output;
};