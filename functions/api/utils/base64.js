const {
  decodeBase64,
  hexlify,
  toUtf8String,
} = require('ethers');

const base64ToHex = string => {
  try {
    return Buffer.from(string, 'base64').toString('hex');
  } catch (error) {
    return string;
  }
};

const base64ToHash = string => {
  try {
    return hexlify(decodeBase64(string));
  } catch (error) {
    return string;
  }
};

const base64ToString = string => {
  try {
    return toUtf8String(decodeBase64(string));
  } catch (error) {
    return string;
  }
};

module.exports = {
  base64ToHex,
  base64ToHash,
  base64ToString,
};