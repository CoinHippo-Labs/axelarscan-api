const {
  toArray,
} = require('../../../utils');

module.exports = data => {
  const {
    aggs,
  } = { ...data };

  const {
    buckets,
  } = { ...aggs?.types };

  if (buckets) {
    data = toArray(buckets).map(b => { return { key: b.key, count: b.doc_count }; });
  }

  return data;
};