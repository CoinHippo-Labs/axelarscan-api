const normalizeObject = object =>
  Array.isArray(object) ?
    object :
    Object.fromEntries(
      Object.entries(object)
        .map(([k, v]) =>
          [
            k,
            typeof v === 'object' ?
              normalizeObject(v) :
              typeof v === 'boolean' ?
                v :
                !isNaN(v) ?
                  Number(v) :
                  v,
          ]
        )
    );

const transferCollections = [
  'cross_chain_transfers',
  'deposit_addresses',
  'wraps',
  'unwraps',
  'erc20_transfers',
  'batches',
  'command_events',
  'ibc_channels',
  'tvls',
  'assets',
  'transfers',
  'token_sent_events',
];

module.exports = {
  normalizeObject,
  transferCollections,
};