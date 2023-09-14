const { FixedNumber, formatUnits, isHexString, parseUnits: _parseUnits } = require('ethers');

const { split, toDecimal } = require('./');

const toBigNumber = number => {
  try {
    return number.round(0).toString().replace('.0', '');
  } catch (error) {
    return (isHexString(number?.hex) ? BigInt(number.hex) : isHexString(number) ? BigInt(number) : number)?.toString() || '0';
  }
};

const toFixedNumber = number => FixedNumber.fromString(number?.toString().includes('.') ? toDecimal(number.toString()) : toBigNumber(number));

const numberFormatUnits = (number, decimals = 6) => {
  try {
    return Number(formatUnits(parseInt(number || '0'), decimals));
  } catch (error) {
    if (number?.toString().length > 18) {
      return Number(formatUnits(number, 18));
    }
  }
};

const parseUnits = (number = 0, decimals = 18) => {
  try {
    number = number.toString();
    if (number.includes('.')) {
      const [_number, _decimals] = split(number, 'normal', '.');
      if (typeof _decimals === 'string' && _decimals.length > decimals) {
        let output = `${_number}${_decimals.substring(0, decimals)}`;
        while (output.length > 1 && output.startsWith('0')) {
          output = output.substring(1);
        }
        return output;
      }
    }
    return toBigNumber(_parseUnits(number, decimals));
  } catch (error) {
    return '0';
  }
};

module.exports = {
  toBigNumber,
  toFixedNumber,
  numberFormatUnits,
  parseUnits,
};