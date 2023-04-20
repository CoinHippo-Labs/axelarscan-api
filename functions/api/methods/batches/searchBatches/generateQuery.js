module.exports = params => {
  const {
    query,
  } = { ...params };

  return {
    bool: {
      must:
        Object.entries(params)
          .filter(([k, v]) =>
            ![
              'method',
              'query',
              'aggs',
              'from',
              'size',
              'sort',
            ]
            .includes(k)
          )
          .map(([k, v]) => {
            let obj;

            switch (k) {
              case 'chain':
                if (v) {
                  obj = { match: { chain: v } };
                }
                break;
              case 'batchId':
                if (v) {
                  obj = { match: { batch_id: v } };
                }
                break;
              case 'commandId':
                if (v) {
                  if (v.startsWith('0x')) {
                    v = v.substring(2);
                  }
                  obj = { match: { command_ids: v } };
                }
                break;
              case 'keyId':
                if (v) {
                  obj = { match: { key_id: v } };
                }
                break;
              case 'type':
                if (v) {
                  obj = { match: { 'commands.type': v } };
                }
                break;
              case 'transactionHash':
                if (v) {
                  obj = { match: { 'commands.transactionHash': v } };
                }
                break;
              case 'sourceTransactionHash':
                if (v) {
                  obj = { match: { 'commands.sourceTxHash': v } };
                }
                break;
              case 'status':
                switch (v) {
                  case 'executed':
                    obj = {
                      bool: {
                        must: [
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                          { match: { 'commands.executed': true } },
                        ],
                        must_not: [
                          { match: { 'commands.executed': false } },
                        ],
                      },
                    };
                    break;
                  case 'unexecuted':
                    obj = {
                      bool: {
                        should: [
                          {
                            bool: {
                              must: [
                                { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                              ],
                              should: [
                                { match: { 'commands.executed': false } },
                                {
                                  bool: {
                                    must_not: [
                                      { exists: { field: 'commands.executed' } },
                                    ],
                                  },
                                },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                        ],
                        minimum_should_match: 1,
                      },
                    };
                    break;
                  case 'signed':
                  case 'signing':
                  case 'aborted':
                    obj = { match: { status: `BATCHED_COMMANDS_STATUS_${v.toUpperCase()}` } };
                    break;
                  default:
                    break;
                }
                break;
              case 'fromTime':
                if (v) {
                  obj = { range: { 'created_at.ms': { gte: Number(v) * 1000 } } };
                }
                break;
              case 'toTime':
                if (v) {
                  obj = { range: { 'created_at.ms': { lte: Number(v) * 1000 } } };
                }
                break;
              default:
                break;
            }

            return obj;
          })
          .filter(q => q),
      ...query?.bool,
    },
  };
};