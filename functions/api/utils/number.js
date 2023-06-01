const { FixedNumber, formatUnits, isHexString } = require('ethers');

const toBigNumber = number => {
  try {
    return number.round(0).toString().replace('.0', '');
  } catch (error) {
    return (isHexString(number?.hex) ? BigInt(number.hex) : isHexString(number) ? BigInt(number) : number)?.toString() || '0';
  }
};

const toFixedNumber = number => FixedNumber.fromString(number?.toString().includes('.') ? number.toString() : toBigNumber(number));

const numberFormatUnits = (number, decimals = 6) => {
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
  toFixedNumber,
  numberFormatUnits,
};