const {
  formatUnits,
  isHexString,
} = require('ethers');

const toBigNumber = number =>
  (isHexString(number?.hex) ?
    BigInt(number.hex) :
    isHexString(number) ?
      BigInt(number) :
      number
  )?.toString() || '0';

const numberFormatUnits = (
  number,
  decimals = 6,
) =>
  Number(formatUnits(parseInt(number || '0'), decimals));

module.exports = {
  toBigNumber,
  numberFormatUnits,
};