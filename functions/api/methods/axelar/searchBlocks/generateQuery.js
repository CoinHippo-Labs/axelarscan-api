const { toArray } = require('../../../utils');

module.exports = params => {
  const { query } = { ...params };
  return {
    bool: {
      must: toArray(
        Object.entries(params)
          .filter(([k, v]) =>
            ![
              'method',
              'query',
              'aggs',
              'fields',
              '_source',
              'from',
              'size',
              'sort',
            ]
            .includes(k)
          )
          .map(([k, v]) => {
            let obj;
            switch (k) {
              case 'fromBlock':
                if (v) {
                  obj = { range: { height: { gte: Number(v) } } };
                }
                break;
              case 'toBlock':
                if (v) {
                  obj = { range: { height: { lte: Number(v) } } };
                }
                break;
              default:
                break;
            }
            return obj;
          })
      ),
      ...query?.bool,
    },
  };
};