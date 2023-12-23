const moment = require('moment');

const timeDiff = (fromTime = moment().subtract(5, 'minutes'), unit = 'seconds', toTime = moment(), exact = false) => moment(toTime).diff(moment(fromTime), unit, exact);

module.exports = {
  timeDiff,
};