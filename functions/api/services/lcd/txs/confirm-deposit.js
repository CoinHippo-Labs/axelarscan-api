const _ = require('lodash');

const lcd = require('../');
const {
  transfer_actions,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const hashes = tx_responses.filter(t => !t?.code && transfer_actions.findIndex(s => (t?.tx?.body?.messages || []).findIndex(m => _.last((m?.['@type'] || '').split('.')).replace('Request', '').includes(s)) > -1) > -1).map(t => t.txhash);

    if (hashes.length > 0) {
      for (let i = 0; i < hashes.length; i++) {
        const txhash = hashes[i];

        const path = `/cosmos/tx/v1beta1/txs/${txhash}`;

        if (i === 0 || i === hashes.length - 1) {
          await lcd(path);
        }
        else {
          lcd(path);
        }
      }
    }
  } catch (error) {}
};