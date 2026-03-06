const CLOUD_COST_PER_1K_TOKENS = 0.006;
const DEVICE_COST_PER_1K_TOKENS = 0.0004;

const roundCurrency = (value) => Number(value.toFixed(6));

export const estimateCosts = ({ totalTokens = 0, cloudHandoff = false }) => {
  const tokenFactor = totalTokens / 1000;
  const cloudCost = roundCurrency(tokenFactor * CLOUD_COST_PER_1K_TOKENS);
  const deviceCost = roundCurrency(tokenFactor * DEVICE_COST_PER_1K_TOKENS);

  if (cloudHandoff) {
    return {
      cloudCost,
      deviceCost: cloudCost,
      saved: 0
    };
  }

  return {
    cloudCost,
    deviceCost,
    saved: roundCurrency(Math.max(cloudCost - deviceCost, 0))
  };
};
