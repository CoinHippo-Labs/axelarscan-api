const { getAPI, getWS } = require('../../../utils/config');
const { log, sleep, toArray, parseRequestError } = require('../../../utils');

module.exports = async context => {
  const api = getAPI();
  const ws = getWS();
  if (api && ws) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler-tx`;
    const subscribe = () => {
      const events = ['open', 'error', 'close', 'message'];
      events.forEach(event => {
        ws.on(
          event,
          async output => {
            switch (event) {
              case 'open':
                const data = {
                  jsonrpc: '2.0',
                  method: 'subscribe',
                  id: '0',
                  params: { query: `tm.event='Tx'` },
                };
                log('debug', service_name, 'connect ws', data);
                ws.send(JSON.stringify(data));
                break;
              case 'error':
                log('error', service_name, 'ws error', { error: output?.message });
                ws.close();
                break;
              case 'close':
                log('debug', service_name, 'disconnect ws', { code: output });
                await sleep(0.2 * 1000);
                subscribe();
                break;
              case 'message':
                try {
                  const data = JSON.parse(output.toString());
                  const { events } = { ...data?.result };
                  for (const txhash of toArray(events?.['tx.hash'])) {
                    log('info', service_name, 'get tx', { txhash });
                    await api.get('/', { params: { index: true, method: 'lcd', path: `/cosmos/tx/v1beta1/txs/${txhash}` } }).catch(error => parseRequestError(error));
                  }
                } catch (error) {}
                break;
              default:
                break;
            }
          },
        );
      });
    };
    subscribe();
    if (context) {
      while (context.getRemainingTimeInMillis() > 2 * 1000) {
        if (context.getRemainingTimeInMillis() < 5 * 1000) {
          ws.close();
        }
        await sleep(1 * 1000);
      }
    }
  }
};