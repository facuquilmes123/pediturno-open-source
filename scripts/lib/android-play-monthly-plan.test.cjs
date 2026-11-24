const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_PRICE, existingDraftUpdate, verifyExistingDraftReadback } = require('./android-play-monthly-plan.cjs');

function subscription(plan = {}) {
  return {
    packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly',
    basePlans: [{
      basePlanId: 'monthly', state: 'DRAFT', offerTags: [{ tag: 'preserve-me' }],
      autoRenewingBasePlanType: { billingPeriodDuration: 'P1M', gracePeriodDuration: 'P7D', accountHoldDuration: 'P53D' },
      otherRegionsConfig: { newSubscriberAvailability: false, usdPrice: { currencyCode: 'USD', units: '4', nanos: 0 }, eurPrice: { currencyCode: 'EUR', units: '4', nanos: 0 } },
      regionalConfigs: [
        { regionCode: 'AR', newSubscriberAvailability: true, price: { currencyCode: 'ARS', units: '6150', nanos: 0 } },
        { regionCode: 'BR', newSubscriberAvailability: false, price: { currencyCode: 'BRL', units: '20', nanos: 0 } },
      ],
      ...plan,
    }],
  };
}

const conversion = {
  regionVersion: { version: '2026/10' },
  convertedRegionPrices: {
    AR: { regionCode: 'AR', price: { currencyCode: 'ARS', units: '9999', nanos: 0 } },
    BR: { regionCode: 'BR', price: { currencyCode: 'BRL', units: '40', nanos: 0 } },
  },
};

test('existing draft preview updates only existing region prices and preserves plan configuration', () => {
  const result = existingDraftUpdate(subscription(), conversion);
  const plan = result.intended.basePlans[0];
  assert.deepEqual(SOURCE_PRICE, { currencyCode: 'USD', units: '7', nanos: 0 });
  assert.equal(result.regionsVersion, '2026/10');
  assert.equal(plan.state, undefined);
  assert.deepEqual(plan.offerTags, [{ tag: 'preserve-me' }]);
  assert.deepEqual(plan.autoRenewingBasePlanType, { billingPeriodDuration: 'P1M', gracePeriodDuration: 'P7D', accountHoldDuration: 'P53D' });
  assert.deepEqual(plan.otherRegionsConfig, subscription().basePlans[0].otherRegionsConfig);
  assert.deepEqual(plan.regionalConfigs.map(region => region.regionCode), ['AR', 'BR']);
  assert.equal(plan.regionalConfigs[0].price.units, '9999');
  assert.equal(plan.regionalConfigs[1].price.units, '40');
  assert.equal(plan.regionalConfigs[1].newSubscriberAvailability, false);
});

test('existing draft guard rejects non-draft, non-monthly, non-P1M, or missing official region pricing', () => {
  assert.throws(() => existingDraftUpdate(subscription({ state: 'ACTIVE' }), conversion), /monthly DRAFT P1M/);
  assert.throws(() => existingDraftUpdate(subscription({ basePlanId: 'annual' }), conversion), /monthly DRAFT P1M/);
  assert.throws(() => existingDraftUpdate(subscription({ autoRenewingBasePlanType: { billingPeriodDuration: 'P1Y' } }), conversion), /monthly DRAFT P1M/);
  assert.throws(() => existingDraftUpdate(subscription(), { regionVersion: { version: 'x' }, convertedRegionPrices: { AR: conversion.convertedRegionPrices.AR } }), /BR/);
});

test('readback requires the same regions, availability and converted prices while remaining draft', () => {
  const update = existingDraftUpdate(subscription(), conversion);
  const verified = subscription({
    regionalConfigs: structuredClone(update.intended.basePlans[0].regionalConfigs),
  });
  assert.doesNotThrow(() => verifyExistingDraftReadback(verified, update.intended));
  verified.basePlans[0].regionalConfigs[1].newSubscriberAvailability = true;
  assert.throws(() => verifyExistingDraftReadback(verified, update.intended), /regional draft price/);
});
