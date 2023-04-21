const {
  getChainData,
} = require('../../../utils/config');
const {
  base64ToBech32,
} = require('../../../utils/bech32');
const {
  toArray,
} = require('../../../utils');

module.exports = data => {
  const {
    aggs,
    total,
  } = { ...data };

  const {
    buckets,
  } = { ...aggs?.uptimes };

  if (buckets) {
    const {
      prefix_address,
    } = { ...getChainData('axelarnet') };

    data = {
      data:
        Object.fromEntries(
          toArray(buckets)
            .map(b => {
              const {
                key,
                doc_count,
              } = { ...b };

              return [base64ToBech32(key, `${prefix_address}valcons`), doc_count];
            })
        ),
      total,
    };
  }

  return data;
};