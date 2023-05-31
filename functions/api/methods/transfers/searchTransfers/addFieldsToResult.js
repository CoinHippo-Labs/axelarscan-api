const { toArray } = require('../../../utils');

module.exports = data => toArray(data).map(d => {
  const {
    send,
    link,
    confirm,
    vote,
    command,
    ibc_send,
    axelar_transfer,
    wrap,
    unwrap,
    erc20_transfer,
    type,
  } = { ...d };
  const { amount, value, insufficient_fee } = { ...send };
  const { price } = { ...link };

  if (link && typeof price !== 'number' && typeof amount === 'number' && typeof value === 'number' && amount) {
    d.link.price = value / amount;
  }

  const status =
    ibc_send ?
      ibc_send.failed_txhash && !ibc_send.ack_txhash ?
        'ibc_failed' :
        ibc_send.recv_txhash || unwrap ?
          'executed' :
          'ibc_sent' :
      command?.executed || unwrap ?
        'executed' :
         command ?
          'batch_signed' :
          axelar_transfer || unwrap ?
            'executed' :
            vote ?
              'voted' :
              confirm ?
                'deposit_confirmed' :
                send?.status === 'failed' && !wrap && !erc20_transfer ?
                  'send_failed' :
                  'asset_sent';

  let simplified_status;
  switch (status) {
    case 'ibc_failed':
    case 'send_failed':
      simplified_status = 'failed';
      break;
    case 'executed':
      simplified_status = 'received';
      break;
    case 'ibc_sent':
    case 'batch_signed':
    case 'voted':
    case 'deposit_confirmed':
      simplified_status = 'approved';
      break;
    default:
      simplified_status = 'sent';
      break;
  }

  switch (simplified_status) {
    case 'failed':
    case 'received':
    case 'approved':
      if (insufficient_fee) {
        d.send.insufficient_fee = false;
      }
      break;
    default:
      break;
  }

  return {
    ...d,
    type: wrap ? 'wrap' : unwrap ? 'unwrap' : erc20_transfer ? 'erc20_transfer' : type,
    status,
    simplified_status,
  };
});