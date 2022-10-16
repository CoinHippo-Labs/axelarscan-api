const {
  read,
} = require('./index');

module.exports = async (
  params = {},
) => {
  const {
    sender,
    fromBlock,
    toBlock,
    from,
    size,
    sort,
  } = { ...params };
  let {
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (sender) {
    must.push({ match: { sender } });
  }
  if (
    fromBlock ||
    toBlock
  ) {
    const range = {};
    if (fromBlock) {
      range.gte = fromBlock;
    }
    if (toBlock) {
      range.lte = toBlock;
    }
    must.push({ range: { height: range } });
  }
  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match: should.length > 0 ? 1 : 0,
      },
    };
  }

  return await read(
    'heartbeats',
    query,
    {
      from: typeof from === 'number' ?
        from :
        0,
      size: typeof size === 'number' ?
        size :
        200,
      sort: sort ||
        [{ period_height: 'desc' }],
      track_total_hits: true,
    },
  );
};