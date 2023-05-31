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
              case 'txHash':
                if (v) {
                  obj = { match: { txhash: v } };
                }
                break;
              case 'type':
                if (v) {
                  obj = { match: { types: v } };
                }
                break;
              case 'address':
                if (v) {
                  obj = { match: { addresses: v } };
                }
                break;
              case 'status':
                if (v) {
                  switch (v) {
                    case 'success':
                      obj = { match: { code: 0 } };
                      break;
                    case 'failed':
                      obj = {
                        bool: {
                          must_not: [
                            { match: { code: 0 } },
                          ],
                        },
                      };
                      break;
                    default:
                      break;
                  }
                }
                break;
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
              case 'fromTime':
                if (v) {
                  obj = { range: { timestamp: { gte: Number(v) * 1000 } } };
                }
                break;
              case 'toTime':
                if (v) {
                  obj = { range: { timestamp: { lte: Number(v) * 1000 } } };
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