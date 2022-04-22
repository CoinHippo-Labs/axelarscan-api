const BigNumber = require('bignumber.js');

BigNumber.config({ DECIMAL_PLACES: Number(40), EXPONENTIAL_AT: [-7, Number(40)] });

module.exports = () => {
  const module = {};
  module.fee_denom = 'uaxl';
  module.getDenom = (denom, denoms) => denoms?.find(d => [d?.id?.toLowerCase()].concat(Array.isArray(d?.ibc) ? d.ibc.map(ibc => ibc?.ibc_denom?.toLowerCase()) : d?.ibc?.toLowerCase()).includes(denom?.toLowerCase()));
  module.denomer = {
    id: (denom, denoms) => module.getDenom(denom, denoms)?.id || denom,
    symbol: (denom, denoms) => module.getDenom(denom, denoms)?.symbol || denom,
    title: (denom, denoms) => module.getDenom(denom, denoms)?.title || denom,
    image: (denom, denoms) => module.getDenom(denom, denoms)?.image,
    amount: (value, denom, denoms, chain_id) => BigNumber(!isNaN(value) ? value : 0).shiftedBy(-(module.getDenom(denom, denoms)?.contracts?.find(c => c?.chain_id === chain_id)?.contract_decimals || module.getDenom(denom, denoms)?.contract_decimals || 6)).toNumber(),
  };
  return module;
};