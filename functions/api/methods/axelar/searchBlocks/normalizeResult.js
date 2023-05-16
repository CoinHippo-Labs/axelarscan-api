const {
  getChainData,
} = require('../../../utils/config');
const {
  base64ToHex,
} = require('../../../utils/base64');
const {
  base64ToBech32,
} = require('../../../utils/bech32');
const {
  toArray,
} = require('../../../utils');

module.exports = data => {
  const {
    prefix_address,
  } = { ...getChainData('axelarnet') };

  return (
    toArray(data).map(d => {
      const {
        height,
        hash,
        proposer_address,
        num_txs,
      } = { ...d };

      return {
        ...d,
        height: Number(height),
        hash: base64ToHex(hash),
        proposer_address: base64ToBech32(proposer_address, `${prefix_address}valcons`),
        num_txs: num_txs || 0,
      };
    })
  );
};
