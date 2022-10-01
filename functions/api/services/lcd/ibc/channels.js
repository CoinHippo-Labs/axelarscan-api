const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
  write,
} = require('../../index');
const {
  to_hash,
  get_address,
} = require('../../../utils/address');

const environment = process.env.ENVIRONMENT || config?.environment;

const data = require('../../../data');
const cosmos_chains_data = data?.chains?.[environment]?.cosmos || [];
const axelarnet = cosmos_chains_data.find(c => c?.id === 'axelarnet');

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  path = '/ibc/core/channel/v1/channels',
  lcd_response = {},
) => {
  let response;

  let {
    channels,
    pagination,
  } = { ...lcd_response };
  let {
    next_key,
  } = { ...pagination };

  if (
    channels &&
    endpoints?.lcd
  ) {
    const lcd = axios.create({ baseURL: endpoints.lcd });

    let all_channels = channels;

    while (next_key) {
      const _response = await lcd.get(
        path,
        {
          params: {
            'pagination.key': next_key,
          },
        },
      ).catch(error => { return { data: { error } }; });

      const {
        data,
      } = { ..._response };

      channels = data?.channels;
      pagination = data?.pagination;
      next_key = pagination?.next_key;

      if (channels) {
        all_channels = _.uniqBy(
          _.concat(
            all_channels,
            channels,
          ),
          'channel_id',
        );
      }
    }

    const _response = await read(
      'ibc_channels',
      {
        match_all: {},
      },
      {
        size: 1000,
      },
    );

    const {
      data,
    } = { ..._response };

    all_channels = all_channels
      .map(c => {
        const {
          channel_id,
        } = { ...c };

        return {
          ...data?.find(_c => _c?.channel_id === channel_id),
          ...c,
        };
      });

    for (const channel of all_channels) {
      const {
        channel_id,
        port_id,
        version,
        counterparty,
        updated_at,
      } = { ...channel };
      let {
        chain_id,
        escrow_address,
      } = { ...channel };

      if (
        !chain_id ||
        !escrow_address ||
        (counterparty && !counterparty.escrow_address) ||
        moment().diff(moment((updated_at || 0) * 1000), 'minutes', true) > 240
      ) {
        const __response = await lcd.get(
          `/ibc/core/channel/v1/channels/${channel_id}/ports/${port_id}/client_state`,
        ).catch(error => { return { data: { error } }; });

        const {
          client_state,
        } = { ...__response?.data?.identified_client_state };

        chain_id = client_state?.chain_id ||
          chain_id;

        if (chain_id) {
          escrow_address =
            get_address(
              `${version}\x00${port_id}/${channel_id}`,
              axelarnet?.prefix_address,
            ) ||
              escrow_address;

          if (counterparty) {
            const chain_data = cosmos_chains_data.find(c =>
              c?.prefix_chain_ids?.findIndex(p => chain_id.startsWith(p)) > -1 ||
              Object.values({ ...c?.overrides })
                .findIndex(o => o?.prefix_chain_ids?.findIndex(p => chain_id.startsWith(p)) > -1) > -1
            );
            const {
              prefix_address,
            } = { ...chain_data };

            if (prefix_address) {
              counterparty.escrow_address = get_address(
                `${version}\x00${counterparty.port_id}/${counterparty.channel_id}`,
                prefix_address,
              );
            }
          }

          await write(
            'ibc_channels',
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
    }
  }

  response = lcd_response;

  return response;
};