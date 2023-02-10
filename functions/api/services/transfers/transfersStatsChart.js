const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get_others_version_chain_ids,
} = require('./utils');
const {
  read,
} = require('../index');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const assets_data =
  require('../../data')?.assets?.[environment] ||
  [];

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
    must.push({ match_phrase: { 'send.original_source_chain': sourceChain } });

    for (const id of get_others_version_chain_ids(sourceChain)) {
      must_not.push({ match_phrase: { 'send.original_source_chain': id } });
      must_not.push({ match_phrase: { 'send.source_chain': id } });
    }
  }

  if (destinationChain) {
    must.push({ match_phrase: { 'send.original_destination_chain': destinationChain } });

    for (const id of get_others_version_chain_ids(destinationChain)) {
      must_not.push({ match_phrase: { 'send.original_destination_chain': id } });
      must_not.push({ match_phrase: { 'send.destination_chain': id } });
    }
  }

  if (asset) {
    if (
      asset.endsWith('-wei') &&
      assets_data
        .findIndex(a =>
          a?.id === `w${asset}`
        ) > -1
    ) {
      must
        .push(
          {
            bool: {
              should:
                [
                  { match_phrase: { 'send.denom': asset } },
                  {
                    bool: {
                      must:
                        [
                          { match_phrase: { 'send.denom': `w${asset}` } },
                        ],
                      should:
                        [
                          { match: { type: 'wrap' } },
                          { match: { type: 'unwrap' } },
                        ],
                      minimum_should_match: 1,
                    },
                  },
                ],
              minimum_should_match: 1,
            },
          }
        );
    }
    else {
      must.push({ match_phrase: { 'send.denom': asset } });
    }
  }

  fromTime =
    fromTime ?
      Number(fromTime) * 1000 :
      moment()
        .subtract(
          30,
          'days',
        )
        .valueOf();

  toTime =
    toTime ?
      Number(toTime) * 1000 :
      moment()
        .valueOf();

  must.push({ range: { 'send.created_at.ms': { gte: fromTime, lte: toTime } } });

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
      'cross_chain_transfers',
      {
        ...query,
        bool: {
          ...query.bool,
          should:
            _.concat(
              query.bool?.should ||
              [],
              { exists: { field: 'confirm' } },
              { exists: { field: 'vote' } },
            ),
          minimum_should_match: 1,
        },
      },
      {
        aggs: {
          stats: {
            terms: { field: `send.created_at.${granularity}`, size: 1000 },
            aggs: {
              volume: {
                sum: {
                  field: 'send.value',
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
      data:
        _.orderBy(
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

  return response;
};