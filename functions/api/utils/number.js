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
) => {
  try {
    return Number(formatUnits(parseInt(number || '0'), decimals));
  } catch (error) {
    if (number?.toString().length > 18) {
      return Number(formatUnits(number, 18));
    }
  }
};

module.exports = {
  toBigNumber,
  numberFormatUnits,
};