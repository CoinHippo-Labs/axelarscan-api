const {
  toArray,
} = require('../../../utils');

module.exports = output => {
  const {
    aggs,
  } = { ...output };

  const {
    buckets,
  } = { ...aggs?.types };

  if (buckets) {
    output = toArray(buckets).map(b => { return { key: b.key, count: b.doc_count }; });
  }

  return output;
};