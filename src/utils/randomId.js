export const randomId = () => {
  if (typeof global.crypto?.randomUUID === 'function') {
    return global.crypto.randomUUID();
  }

  const randomHex = Math.random().toString(16).slice(2);
  return `${Date.now()}-${randomHex}`;
};
