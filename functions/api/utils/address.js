const {
  bech32,
} = require('bech32');
const {
  tmhash,
} = require('tendermint/lib/hash');

const hex_to_bech32 = (
  address,
  prefix,
) => bech32.encode(
  prefix,
  bech32.toWords(
    Buffer.from(
      address,
      'hex',
    ),
  ),
);

const get_address = (
  preImage,
  prefix,
) => hex_to_bech32(
  tmhash(preImage)
    .slice(0, 20)
    .toString('hex')
    .toUpperCase(),
  prefix,
);

module.exports = {
  get_address,
};