const SOURCE_PRICE = Object.freeze({ currencyCode: 'USD', units: '7', nanos: 0 });

function sameMoney(left, right) {
  return left?.currencyCode === right?.currencyCode &&
    BigInt(left?.units ?? 0) === BigInt(right?.units ?? 0) &&
    Number(left?.nanos ?? 0) === Number(right?.nanos ?? 0);
}

function draftMonthlyPlan(plan) {
  return plan?.basePlanId === 'monthly' && plan?.state === 'DRAFT' &&
    plan?.autoRenewingBasePlanType?.billingPeriodDuration === 'P1M';
}

function convertedPrice(conversion, regionCode) {
  const converted = conversion?.convertedRegionPrices?.[regionCode];
  if (!converted?.price?.currencyCode) throw new Error(`Official converted price missing for existing region ${regionCode}.`);
  return converted.price;
}

function existingDraftUpdate(current, conversion) {
  if (!current || current.packageName !== 'com.pediturno.servicios' || current.productId !== 'pediturno_servicios_pro_monthly') {
    throw new Error('Subscription identity mismatch.');
  }
  if (!Array.isArray(current.basePlans) || current.basePlans.length !== 1 || !draftMonthlyPlan(current.basePlans[0])) {
    throw new Error('Only one monthly DRAFT P1M base plan can be updated safely.');
  }
  const plan = current.basePlans[0];
  if (!Array.isArray(plan.regionalConfigs) || plan.regionalConfigs.length < 1) throw new Error('Existing draft has no regional configurations to preserve.');
  const regionsVersion = conversion?.regionVersion?.version;
  if (typeof regionsVersion !== 'string' || !regionsVersion) throw new Error('Official regions version missing.');
  const { state: _state, regionalConfigs, ...preservedPlan } = plan;
  const updatedPlan = {
    ...preservedPlan,
    regionalConfigs: regionalConfigs.map(config => {
      if (!config || typeof config.regionCode !== 'string' || !config.regionCode) throw new Error('Existing draft has an invalid region configuration.');
      // Keep the approved regions and availability exactly as they are; only refresh price from USD 7 conversion.
      return { ...config, price: convertedPrice(conversion, config.regionCode) };
    }),
  };
  return {
    regionsVersion,
    intended: { packageName: current.packageName, productId: current.productId, basePlans: [updatedPlan] },
  };
}

function newDraftPlan(conversion) {
  const argentina = convertedPrice(conversion, 'AR');
  const regionsVersion = conversion?.regionVersion?.version;
  if (!regionsVersion) throw new Error('Official Argentina conversion or regions version missing.');
  return {
    regionsVersion,
    intended: {
      packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly',
      basePlans: [{
        basePlanId: 'monthly',
        autoRenewingBasePlanType: { billingPeriodDuration: 'P1M', gracePeriodDuration: 'P7D' },
        regionalConfigs: [{ regionCode: 'AR', newSubscriberAvailability: true, price: argentina }],
      }],
    },
  };
}

function verifyExistingDraftReadback(verified, intended) {
  const plans = verified?.basePlans;
  const expected = intended?.basePlans;
  if (!Array.isArray(plans) || !Array.isArray(expected) || plans.length !== 1 || expected.length !== 1 || !draftMonthlyPlan(plans[0])) {
    throw new Error('Readback did not preserve one monthly DRAFT P1M plan.');
  }
  const actualRegions = plans[0].regionalConfigs;
  const expectedRegions = expected[0].regionalConfigs;
  if (!Array.isArray(actualRegions) || actualRegions.length !== expectedRegions.length) throw new Error('Readback changed configured regions.');
  for (const expectedRegion of expectedRegions) {
    const actual = actualRegions.find(region => region.regionCode === expectedRegion.regionCode);
    if (!actual || actual.newSubscriberAvailability !== expectedRegion.newSubscriberAvailability || !sameMoney(actual.price, expectedRegion.price)) {
      throw new Error('Readback did not preserve the intended regional draft price.');
    }
  }
}

module.exports = { SOURCE_PRICE, existingDraftUpdate, newDraftPlan, verifyExistingDraftReadback };
