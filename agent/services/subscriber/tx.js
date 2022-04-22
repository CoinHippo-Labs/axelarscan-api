// import module for http request
const axios = require('axios');
// import web socket
const WebSocket = require('ws');
// import config
const config = require('config-yml');
// import utils
const { log, sleep } = require('../../utils');

// initial service name
const service_name = 'tx-subscriber';

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

module.exports = () => {
  if (config?.[environment]?.endpoints?.rpc && config[environment].endpoints.api) {
    // initial endpoints
    const rpc = config[environment].endpoints.rpc, api = config[environment].endpoints.api;

    // initial api requester
    const requester = axios.create({ baseURL: api });

    // initial function to subscribe web socket
    const subscribe = () => {
      // initial web socket
      const url = `ws://${new URL(rpc).hostname}:${new URL(rpc).port}/websocket`;
      const ws = new WebSocket(url);

      ws.on('open', () => {
        log('info', service_name, 'connect', { url });
        ws.send('{"jsonrpc":"2.0","method":"subscribe","id":"0","params":{"query":"tm.event=\'Tx\'"}}');
      });

      ws.on('close', async code => {
        log('info', service_name, 'disconnect', { code });
        await sleep(3 * 1000);
        subscribe();
      });

      ws.on('error', error => {
        log('error', service_name, 'error', { message: error.message });
        ws.close();
      });

      ws.on('message', async data => {
        try {
          data = JSON.parse(data.toString());
          const hashes = data?.result?.events?.['tx.hash'] || [];
          for (let i = 0; i < hashes.length; i++) {
            const hash = hashes[i];
            log('info', service_name, 'get tx', { hash });
            // request api
            await requester.get('', { params: { module: 'lcd', path: `/cosmos/tx/v1beta1/txs/${hash}` } })
              .catch(error => { return { data: { error } }; });
          }
        } catch (error) {}
      });
    }

    // start subscribe
    subscribe();
  }
};