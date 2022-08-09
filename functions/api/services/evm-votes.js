const { crud } = require('./index');

module.exports = async (params = {}) => {
  const {
    chain,
    txHash,
    pollId,
    transactionId,
    voter,
    vote,
    from,
    size,
    sort,
  } = { ...params };
  let {
    query,
    fromTime,
    toTime,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (chain) {
    must.push({ match: { sender_chain: chain } });
  }
  if (txHash) {
    must.push({ match: { txhash: txHash } });
  }
  if (pollId) {
    must.push({ match_phrase: { poll_id: pollId } });
  }
  if (transactionId) {
    must.push({ match: { transaction_id: transactionId } });
  }
  if (voter) {
    must.push({ match: { voter } });
  }
  if (vote) {
    switch (vote) {
      case 'yes':
      case 'no':
        must.push({ match: { vote: vote === 'yes' } });
        break;
      default:
        break;
    }
  }
  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime = toTime ? Number(toTime) * 1000 : moment().valueOf();
    must.push({ range: { 'created_at.ms': { gte: fromTime, lte: toTime } } });
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

  return await crud({
    collection: 'evm_votes',
    method: 'search',
    query,
    from: typeof from === 'number' ? from : 0,
    size: typeof size === 'number' ? size : 100,
    sort: sort || [{ 'created_at.ms': 'desc' }],
    track_total_hits: true,
  });
};