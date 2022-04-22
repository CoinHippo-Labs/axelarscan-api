// import module for http request
const axios = require('axios');
// import web socket
const WebSocket = require('ws');
// import config
const config = require('config-yml');
// import utils
const { log, sleep } = require('../../utils');

// initial service name
const service_name = 'block-subscriber';

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
        ws.send('{"jsonrpc":"2.0","method":"subscribe","id":"0","params":{"query":"tm.event=\'NewBlock\'"}}');
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
          if (data?.result?.data?.value?.block?.header?.height) {
            const height = Number(data.result.data.value.block.header.height);
            // initial num previous blocks to fetch transactions
            const num_prev_blocks_fetch_tx = config[environment].num_prev_blocks_fetch_tx || 0;

            log('info', service_name, 'get block', { height });
            for (let i = 0; i <= num_prev_blocks_fetch_tx; i++) {
              const _height = height - i;
              if (_height > 0) {
                // request api
                await requester.get('', {
                  params: {
                    module: 'lcd',
                    path: i === 0 ? `/cosmos/base/tendermint/v1beta1/blocks/${_height}` : '/cosmos/tx/v1beta1/txs',
                    events: i === 0 ? undefined : `tx.height=${_height}`,
                  },
                }).catch(error => { return { data: { error } }; });
              }
            }
          }
        } catch (error) {}
      });
    }

    // start subscribe
    subscribe();
  }
};