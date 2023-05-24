const _ = require('lodash');

const searchTransfers = require('../searchTransfers');
const {
  toArray,
} = require('../../../utils');

module.exports = async params => {
  let output;

  const {
    status,
  } = { ...params };

  const response =
    await searchTransfers(
      {
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
      },
    );

  const {
    aggs,
    total,
  } = { ...response };

  const {
    source_chains,
    types,
  } = { ...aggs };

  const {
    buckets,
  } = { ...source_chains };

  if (buckets) {
    output = {
      data: _.orderBy(
        buckets.flatMap(b => {
          const {
            destination_chains,
          } = { ...b };

          return (
            toArray(destination_chains?.buckets).flatMap(_b => {
              const {
                assets,
              } = { ..._b };

              return (
                toArray(assets?.buckets).map(__b => {
                  const {
                    volume,
                    doc_count,
                  } = { ...__b };

                  return {
                    id: [b.key, _b.key, __b.key].join('_'),
                    source_chain: b.key,
                    destination_chain: _b.key,
                    asset: __b.key,
                    num_txs: doc_count,
                    volume: volume?.value || 0,
                  };
                })
              );
            })
          );
        }),
        ['volume', 'num_txs'],
        ['desc', 'desc'],
      ),
      types:
        toArray(types?.buckets).map(b => {
          const {
            key,
            doc_count,
          } = { ...b };

          return {
            key,
            num_txs: doc_count,
          };
        }),
      total,
    };
  }
  else {
    output = response;
  }

  return output;
};