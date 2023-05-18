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

module.exports = async (
  lcd_response = {},
) => {
  const {
    block,
    block_id,
  } = { ...lcd_response };

  const {
    header,
    last_commit,
  } = { ...block };

  const {
    hash,
  } = { ...block_id };

  const {
    hash,
    proposer_address,
  } = { ...header };

  const {
    signatures,
  } = { ...last_commit };

  const {
    prefix_address,
  } = { ...getChainData('axelarnet') };

  if (hash) {
    lcd_response.block_id.hash = base64ToHex(hash);
  }

  if (proposer_address) {
    lcd_response.block.header.proposer_address = base64ToBech32(proposer_address, `${prefix_address}valcons`);
  }

  if (signatures) {
    lcd_response.block.last_commit.validators = toArray(toArray(signatures).map(s => s.validator_address)).map(a => base64ToBech32(a, `${prefix_address}valcons`));
  }

  return lcd_response;
};