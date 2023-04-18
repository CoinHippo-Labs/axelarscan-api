const {
  isHexString,
} = require('ethers');

const toBigNumber = number =>
  (isHexString(number?.hex) ?
    BigInt(number.hex) :
    isHexString(number) ?
      BigInt(number) :
      number
  )?.toString() || '0';

module.exports = {
  toBigNumber,
};