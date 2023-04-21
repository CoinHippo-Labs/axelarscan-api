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
              case 'sender':
                if (v) {
                  obj = { match: { sender: v } };
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