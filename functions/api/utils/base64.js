const {
  decodeBase64,
  hexlify,
} = require('ethers');

const base64ToHex = string => {
  try {
    return hexlify(decodeBase64(string));
  } catch (error) {}

  return string;
};

module.exports = {
  base64ToHex,
};