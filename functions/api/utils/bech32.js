const { bech32 } = require('bech32');
const { tmhash } = require('tendermint/lib/hash');

const { base64ToHex } = require('./base64');

const hexToBech32 = (address, prefix) => bech32.encode(prefix, bech32.toWords(Buffer.from(address, 'hex')));
const base64ToBech32 = (address, prefix) => hexToBech32(base64ToHex(address), prefix);
const bech32ToBech32 = (address, prefix) => bech32.encode(prefix, bech32.decode(address).words);
const pubKeyToBech32 = (pubKey, prefix) => hexToBech32(tmhash(Buffer.from(pubKey, 'base64')).slice(0, 20).toString('hex').toUpperCase(), prefix);

module.exports = {
  hexToBech32,
  base64ToBech32,
  bech32ToBech32,
  pubKeyToBech32,
};