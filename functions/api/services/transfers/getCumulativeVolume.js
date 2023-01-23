const _ = require('lodash');
const moment = require('moment');
const {
  get_others_version_chain_ids,
} = require('./utils');
const {
  read,
} = require('../index');

module.exports = async (
  params = {},
) => {
  let response;

  const {
    sourceChain,
    destinationChain,
    asset,
  } = { ...params };
  let {
    fromTime,
    toTime,
    granularity,
    query,
  } = { ...params };

  granularity =
    granularity ||
    'month';

  const _query = _.cloneDeep(query);

  let must = [],
    should = [],
    must_not = [];

  if (sourceChain) {
    must.push({ match_phrase: { 'source.original_sender_chain': sourceChain } });

    for (const id of get_others_version_chain_ids(sourceChain)) {
      must_not.push({ match_phrase: { 'source.original_sender_chain': id } });
      must_not.push({ match_phrase: { 'source.sender_chain': id } });
    }
  }

  if (destinationChain) {
    must.push({ match_phrase: { 'source.original_recipient_chain': destinationChain } });

    for (const id of get_others_version_chain_ids(destinationChain)) {
      must_not.push({ match_phrase: { 'source.original_recipient_chain': id } });
      must_not.push({ match_phrase: { 'source.recipient_chain': id } });
    }
  }

  if (asset) {
    must.push({ match_phrase: { 'source.denom': asset } });
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime =
      toTime ?
        Number(toTime) * 1000 :
        moment()
          .valueOf();

    must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });
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

  let _response =
    await read(
      'transfers',
      {
        ...query,
        bool: {
          ...query.bool,
          should:
            _.concat(
              query.bool?.should ||
              [],
              { exists: { field: 'confirm_deposit' } },
              { exists: { field: 'vote' } },
            ),
          minimum_should_match: 1,
        },
      },
      {
        aggs: {
          cumulative_volume: {
            date_histogram: {
              field: `source.created_at.${granularity}`,
              calendar_interval: granularity,
            },
            aggs: {
              volume: {
                sum: {
                  field: 'source.value',
                },
              },
              cumulative_volume: {
                cumulative_sum: {
                  buckets_path: 'volume',
                },
              },
            },
          },
        },
        size: 0,
      },
    );

  const {
    aggs,
    total,
  } = { ..._response };
  const {
    cumulative_volume,
  } = { ...aggs };
  const {
    buckets,
  } = { ...cumulative_volume };

  if (buckets) {
    _response = {
      data:
        buckets
          .map(c => {
            const {
              key,
              volume,
              cumulative_volume,
              doc_count,
            } = { ...c };

            return {
              timestamp: key,
              volume:
                volume?.value ||
                0,
              cumulative_volume:
                cumulative_volume?.value ||
                0,
              num_txs: doc_count,
            };
          }),
      total,
    };

    response = {
      ..._response,
    };
  }

  if (!_query) {
    must = [];
    should = [];
    must_not = [];

    if (sourceChain) {
      must.push({ match_phrase: { 'event.chain': sourceChain } });

      for (const id of get_others_version_chain_ids(sourceChain)) {
        must_not.push({ match_phrase: { 'event.chain': id } });
      }
    }

    if (destinationChain) {
      must.push({ match_phrase: { 'event.returnValues.destinationChain': destinationChain } });

      for (const id of get_others_version_chain_ids(destinationChain)) {
        must_not.push({ match_phrase: { 'event.returnValues.destinationChain': id } });
      }
    }

    if (asset) {
      must.push({ match_phrase: { 'event.denom': asset } });
    }

    if (fromTime) {
      fromTime /= 1000;
      toTime /= 1000;

      must.push({ range: { 'event.block_timestamp': { gte: fromTime, lte: toTime } } });
    }

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

    let _response =
      await read(
        'token_sent_events',
        query,
        {
          aggs: {
            cumulative_volume: {
              date_histogram: {
                field: `event.created_at.${granularity}`,
                calendar_interval: granularity,
              },
              aggs: {
                volume: {
                  sum: {
                    field: 'event.value',
                  },
                },
                cumulative_volume: {
                  cumulative_sum: {
                    buckets_path: 'volume',
                  },
                },
              },
            },
          },
          size: 0,
        },
      );

    const {
      aggs,
      total,
    } = { ..._response };
    const {
      cumulative_volume,
    } = { ...aggs };
    const {
      buckets,
    } = { ...cumulative_volume };

    if (buckets) {
      _response = {
        data:
          buckets
            .map(c => {
              const {
                key,
                volume,
                cumulative_volume,
                doc_count,
              } = { ...c };

              return {
                timestamp: key,
                volume:
                  volume?.value ||
                  0,
                cumulative_volume:
                  cumulative_volume?.value ||
                  0,
                num_txs: doc_count,
              };
            }),
        total,
      };
    }

    response = {
      ...response,
      data:
        Object.entries(
          _.groupBy(
            _.concat(
              response?.data ||
              [],
              _response?.data ||
              [],
            ),
            'timestamp',
          )
        )
        .map(([k, v]) => {
          return {
            ..._.head(v),
            volume:
              _.sumBy(
                v,
                'volume',
              ),
            cumulative_volume:
              _.sumBy(
                v,
                'cumulative_volume',
              ),
            num_txs:
              _.sumBy(
                v,
                'num_txs',
              ),
          };
        }),
      total:
        (
          response?.total ||
          0
        ) +
        (
          _response?.total ||
          0
        ),
    };
  }

  return response;
};