const {
  bech32,
} = require('bech32');
const {
  tmhash,
} = require('tendermint/lib/hash');

const to_hash = (
  string,
  length,
) =>
  tmhash(string)
    .slice(
      0,
      length,
    )
    .toString('hex')
    .toUpperCase();

const hex_to_bech32 = (
  address,
  prefix,
) =>
  bech32.encode(
    prefix,
    bech32.toWords(
      Buffer.from(
        address,
        'hex',
      ),
    ),
  );

const get_address = (
  string,
  prefix,
  length = 20,
) =>
  hex_to_bech32(
    to_hash(
      string,
      length,
    ),
    prefix,
  );

module.exports = {
  to_hash,
  get_address,
};