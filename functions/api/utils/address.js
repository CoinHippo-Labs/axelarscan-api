const {
  bech32,
} = require('bech32');
const {
  tmhash,
} = require('tendermint/lib/hash');

const to_hash = (
  string,
  length,
) => {
  try {
    return tmhash(string).slice(0, length).toString('hex').toUpperCase();
  } catch (error) {}

  return null;
};

const hex_to_bech32 = (
  address,
  prefix,
) => {
  try {
    return bech32.encode(prefix, bech32.toWords(Buffer.from(address, 'hex')));
  } catch (error) {}

  return null;
};

const get_address = (
  string,
  prefix,
  length = 20,
) =>
  hex_to_bech32(to_hash(string, length), prefix);

const is_operator_address = address => {
  const prefix = 'axelarvaloper1';

  try {
    if (typeof address === 'string' && address.startsWith(prefix)) {
      bech32.decode(address);
      return true;
    }
  } catch (error) {}

  return false;
};

module.exports = {
  to_hash,
  get_address,
  is_operator_address,
};