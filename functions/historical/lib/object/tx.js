const _ = require('lodash');

const { fee_denom, denomer } = require('./denom')();

module.exports = () => {
  const module = {};
  module.tx_manager = {
    status: tx => tx && !tx.code ? 'success' : 'failed',
    type: tx => {
      let type = _.head(tx?.logs?.flatMap(log => log?.events?.filter(event => event.type === 'message').map(event => event.type === 'message' ? event.attributes && _.head(event.attributes.filter(attribute => attribute.key === 'action').map(attribute => _.last(attribute.value?.split('.') || []))) : event.type)));
      if (tx) {
        if (!tx.code) {
          if (tx?.tx?.body?.messages?.findIndex(message => message?.inner_message?.['@type']) > -1) {
            type = _.last(tx.tx.body.messages.find(message => message?.inner_message?.['@type']).inner_message['@type'].split('.'));
          }
        }
        else {
          if (tx?.tx?.body?.messages?.findIndex(message => message?.['@type']) > -1) {
            type = _.last(tx.tx.body.messages.find(message => message?.['@type'])['@type'].split('.'));
          }
        }
      }
      return type?.replace('Request', '');
    },
    fee: (tx, denoms) => tx?.tx?.auth_info?.fee?.amount && denomer.amount(_.sumBy(tx.tx.auth_info.fee.amount, 'amount'), fee_denom, denoms),
    symbol: (tx, denoms) => tx?.tx?.auth_info?.fee?.amount && _.head(tx.tx.auth_info.fee.amount.map(amount => denomer.symbol(amount?.denom, denoms)).filter(denom => denom)),
    gas_used: tx => tx && Number(tx.gas_used),
    gas_limit: tx => tx && Number(tx.gas_wanted),
    memo: tx => tx?.tx?.body?.memo,
    activities: (tx, denoms) => {
      const activities = tx?.logs?.map(log => log?.events && _.assign.apply(_, (log.events.map(event => {
        const event_obj = {
          type: event.type,
          log: log.log, ...((event.attributes && _.assign.apply(_, event.attributes.map(attribute => {
            const attr_obj = {
              [`${attribute.key}`]: attribute.key === 'amount' && typeof attribute.value === 'string' ? denomer.amount(attribute.value.substring(0, attribute.value.split('').findIndex(c => isNaN(c)) > -1 ? attribute.value.split('').findIndex(c => isNaN(c)) : undefined), attribute.value.split('').findIndex(c => isNaN(c)) > -1 ? attribute.value.substring(attribute.value.split('').findIndex(c => isNaN(c))) : denoms?.[0]?.denom, denoms) : attribute.key === 'action' ? _.last(attribute.value?.split('.') || []) : attribute.value,
            };
            if (attribute.key === 'amount' && typeof attribute.value === 'string') {
              attr_obj.symbol = denomer.symbol(attribute.value.split('').findIndex(c => isNaN(c)) > -1 ? attribute.value.substring(attribute.value.split('').findIndex(c => isNaN(c))) : denoms?.[0]?.denom, denoms);
            }
            if (!attr_obj.symbol) {
              const attribute_amount = event.attributes.find(_attribute => _attribute.key === 'amount');
              const attribute_symbol = event.attributes.find(_attribute => _attribute.key === 'denom');

              if (attribute_symbol?.value) {
                attr_obj.symbol = _.last(attribute_symbol.value.split('/'));
                attr_obj.amount = denomer.amount(attribute_amount?.value || 0, attr_obj.symbol, denoms);
                attr_obj.symbol = denomer.symbol(attr_obj.symbol, denoms);
              }
            }
            return { ...attr_obj };
          }))) || {}),
        };
        if (!event_obj?.action) {
          event_obj.action = event_obj.type;
        }
        if (event?.attributes?.findIndex(attribute => attribute.key === 'recipient') > -1) {
          event_obj.recipient = _.uniq(event.attributes.filter(attribute => attribute.key === 'recipient').map(attribute => attribute.value));
        }
        return { ...event_obj };
      }))));
      if (activities?.length < 1 && tx?.code) {
        activities.push({ failed: true });
      }
      return activities;
    },
  };
  return module;
};