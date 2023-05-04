const {
  getChainData,
} = require('../../../utils/config');
const {
  base64ToBech32,
} = require('../../../utils/bech32');
const {
  toArray,
} = require('../../../utils');

module.exports = output => {
  const {
    data,
    aggs,
    total,
  } = { ...output };

  const {
    buckets,
  } = { ...aggs?.uptimes };

  const {
    prefix_address,
  } = { ...getChainData('axelarnet') };

  if (buckets) {
    output = {
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
  else if (data) {
    output = {
      ...output,
      data: toArray(data).map(d => { return { ...d, validators: toArray(d.validators).map(a => base64ToBech32(a, `${prefix_address}valcons`)) }; }),
    };
  }

  return output;
};