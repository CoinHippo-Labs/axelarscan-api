const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get_distinguish_chain_id,
  get_others_version_chain_ids,
} = require('./utils');
const {
  read,
} = require('../index');
const {
  equals_ignore_case,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );

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
    query,
  } = { ...params };

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
    must.push({ match_phrase: { 'send.denom': asset } });
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime =
      toTime ?
        Number(toTime) * 1000 :
        moment()
          .valueOf();

    must.push({ range: { 'send.created_at.ms': { gte: fromTime, lte: toTime } } });
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

  response =
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
          source_chains: {
            terms: { field: 'send.original_source_chain.keyword', size: 1000 },
            aggs: {
              destination_chains: {
                terms: { field: 'send.original_destination_chain.keyword', size: 1000 },
                aggs: {
                  assets: {
                    terms: { field: 'send.denom.keyword', size: 1000 },
                    aggs: {
                      volume: {
                        sum: { field: 'send.value' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        size: 0,
      },
    );

  const {
    source_chains,
  } = { ...response?.aggs };

  if (source_chains?.buckets) {
    response = {
      data:
        _.orderBy(
          source_chains.buckets
            .flatMap(s => {
              const {
                destination_chains,
              } = { ...s };

              s.key = get_distinguish_chain_id(s.key);

              return (
                (destination_chains?.buckets || [])
                  .flatMap(d => {
                    const {
                      assets,
                    } = { ...d };

                    d.key = get_distinguish_chain_id(d.key);

                    return (
                      (assets?.buckets || [])
                        .map(a => {
                          return {
                            id: `${s.key}_${d.key}_${a.key}`,
                            source_chain: s.key,
                            destination_chain: d.key,
                            asset: a.key,
                            num_txs: a.doc_count,
                            volume: a.volume?.value,
                          };
                        }) ||
                      [{
                        id: `${s.key}_${d.key}`,
                        source_chain: s.key,
                        destination_chain: d.key,
                        num_txs: d.doc_count,
                        volume: d.volume?.value,
                      }]
                    );
                  }) ||
                [{
                  id: `${s.key}`,
                  source_chain: s.key,
                  num_txs: s.doc_count,
                  volume: s.volume?.value,
                }]
              );
            }),
          [
            'volume',
            'num_txs',
          ],
          [
            'desc',
            'desc',
          ],
        ),
      total: response.total,
    };
  }

  return response;
};