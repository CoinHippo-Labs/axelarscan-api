const { read } = require('../../services/index');
const { TX_COLLECTION } = require('../../utils/config');
const { toArray } = require('../../utils');

module.exports = async (size = 250) => {
  const response = await read(
    TX_COLLECTION,
    {
      bool: {
        must: [
          { match: { types: 'RegisterProxyRequest' } },
          { exists: { field: 'tx.body.messages.sender' } },
          { exists: { field: 'tx.body.messages.proxy_addr' } },
        ],
      },
    },
    { size },
  );
  const { data } = { ...response };
  return Object.fromEntries(
    toArray(data).map(d => {
      const { tx, height } = { ...d };
      const { messages } = { ...tx?.body };
      const { sender, proxy_addr } = { ...toArray(messages).find(m => m.sender && m.proxy_addr) };
      return [sender.toLowerCase(), { address: proxy_addr.toLowerCase(), height }];
    })
  );
};