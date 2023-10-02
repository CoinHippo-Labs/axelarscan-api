const { getMapping } = require('../../services/index');
const { TRANSFER_COLLECTION } = require('../../utils/config');

module.exports = async () => {
  const COLLECTION = TRANSFER_COLLECTION;
  const response = await getMapping(COLLECTION);
  const { properties } = { ...response?.[COLLECTION]?.mappings };
  return properties && {
    ...properties,
    status: { type: 'text' },
    simplified_status: { type: 'text' },
  };
};