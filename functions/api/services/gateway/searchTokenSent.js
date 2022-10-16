const moment = require('moment');
const {
  read,
} = require('../index');

module.exports = async (
  params = {},
) => {
  let response;

  const {
    txHash,
    sourceChain,
    destinationChain,
    asset,
    senderAddress,
    recipientAddress,
    fromTime,
    from,
    size,
    sort,
  } = { ...params };
  let {
    toTime,
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (txHash) {
    must.push({ match: { 'event.transactionHash': txHash } });
  }
  if (sourceChain) {
    must.push({ match: { 'event.chain': sourceChain } });
  }
  if (destinationChain) {
    must.push({ match: { 'event.returnValues.destinationChain': destinationChain } });
  }
  if (asset) {
    must.push({ match: { 'event.returnValues.asset': asset } });
  }
  if (senderAddress) {
    should.push({ match: { 'event.transaction.from': senderAddress } });
    should.push({ match: { 'event.receipt.from': senderAddress } });
  }
  if (recipientAddress) {
    must.push({ match: { 'event.returnValues.destinationAddress': recipientAddress } });
  }
  if (fromTime) {
    fromTime = Number(fromTime);
    toTime = toTime ?
      Number(toTime) :
      moment().unix();
    must.push({ range: { 'event.block_timestamp': { gte: fromTime, lte: toTime } } });
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

  response = await read(
    'token_sent_events',
    query,
    {
      from: typeof from === 'number' ?
        from :
        0,
      size: typeof size === 'number' ?
        size :
        100,
      sort: sort ||
        [{ 'event.block_timestamp': 'desc' }],
    },
  );

  return response;
};