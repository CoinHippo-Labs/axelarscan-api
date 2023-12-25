const { bech32 } = require('bech32');
const { tmhash } = require('tendermint/lib/hash');
const { decodeBase64, getAddress, hexlify } = require('ethers');

const toHash = (string, length) => {
  try {
    return tmhash(string).slice(0, length).toString('hex').toUpperCase();
  } catch (error) {
    return null;
  }
};

const hexToBech32 = (address, prefix = 'axelar') => {
  try {
    return bech32.encode(prefix, bech32.toWords(Buffer.from(address, 'hex')));
  } catch (error) {
    return null;
  }
};

const bech32ToBech32 = (address, prefix) => bech32.encode(prefix, bech32.decode(address).words);

const _getAddress = (string, prefix = 'axelar', length = 20) => hexToBech32(toHash(string, length), prefix);

const getIcapAddress = string => {
  try {
    return string?.startsWith('0x') ? getAddress(string) : string;
  } catch (error) {
    return string;
  }
};

const base64ToHex = string => {
  try {
    return hexlify(decodeBase64(string));
  } catch (error) {
    return string;
  }
};

const toJson = string => {
  if (!string) return null;
  if (typeof string === 'object') return string;
  try {
    return JSON.parse(string);
  } catch (error) {
    return null;
  }
};

const toHex = byteArray => {
  let string = '0x';
  if (typeof byteArray === 'string' && byteArray.startsWith('[') && byteArray.endsWith(']')) byteArray = toJson(byteArray);
  if (Array.isArray(byteArray)) byteArray.forEach(byte => string += ('0' + (byte & 0xFF).toString(16)).slice(-2));
  else string = byteArray;
  return string;
};

const toCase = (string, _case = 'normal') => {
  if (typeof string !== 'string') return string;
  string = string.trim();
  switch (_case) {
    case 'upper':
      string = string.toUpperCase();
      break;
    case 'lower':
      string = string.toLowerCase();
      break;
    default:
      break;
  }
  return string;
};

const split = (string, options) => {
  let { delimiter, toCase: _toCase, filterBlank } = { ...options };
  delimiter = typeof delimiter === 'string' ? delimiter : ',';
  _toCase = _toCase || 'normal';
  filterBlank = typeof filterBlank === 'boolean' ? filterBlank : true;
  return (typeof string !== 'string' && ![undefined, null].includes(string) ? [string] : (typeof string === 'string' ? string : '').split(delimiter).map(s => toCase(s, _toCase))).filter(s => !filterBlank || s);
};

const toArray = (x, options) => {
  let { delimiter, toCase: _toCase, filterBlank } = { ...options };
  delimiter = typeof delimiter === 'string' ? delimiter : ',';
  _toCase = _toCase || 'normal';
  filterBlank = typeof filterBlank === 'boolean' ? filterBlank : true;
  if (Array.isArray(x)) return x.map(_x => toCase(_x, _toCase)).filter(_x => !filterBlank || _x);
  return split(x, { delimiter, toCase: _toCase, filterBlank });
};

module.exports = {
  toHash,
  hexToBech32,
  bech32ToBech32,
  getAddress: _getAddress,
  getIcapAddress,
  base64ToHex,
  toJson,
  toHex,
  toCase,
  split,
  toArray,
};