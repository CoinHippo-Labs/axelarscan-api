const {
  decodeBase64,
  hexlify,
  toUtf8String,
} = require('ethers');

const base64ToHex = string => {
  try {
    return hexlify(decodeBase64(string));
  } catch (error) {
    return string;
  }
};

const base64ToString = (string = 'c3BlbmRlcg==') => {
  try {
    return toUtf8String(decodeBase64(string));
  } catch (error) {
    return string;
  }
};

module.exports = {
  base64ToHex,
  base64ToString,
};