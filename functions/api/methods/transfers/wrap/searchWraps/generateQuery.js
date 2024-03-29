const { toArray } = require('../../../../utils');

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
              case 'depositAddress':
                if (v) {
                  obj = { match: { deposit_address: v } };
                }
                break;
              case 'txHash':
                if (v) {
                  obj = { match: { tx_hash: v } };
                }
                break;
              case 'txHashWrap':
                if (v) {
                  obj = { match: { tx_hash_wrap: v } };
                }
                break;
              case 'sourceChain':
                if (v) {
                  v = toArray(v);
                  obj = {
                    bool: {
                      should: v.map(c => {
                        return {
                          bool: {
                            must: [
                              { match: { source_chain: c } },
                            ],
                          },
                        };
                      }),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'destinationChain':
                if (v) {
                  v = toArray(v);
                  obj = {
                    bool: {
                      should: v.map(c => {
                        return {
                          bool: {
                            must: [
                              { match: { destination_chain: c } },
                            ],
                          },
                        };
                      }),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'recipientAddress':
                if (v) {
                  obj = { match: { recipient_address: v } };
                }
                break;
              case 'status':
                switch (v) {
                  case 'to_update':
                    obj = {
                      bool: {
                        must: [
                          { exists: { field: 'tx_hash' } },
                          { exists: { field: 'tx_hash_wrap' } },
                          { exists: { field: 'source_chain' } },
                          { exists: { field: 'destination_chain' } },
                          {
                            bool: {
                              should: [
                                {
                                  bool: {
                                    must_not: [
                                      { exists: { field: 'num_update_time' } },
                                    ],
                                  },
                                },
                                { range: { num_update_time: { lt: 3 } } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                        ],
                      },
                    };
                    break;
                  default:
                    break;
                }
                break;
              case 'fromTime':
                if (v) {
                  obj = { range: { updated_at: { gte: Number(v) * 1000 } } };
                }
                break;
              case 'toTime':
                if (v) {
                  obj = { range: { updated_at: { lte: Number(v) * 1000 } } };
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