const normalize_obj = object =>
  Array.isArray(object) ?
    object :
    Object.fromEntries(
      Object.entries(object)
        .map(([k, v]) =>
          [
            k,
            typeof v === 'object' ?
              normalize_obj(v) :
              typeof v === 'boolean' ?
                v :
                !isNaN(v) ?
                  Number(v) :
                  v,
          ]
        )
    );

const transfer_collections = [
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
  normalize_obj,
  transfer_collections,
};