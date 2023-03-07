const moment = require('moment');

const {
  read,
} = require('./index');

module.exports = async (
  params = {},
) => {
  const {
    chain,
    batchId,
    commandId,
    keyId,
    type,
    transactionHash,
    sourceTransactionHash,
    status,
    from,
    size,
    sort,
  } = { ...params };
  let {
    query,
    fromTime,
    toTime,
  } = { ...params };

  const must = [];
  const should = [];
  const must_not = [];

  if (chain) {
    must.push({ match: { chain } });
  }

  if (batchId) {
    must.push({ match: { batch_id: batchId } });
  }

  if (commandId) {
    must.push({ match: { command_ids: commandId } });
  }

  if (keyId) {
    must.push({ match: { key_id: keyId } });
  }

  if (type) {
    must.push({ match: { 'commands.type': type } });
  }

  if (transactionHash) {
    must.push({ match: { 'commands.transactionHash': transactionHash } });
  }

  if (sourceTransactionHash) {
    must.push({ match: { 'commands.params.sourceTxHash': sourceTransactionHash } });
  }

  if (status) {
    switch (status) {
      case 'executed':
        must.push({ match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } });
        must.push({ match: { 'commands.executed': true } });
        must_not.push({ match: { 'commands.executed': false } });
        break;
      case 'unexecuted':
        should.push({
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
        });
        should.push({ match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } });
        break;
      case 'signed':
      case 'signing':
      case 'aborted':
        must.push({ match: { status: `BATCHED_COMMANDS_STATUS_${status}` } });
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

  return (
    await read(
      'batches',
      query,
      {
        from: typeof from === 'number' ? from : 0,
        size: typeof size === 'number' ? size : 25,
        sort: sort || [{ 'created_at.ms': 'desc' }],
        track_total_hits: true,
      },
    )
  );
};