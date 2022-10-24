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
    'day';

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

  fromTime = fromTime ?
    Number(fromTime) * 1000 :
    moment()
      .subtract(
        30,
        'days',
      )
      .valueOf();
  toTime = toTime ?
    Number(toTime) * 1000 :
    moment()
      .valueOf();
  must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match: should.length > 0 ?
          1 :
          0,
      },
    };
  }

  let _response = await read(
    'transfers',
    {
      ...query,
      bool: {
        ...query.bool,
        must: _.concat(
          query.bool?.must ||
          [],
          { exists: { field: 'confirm_deposit' } },
        ),
      },
    },
    {
      aggs: {
        stats: {
          terms: { field: `source.created_at.${granularity}`, size: 1000 },
          aggs: {
            volume: {
              sum: {
                field: 'source.value',
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
    stats,
  } = { ...aggs };
  const {
    buckets,
  } = { ...stats };

  if (buckets) {
    _response = {
      data: _.orderBy(
        buckets
          .map(c => {
            const {
              key,
              volume,
              doc_count,
            } = { ...c };

            return {
              timestamp: key,
              volume:
                volume?.value ||
                0,
              num_txs: doc_count,
            };
          }),
        ['timestamp'],
        ['asc'],
      ),
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
        minimum_should_match: should.length > 0 ?
          1 :
          0,
      },
    };

    let _response = await read(
      'token_sent_events',
      query,
      {
        aggs: {
          stats: {
            terms: { field: `event.created_at.${granularity}`, size: 1000 },
            aggs: {
              volume: {
                sum: {
                  field: 'event.value',
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
      stats,
    } = { ...aggs };
    const {
      buckets,
    } = { ...stats };

    if (buckets) {
      _response = {
        data: _.orderBy(
          buckets
            .map(c => {
              const {
                key,
                volume,
                doc_count,
              } = { ...c };

              return {
                timestamp: key,
                volume:
                  volume?.value ||
                  0,
                num_txs: doc_count,
              };
            }),
          ['timestamp'],
          ['asc'],
        ),
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
            volume: _.sumBy(
              v,
              'volume',
            ),
            num_txs: _.sumBy(
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