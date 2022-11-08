const lcd = require('../');

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const hashes = tx_responses
      .filter(t =>
        !t?.code &&
        [
          'RouteIBCTransfersRequest',
          'MsgAcknowledgement',
          'MsgTimeout',
          'ExecutePendingTransfersRequest',
        ].findIndex(s =>
          (t?.tx?.body?.messages || [])
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      )
      .map(t => t.txhash);

    if (hashes.length > 0) {
      for (let i = 0; i < hashes.length; i++) {
        const txhash = hashes[i];

        const path = `/cosmos/tx/v1beta1/txs/${txhash}`;

        if (
          i === 0 ||
          i === hashes.length - 1
        ) {
          await lcd(
            path,
          );
        }
        else {
          lcd(
            path,
          );
        }
      }
    }
  } catch (error) {}
};