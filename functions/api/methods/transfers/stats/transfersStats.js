const _ = require('lodash');

const searchTransfers = require('../searchTransfers');
const { toArray } = require('../../../utils');

module.exports = async params => {
  let output;

  const { status } = { ...params };
  const response = await searchTransfers({
    ...params,
    status: status || 'confirmed',
    aggs: {
      source_chains: {
        terms: { field: 'send.original_source_chain.keyword', size: 1000 },
        aggs: {
          destination_chains: {
            terms: { field: 'send.original_destination_chain.keyword', size: 1000 },
            aggs: {
              assets: {
                terms: { field: 'send.denom.keyword', size: 1000 },
                aggs: { volume: { sum: { field: 'send.value' } } },
              },
            },
          },
        },
      },
      types: {
        terms: { field: 'type.keyword', size: 10 },
      },
    },
    size: 0,
  });
  const { aggs, total } = { ...response };
  const { source_chains } = { ...aggs };
  let { types } = { ...aggs };
  const { buckets } = { ...source_chains };

  if (buckets) {
    if (types) {
      types = toArray(types?.buckets).map(b => {
        const { key, doc_count } = { ...b };
        return {
          key,
          num_txs: doc_count,
        };
      });

      const num_without_type = total - _.sumBy(types, 'num_txs');
      if (num_without_type > 0) {
        const index = types.findIndex(d => d.key === 'deposit_address');
        if (index > -1) {
          types[index].num_txs += num_without_type;
        }
        else {
          types.push({ key: 'deposit_address', num_txs: num_without_type });
        }
      }
    }

    output = {
      data: _.orderBy(
        buckets.flatMap(b =>
          toArray(b.destination_chains?.buckets).flatMap(d =>
            toArray(d.assets?.buckets).map(a => {
              const { volume, doc_count } = { ...a };
              return {
                id: [b.key, d.key, a.key].join('_'),
                source_chain: b.key,
                destination_chain: d.key,
                asset: a.key,
                num_txs: doc_count,
                volume: volume?.value || 0,
              };
            })
          )
        ),
        ['volume', 'num_txs'], ['desc', 'desc'],
      ),
      types,
      total,
    };
  }
  else {
    output = response;
  }

  return output;
};