const stringToBeArray = string => {
  let array;

  try {
    array = new Uint8Array(new ArrayBuffer(string.length));

    array.forEach((_, i) => {
      array[i] = string.charCodeAt(i);
    });
  } catch (error) {}

  return array;
};

module.exports = {
  stringToBeArray,
};