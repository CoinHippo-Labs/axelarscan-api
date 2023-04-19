const {
  bech32,
} = require('bech32');
const {
  tmhash,
} = require('tendermint/lib/hash');

const toHash = (
  string,
  length,
) => {
  try {
    return tmhash(string).slice(0, length).toString('hex').toUpperCase();
  } catch (error) {
    return null;
  }
};

const hexToBech32 = (
  address,
  prefix = 'axelar',
) => {
  try {
    return bech32.encode(prefix, bech32.toWords(Buffer.from(address, 'hex')));
  } catch (error) {
    return null;
  }
};

const getAddress = (
  string,
  prefix = 'axelar',
  length = 20,
) =>
  hexToBech32(toHash(string, length), prefix);

const isOperatorAddress = (
  address,
  prefix = 'axelarvaloper1',
) => {
  try {
    if (typeof address === 'string' && address.startsWith(prefix)) {
      bech32.decode(address);
      return true;
    }
  } catch (error) {}
  return false;
};

module.exports = {
  toHash,
  getAddress,
  isOperatorAddress,
};