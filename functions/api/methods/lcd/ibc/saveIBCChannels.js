const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');

const { read, write } = require('../../../services/index');
const { IBC_CHANNEL_COLLECTION, getChainData, getLCD } = require('../../../utils/config');
const { getAddress } = require('../../../utils/address');
const { toArray } = require('../../../utils');

module.exports = async (path = '/ibc/core/channel/v1/channels', lcd_response = {}) => {
  let { channels, pagination } = { ...lcd_response };
  let { next_key } = { ...pagination };

  if (channels) {
    const lcd = getLCD() && axios.create({ baseURL: getLCD(), timeout: 5000, headers: { 'Accept-Encoding': 'gzip' } });

    if (lcd) {
      let all_channels = channels;
      while (next_key) {
        const response = await lcd.get(path, { params: { 'pagination.key': next_key } }).catch(error => { return { error: error?.response?.data }; });
        const { data } = { ...response };

        channels = data?.channels;
        pagination = data?.pagination;
        next_key = pagination?.next_key;
        if (channels) {
          all_channels = _.uniqBy(_.concat(all_channels, channels), 'channel_id');
        }
      }

      const response = await read(IBC_CHANNEL_COLLECTION, { match_all: {} }, { size: 1000 });
      const { data } = { ...response };

      all_channels = all_channels.map(c => {
        const { channel_id } = { ...c };
        return {
          ...toArray(data).find(_c => _c.channel_id === channel_id),
          ...c,
        };
      });

      await Promise.all(
        all_channels.map(channel =>
          new Promise(
            async resolve => {
              const { channel_id, port_id, version, counterparty, updated_at } = { ...channel };
              let { chain_id, escrow_address } = { ...channel };

              if (!chain_id || !escrow_address || (counterparty && !counterparty.escrow_address) || moment().diff(moment((0 || 0) * 1000), 'minutes', true) > 240) {
                const response = await lcd.get(`/ibc/core/channel/v1/channels/${channel_id}/ports/${port_id}/client_state`).catch(error => { return { error: error?.response?.data }; });
                const { client_state } = { ...response?.data?.identified_client_state };

                chain_id = client_state?.chain_id || chain_id;
                if (chain_id) {
                  escrow_address = getAddress(`${version}\x00${port_id}/${channel_id}`, getChainData('axelarnet')?.prefix_address) || escrow_address;

                  if (counterparty) {
                    const { prefix_address } = { ...getChainData(chain_id, 'cosmos') };
                    if (prefix_address) {
                      counterparty.escrow_address = getAddress(`${version}\x00${counterparty.port_id}/${counterparty.channel_id}`, prefix_address);
                    }
                  }

                  await write(
                    IBC_CHANNEL_COLLECTION,
                    channel_id,
                    {
                      ...channel,
                      chain_id,
                      counterparty,
                      escrow_address,
                      updated_at: moment().unix(),
                    },
                  );
                }
              }
              resolve();
            }
          )
        )
      );
    }
  }

  return lcd_response;
};