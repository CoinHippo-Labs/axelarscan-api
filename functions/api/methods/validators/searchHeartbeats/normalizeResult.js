const {
  toArray,
} = require('../../../utils');

module.exports = data => {
  const {
    aggs,
  } = { ...data };

  const {
    buckets,
  } = { ...aggs?.heartbeats };

  if (buckets) {
    data =
      toArray(buckets).map(b => {
        const {
          key,
          period_height,
          doc_count,
        } = { ...b };

        return {
          key,
          count: period_height?.buckets && period_height?.buckets.length <= 100000 ? period_height.buckets.length : doc_count,
        };
      });
  }

  return data;
};