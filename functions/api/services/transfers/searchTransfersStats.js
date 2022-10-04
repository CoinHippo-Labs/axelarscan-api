const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get_distinguish_chain_id,
} = require('./utils');
const {
  read,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const data = require('../../data');
const evm_chains_data = data?.chains?.[environment]?.evm || [];
const cosmos_chains_data = data?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);

module.exports = async (
  params = {},
) => {
  let response;

  let {
    fromTime,
    toTime,
    query,
  } = { ...params };

  const _query = _.cloneDeep(query);

  const must = [],
    should = [],
    must_not = [];

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime = toTime ?
      Number(toTime) * 1000 :
      moment().valueOf();
    must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });
  }

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match: should.length > 0 ? 1 : 0,
      },
    };
  }

  response = await read(
    'transfers',
    {
      ...query,
      bool: {
        ...query.bool,
        must: _.concat(
          query.bool?.must || [],
          { exists: { field: 'confirm_deposit' } },
        ),
      },
    },
    {
      aggs: {
        source_chains: {
          terms: { field: 'source.original_sender_chain.keyword', size: 1000 },
          aggs: {
            destination_chains: {
              terms: { field: 'source.original_recipient_chain.keyword', size: 1000 },
              aggs: {
                assets: {
                  terms: { field: 'source.denom.keyword', size: 1000 },
                  aggs: {
                    volume: {
                      sum: { field: 'source.value' },
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
      data: _.orderBy(
        source_chains.buckets
          .flatMap(s => {
            const {
              destination_chains,
            } = { ...s };

            s.key = get_distinguish_chain_id(s.key);

            return destination_chains?.buckets?.flatMap(d => {
              const {
                assets,
              } = { ...d };

              d.key = get_distinguish_chain_id(d.key);

              return assets?.buckets?.map(a => {
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
              }];
            }) ||
            [{
              id: `${s.key}`,
              source_chain: s.key,
              num_txs: s.doc_count,
              volume: s.volume?.value,
            }];
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

    if (!_query) {
      if (fromTime) {
        fromTime /= 1000;
        toTime /= 1000;
        query = {
          range: { 'event.block_timestamp': { gte: fromTime, lte: toTime } },
        };
      }

      const _response = await read(
        'token_sent_events',
        query,
        {
          aggs: {
            source_chains: {
              terms: { field: 'event.chain.keyword', size: 1000 },
              aggs: {
                destination_chains: {
                  terms: { field: 'event.returnValues.destinationChain.keyword', size: 1000 },
                  aggs: {
                    assets: {
                      terms: { field: 'event.denom.keyword', size: 1000 },
                      aggs: {
                        volume: {
                          sum: { field: 'event.value' },
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

      if (_response?.aggs?.source_chains?.buckets) {
        response = {
          ...response,
          data: _.orderBy(
            Object.entries(
              _.groupBy(
                _.concat(
                  response.data,
                  _response.aggs.source_chains.buckets.flatMap(s => {
                    const {
                      destination_chains,
                    } = { ...s };

                    return destination_chains?.buckets?.flatMap(d => {
                      const {
                        assets,
                      } = { ...d };

                      d.key = chains_data.find(c =>
                        equals_ignore_case(c?.id, d.key) ||
                        c?.overrides?.[d.key] ||
                        c?.prefix_chain_ids?.findIndex(p => d.key?.startsWith(p)) > -1
                      )?.id ||
                        d.key;

                      return assets?.buckets?.map(a => {
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
                      }];
                    }) ||
                    [{
                      id: `${s.key}`,
                      source_chain: s.key,
                      num_txs: s.doc_count,
                      volume: s.volume?.value,
                    }];
                  }),
                ),
                'id',
              )
            ).map(([k, v]) => {
              return {
                ..._.head(v),
                id: k,
                num_txs: _.sumBy(
                  v,
                  'num_txs',
                ),
                volume: _.sumBy(
                  v,
                  'volume',
                ),
              };
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
          total:
            (response.total || 0) +
            (_response.total || 0),
        };
      }
    }
  }

  return response;
};